/**
 * Instances applicatives des stores. Les composants importent depuis ici ;
 * les tests utilisent les fabriques (`createDataStore`, `connectComputed`) directement.
 */
import { useStore } from 'zustand'
import type { CellValue } from '@/engine/formula'
import { connectComputed, selectCellValue, type ComputedState } from './computed.store'
import { createDataStore } from './data.store'

export const useDataStore = createDataStore()

const computed = connectComputed(useDataStore)
export const computedStore = computed.store
export const getSheet = computed.getSheet

export function useComputed<T>(selector: (s: ComputedState) => T): T {
  return useStore(computedStore, selector)
}

/** Valeur calculée d'une cellule ; ne déclenche un rendu que si cette valeur change. */
export function useCellValue(tableId: string, recordId: string, fieldId: string): CellValue {
  return useStore(computedStore, selectCellValue(tableId, recordId, fieldId))
}

export { useUIStore, type CellPosition } from './ui.store'
export { createDataStore, type DataState, type DataStore } from './data.store'
export { connectComputed, type ComputedEngine, type ComputedState } from './computed.store'
