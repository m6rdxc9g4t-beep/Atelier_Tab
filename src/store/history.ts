/**
 * Annuler / rétablir (⌘Z, ⇧⌘Z, Ctrl+Y), comme Excel et Airtable.
 *
 * Chaque action de l'interface sur une table passe par `undoable` : on garde la table avant
 * et après. Le store étant immuable (Immer, partage structurel), un instantané ne coûte que
 * les objets modifiés. Annuler remet la table d'avant, rétablir celle d'après : toute action
 * (saisie, collage, suppression de lignes ou de colonnes, déplacement, changement de type…)
 * est donc annulable, formules comprises.
 *
 * Une table modifiée hors de l'historique (assistant IA, fichier modifié par Claude Code)
 * perd son historique : annuler ne doit jamais écraser ces modifications.
 *
 * Les réglages de vue (filtres, tri, champs masqués…) ne font pas partie de l'historique :
 * annuler une saisie ne retire pas un filtre posé ensuite, comme dans Excel.
 */
import { create } from 'zustand'
import type { Table } from '@/types/domain'
import { useDataStore } from './index'
import { useUIStore, type CellPosition } from './ui.store'

export interface HistoryEntry {
  /** Libellé affiché (« Annuler : Coller 6 cellules »). */
  label: string
  tableId: string
  before: Table
  after: Table
  /** Sélection avant l'action, rendue après annulation. */
  selection: CellPosition | null
}

interface HistoryState {
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export const useHistory = create<HistoryState>(() => ({ past: [], future: [] }))

const LIMIT = 100
/** > 0 pendant une action enregistrée, une annulation ou un rétablissement. */
let depth = 0

/**
 * Exécute `fn` (qui modifie la table `tableId`) et l'enregistre comme une seule étape.
 * Les appels imbriqués comptent dans l'étape la plus extérieure.
 */
export function undoable<T>(label: string, tableId: string, fn: () => T): T {
  if (depth > 0) return fn()
  const before = useDataStore.getState().tables[tableId]
  const selection = useUIStore.getState().selection
  depth++
  let result: T
  try {
    result = fn()
  } finally {
    depth--
  }
  const after = useDataStore.getState().tables[tableId]
  if (before && after && !sameData(before, after)) {
    useHistory.setState((s) => ({
      past: [...s.past.slice(-(LIMIT - 1)), { label, tableId, before, after, selection }],
      future: [],
    }))
  }
  return result
}

/** Mêmes données (colonnes, lignes, ordre) ; les vues peuvent différer. */
function sameData(a: Table | undefined, b: Table | undefined): boolean {
  return (
    a !== undefined &&
    b !== undefined &&
    a.fields === b.fields &&
    a.records === b.records &&
    a.rowOrder === b.rowOrder &&
    a.fieldOrder === b.fieldOrder
  )
}

function forget(tableIds: Set<string>): void {
  useHistory.setState((s) => ({
    past: s.past.filter((e) => !tableIds.has(e.tableId)),
    future: s.future.filter((e) => !tableIds.has(e.tableId)),
  }))
}

// Modification venue d'ailleurs (assistant, fichier externe) : l'historique de la table est oublié.
useDataStore.subscribe((state, prev) => {
  if (depth > 0 || state.tables === prev.tables) return
  const changed = new Set<string>()
  for (const id of new Set([...Object.keys(state.tables), ...Object.keys(prev.tables)])) {
    if (!sameData(state.tables[id], prev.tables[id])) changed.add(id)
  }
  const { past, future } = useHistory.getState()
  if ([...past, ...future].some((e) => changed.has(e.tableId))) forget(changed)
})

/** Remet les données d'une table (en gardant ses vues actuelles) et ramène l'interface dessus. */
function restore(entry: HistoryEntry, table: Table, selection: CellPosition | null): void {
  const ui = useUIStore.getState()
  if (ui.activeTableId !== entry.tableId) ui.openTable(entry.tableId)
  const current = useDataStore.getState().tables[entry.tableId]
  depth++
  try {
    useDataStore
      .getState()
      .replaceTable(
        current ? { ...table, views: current.views, activeViewId: current.activeViewId } : table,
      )
  } finally {
    depth--
  }
  const keep =
    selection && table.records[selection.recordId] && table.fields[selection.fieldId]
      ? selection
      : null
  useUIStore.setState({ editing: null, inputError: null, rangeEnd: null, selection: keep })
}

/** Annule la dernière action. Renvoie son libellé, ou null s'il n'y a rien à annuler. */
export function undo(): string | null {
  const entry = useHistory.getState().past.at(-1)
  if (!entry) return null
  if (!sameData(useDataStore.getState().tables[entry.tableId], entry.after)) {
    forget(new Set([entry.tableId]))
    return null
  }
  useHistory.setState((s) => ({ past: s.past.slice(0, -1), future: [...s.future, entry] }))
  restore(entry, entry.before, entry.selection)
  return entry.label
}

/** Rétablit la dernière action annulée. */
export function redo(): string | null {
  const entry = useHistory.getState().future.at(-1)
  if (!entry) return null
  if (!sameData(useDataStore.getState().tables[entry.tableId], entry.before)) {
    forget(new Set([entry.tableId]))
    return null
  }
  useHistory.setState((s) => ({ future: s.future.slice(0, -1), past: [...s.past, entry] }))
  restore(entry, entry.after, useUIStore.getState().selection ?? entry.selection)
  return entry.label
}

/** Vide l'historique (changement complet des données). */
export function clearHistory(): void {
  useHistory.setState({ past: [], future: [] })
}
