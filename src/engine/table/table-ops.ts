/**
 * Opérations structurelles pures sur une table : insertion / suppression de lignes et
 * de colonnes avec réécriture des formules, comme dans Excel.
 *
 * Ces fonctions sont conçues pour être appelées dans un producteur Immer (elles
 * modifient la table reçue) mais n'en dépendent pas.
 */
import { isFormula, shiftReferences, type StructuralChange } from '@/engine/formula'
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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
