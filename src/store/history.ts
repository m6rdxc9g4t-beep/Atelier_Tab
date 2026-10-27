/**
 * Annuler / rétablir (⌘Z, ⇧⌘Z, Ctrl+Y), comme Excel et Airtable.
 *
 * Chaque action de l'interface sur une table passe par `undoable` : on garde la table avant
 * et après. Le store étant immuable (Immer, partage structurel), un instantané ne coûte que
 * les objets modifiés. Annuler remet les données d'avant (colonnes, lignes, ordres), rétablir
 * celles d'après : toute action (saisie, collage, import, suppression de lignes ou de colonnes,
 * déplacement, changement de type…) est donc annulable, formules comprises.
 *
 * Une table modifiée hors de l'historique (assistant IA, fichier modifié par Claude Code)
 * perd son historique : annuler ne doit jamais écraser ces modifications.
 *
 * Les réglages de vue (filtres, tri, champs masqués…) ne font pas partie de l'historique :
 * annuler une saisie ne retire pas un filtre posé ensuite, comme dans Excel. Une vue que
 * l'action a changée elle-même (filtre retiré avec sa colonne) revient avec les données si
 * personne ne l'a retouchée depuis. Le nom de la table non plus : annuler ne défait pas un
 * renommage fait ensuite.
 */
import { create } from 'zustand'
import { operatorsFor } from '@/engine/table'
import { shortcut } from '@/lib/keys'
import type { Table, View } from '@/types/domain'
import { useDataStore } from './index'
import { useNotices, type Notice } from './notices.store'
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
  return undoableStep(label, tableId, fn).result
}

/**
 * Comme `undoable`, et renvoie aussi l'étape enregistrée : null si l'action n'a rien changé ou
 * si elle fait partie d'une étape plus large (appel imbriqué).
 */
export function undoableStep<T>(
  label: string,
  tableId: string,
  fn: () => T,
): { result: T; step: HistoryEntry | null } {
  if (depth > 0) return { result: fn(), step: null }
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
  if (!before || !after || sameData(before, after)) return { result, step: null }
  const step: HistoryEntry = { label, tableId, before, after, selection }
  useHistory.setState((s) => ({ past: [...s.past.slice(-(LIMIT - 1)), step], future: [] }))
  return { result, step }
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

/**
 * Réglages d'une vue retouchée depuis l'action, sans ceux qui ne valent plus pour les colonnes
 * rendues (`table`), comme après une suppression ou un changement de type : colonne absente,
 * type différent de celui de `was` (la table que l'on quitte), statut retiré, regroupement
 * Kanban hors d'une colonne Statut.
 */
function fitView(view: View, table: Table, was: Table): View {
  const filters = view.filters.filter((f) => {
    const field = table.fields[f.fieldId]
    if (!field) return false
    if (was.fields[f.fieldId]?.type !== field.type) {
      return operatorsFor(field).includes(f.operator) && f.value === undefined
    }
    if (field.type === 'select' && typeof f.value === 'string') {
      return (field.options?.choices ?? []).some((c) => c.id === f.value)
    }
    return true
  })
  const sorts = view.sorts.filter((s) => table.fields[s.fieldId])
  const hiddenFieldIds = view.hiddenFieldIds.filter((id) => table.fields[id])
  const group = view.groupByFieldId
  const keepGroup = group === undefined || table.fields[group]?.type === 'select'
  if (
    keepGroup &&
    filters.length === view.filters.length &&
    sorts.length === view.sorts.length &&
    hiddenFieldIds.length === view.hiddenFieldIds.length
  ) {
    return view
  }
  const fitted: View = { ...view, filters, sorts, hiddenFieldIds }
  if (!keepGroup) delete fitted.groupByFieldId
  return fitted
}

/**
 * Vues après un retour à `target` depuis `leaving` : une vue restée telle que `leaving` l'avait
 * laissée reprend son état de `target` (le filtre retiré avec sa colonne revient avec elle) ;
 * une vue retouchée depuis garde ses réglages, ajustés aux colonnes rendues.
 */
function restoreViews(current: Table, target: Table, leaving: Table): View[] {
  return current.views.map((view) => {
    const untouched = leaving.views.find((v) => v.id === view.id) === view
    const back = untouched ? target.views.find((v) => v.id === view.id) : undefined
    return back ?? fitView(view, target, current)
  })
}

/**
 * Remet les données de `target` (colonnes, lignes, ordres) et ramène l'interface sur la table.
 * Le nom, le projet et la vue active restent ceux d'aujourd'hui.
 */
function restore(
  entry: HistoryEntry,
  target: Table,
  leaving: Table,
  selection: CellPosition | null,
): void {
  const ui = useUIStore.getState()
  if (ui.activeTableId !== entry.tableId) ui.openTable(entry.tableId)
  const current = useDataStore.getState().tables[entry.tableId]
  const next: Table = current
    ? {
        ...current,
        fields: target.fields,
        records: target.records,
        rowOrder: target.rowOrder,
        fieldOrder: target.fieldOrder,
        views: restoreViews(current, target, leaving),
      }
    : target
  depth++
  try {
    useDataStore.getState().replaceTable(next)
  } finally {
    depth--
  }
  const keep =
    selection && target.records[selection.recordId] && target.fields[selection.fieldId]
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
  restore(entry, entry.before, entry.after, entry.selection)
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
  restore(entry, entry.after, entry.before, useUIStore.getState().selection ?? entry.selection)
  return entry.label
}

/**
 * Annule `step` seulement s'il est encore la dernière étape : le bouton « Annuler » d'un
 * message ne doit jamais annuler une autre action que celle qu'il annonce. Sinon rien n'est
 * annulé et un message le dit. Renvoie le libellé annulé, ou null.
 */
export function undoStep(step: HistoryEntry): string | null {
  const { past, future } = useHistory.getState()
  if (past.at(-1) === step) return undo()
  useNotices.getState().push({
    tone: 'info',
    title: 'Rien n’a été annulé',
    detail: future.includes(step)
      ? 'Cette action est déjà annulée.'
      : past.includes(step)
        ? `D’autres modifications ont suivi : annulez-les d’abord (${shortcut('Z')}).`
        : 'La table a été modifiée ailleurs depuis : cette action ne peut plus être annulée.',
  })
  return null
}

/**
 * Message avec un bouton « Annuler » qui n'annule que `step`, l'action annoncée. Le message
 * disparaît si l'étape est annulée (⌘Z) ; le bouton disparaît si une autre étape la suit ou si
 * elle est oubliée (table modifiée ailleurs). Sans étape (rien n'a changé), pas de bouton.
 */
export function notifyUndoable(
  step: HistoryEntry | null,
  notice: Omit<Notice, 'id' | 'action'>,
  ttlMs = 8000,
): void {
  const notices = useNotices.getState()
  if (!step || useHistory.getState().past.at(-1) !== step) {
    notices.push(notice, ttlMs)
    return
  }
  const id = notices.push(
    { ...notice, action: { label: 'Annuler', run: () => void undoStep(step) } },
    ttlMs,
  )
  const stop = useHistory.subscribe((s) => {
    if (s.past.at(-1) === step) return
    stop()
    const shown = useNotices.getState()
    if (!shown.notices.some((n) => n.id === id)) return
    if (s.future.includes(step)) shown.dismiss(id)
    else shown.clearAction(id)
  })
  // Message fermé de lui-même : plus rien à suivre.
  if (ttlMs > 0) setTimeout(stop, ttlMs)
}

/** Vide l'historique (changement complet des données). */
export function clearHistory(): void {
  useHistory.setState({ past: [], future: [] })
}
