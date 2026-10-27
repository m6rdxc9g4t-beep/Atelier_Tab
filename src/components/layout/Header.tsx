import { useState } from 'react'
import { ChevronRight, PanelLeftOpen, Search, Sparkles } from 'lucide-react'
import { useAssistant } from '@/store/assistant.store'
import { useDataStore, useUIStore } from '@/store'
import type { Table } from '@/types/domain'
import { cn } from '@/lib/cn'
import { shortcut } from '@/lib/keys'
import { ProviderBadges } from '@/components/assistant/ProviderBadges'
import { AtelierBrand } from './AtelierBrand'
import { OnlineToggle } from './OnlineToggle'
import { SuiteSwitcher } from './SuiteSwitcher'
import { ThemeToggle } from './ThemeToggle'

/**
 * En-tête de l'application : suite et marque, fil d'Ariane (double-clic sur le nom de la table
 * pour la renommer), recherche ⌘K, moteurs d'IA, mode en ligne, assistant et thème.
 * Les outils de la table (modes, filtres, import / export) sont dans la barre de vue.
 */
export function Header({ table }: { table: Table }) {
  const project = useDataStore((s) => s.projects[table.projectId])
  const workspace = useDataStore((s) => (project ? s.workspaces[project.workspaceId] : undefined))
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setPaletteOpen = useUIStore((s) => s.setPaletteOpen)
  const assistantOpen = useAssistant((s) => s.open)
  const toggleAssistant = useAssistant((s) => s.toggle)
  const [renaming, setRenaming] = useState(false)

  const rename = (name: string) => {
    const clean = name.trim()
    if (clean && clean !== table.name) useDataStore.getState().renameTable(table.id, clean)
    setRenaming(false)
  }

  return (
    <header className="@container relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-line-strong bg-sidebar/70 px-3 backdrop-blur-sm">
      {sidebarCollapsed && (
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Afficher le panneau des projets"
          title="Afficher le panneau des projets"
          className="btn-icon"
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
        {workspace && <span className="truncate @max-[60rem]:hidden">{workspace.name}</span>}
        {workspace && (
          <ChevronRight size={13} className="shrink-0 text-faint @max-[60rem]:hidden" />
        )}
        {project && <span className="truncate @max-[40rem]:hidden">{project.name}</span>}
        {project && <ChevronRight size={13} className="shrink-0 text-faint @max-[40rem]:hidden" />}
        {renaming ? (
          <input
            autoFocus
            defaultValue={table.name}
            aria-label="Nom de la table"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
            className="h-7 w-56 rounded-md border border-accent bg-field px-2 font-semibold text-ink outline-none"
          />
        ) : (
          <h1
            onDoubleClick={() => setRenaming(true)}
            title="Double-cliquez pour renommer la table"
            className="atelier-neon-text max-w-[60%] shrink-0 cursor-text truncate text-[14px] font-semibold text-ink"
          >
            {table.name}
          </h1>
        )}
      </nav>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-label="Rechercher une table ou une action"
        title={`Rechercher une table ou une action (${shortcut('K')})`}
        className="btn h-8 w-56 justify-start text-faint @max-[64rem]:w-auto"
      >
        <Search size={14} />
        <span className="flex-1 text-left @max-[64rem]:sr-only">Rechercher…</span>
        <kbd className="kbd @max-[64rem]:hidden">{shortcut('K')}</kbd>
      </button>
      <ProviderBadges className="@max-[72rem]:hidden" />
      <OnlineToggle labelClassName="@max-[44rem]:sr-only" />
      <button
        type="button"
        onClick={toggleAssistant}
        aria-pressed={assistantOpen}
        title={`Assistant IA (${shortcut('J')})`}
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
    </header>
  )
}
