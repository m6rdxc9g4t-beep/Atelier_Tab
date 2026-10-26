/**
 * TableSheet : fait le lien entre une table (identifiants stables) et le moteur de
 * formules (adresses A1). Synchronise le Workbook de façon incrémentale à partir
 * des instantanés immuables du store.
 */
import { formatNumberAsText } from '@/engine/formula/coerce'
import {
  columnToLetters,
  isError,
  translateFormula,
  Workbook,
  type CellInput,
  type CellValue,
} from '@/engine/formula'
import { toEngineInput, type LookupContext } from '@/engine/field-types'
import type { Field, Table, TableRecord } from '@/types/domain'

/** Clé d'une cellule côté domaine : `recordId:fieldId`. */
export type CellKey = string

export function cellKey(recordId: string, fieldId: string): CellKey {
  return `${recordId}:${fieldId}`
}

/**
 * Saisie effective d'une cellule : la valeur stockée si elle existe, sinon, pour une
 * colonne-formule et une ligne de données, le modèle recopié sur la ligne.
 */
export function effectiveInput(record: TableRecord, field: Field, rowIndex: number): CellInput {
  const stored = record.cells[field.id] ?? null
  if (stored !== null) return stored
  if (field.type === 'formula' && field.columnFormula && record.kind === 'data') {
    return translateFormula(field.columnFormula, rowIndex, 0)
  }
  return null
}

/**
 * Entrée donnée au moteur. Une case jamais cochée d'une ligne de données vaut FAUX, comme une
 * case décochée (et comme dans Excel) : NB.SI(…;FAUX), `=FAUX` et les filtres sont d'accord.
 */
function engineInput(
  record: TableRecord,
  field: Field,
  rowIndex: number,
  ctx: LookupContext,
): CellInput {
  const input = toEngineInput(field, effectiveInput(record, field, rowIndex), ctx)
  return input === null && field.type === 'checkbox' && record.kind === 'data' ? false : input
}

export interface ColumnSummary {
  sum: number
  average: number | null
  min: number | null
  max: number | null
  /** Nombre de valeurs numériques. */
  count: number
  /** Nombre de cellules non vides. */
  filled: number
  errors: number
}

export class TableSheet {
  private readonly wb = new Workbook()
  private table: Table | null = null
  private ctx: LookupContext | null = null
  /** Entrées moteur actuellement poussées, par adresse A1. */
  private readonly pushed = new Map<string, CellInput>()
  private readonly addressByKey = new Map<CellKey, string>()
  private readonly keyByAddress = new Map<string, CellKey>()

  /** Applique un nouvel instantané de la table. Renvoie les cellules dont la valeur a changé. */
  sync(table: Table, ctx: LookupContext): Set<CellKey> {
    const prev = this.table
    const structural =
      !prev ||
      prev.id !== table.id ||
      prev.fieldOrder !== table.fieldOrder ||
      prev.rowOrder !== table.rowOrder ||
      prev.fields !== table.fields ||
      this.ctx?.collaborators !== ctx.collaborators

    this.table = table
    this.ctx = ctx
    return structural ? this.rebuild(table, ctx) : this.patch(prev, table, ctx)
  }

  private rebuild(table: Table, ctx: LookupContext): Set<CellKey> {
    const before = new Set(this.addressByKey.keys())
    this.wb.clear()
    this.pushed.clear()
    this.addressByKey.clear()
    this.keyByAddress.clear()

    const entries: [string, CellInput][] = []
    table.rowOrder.forEach((recordId, r) => {
      const record = table.records[recordId]
      if (!record) return
      table.fieldOrder.forEach((fieldId, c) => {
        const field = table.fields[fieldId]
        if (!field) return
        const address = `${columnToLetters(c)}${r + 1}`
        const key = cellKey(recordId, fieldId)
        this.addressByKey.set(key, address)
        this.keyByAddress.set(address, key)
        const input = engineInput(record, field, r, ctx)
        if (input !== null) {
          entries.push([address, input])
          this.pushed.set(address, input)
        }
      })
    })
    this.wb.setCells(entries)
    return new Set([...before, ...this.addressByKey.keys()])
  }

  private patch(prev: Table, table: Table, ctx: LookupContext): Set<CellKey> {
    const updates: [string, CellInput][] = []
    table.rowOrder.forEach((recordId, r) => {
      const record = table.records[recordId]
      if (!record || record === prev.records[recordId]) return
      for (const fieldId of table.fieldOrder) {
        const field = table.fields[fieldId]
        const address = this.addressByKey.get(cellKey(recordId, fieldId))
        if (!field || !address) continue
        const input = engineInput(record, field, r, ctx)
        if (input !== (this.pushed.get(address) ?? null)) {
          updates.push([address, input])
          if (input === null) this.pushed.delete(address)
          else this.pushed.set(address, input)
        }
      }
    })
    if (updates.length === 0) return new Set()
    const changed = this.wb.setCells(updates)
    const keys = new Set<CellKey>()
    for (const address of changed) {
      const key = this.keyByAddress.get(address)
      if (key) keys.add(key)
    }
    return keys
  }

  // ---------------------------------------------------------------- lecture

  value(recordId: string, fieldId: string): CellValue {
    const address = this.addressByKey.get(cellKey(recordId, fieldId))
    return address ? this.wb.getValue(address) : null
  }

  /** Adresse A1 d'une cellule (ex. "D1"). */
  address(recordId: string, fieldId: string): string | null {
    return this.addressByKey.get(cellKey(recordId, fieldId)) ?? null
  }

  /** Cellule (domaine) à une adresse A1. */
  locate(address: string): { recordId: string; fieldId: string } | null {
    const key = this.keyByAddress.get(address.toUpperCase().replace(/\$/g, ''))
    if (!key) return null
    const [recordId = '', fieldId = ''] = key.split(':')
    return { recordId, fieldId }
  }

  /** Saisie effective (formule recopiée incluse) telle que vue par le moteur. */
  input(recordId: string, fieldId: string): CellInput {
    const address = this.addressByKey.get(cellKey(recordId, fieldId))
    return address ? (this.pushed.get(address) ?? null) : null
  }

  parseError(recordId: string, fieldId: string): string | null {
    const address = this.addressByKey.get(cellKey(recordId, fieldId))
    return address ? this.wb.getParseError(address) : null
  }

  /** Aperçu d'une formule saisie dans la barre `fx`, sans l'enregistrer. */
  preview(formula: string, recordId: string, fieldId: string): CellValue {
    const address = this.addressByKey.get(cellKey(recordId, fieldId))
    return this.wb.preview(formula, address ?? undefined)
  }

  /** Toutes les valeurs calculées, par clé domaine. */
  values(): Map<CellKey, CellValue> {
    const out = new Map<CellKey, CellValue>()
    for (const [key, address] of this.addressByKey) out.set(key, this.wb.getValue(address))
    return out
  }

  /**
   * Agrégats d'une colonne pour le pied de grille. Les lignes de synthèse (totaux)
   * sont exclues pour éviter le double comptage.
   */
  summarize(fieldId: string): ColumnSummary {
    const nums: number[] = []
    let filled = 0
    let errors = 0
    const table = this.table
    if (table) {
      for (const recordId of table.rowOrder) {
        if (table.records[recordId]?.kind !== 'data') continue
        const v = this.value(recordId, fieldId)
        if (v === null || v === '') continue
        filled++
        if (isError(v)) errors++
        else if (typeof v === 'number') nums.push(v)
      }
    }
    const sum = Number(nums.reduce((a, b) => a + b, 0).toPrecision(15))
    return {
      sum,
      average: nums.length ? Number((sum / nums.length).toPrecision(15)) : null,
      min: nums.length ? Math.min(...nums) : null,
      max: nums.length ? Math.max(...nums) : null,
      count: nums.length,
      filled,
      errors,
    }
  }
}

/** Valeur texte brute d'une cellule calculée (debug, CSV). */
export function plainText(v: CellValue): string {
  if (v === null) return ''
  if (isError(v)) return v.code
  if (typeof v === 'number') return formatNumberAsText(v)
  return String(v)
}
