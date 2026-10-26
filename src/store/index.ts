/**
 * Instances applicatives des stores. Les composants importent depuis ici ;
 * les tests utilisent les fabriques (`createDataStore`, `connectComputed`) directement.
 */
import { useStore } from 'zustand'
import type { CellValue } from '@/engine/formula'
import { getDesktopApi } from '@/services/desktop'
import { desktopAdapter } from '@/services/persistence/desktop.adapter'
import { connectComputed, selectCellValue, type ComputedState } from './computed.store'
import { createDataStore, keepUnchanged, pickData } from './data.store'
import { useNotices } from './notices.store'

const desktop = getDesktopApi()

/** App de bureau : données dans ~/Atelier_Tab. Navigateur : IndexedDB. */
export const useDataStore = createDataStore(desktop ? { adapter: desktopAdapter(desktop) } : {})

if (desktop) {
  // Fichiers modifiés par un autre programme (Claude Code, un éditeur…) : on recharge.
  desktop.onExternalChange((data) => {
    // Seules les tables modifiées sont remplacées : les autres gardent calculs et historique.
    useDataStore.setState(pickData(keepUnchanged(useDataStore.getState(), data)))
    useNotices
      .getState()
      .push({ tone: 'info', title: 'Données mises à jour depuis le dossier Atelier_Tab' }, 3000)
  })
  desktop.onDataErrors((errors) => {
    useNotices.getState().push(
      {
        tone: 'warning',
        title: 'Fichier ignoré : contenu invalide',
        detail: `${errors.join('\n')}\nLa dernière version valide reste affichée.`,
      },
      10000,
    )
  })
}

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
export { useNotices } from './notices.store'
export { createDataStore, type DataState, type DataStore } from './data.store'
export { connectComputed, type ComputedEngine, type ComputedState } from './computed.store'
