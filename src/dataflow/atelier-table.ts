/**
 * Table d'échange `atelier-table/1` (docs/SUITE.md §7.2) : format unique des tables qui passent
 * d'une étape à l'autre d'un workflow Atelier Nexus.
 *
 * Une enveloppe DataFlow v2.1.0 se convertit exactement comme Atelier Viz l'aplatit (§4.2) :
 * - `_ligne` (`row_index`) et `_id` (`record_id`) en tête, puis une colonne par entrée de
 *   `columns_schema`, valeur = `computed` (un code d'erreur `#…!` devient `null`) ;
 * - type déduit de `type` : `currency | number | percent` → `number`, `formula` → `number` si
 *   toutes ses valeurs présentes sont des nombres, `date` → `date`, `checkbox` → `boolean`,
 *   sinon `string` (un booléen devient « Vrai » / « Faux », comme dans Viz) ;
 * - `key` : libellé en `snake_case` sans accent, unique dans la table (`_2`, `_3`…) ;
 * - les lignes de total (`summary_rows`) ne sont pas reprises.
 *
 * Module pur : filtres et pagination de l'outil `query_table` sont appliqués ici.
 */
import { ERROR_CODES } from '@/engine/formula/values'
import { parseDate, parseLocaleNumber } from '@/engine/field-types'
import type { AtelierPayload } from './schema/atelier.v2_1'

export const ATELIER_TABLE_FORMAT = 'atelier-table/1'

export type AtelierTableType = 'string' | 'number' | 'date' | 'datetime' | 'boolean'
export type AtelierTableValue = string | number | boolean | null

export interface AtelierTableColumn {
  key: string
  label: string
  type: AtelierTableType
}

export interface AtelierTable {
  format: typeof ATELIER_TABLE_FORMAT
  name: string
  label: string
  columns: AtelierTableColumn[]
  rows: Record<string, AtelierTableValue>[]
  total: number | null
  truncated: boolean
}

/** Colonne convertie, avec sa source dans l'enveloppe (pour résoudre une référence). */
export interface SourceColumn extends AtelierTableColumn {
  /** Lettre (A, B…) et id du champ ; absents pour `_ligne` et `_id`. */
  letter?: string
  fieldId?: string
}

export const ROW_KEY = '_ligne'
export const ID_KEY = '_id'

const NUMERIC_TYPES = new Set(['currency', 'number', 'percent'])
const ERRORS = new Set<string>(ERROR_CODES)

/** JSON Schema (draft 2020-12) d'une table `atelier-table/1`. */
export const ATELIER_TABLE_SCHEMA = {
  type: 'object',
  properties: {
    format: { const: ATELIER_TABLE_FORMAT },
    name: { type: 'string' },
    label: { type: 'string' },
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', pattern: '^[a-z0-9_]+$' },
          label: { type: 'string' },
          type: { enum: ['string', 'number', 'date', 'datetime', 'boolean'] },
        },
        required: ['key', 'label', 'type'],
      },
    },
    rows: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: { type: ['string', 'number', 'boolean', 'null'] },
      },
    },
    total: { type: ['integer', 'null'] },
    truncated: { type: 'boolean' },
  },
  required: ['format', 'name', 'label', 'columns', 'rows', 'total', 'truncated'],
} as const

/** Texte sans accent ni ligature, en minuscules (« Œuvre », « m² » → « oeuvre », « m2 »). */
export function foldText(text: string): string {
  return text
    .replace(/[œŒ]/g, 'oe')
    .replace(/[æÆ]/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Libellé → clé `snake_case` sans accent (« Coût HT » → `cout_ht`, « Échéance » → `echeance`). */
export function columnKey(label: string, fallback = 'colonne'): string {
  const key = foldText(label)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const base = key || foldText(fallback).replace(/[^a-z0-9]+/g, '_') || 'colonne'
  return /^[0-9]/.test(base) ? `c_${base}` : base
}

function uniqueKeys(keys: string[]): string[] {
  const out: string[] = []
  for (const key of keys) {
    let candidate = key
    for (let n = 2; out.includes(candidate); n++) candidate = `${key}_${n}`
    out.push(candidate)
  }
  return out
}

function isErrorCode(v: unknown): boolean {
  return typeof v === 'string' && ERRORS.has(v)
}

function asText(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return v ? 'Vrai' : 'Faux'
  return String(v)
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function asDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
}

function asBoolean(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    if (['true', 'vrai', 'oui'].includes(t)) return true
    if (['false', 'faux', 'non'].includes(t)) return false
  }
  return null
}

function convert(type: AtelierTableType, v: unknown): AtelierTableValue {
  switch (type) {
    case 'number':
      return asNumber(v)
    case 'date':
      return asDate(v)
    case 'boolean':
      return asBoolean(v)
    default:
      return asText(v)
  }
}

/**
 * Colonnes et lignes complètes d'une enveloppe DataFlow (sans filtre ni pagination).
 * Le type d'une colonne-formule est déduit de toutes ses valeurs : il ne dépend pas des filtres.
 */
export function flattenPayload(payload: AtelierPayload): {
  columns: SourceColumn[]
  rows: Record<string, AtelierTableValue>[]
} {
  const schema = payload.project.columns_schema
  const records = [...payload.project.records].sort((a, b) => a.row_index - b.row_index)
  const computed = (letter: string) =>
    records.map((r) => {
      const v = r.values[letter]?.computed ?? null
      return isErrorCode(v) ? null : v
    })

  const keys = uniqueKeys([
    ROW_KEY,
    ID_KEY,
    ...schema.map((c) => columnKey(c.label.trim(), c.col_letter)),
  ])
  const columns: SourceColumn[] = [
    { key: keys[0] as string, label: 'Ligne', type: 'number' },
    { key: keys[1] as string, label: 'Identifiant', type: 'string' },
  ]
  const values: AtelierTableValue[][] = [
    records.map((r) => r.row_index),
    records.map((r) => r.record_id),
  ]
  schema.forEach((col, i) => {
    const raw = computed(col.col_letter)
    const present = raw.filter((v) => v !== null && v !== '')
    let type: AtelierTableType = 'string'
    if (NUMERIC_TYPES.has(col.type)) type = 'number'
    else if (
      col.type === 'formula' &&
      present.length > 0 &&
      present.every((v) => typeof v === 'number')
    )
      type = 'number'
    else if (col.type === 'date') type = 'date'
    else if (col.type === 'checkbox') type = 'boolean'
    columns.push({
      key: keys[i + 2] as string,
      label: col.label.trim() || col.col_letter,
      type,
      letter: col.col_letter,
      fieldId: col.id,
    })
    values.push(raw.map((v) => (v === '' && type !== 'string' ? null : convert(type, v))))
  })

  const rows = records.map((_, r) => {
    const row: Record<string, AtelierTableValue> = {}
    columns.forEach((c, i) => {
      row[c.key] = values[i]?.[r] ?? null
    })
    return row
  })
  return { columns, rows }
}

// ---------------------------------------------------------------------------
// Requête : filtres, colonnes, pagination
// ---------------------------------------------------------------------------

export const FILTER_OPS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'empty',
  'not_empty',
] as const
export type FilterOp = (typeof FILTER_OPS)[number]

export interface TableFilter {
  /** Colonne déjà résolue (clé `atelier-table/1`). */
  key: string
  op: FilterOp
  value?: string | number | boolean | null
}

/** Erreur de requête (valeur de filtre incompatible avec le type de la colonne). */
export class TableQueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TableQueryError'
  }
}

function isEmpty(v: AtelierTableValue): boolean {
  return v === null || v === ''
}

/** Valeur du filtre dans le type de la colonne (comparable à la cellule). */
function operand(column: AtelierTableColumn, filter: TableFilter): AtelierTableValue {
  const v = filter.value ?? null
  if (v === null) return null
  const fail = (what: string) =>
    new TableQueryError(
      `Filtre « ${column.label} » (${filter.op}) : ${what} attendu, reçu ${JSON.stringify(v)}`,
    )
  switch (column.type) {
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? parseLocaleNumber(v) : null
      if (n === null) throw fail('un nombre')
      return n
    }
    case 'date': {
      const d = typeof v === 'string' ? parseDate(v) : null
      if (d === null) throw fail('une date (AAAA-MM-JJ ou JJ/MM/AAAA)')
      return d
    }
    case 'boolean': {
      const b = asBoolean(typeof v === 'boolean' ? v : String(v))
      if (b === null) throw fail('un booléen')
      return b
    }
    default:
      return asText(v)
  }
}

function compare(type: AtelierTableType, a: AtelierTableValue, b: AtelierTableValue): number {
  if (type === 'number') return (a as number) - (b as number)
  if (type === 'boolean') return Number(a) - Number(b)
  if (type === 'date' || type === 'datetime')
    return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
  return String(a).localeCompare(String(b), 'fr', { sensitivity: 'base', numeric: true })
}

function matches(
  column: AtelierTableColumn,
  cell: AtelierTableValue,
  filter: TableFilter,
): boolean {
  switch (filter.op) {
    case 'empty':
      return isEmpty(cell)
    case 'not_empty':
      return !isEmpty(cell)
    case 'contains': {
      if (isEmpty(cell)) return false
      const needle = asText(filter.value ?? null)
      return needle === null || foldText(asText(cell) ?? '').includes(foldText(needle))
    }
    default:
      break
  }
  const target = operand(column, filter)
  if (filter.op === 'eq' || filter.op === 'ne') {
    const equal =
      target === null || target === ''
        ? isEmpty(cell)
        : !isEmpty(cell) && compare(column.type, cell, target) === 0
    return filter.op === 'eq' ? equal : !equal
  }
  if (target === null || target === '') {
    throw new TableQueryError(`Filtre « ${column.label} » (${filter.op}) : valeur attendue`)
  }
  if (column.type === 'boolean') {
    throw new TableQueryError(
      `Filtre « ${column.label} » : ${filter.op} ne s’applique pas à une case à cocher (eq, ne, empty, not_empty)`,
    )
  }
  if (isEmpty(cell)) return false
  const c = compare(column.type, cell, target)
  if (filter.op === 'gt') return c > 0
  if (filter.op === 'gte') return c >= 0
  if (filter.op === 'lt') return c < 0
  return c <= 0
}

export interface TableQuery {
  /** Clés des colonnes à garder (`_ligne` et `_id` sont toujours en tête). Absent : toutes. */
  keys?: string[]
  filters?: TableFilter[]
  offset?: number
  limit?: number
}

/** Applique filtres (tous réunis par « et »), choix de colonnes et pagination. */
export function queryAtelierTable(
  source: {
    name: string
    label: string
    columns: SourceColumn[]
    rows: Record<string, AtelierTableValue>[]
  },
  query: TableQuery = {},
): AtelierTable {
  const byKey = new Map(source.columns.map((c) => [c.key, c]))
  const filters = query.filters ?? []
  const kept = source.rows.filter((row) =>
    filters.every((f) => {
      const column = byKey.get(f.key)
      if (!column) throw new TableQueryError(`Colonne inconnue : ${f.key}`)
      return matches(column, row[f.key] ?? null, f)
    }),
  )
  const wanted = query.keys ? new Set([ROW_KEY, ID_KEY, ...query.keys]) : null
  const columns = source.columns
    .filter((c) => !wanted || wanted.has(c.key))
    .map(({ key, label, type }) => ({ key, label, type }))
  const offset = query.offset ?? 0
  const limit = query.limit ?? kept.length
  const page = kept.slice(offset, offset + limit).map((row) => {
    const out: Record<string, AtelierTableValue> = {}
    for (const c of columns) out[c.key] = row[c.key] ?? null
    return out
  })
  return {
    format: ATELIER_TABLE_FORMAT,
    name: source.name,
    label: source.label,
    columns,
    rows: page,
    total: kept.length,
    truncated: page.length < kept.length,
  }
}

/** Table complète d'une enveloppe DataFlow, au format `atelier-table/1`. */
export function toAtelierTable(payload: AtelierPayload, query: TableQuery = {}): AtelierTable {
  const { columns, rows } = flattenPayload(payload)
  const source = payload.project.source_table
  return queryAtelierTable(
    {
      name: source?.id ?? payload.project.id,
      label: source?.name ?? payload.project.name,
      columns,
      rows,
    },
    query,
  )
}
