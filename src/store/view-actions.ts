/**
 * Réglages de la vue active : champs masqués, filtres, tri, hauteur des lignes, agrégats du
 * pied de grille, regroupement Kanban. Enregistrés avec la table (comme une vue Airtable),
 * hors de l'historique d'annulation.
 */
import { operatorsFor } from '@/engine/table'
import { newId } from '@/lib/ids'
import type { Filter, RowHeight, Sort, SummaryKind, Table, View } from '@/types/domain'
import { useDataStore } from './index'
import { useUIStore } from './ui.store'
import { activeView } from './view-rows'

function patchView(table: Table, patch: Partial<Omit<View, 'id' | 'mode'>>): void {
  const view = activeView(table)
  if (view) useDataStore.getState().updateView(table.id, view.id, patch)
}

function freshView(tableId: string): { table: Table; view: View } | null {
  const table = useDataStore.getState().tables[tableId]
  const view = table ? activeView(table) : undefined
  return table && view ? { table, view } : null
}

// ------------------------------------------------------------------ champs masqués

export function setFieldHidden(tableId: string, fieldId: string, hidden: boolean): void {
  const current = freshView(tableId)
  if (!current) return
  const set = new Set(current.view.hiddenFieldIds)
  if (hidden) set.add(fieldId)
  else set.delete(fieldId)
  // La première colonne (titre) reste toujours visible, comme le champ principal d'Airtable.
  const first = current.table.fieldOrder[0]
  if (first) set.delete(first)
  patchView(current.table, { hiddenFieldIds: current.table.fieldOrder.filter((id) => set.has(id)) })
  const ui = useUIStore.getState()
  if (hidden && ui.selection?.fieldId === fieldId) ui.select(null)
}

export function setAllFieldsHidden(tableId: string, hidden: boolean): void {
  const current = freshView(tableId)
  if (!current) return
  patchView(current.table, { hiddenFieldIds: hidden ? current.table.fieldOrder.slice(1) : [] })
  if (hidden) useUIStore.getState().select(null)
}

// ------------------------------------------------------------------ filtres

function setFilters(tableId: string, filters: Filter[]): void {
  const current = freshView(tableId)
  if (!current) return
  patchView(current.table, { filters })
  // Les lignes gardées visibles malgré l'ancien filtre suivent maintenant le nouveau.
  useUIStore.getState().clearPins()
}

export function addFilter(tableId: string, fieldId?: string): void {
  const current = freshView(tableId)
  if (!current) return
  const id = fieldId ?? current.table.fieldOrder[0]
  const field = id ? current.table.fields[id] : undefined
  if (!field) return
  const operator = operatorsFor(field)[0] ?? 'equals'
  setFilters(tableId, [
    ...current.view.filters,
    {
      id: newId('flt'),
      fieldId: field.id,
      operator,
      ...(field.type === 'checkbox' ? { value: true } : {}),
    },
  ])
}

export function updateFilter(
  tableId: string,
  filterId: string,
  patch: Partial<Omit<Filter, 'id'>>,
): void {
  const current = freshView(tableId)
  if (!current) return
  setFilters(
    tableId,
    current.view.filters.map((f) => {
      if (f.id !== filterId) return f
      const next: Filter = { ...f, ...patch }
      // Changement de colonne : opérateur et valeur repartent de zéro.
      if (patch.fieldId && patch.fieldId !== f.fieldId) {
        const field = current.table.fields[patch.fieldId]
        next.operator = field ? (operatorsFor(field)[0] ?? 'equals') : 'equals'
        delete next.value
        if (field?.type === 'checkbox') next.value = true
      }
      if (next.value === undefined || next.value === '') delete next.value
      return next
    }),
  )
}

export function removeFilter(tableId: string, filterId: string): void {
  const current = freshView(tableId)
  if (current)
    setFilters(
      tableId,
      current.view.filters.filter((f) => f.id !== filterId),
    )
}

export function clearFilters(tableId: string): void {
  setFilters(tableId, [])
  useUIStore.getState().setSearch('')
}

// ------------------------------------------------------------------ tri

export function setSorts(tableId: string, sorts: Sort[]): void {
  const current = freshView(tableId)
  if (current) patchView(current.table, { sorts })
}

/** Trie la vue sur une seule colonne (menu de la colonne). */
export function sortBy(tableId: string, fieldId: string, direction: Sort['direction']): void {
  setSorts(tableId, [{ fieldId, direction }])
}

// ------------------------------------------------------------------ affichage

export function setRowHeight(tableId: string, rowHeight: RowHeight): void {
  const current = freshView(tableId)
  if (current) patchView(current.table, { rowHeight })
}

export function setSummary(tableId: string, fieldId: string, kind: SummaryKind): void {
  const current = freshView(tableId)
  if (!current) return
  patchView(current.table, { summaries: { ...current.view.summaries, [fieldId]: kind } })
}

export function setGroupBy(tableId: string, fieldId: string): void {
  const current = freshView(tableId)
  if (current) patchView(current.table, { groupByFieldId: fieldId })
}
