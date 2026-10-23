/**
 * Plan d'import (colonne source → champ) et calcul des changements à appliquer.
 *
 * `suggestPlan` propose une correspondance (champ existant du même nom, sinon nouvelle
 * colonne du type inféré) ; `buildImport` convertit chaque cellule avec les règles de
 * saisie de la grille (`parseUserInput`) et produit des `ImportChanges`, appliqués ensuite
 * par `applyImport` dans une seule mise à jour du store.
 */
import {
  choicesFromLabels,
  parseUserInput,
  WORKFLOW_STATUSES,
  workflowStatusCode,
  type LookupContext,
} from '@/engine/field-types'
import { isFormula, translateFormula, type CellInput } from '@/engine/formula'
import { defaultRowInsertIndex } from '@/engine/table'
import { newId } from '@/lib/ids'
import type {
  AtelierMapping,
  CellStore,
  CurrencyCode,
  Field,
  FieldOptions,
  FieldType,
  SelectChoice,
  Table,
} from '@/types/domain'
import { columnSample, sourceValue, type CsvAnalysis } from './analyze'
import { distinctLabels, inferFieldType, suggestMappings } from './infer'

export type ColumnTarget =
  | { kind: 'skip' }
  | { kind: 'field'; fieldId: string }
  | {
      kind: 'new'
      label: string
      type: FieldType
      currency?: CurrencyCode
      mapping?: AtelierMapping
    }

/** Clé de rapprochement des lignes : `id` (identifiants du CSV enrichi) ou index de colonne source. */
export type ImportKey = 'id' | number

export interface ImportPlan {
  /** Une cible par colonne source (`analysis.columns`), dans le même ordre. */
  targets: ColumnTarget[]
  /** `append` : toutes les lignes sont ajoutées. `upsert` : les lignes dont la clé existe sont mises à jour. */
  mode: 'append' | 'upsert'
  key?: ImportKey
}

export interface ImportChanges {
  /** Nouveaux champs, ajoutés à droite dans cet ordre. */
  newFields: Field[]
  /** Choix ajoutés aux champs `select` existants (libellés inconnus du CSV). */
  addedChoices: Record<string, SelectChoice[]>
  /** Lignes existantes mises à jour (les cellules vides du CSV n'effacent rien). */
  updates: { recordId: string; cells: CellStore }[]
  /** Nouvelles lignes ; `id` conservé quand c'est possible (CSV enrichi, nouvelle table). */
  inserts: { id?: string; cells: CellStore }[]
}

export interface ImportIssue {
  /** Numéro de la ligne de données du CSV (1 = première ligne après l'en-tête). */
  row: number
  column: string
  value: string
  reason: string
}

export interface ImportResult {
  changes: ImportChanges
  inserted: number
  updated: number
  /** Lignes du CSV sans aucune valeur dans les colonnes importées. */
  skipped: number
  /** Cellules contenant une formule. */
  formulas: number
  /** Valeurs refusées (cellule laissée vide), au plus `MAX_ISSUES`. */
  issues: ImportIssue[]
  issueCount: number
}

export const MAX_ISSUES = 50

function sameLabel(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), 'fr', { sensitivity: 'base' }) === 0
}

/**
 * Plan proposé. Table existante : chaque colonne dont l'en-tête est le libellé d'un champ y
 * est rattachée, les autres deviennent de nouvelles colonnes. Nouvelle table (`table` nul) :
 * une colonne par colonne source, avec type et rôle inférés.
 */
export function suggestPlan(
  analysis: CsvAnalysis,
  table: Table | null,
  ctx: LookupContext,
): ImportPlan {
  const fields = table ? table.fieldOrder.map((id) => table.fields[id]).filter(isField) : []
  const claimed = new Set<string>()
  const matches = analysis.columns.map((col) => {
    const f = fields.find(
      (field) =>
        !claimed.has(field.id) && field.type !== 'formula' && sameLabel(field.label, col.header),
    )
    if (f) claimed.add(f.id)
    return f
  })

  const inferred = analysis.columns.map((col, i) =>
    matches[i] ? null : inferFieldType(col.header, columnSample(analysis, col), ctx),
  )
  const taken = new Set(fields.map((f) => f.atelierMapping).filter(isMapping))
  const unmatched = analysis.columns
    .map((col, i) => ({ i, header: col.header, type: inferred[i]?.type }))
    .filter((c): c is { i: number; header: string; type: FieldType } => c.type !== undefined)
  const mappings = suggestMappings(unmatched, taken)
  const mappingOf = new Map(unmatched.map((c, k) => [c.i, mappings[k]]))

  const targets: ColumnTarget[] = analysis.columns.map((col, i) => {
    const match = matches[i]
    if (match) return { kind: 'field', fieldId: match.id }
    const t = inferred[i] ?? { type: 'text' as const }
    const mapping = mappingOf.get(i)
    return {
      kind: 'new',
      label: col.header,
      type: t.type,
      ...(t.currency ? { currency: t.currency } : {}),
      ...(mapping ? { mapping } : {}),
    }
  })

  // Réimport d'un CSV enrichi dans une table : mise à jour par identifiant.
  const upsertById =
    table !== null &&
    analysis.idIndex !== undefined &&
    analysis.rows.some((r) => table.records[(r[analysis.idIndex as number] ?? '').trim()])
  return upsertById ? { targets, mode: 'upsert', key: 'id' } : { targets, mode: 'append' }
}

function isField(f: Field | undefined): f is Field {
  return f !== undefined
}

function isMapping(m: AtelierMapping | undefined): m is AtelierMapping {
  return m !== undefined
}

/** Champ créé pour une cible `new` ; les choix d'un statut viennent des valeurs du CSV. */
function newFieldFor(
  target: Extract<ColumnTarget, { kind: 'new' }>,
  values: readonly string[],
): Field {
  const options: FieldOptions = {}
  if (target.type === 'select') {
    let labels = distinctLabels(values)
    // Uniquement des statuts de workflow : ordre du workflow (aussi celui du Kanban).
    if (labels.length > 0 && labels.every((l) => workflowStatusCode(l) !== null)) {
      const rank = (l: string) =>
        WORKFLOW_STATUSES.findIndex((s) => s.code === workflowStatusCode(l))
      labels = [...labels].sort((a, b) => rank(a) - rank(b))
    }
    options.choices = choicesFromLabels(labels)
  }
  if (target.type === 'currency') options.currency = target.currency ?? 'EUR'
  if (target.type === 'formula') options.resultFormat = 'number'
  return {
    id: newId('fld'),
    label: target.label.trim() || 'Colonne',
    type: target.type,
    ...(Object.keys(options).length ? { options } : {}),
    ...(target.mapping ? { atelierMapping: target.mapping } : {}),
    ...(target.type === 'text' && target.mapping === 'description' ? { width: 280 } : {}),
  }
}

function keyText(input: CellInput): string | null {
  if (input === null) return null
  return typeof input === 'string'
    ? input.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
    : JSON.stringify(input)
}

/**
 * Convertit le CSV selon le plan. Fonction pure : `table` n'est pas modifiée (nul pour une
 * nouvelle table). Les formules sont recopiées comme un copier-coller Excel : leurs
 * références relatives suivent le déplacement entre la ligne du CSV et la ligne d'arrivée.
 */
export function buildImport(
  analysis: CsvAnalysis,
  plan: ImportPlan,
  table: Table | null,
  ctx: LookupContext,
): ImportResult {
  const issues: ImportIssue[] = []
  let issueCount = 0
  let formulas = 0
  const report = (issue: ImportIssue) => {
    issueCount++
    if (issues.length < MAX_ISSUES) issues.push(issue)
  }

  // Champs cibles : existants (copie, pour y ajouter des choix) ou nouveaux.
  const newFields: Field[] = []
  const columns = analysis.columns.map((col, i) => {
    const target = plan.targets[i] ?? { kind: 'skip' }
    if (target.kind === 'skip') return null
    if (target.kind === 'field') {
      const existing = table?.fields[target.fieldId]
      if (!existing) return null
      return { col, field: structuredClone(existing), isNew: false }
    }
    const values = target.type === 'select' ? columnSample(analysis, col) : []
    const field = newFieldFor(target, values)
    newFields.push(field)
    return { col, field, isNew: true }
  })
  const active = columns.filter((c): c is NonNullable<typeof c> => c !== null)

  // Libellés inconnus d'un statut existant : ajoutés à ses choix plutôt que refusés.
  const addedChoices: Record<string, SelectChoice[]> = {}
  for (const { col, field, isNew } of active) {
    if (isNew || field.type !== 'select') continue
    const existing = field.options?.choices ?? []
    const unknown = distinctLabels(columnSample(analysis, col)).filter(
      (label) => !parseUserInput(field, label, ctx).ok,
    )
    if (unknown.length === 0) continue
    const added = choicesFromLabels(unknown, existing, existing.length)
    addedChoices[field.id] = added
    field.options = { ...field.options, choices: [...existing, ...added] }
  }

  // Rapprochement des lignes (mode upsert).
  const keyIndex = new Map<string, string>()
  let keyColumn: (typeof active)[number] | undefined
  if (plan.mode === 'upsert' && table && plan.key !== undefined && plan.key !== 'id') {
    keyColumn = active.find((c) => c.col === analysis.columns[plan.key as number])
    if (keyColumn && !keyColumn.isNew) {
      for (const rid of table.rowOrder) {
        const record = table.records[rid]
        if (record?.kind !== 'data') continue
        const k = keyText(record.cells[keyColumn.field.id] ?? null)
        if (k !== null && !keyIndex.has(k)) keyIndex.set(k, rid)
      }
    } else {
      keyColumn = undefined
    }
  }
  const matchRecord = (row: readonly string[]): string | undefined => {
    if (plan.mode !== 'upsert' || !table) return undefined
    if (plan.key === 'id') {
      if (analysis.idIndex === undefined) return undefined
      const id = (row[analysis.idIndex] ?? '').trim()
      return table.records[id]?.kind === 'data' ? id : undefined
    }
    if (!keyColumn) return undefined
    const parsed = parseUserInput(keyColumn.field, sourceValue(row, keyColumn.col), ctx)
    const k = parsed.ok ? keyText(parsed.input) : null
    return k === null ? undefined : keyIndex.get(k)
  }

  const updates: ImportChanges['updates'] = []
  const inserts: ImportChanges['inserts'] = []
  const insertAt = table ? defaultRowInsertIndex(table) : 0
  const usedIds = new Set<string>()
  let skipped = 0

  analysis.rows.forEach((row, i) => {
    const recordId = matchRecord(row)
    const targetRow = recordId
      ? (table as Table).rowOrder.indexOf(recordId)
      : insertAt + inserts.length
    const cells: CellStore = {}
    for (const { col, field } of active) {
      const text = sourceValue(row, col)
      if (text === '') continue
      const parsed = parseUserInput(field, text, ctx)
      if (!parsed.ok) {
        report({ row: i + 1, column: col.header, value: text, reason: parsed.reason })
        continue
      }
      let input = parsed.input
      if (isFormula(input)) {
        formulas++
        input = translateFormula(input, targetRow - i, 0)
      }
      if (input !== null && input !== '') cells[field.id] = input
    }
    if (Object.keys(cells).length === 0 && !recordId) {
      skipped++
      return
    }
    if (recordId) {
      updates.push({ recordId, cells })
      return
    }
    // Identifiant d'origine conservé pour une nouvelle table (aller-retour du CSV enrichi).
    const sourceId =
      table === null && analysis.idIndex !== undefined ? (row[analysis.idIndex] ?? '').trim() : ''
    if (/^[A-Za-z0-9_-]{1,64}$/.test(sourceId) && !usedIds.has(sourceId)) {
      usedIds.add(sourceId)
      inserts.push({ id: sourceId, cells })
    } else {
      inserts.push({ cells })
    }
  })

  return {
    changes: { newFields, addedChoices, updates, inserts },
    inserted: inserts.length,
    updated: updates.length,
    skipped,
    formulas,
    issues,
    issueCount,
  }
}
