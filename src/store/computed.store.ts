/**
 * Valeurs calculées, dérivées du store de données par le moteur de formules.
 *
 * Chaque table possède un `TableSheet`. À chaque changement du store de données, seules
 * les tables dont la référence a changé sont resynchronisées, et seules les cellules
 * dont la valeur a changé reçoivent une nouvelle entrée : un composant de cellule qui
 * lit sa valeur via un sélecteur ne se re-rend donc que si cette valeur change.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { CellValue } from '@/engine/formula'
import { cellKey, TableSheet, type CellKey } from '@/engine/table'
import type { AppData } from '@/types/domain'
import type { DataStore } from './data.store'

export interface ComputedState {
  values: Record<string, Record<CellKey, CellValue>>
  /** Incrémenté à chaque recalcul d'une table (pour les agrégats de pied de grille). */
  revisions: Record<string, number>
}

export type ComputedStore = UseBoundStore<StoreApi<ComputedState>>

export interface ComputedEngine {
  store: ComputedStore
  getSheet(tableId: string): TableSheet | undefined
  /** Arrête la synchronisation (tests, rechargement à chaud). */
  disconnect(): void
}

export function connectComputed(dataStore: DataStore): ComputedEngine {
  const sheets = new Map<string, TableSheet>()
  const store: ComputedStore = create<ComputedState>(() => ({ values: {}, revisions: {} }))

  const syncAll = (data: AppData, prev: AppData | null) => {
    const ctx = { collaborators: data.collaborators }
    const collaboratorsChanged = prev?.collaborators !== data.collaborators
    const nextValues = { ...store.getState().values }
    const nextRevisions = { ...store.getState().revisions }
    let dirty = false

    for (const [tableId, table] of Object.entries(data.tables)) {
      if (prev && prev.tables[tableId] === table && !collaboratorsChanged) continue
      let sheet = sheets.get(tableId)
      if (!sheet) sheets.set(tableId, (sheet = new TableSheet()))
      const changed = sheet.sync(table, ctx)
      if (changed.size === 0) continue

      const current = nextValues[tableId] ?? {}
      const updated: Record<CellKey, CellValue> = { ...current }
      for (const key of changed) {
        const [recordId = '', fieldId = ''] = key.split(':')
        if (!table.records[recordId] || !table.fields[fieldId]) delete updated[key]
        else updated[key] = sheet.value(recordId, fieldId)
      }
      nextValues[tableId] = updated
      nextRevisions[tableId] = (nextRevisions[tableId] ?? 0) + 1
      dirty = true
    }

    for (const tableId of Object.keys(nextValues)) {
      if (!data.tables[tableId]) {
        delete nextValues[tableId]
        delete nextRevisions[tableId]
        sheets.delete(tableId)
        dirty = true
      }
    }

    if (dirty) store.setState({ values: nextValues, revisions: nextRevisions })
  }

  syncAll(dataStore.getState(), null)
  const unsubscribe = dataStore.subscribe((state, prev) => syncAll(state, prev))

  return {
    store,
    getSheet: (tableId) => sheets.get(tableId),
    disconnect: unsubscribe,
  }
}

/** Sélecteur de valeur calculée d'une cellule. */
export function selectCellValue(tableId: string, recordId: string, fieldId: string) {
  const key = cellKey(recordId, fieldId)
  return (s: ComputedState): CellValue => s.values[tableId]?.[key] ?? null
}
