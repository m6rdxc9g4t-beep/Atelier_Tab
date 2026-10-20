import { lazy, Suspense, useCallback, useState } from 'react'
import {
  ChevronRight,
  Columns3,
  Grid3x3,
  PanelLeftOpen,
  Send,
  Sparkles,
  Table2,
} from 'lucide-react'
import { useAssistant } from '@/store/assistant.store'
import { useDataStore, useUIStore } from '@/store'
import type { Table, ViewMode } from '@/types/domain'
import { cn } from '@/lib/cn'
import { ProviderBadges } from '@/components/assistant/ProviderBadges'
import { AtelierBrand } from './AtelierBrand'
import { OnlineToggle } from './OnlineToggle'
import { SuiteSwitcher } from './SuiteSwitcher'
import { ThemeToggle } from './ThemeToggle'

// Chargé à la première ouverture, comme l'assistant : le démarrage reste léger.
const ExportDialog = lazy(() =>
  import('@/components/dataflow/ExportDialog').then((m) => ({ default: m.ExportDialog })),
)

const MODES: { mode: ViewMode; label: string; icon: typeof Table2; hint: string }[] = [
  { mode: 'hybrid', label: 'Grille', icon: Table2, hint: 'Badges, avatars et formules' },
  { mode: 'sheet', label: 'Tableur', icon: Grid3x3, hint: 'Valeurs brutes, comme dans Excel' },
  { mode: 'kanban', label: 'Kanban', icon: Columns3, hint: 'Cartes groupées par statut' },
]

export function Header({ table, mode }: { table: Table; mode: ViewMode }) {
  const [exportOpen, setExportOpen] = useState(false)
  const closeExport = useCallback(() => setExportOpen(false), [])
  const project = useDataStore((s) => s.projects[table.projectId])
  const workspace = useDataStore((s) => (project ? s.workspaces[project.workspaceId] : undefined))
  const setViewMode = useDataStore((s) => s.setViewMode)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const assistantOpen = useAssistant((s) => s.open)
  const toggleAssistant = useAssistant((s) => s.toggle)

  return (
    <header className="@container relative z-30 flex h-11 shrink-0 items-center gap-3 border-b border-line-strong bg-sidebar/70 px-3 backdrop-blur-sm">
      {sidebarCollapsed && (
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Afficher le panneau des projets"
          title="Afficher le panneau des projets"
          className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-ink"
        >
          <PanelLeftOpen size={15} />
        </button>
      )}

      <div className="flex shrink-0 items-center gap-1.5">
        <SuiteSwitcher />
        <AtelierBrand nameClassName="text-ink @max-[52rem]:sr-only" />
      </div>
      <span className="h-4 w-px shrink-0 bg-line" aria-hidden />

      <nav aria-label="Fil d'Ariane" className="flex min-w-0 flex-1 items-center gap-1 text-muted">
        {workspace && <span className="truncate">{workspace.name}</span>}
        {workspace && <ChevronRight size={13} className="shrink-0 text-faint" />}
        {project && <span className="truncate">{project.name}</span>}
        {project && <ChevronRight size={13} className="shrink-0 text-faint" />}
        <span className="atelier-neon-text max-w-[60%] shrink-0 truncate font-semibold text-ink">
          {table.name}
        </span>
      </nav>

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
            {/* Fenêtre étroite (assistant ouvert…) : icônes seules. */}
            <span className="@max-[58rem]:sr-only">{label}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setExportOpen(true)}
        aria-label="Exporter vers Atelier Projets"
        title="Exporter cette table vers Atelier Projets (JSON, CSV ou envoi direct)"
        className="flex h-8 shrink-0 items-center gap-1.5 atelier-btn-primary rounded-lg px-3 font-medium hover:brightness-110"
      >
        <Send size={14} />
        <span className="@max-[80rem]:hidden">Exporter vers Atelier Projets</span>
        <span className="hidden @max-[80rem]:inline">Exporter</span>
      </button>
      <ProviderBadges className="@max-[72rem]:hidden" />
      <OnlineToggle labelClassName="@max-[44rem]:sr-only" />
      <button
        type="button"
        onClick={toggleAssistant}
        aria-pressed={assistantOpen}
        title="Assistant IA (⌘J)"
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5',
          assistantOpen
            ? 'border-accent bg-accent-soft text-ink'
            : 'border-line-strong bg-field text-muted hover:bg-surface-hover hover:text-ink',
        )}
      >
        <Sparkles size={14} className={assistantOpen ? 'text-accent-fg' : undefined} />
        <span className="@max-[48rem]:sr-only">Assistant</span>
      </button>
      <ThemeToggle />
      {exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog table={table} open onClose={closeExport} />
        </Suspense>
      )}
    </header>
  )
}
