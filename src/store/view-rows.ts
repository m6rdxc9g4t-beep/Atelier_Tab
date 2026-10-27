/**
 * Lignes et colonnes affichées par la vue active : filtres, tri, recherche rapide et champs
 * masqués appliqués. Toute coordonnée de la grille (navigation, plage, collage) s'y réfère ;
 * les formules, elles, lisent toujours l'ordre de la table (`rowOrder`, `fieldOrder`).
 */
import { useMemo } from 'react'
import { activeFilters, activeSorts, viewRecordIds } from '@/engine/table'
import type { Table, View } from '@/types/domain'
import { computedStore, getSheet, useComputed, useDataStore } from './index'
import { useUIStore } from './ui.store'

export function activeView(table: Table): View | undefined {
  return table.views.find((v) => v.id === table.activeViewId)
}

/**
 * Champs masqués de la vue active. La première colonne (titre) n'en fait jamais partie, même
 * si un déplacement de colonne (glisser, outil `move_column`) y a amené un champ masqué.
 */
export function hiddenFieldSet(table: Table): Set<string> {
  const hidden = new Set(activeView(table)?.hiddenFieldIds ?? [])
  const first = table.fieldOrder[0]
  if (first) hidden.delete(first)
  return hidden
}

export function visibleFieldIds(table: Table): string[] {
  const hidden = hiddenFieldSet(table)
  return table.fieldOrder.filter((id) => !hidden.has(id))
}

interface CacheEntry {
  table: Table
  revision: number
  search: string
  pinned: string[]
  result: string[]
}

let cache: CacheEntry | null = null

/** Ids des lignes de la vue active, dans l'ordre d'affichage. */
export function getViewRows(table: Table): string[] {
  const { search, pinnedRecordIds } = useUIStore.getState()
  const revision = computedStore.getState().revisions[table.id] ?? 0
  if (
    cache &&
    cache.table === table &&
    cache.revision === revision &&
    cache.search === search &&
    cache.pinned === pinnedRecordIds
  ) {
    return cache.result
  }
  const sheet = getSheet(table.id)
  const result = viewRecordIds(
    table,
    activeView(table),
    (recordId, fieldId) => sheet?.value(recordId, fieldId) ?? null,
    { collaborators: useDataStore.getState().collaborators },
    { search, searchFieldIds: visibleFieldIds(table), pinned: new Set(pinnedRecordIds) },
  )
  cache = { table, revision, search, pinned: pinnedRecordIds, result }
  return result
}

/** Lignes de la vue active, recalculées quand la table, ses valeurs ou la recherche changent. */
export function useViewRows(table: Table): string[] {
  const revision = useComputed((s) => s.revisions[table.id] ?? 0)
  const search = useUIStore((s) => s.search)
  const pinned = useUIStore((s) => s.pinnedRecordIds)
  return useMemo(() => {
    void revision
    void search
    void pinned
    return getViewRows(table)
  }, [table, revision, search, pinned])
}

/**
 * L'ordre d'affichage peut-il différer de celui de la table (filtre, tri ou recherche) ?
 * Le glisser-déposer de lignes est alors désactivé, comme dans Airtable.
 */
export function isReordered(table: Table): boolean {
  const view = activeView(table)
  return (
    activeSorts(table, view).length > 0 ||
    activeFilters(table, view).length > 0 ||
    useUIStore.getState().search.trim() !== ''
  )
}
