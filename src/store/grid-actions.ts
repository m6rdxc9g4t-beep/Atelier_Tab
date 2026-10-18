/**
 * Actions de la grille : sélection, édition, validation des saisies.
 * Elles orchestrent les stores et le moteur ; les composants se contentent de les appeler.
 */
import { parseUserInput, toEditText, type LookupContext } from '@/engine/field-types'
import { isFormula, type CellInput } from '@/engine/formula'
import type { Table } from '@/types/domain'
import { getSheet, useDataStore } from './index'
import { useUIStore, type CellPosition } from './ui.store'

export type Move = 'up' | 'down' | 'left' | 'right' | 'none'

function lookup(): LookupContext {
  return { collaborators: useDataStore.getState().collaborators }
}

export function getActiveTable(): Table | undefined {
  const id = useUIStore.getState().activeTableId
  return id ? useDataStore.getState().tables[id] : undefined
}

/**
 * Saisie à montrer pour une cellule : la valeur stockée, ou pour une colonne-formule
 * la formule recopiée sur la ligne (ex. `=C2*1.2`).
 */
export function effectiveInputOf(tableId: string, cell: CellPosition): CellInput {
  const table = useDataStore.getState().tables[tableId]
  const stored = table?.records[cell.recordId]?.cells[cell.fieldId] ?? null
  if (stored !== null) return stored
  return getSheet(tableId)?.input(cell.recordId, cell.fieldId) ?? null
}

/** Texte de départ de l'éditeur pour une cellule. */
export function editTextOf(tableId: string, cell: CellPosition): string {
  const table = useDataStore.getState().tables[tableId]
  const field = table?.fields[cell.fieldId]
  if (!field) return ''
  const input = effectiveInputOf(tableId, cell)
  return toEditText(field, input, lookup())
}

export function beginEdit(
  cell: CellPosition,
  initialText?: string,
  origin: 'cell' | 'bar' = 'cell',
): void {
  const table = getActiveTable()
  if (!table) return
  const field = table.fields[cell.fieldId]
  if (!field) return
  if (field.type === 'checkbox' && initialText === undefined) {
    toggleCheckbox(cell)
    return
  }
  useUIStore.getState().startEditing(cell, initialText ?? editTextOf(table.id, cell), origin)
}

export function cancelEdit(): void {
  const ui = useUIStore.getState()
  ui.stopEditing()
  ui.setInputError(null)
}

/** Valide la saisie en cours. Renvoie `false` (et garde l'édition ouverte) si elle est refusée. */
export function commitEdit(move: Move = 'none'): boolean {
  const ui = useUIStore.getState()
  const editing = ui.editing
  const table = getActiveTable()
  if (!editing || !table) return false
  const { cell, draft } = editing
  const field = table.fields[cell.fieldId]
  if (!field) {
    ui.stopEditing()
    return false
  }

  const unchanged = draft === editTextOf(table.id, cell)
  if (!unchanged) {
    const parsed = parseUserInput(field, draft, lookup())
    if (!parsed.ok) {
      ui.setInputError(parsed.reason)
      return false
    }
    useDataStore.getState().setCell(table.id, cell.recordId, cell.fieldId, parsed.input)
  }
  ui.stopEditing()
  moveSelection(move)
  return true
}

export function moveSelection(move: Move, extend = 1): void {
  if (move === 'none') return
  const ui = useUIStore.getState()
  const table = getActiveTable()
  const sel = ui.selection
  if (!table || !sel) return
  const fields = visibleFieldIds(table)
  let r = table.rowOrder.indexOf(sel.recordId)
  let c = fields.indexOf(sel.fieldId)
  if (r === -1 || c === -1) return
  if (move === 'up') r -= extend
  if (move === 'down') r += extend
  if (move === 'left') c -= extend
  if (move === 'right') c += extend
  r = Math.max(0, Math.min(table.rowOrder.length - 1, r))
  c = Math.max(0, Math.min(fields.length - 1, c))
  const recordId = table.rowOrder[r]
  const fieldId = fields[c]
  if (recordId && fieldId) ui.select({ recordId, fieldId })
}

export function selectEdge(edge: 'rowStart' | 'rowEnd' | 'top' | 'bottom'): void {
  const ui = useUIStore.getState()
  const table = getActiveTable()
  const sel = ui.selection
  if (!table || !sel) return
  const fields = visibleFieldIds(table)
  const recordId =
    edge === 'top' ? table.rowOrder[0] : edge === 'bottom' ? table.rowOrder.at(-1) : sel.recordId
  const fieldId = edge === 'rowStart' ? fields[0] : edge === 'rowEnd' ? fields.at(-1) : sel.fieldId
  if (recordId && fieldId) ui.select({ recordId, fieldId })
}

export function clearCell(cell: CellPosition): void {
  const table = getActiveTable()
  if (!table) return
  useDataStore.getState().setCell(table.id, cell.recordId, cell.fieldId, null)
}

export function toggleCheckbox(cell: CellPosition): void {
  const table = getActiveTable()
  if (!table) return
  const current = table.records[cell.recordId]?.cells[cell.fieldId] ?? null
  if (isFormula(current)) return
  useDataStore.getState().setCell(table.id, cell.recordId, cell.fieldId, current !== true)
}

/** Ajoute une ligne (au-dessus du total s'il y en a un) et la sélectionne. */
export function addRowAndSelect(): void {
  const table = getActiveTable()
  if (!table) return
  const recordId = useDataStore.getState().addRecord(table.id)
  const fieldId = visibleFieldIds(table)[0]
  if (fieldId) useUIStore.getState().select({ recordId, fieldId })
}

export function visibleFieldIds(table: Table): string[] {
  const view = table.views.find((v) => v.id === table.activeViewId)
  const hidden = new Set(view?.hiddenFieldIds ?? [])
  return table.fieldOrder.filter((id) => !hidden.has(id))
}
