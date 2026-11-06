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
 * Barre haute de 44 px (DESIGN.md « Layout ») : fil d'Ariane et titre de la table (double-clic
 * pour la renommer), moteurs d'IA, mode en ligne, assistant et thème. La suite, la marque et la
 * recherche ⌘K sont dans la barre latérale ; quand elle est repliée, elles reviennent ici.
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
    <header className="@container relative z-30 flex h-11 shrink-0 items-center gap-2 border-b border-line bg-page px-3">
      {sidebarCollapsed && (
        <>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Afficher le panneau des projets"
            title="Afficher le panneau des projets"
            className="btn-icon"
          >
            <PanelLeftOpen size={15} />
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <SuiteSwitcher />
            <AtelierBrand nameClassName="@max-[52rem]:sr-only" />
          </div>
          <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden />
        </>
      )}

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
            className="h-7 w-56 rounded-lg border border-focus bg-field px-2 font-semibold text-ink shadow-focus outline-none"
          />
        ) : (
          <h1
            onDoubleClick={() => setRenaming(true)}
            title="Double-cliquez pour renommer la table"
            className="max-w-[60%] shrink-0 cursor-text truncate text-[13px] font-semibold text-ink"
          >
            {table.name}
          </h1>
        )}
      </nav>

      {sidebarCollapsed && (
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Rechercher une table ou une action"
          title={`Rechercher une table ou une action (${shortcut('K')})`}
          className="btn w-52 justify-start font-normal text-faint @max-[64rem]:w-auto"
        >
          <Search size={14} />
          <span className="flex-1 text-left @max-[64rem]:sr-only">Rechercher…</span>
          <kbd className="kbd @max-[64rem]:hidden">{shortcut('K')}</kbd>
        </button>
      )}
      <ProviderBadges className="@max-[72rem]:hidden" />
      <OnlineToggle labelClassName="@max-[44rem]:sr-only" />
      <button
        type="button"
        onClick={toggleAssistant}
        aria-pressed={assistantOpen}
        title={`Assistant IA (${shortcut('J')})`}
        className={cn('btn', assistantOpen && 'bg-selection text-ink')}
      >
        <Sparkles size={14} className={assistantOpen ? 'text-ink' : 'text-muted'} />
        <span className="@max-[48rem]:sr-only">Assistant</span>
      </button>
      <ThemeToggle />
    </header>
  )
}
