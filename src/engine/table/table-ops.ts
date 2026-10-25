/**
 * Opérations structurelles pures sur une table : insertion / suppression de lignes et
 * de colonnes avec réécriture des formules, comme dans Excel.
 *
 * Ces fonctions sont conçues pour être appelées dans un producteur Immer (elles
 * modifient la table reçue) mais n'en dépendent pas.
 */
import {
  isFormula,
  moveReferences,
  shiftReferences,
  type MoveChange,
  type StructuralChange,
} from '@/engine/formula'
import type { Field, Table, TableRecord } from '@/types/domain'

/**
 * Applique un changement structurel à toutes les formules de la table.
 * Les modèles de colonnes-formules sont écrits pour « la ligne courante » : ils ne
 * suivent que les changements de colonnes.
 */
export function rewriteFormulas(table: Table, change: StructuralChange): void {
  for (const record of Object.values(table.records)) {
    for (const [fieldId, input] of Object.entries(record.cells)) {
      if (isFormula(input)) {
        const next = shiftReferences(input, change)
        if (next !== input) record.cells[fieldId] = next
      }
    }
  }
  if (change.axis === 'col') {
    for (const field of Object.values(table.fields)) {
      if (field.columnFormula) {
        const next = shiftReferences(field.columnFormula, change)
        if (next !== field.columnFormula) field.columnFormula = next
      }
    }
  }
}

/** Index d'insertion par défaut d'une nouvelle ligne : juste avant la première ligne de synthèse. */
export function defaultRowInsertIndex(table: Table): number {
  const i = table.rowOrder.findIndex((id) => table.records[id]?.kind === 'summary')
  return i === -1 ? table.rowOrder.length : i
}

export function insertRecord(table: Table, record: TableRecord, index?: number): void {
  const at = clamp(index ?? defaultRowInsertIndex(table), 0, table.rowOrder.length)
  const beforeSummary = table.records[table.rowOrder[at] ?? '']?.kind === 'summary'
  // Une ligne ajoutée juste au-dessus d'un total doit être incluse dans ses plages.
  rewriteFormulas(table, { axis: 'row', index: at, count: 1, expandAdjacent: beforeSummary })
  table.records[record.id] = record
  table.rowOrder.splice(at, 0, record.id)
}

/**
 * Insère plusieurs lignes d'un coup (import) : une seule réécriture des formules, quel que
 * soit le nombre de lignes, au lieu d'une par ligne.
 */
export function insertRecords(table: Table, records: TableRecord[], index?: number): void {
  if (records.length === 0) return
  const at = clamp(index ?? defaultRowInsertIndex(table), 0, table.rowOrder.length)
  const beforeSummary = table.records[table.rowOrder[at] ?? '']?.kind === 'summary'
  rewriteFormulas(table, {
    axis: 'row',
    index: at,
    count: records.length,
    expandAdjacent: beforeSummary,
  })
  for (const record of records) table.records[record.id] = record
  // Pas de `splice(at, 0, ...ids)` : trop d'arguments pour un gros import.
  table.rowOrder = [
    ...table.rowOrder.slice(0, at),
    ...records.map((r) => r.id),
    ...table.rowOrder.slice(at),
  ]
}

export function removeRecords(table: Table, recordIds: string[]): void {
  const indices = recordIds
    .map((id) => table.rowOrder.indexOf(id))
    .filter((i) => i !== -1)
    .sort((a, b) => b - a) // du bas vers le haut : les index restent valides
  for (const i of indices) {
    const id = table.rowOrder[i] as string
    table.rowOrder.splice(i, 1)
    delete table.records[id]
    rewriteFormulas(table, { axis: 'row', index: i, count: -1 })
  }
}

export function insertField(table: Table, field: Field, index?: number): void {
  const at = clamp(index ?? table.fieldOrder.length, 0, table.fieldOrder.length)
  rewriteFormulas(table, { axis: 'col', index: at, count: 1 })
  table.fields[field.id] = field
  table.fieldOrder.splice(at, 0, field.id)
}

export function removeField(table: Table, fieldId: string): void {
  const i = table.fieldOrder.indexOf(fieldId)
  if (i === -1) return
  table.fieldOrder.splice(i, 1)
  delete table.fields[fieldId]
  for (const record of Object.values(table.records)) delete record.cells[fieldId]
  rewriteFormulas(table, { axis: 'col', index: i, count: -1 })
  for (const view of table.views) {
    view.hiddenFieldIds = view.hiddenFieldIds.filter((id) => id !== fieldId)
    view.filters = view.filters.filter((f) => f.fieldId !== fieldId)
    view.sorts = view.sorts.filter((s) => s.fieldId !== fieldId)
    if (view.groupByFieldId === fieldId) delete view.groupByFieldId
  }
}

/** Réécrit les formules de la table après un déplacement (cellules et colonnes-formules). */
function rewriteForMove(table: Table, change: MoveChange): void {
  for (const record of Object.values(table.records)) {
    for (const [fieldId, input] of Object.entries(record.cells)) {
      if (isFormula(input)) {
        const next = moveReferences(input, change)
        if (next !== input) record.cells[fieldId] = next
      }
    }
  }
  // Les modèles de colonnes-formules sont écrits pour la ligne courante : seules les colonnes comptent.
  if (change.axis === 'col') {
    for (const field of Object.values(table.fields)) {
      if (field.columnFormula) {
        const next = moveReferences(field.columnFormula, change)
        if (next !== field.columnFormula) field.columnFormula = next
      }
    }
  }
}

/** Nouvel ordre : le bloc [from, from + count) inséré avant l'index d'origine `to`. */
function reorder<T>(items: T[], from: number, count: number, to: number): T[] {
  const block = items.slice(from, from + count)
  const rest = [...items.slice(0, from), ...items.slice(from + count)]
  const at = to > from ? to - count : to
  return [...rest.slice(0, at), ...block, ...rest.slice(at)]
}

/**
 * Déplace des lignes consécutives (glisser-déposer) avant la ligne d'index `to` (ordre actuel,
 * 0 … longueur). Les formules suivent les cellules déplacées. Renvoie false si les lignes ne
 * sont pas consécutives ou que rien ne bouge.
 */
export function moveRecords(table: Table, recordIds: readonly string[], to: number): boolean {
  const indices = recordIds.map((id) => table.rowOrder.indexOf(id)).sort((a, b) => a - b)
  const from = indices[0]
  if (from === undefined || from === -1 || indices.some((v, i) => v !== from + i)) return false
  const count = indices.length
  const target = clamp(to, 0, table.rowOrder.length)
  if (target >= from && target <= from + count) return false
  rewriteForMove(table, { axis: 'row', from, count, to: target })
  table.rowOrder = reorder(table.rowOrder, from, count, target)
  return true
}

/** Déplace une colonne avant la colonne d'index `to` (ordre actuel, 0 … nombre de colonnes). */
export function moveField(table: Table, fieldId: string, to: number): boolean {
  const from = table.fieldOrder.indexOf(fieldId)
  const target = clamp(to, 0, table.fieldOrder.length)
  if (from === -1 || target === from || target === from + 1) return false
  rewriteForMove(table, { axis: 'col', from, count: 1, to: target })
  table.fieldOrder = reorder(table.fieldOrder, from, 1, target)
  return true
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
