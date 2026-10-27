import { useMemo } from 'react'
import { FilterX } from 'lucide-react'
import { formatNumber, formatValue } from '@/engine/field-types'
import { activeFilters } from '@/engine/table'
import { getSheet, useComputed, useUIStore } from '@/store'
import { activeView, useViewRows, visibleFieldIds } from '@/store/view-rows'
import { clearFilters } from '@/store/view-actions'
import type { Table, ViewMode } from '@/types/domain'
import { shortcut } from '@/lib/keys'

/**
 * Barre d'état, comme Excel : nombre de lignes de la vue (et filtres actifs) à gauche ;
 * à droite, Moyenne, Nb et Somme des cellules sélectionnées, ou un rappel des raccourcis.
 */
export function StatusBar({ table, mode }: { table: Table; mode: ViewMode }) {
  const rows = useViewRows(table)
  const selection = useUIStore((s) => s.selection)
  const rangeEnd = useUIStore((s) => s.rangeEnd)
  const search = useUIStore((s) => s.search)
  const revision = useComputed((s) => s.revisions[table.id] ?? 0)
  const data = rows.filter((id) => table.records[id]?.kind === 'data')
  const totalData = table.rowOrder.filter((id) => table.records[id]?.kind === 'data').length
  const filterCount = activeFilters(table, activeView(table)).length
  const narrowed = data.length !== totalData

  const stats = useMemo(() => {
    void revision
    if (!selection || !rangeEnd) return null
    const cols = visibleFieldIds(table)
    const r0 = rows.indexOf(selection.recordId)
    const r1 = rows.indexOf(rangeEnd.recordId)
    const c0 = cols.indexOf(selection.fieldId)
    const c1 = cols.indexOf(rangeEnd.fieldId)
    if ([r0, r1, c0, c1].includes(-1)) return null
    const sheet = getSheet(table.id)
    const nums: number[] = []
    let filled = 0
    const fieldsSeen = new Set<string>()
    for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) {
      for (let c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) {
        const recordId = rows[r] as string
        const fieldId = cols[c] as string
        const v = sheet?.value(recordId, fieldId) ?? null
        if (v === null || v === '') continue
        filled++
        if (typeof v === 'number') {
          nums.push(v)
          fieldsSeen.add(fieldId)
        }
      }
    }
    // Une seule colonne numérique : ses unités (€, %) ; sinon un nombre simple.
    const only = fieldsSeen.size === 1 ? table.fields[[...fieldsSeen][0] as string] : undefined
    const fmt = (n: number) =>
      only ? formatValue(only, Number(n.toPrecision(15))) : formatNumber(Number(n.toPrecision(15)))
    const sum = nums.reduce((a, b) => a + b, 0)
    return {
      filled,
      count: nums.length,
      sum: nums.length ? fmt(sum) : null,
      average: nums.length ? fmt(sum / nums.length) : null,
    }
  }, [selection, rangeEnd, rows, table, revision])

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-sidebar/70 px-3 text-[12px] text-muted backdrop-blur-sm">
      <span className="tabular-nums">
        {data.length} ligne{data.length > 1 ? 's' : ''}
        {narrowed && ` sur ${totalData}`}
      </span>
      {(filterCount > 0 || search.trim()) && (
        <button
          type="button"
          onClick={() => clearFilters(table.id)}
          className="inline-flex items-center gap-1 rounded px-1 text-accent-fg hover:bg-surface-hover"
        >
          <FilterX size={12} />
          {filterCount > 0 ? `${filterCount} filtre${filterCount > 1 ? 's' : ''}` : 'Recherche'} ·
          effacer
        </button>
      )}
      <span className="ml-auto flex items-center gap-4 tabular-nums">
        {stats ? (
          <>
            {stats.average !== null && (
              <span>
                Moyenne : <strong className="font-medium text-ink">{stats.average}</strong>
              </span>
            )}
            <span>
              Nb : <strong className="font-medium text-ink">{stats.filled}</strong>
            </span>
            {stats.sum !== null && (
              <span>
                Somme : <strong className="font-medium text-ink">{stats.sum}</strong>
              </span>
            )}
          </>
        ) : (
          <span className="hidden text-faint sm:inline">
            {mode === 'kanban'
              ? 'Glissez une carte pour changer son statut · clic pour ouvrir la fiche'
              : `Maj + flèches pour une plage · ${shortcut('C')} / ${shortcut('V')} avec Excel · Espace pour la fiche · ${shortcut('K')} pour chercher`}
          </span>
        )}
      </span>
    </footer>
  )
}
