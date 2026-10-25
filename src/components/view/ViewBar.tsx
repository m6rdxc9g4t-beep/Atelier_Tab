import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Columns3,
  Grid3x3,
  Redo2,
  Rows3,
  Search,
  Send,
  Table2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { activeFilters, activeSorts } from '@/engine/table'
import { useDataStore, useUIStore } from '@/store'
import { redo, undo, useHistory } from '@/store/history'
import { activeView } from '@/store/view-rows'
import { setGroupBy, setRowHeight } from '@/store/view-actions'
import type { RowHeight, Table, ViewMode } from '@/types/domain'
import { Floating } from '@/components/ui/Floating'
import { MenuItem, MenuLabel } from '@/components/ui/Popover'
import { cn } from '@/lib/cn'
import { shortcut } from '@/lib/keys'
import { OPEN_VIEW_PANEL } from '@/components/grid/GridHeader'
import { FieldsMenu, FilterMenu, SortMenu, TOOL_ICONS, ToolButton } from './ViewMenus'

// Chargé à la première ouverture : le démarrage reste léger.
const ExportDialog = lazy(() =>
  import('@/components/dataflow/ExportDialog').then((m) => ({ default: m.ExportDialog })),
)

const MODES: { mode: ViewMode; label: string; icon: typeof Table2; hint: string }[] = [
  { mode: 'hybrid', label: 'Grille', icon: Table2, hint: 'Badges, avatars et formules' },
  { mode: 'sheet', label: 'Tableur', icon: Grid3x3, hint: 'Valeurs brutes, comme dans Excel' },
  { mode: 'kanban', label: 'Kanban', icon: Columns3, hint: 'Cartes groupées par statut' },
]

const ROW_HEIGHTS: { value: RowHeight; label: string }[] = [
  { value: 'compact', label: 'Compacte' },
  { value: 'standard', label: 'Standard' },
  { value: 'tall', label: 'Haute (texte sur plusieurs lignes)' },
]

/** Identifiant du champ de recherche (⌘F y place le curseur). */
export const VIEW_SEARCH_ID = 'view-search'

type Panel = 'fields' | 'filter' | 'sort' | 'height' | 'group'

/**
 * Barre de vue, comme Airtable : mode d'affichage, champs masqués, filtres, tri, hauteur des
 * lignes, recherche ; annuler / rétablir ; import et export de la table.
 */
export function ViewBar({ table, mode }: { table: Table; mode: ViewMode }) {
  const setViewMode = useDataStore((s) => s.setViewMode)
  const openImport = useUIStore((s) => s.openImport)
  const [panel, setPanel] = useState<{ kind: Panel; anchor: HTMLElement } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const closePanel = useCallback(() => setPanel(null), [])
  const closeExport = useCallback(() => setExportOpen(false), [])
  const view = activeView(table)
  const hiddenCount = view?.hiddenFieldIds.length ?? 0
  const filterCount = activeFilters(table, view).length
  const sortCount = activeSorts(table, view).length
  const toggle = (kind: Panel) => (el: HTMLElement) =>
    setPanel((p) => (p?.kind === kind ? null : { kind, anchor: el }))
  const selectFields = Object.values(table.fields).filter((f) => f.type === 'select')
  const barRef = useRef<HTMLDivElement>(null)

  // Ouverture demandée ailleurs (palette de commandes, menu d'une colonne).
  useEffect(() => {
    const onOpen = (e: Event) => {
      const kind = (e as CustomEvent<string>).detail
      if (kind === 'export') return setExportOpen(true)
      if (kind === 'search') return document.getElementById(VIEW_SEARCH_ID)?.focus()
      const el = barRef.current?.querySelector<HTMLElement>(`[data-tool="${kind}"]`)
      if (el) setPanel({ kind: kind as Panel, anchor: el })
    }
    window.addEventListener(OPEN_VIEW_PANEL, onOpen)
    return () => window.removeEventListener(OPEN_VIEW_PANEL, onOpen)
  }, [])
  const groupField = view?.groupByFieldId ? table.fields[view.groupByFieldId] : undefined

  return (
    <div
      ref={barRef}
      className="@container relative z-20 flex h-11 shrink-0 items-center gap-1 border-b border-line bg-surface/60 px-2 backdrop-blur-sm"
    >
      <div
        role="tablist"
        aria-label="Mode d'affichage"
        className="flex shrink-0 rounded-lg border border-line-strong bg-field p-0.5"
      >
        {MODES.map(({ mode: m, label, icon: Icon, hint }) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            title={hint}
            onClick={() => setViewMode(table.id, m)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5',
              mode === m
                ? 'bg-accent-soft font-medium text-ink shadow-[0_0_14px_-4px_var(--atelier-signature)] ring-1 ring-line-strong [&>svg]:text-accent-fg'
                : 'text-muted hover:text-ink',
            )}
          >
            <Icon size={14} />
            <span className="@max-[44rem]:sr-only">{label}</span>
          </button>
        ))}
      </div>

      <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />

      <Tool
        kind="fields"
        icon={<TOOL_ICONS.fields size={14} />}
        label={hiddenCount ? `${hiddenCount} masqué${hiddenCount > 1 ? 's' : ''}` : 'Champs'}
        active={hiddenCount > 0}
        panel={panel}
        onToggle={toggle('fields')}
      />
      <Tool
        kind="filter"
        icon={<TOOL_ICONS.filter size={14} />}
        label="Filtrer"
        count={filterCount}
        active={filterCount > 0}
        panel={panel}
        onToggle={toggle('filter')}
      />
      <Tool
        kind="sort"
        icon={<TOOL_ICONS.sort size={14} />}
        label="Trier"
        count={sortCount}
        active={sortCount > 0}
        panel={panel}
        onToggle={toggle('sort')}
      />
      {mode === 'kanban' ? (
        selectFields.length > 1 && (
          <Tool
            kind="group"
            icon={<Columns3 size={14} />}
            label={groupField ? `Par ${groupField.label}` : 'Grouper'}
            panel={panel}
            onToggle={toggle('group')}
          />
        )
      ) : (
        <Tool
          kind="height"
          icon={<Rows3 size={14} />}
          label="Hauteur"
          panel={panel}
          onToggle={toggle('height')}
        />
      )}

      <SearchBox />

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <UndoButtons />
        <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
        <button
          type="button"
          onClick={() => openImport({ projectId: table.projectId, tableId: table.id })}
          aria-label="Importer un fichier CSV"
          title="Importer un fichier CSV dans cette table ou dans une nouvelle table"
          className="btn"
        >
          <Upload size={14} />
          <span className="@max-[72rem]:sr-only">Importer</span>
        </button>
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          aria-label="Exporter vers Atelier Projets"
          title="Exporter cette table vers Atelier Projets (JSON, CSV ou envoi direct)"
          className="atelier-btn-primary flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 font-medium hover:brightness-110"
        >
          <Send size={14} />
          <span className="@max-[64rem]:hidden">Exporter vers Atelier Projets</span>
          <span className="hidden @max-[64rem]:inline @max-[40rem]:sr-only">Exporter</span>
        </button>
      </div>

      <Floating
        open={panel !== null}
        anchor={panel?.anchor ?? null}
        onClose={closePanel}
        role="dialog"
        label={
          panel?.kind === 'fields'
            ? 'Champs affichés'
            : panel?.kind === 'filter'
              ? 'Filtres'
              : panel?.kind === 'sort'
                ? 'Tri'
                : panel?.kind === 'group'
                  ? 'Regroupement'
                  : 'Hauteur des lignes'
        }
        className={panel?.kind === 'height' || panel?.kind === 'group' ? 'w-64' : 'p-0'}
      >
        {panel?.kind === 'fields' && <FieldsMenu table={table} />}
        {panel?.kind === 'filter' && <FilterMenu table={table} />}
        {panel?.kind === 'sort' && <SortMenu table={table} />}
        {panel?.kind === 'height' && (
          <>
            <MenuLabel>Hauteur des lignes</MenuLabel>
            {ROW_HEIGHTS.map((h) => (
              <MenuItem
                key={h.value}
                checked={(view?.rowHeight ?? 'standard') === h.value}
                onSelect={() => {
                  setRowHeight(table.id, h.value)
                  closePanel()
                }}
              >
                {h.label}
              </MenuItem>
            ))}
          </>
        )}
        {panel?.kind === 'group' && (
          <>
            <MenuLabel>Colonnes du Kanban</MenuLabel>
            {selectFields.map((f) => (
              <MenuItem
                key={f.id}
                checked={view?.groupByFieldId === f.id}
                onSelect={() => {
                  setGroupBy(table.id, f.id)
                  closePanel()
                }}
              >
                {f.label}
              </MenuItem>
            ))}
          </>
        )}
      </Floating>

      {exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog table={table} open onClose={closeExport} />
        </Suspense>
      )}
    </div>
  )
}

function Tool({
  kind,
  icon,
  label,
  count,
  active,
  panel,
  onToggle,
}: {
  kind: Panel
  icon: ReactNode
  label: string
  count?: number
  active?: boolean
  panel: { kind: Panel } | null
  onToggle: (el: HTMLElement) => void
}) {
  return (
    <ToolButton
      tool={kind}
      icon={icon}
      label={label}
      count={count}
      active={active}
      expanded={panel?.kind === kind}
      onClick={onToggle}
    />
  )
}

/** Recherche rapide dans la vue (non enregistrée), comme la loupe d'Airtable. */
function SearchBox() {
  const search = useUIStore((s) => s.search)
  const setSearch = useUIStore((s) => s.setSearch)
  return (
    <div className="relative ml-1 hidden w-44 shrink-0 @[36rem]:block @[64rem]:w-56">
      <Search
        size={13}
        className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint"
        aria-hidden
      />
      <input
        id={VIEW_SEARCH_ID}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setSearch('')
            document.querySelector<HTMLElement>('[role="grid"]')?.focus()
          }
          if (e.key === 'Enter') document.querySelector<HTMLElement>('[role="grid"]')?.focus()
        }}
        placeholder="Rechercher…"
        aria-label="Rechercher dans la vue"
        className={cn('field-input h-7 pr-7 pl-7', search && 'border-focus')}
      />
      {search && (
        <button
          type="button"
          aria-label="Effacer la recherche"
          onClick={() => setSearch('')}
          className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-muted hover:text-ink"
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}

function UndoButtons() {
  const last = useHistory((s) => s.past.at(-1)?.label)
  const next = useHistory((s) => s.future.at(-1)?.label)
  return (
    <>
      <button
        type="button"
        className="btn-icon"
        disabled={!last}
        onClick={() => undo()}
        aria-label="Annuler la dernière action"
        title={last ? `Annuler : ${last} (${shortcut('Z')})` : 'Rien à annuler'}
      >
        <Undo2 size={15} />
      </button>
      <button
        type="button"
        className="btn-icon"
        disabled={!next}
        onClick={() => redo()}
        aria-label="Rétablir l’action annulée"
        title={next ? `Rétablir : ${next} (${shortcut('Z', { shift: true })})` : 'Rien à rétablir'}
      >
        <Redo2 size={15} />
      </button>
    </>
  )
}
