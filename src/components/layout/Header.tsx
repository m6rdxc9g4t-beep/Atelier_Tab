import { ChevronRight, Columns3, Grid3x3, PanelLeftOpen, Send, Table2 } from 'lucide-react'
import { useDataStore, useUIStore } from '@/store'
import type { Table, ViewMode } from '@/types/domain'
import { cn } from '@/lib/cn'
import { ThemeToggle } from './ThemeToggle'

const MODES: { mode: ViewMode; label: string; icon: typeof Table2; hint: string }[] = [
  { mode: 'hybrid', label: 'Grille', icon: Table2, hint: 'Badges, avatars et formules' },
  { mode: 'sheet', label: 'Tableur', icon: Grid3x3, hint: 'Valeurs brutes, comme dans Excel' },
  { mode: 'kanban', label: 'Kanban', icon: Columns3, hint: 'Cartes groupées par statut' },
]

export function Header({ table, mode }: { table: Table; mode: ViewMode }) {
  const project = useDataStore((s) => s.projects[table.projectId])
  const workspace = useDataStore((s) => (project ? s.workspaces[project.workspaceId] : undefined))
  const setViewMode = useDataStore((s) => s.setViewMode)
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line px-3">
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

      <nav aria-label="Fil d'Ariane" className="flex min-w-0 flex-1 items-center gap-1 text-muted">
        {workspace && <span className="truncate">{workspace.name}</span>}
        {workspace && <ChevronRight size={13} className="shrink-0 text-faint" />}
        {project && <span className="truncate">{project.name}</span>}
        {project && <ChevronRight size={13} className="shrink-0 text-faint" />}
        <span className="truncate font-semibold text-ink">{table.name}</span>
      </nav>

      <div
        role="tablist"
        aria-label="Mode d'affichage"
        className="flex shrink-0 rounded-lg bg-surface-sunken p-0.5"
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
                ? 'bg-surface-raised font-medium text-ink shadow-sm ring-1 ring-line'
                : 'text-muted hover:text-ink',
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled
        title="L'export vers atelier_projets arrive avec le module DataFlow"
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 font-medium text-accent-ink opacity-50"
      >
        <Send size={14} />
        Exporter vers atelier_projets
      </button>
      <ThemeToggle />
    </header>
  )
}
