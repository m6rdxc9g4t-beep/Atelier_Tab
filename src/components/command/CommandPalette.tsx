import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import {
  ArrowDownUp,
  Columns3,
  Grid3x3,
  ListFilter,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  Redo2,
  Search,
  Send,
  Sparkles,
  Sun,
  Table2,
  Undo2,
  Upload,
} from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useDataStore, useUIStore } from '@/store'
import { useAssistant } from '@/store/assistant.store'
import { addRowAndSelect, getActiveTable } from '@/store/grid-actions'
import { redo, undo } from '@/store/history'
import { OPEN_VIEW_PANEL } from '@/components/grid/GridHeader'
import { shortcut } from '@/lib/keys'

/**
 * Palette de commandes (⌘K / Ctrl+K) : ouvrir une table de n'importe quel projet, et les
 * actions courantes (nouvelle ligne, filtres, modes, import / export, thème, assistant…).
 */
export function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen)
  const setOpen = useUIStore((s) => s.setPaletteOpen)
  const workspaces = useDataStore((s) => s.workspaces)
  const workspaceOrder = useDataStore((s) => s.workspaceOrder)
  const projects = useDataStore((s) => s.projects)
  const tables = useDataStore((s) => s.tables)
  const { setTheme } = useTheme()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, setOpen])

  if (!open) return null

  const run = (fn: () => void) => () => {
    setOpen(false)
    // Après la fermeture : le focus revient à la grille avant l'action.
    requestAnimationFrame(fn)
  }
  const table = getActiveTable()
  const panel = (detail: string) => () =>
    window.dispatchEvent(new CustomEvent(OPEN_VIEW_PANEL, { detail }))
  const mode = (m: 'hybrid' | 'sheet' | 'kanban') => () => {
    if (table) useDataStore.getState().setViewMode(table.id, m)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh] dark:bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <Command
        label="Palette de commandes"
        loop
        className="w-full max-w-xl overflow-hidden rounded-xl border border-edge bg-surface-raised shadow-glow-strong"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search size={15} className="shrink-0 text-faint" aria-hidden />
          <Command.Input
            autoFocus
            placeholder="Ouvrir une table ou lancer une action…"
            className="h-11 w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
          />
          <kbd className="kbd">Échap</kbd>
        </div>
        <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-muted">Aucun résultat</Command.Empty>
          <Command.Group heading="Tables" className={GROUP}>
            {workspaceOrder.flatMap((wsId) =>
              (workspaces[wsId]?.projectIds ?? []).flatMap((projectId) => {
                const project = projects[projectId]
                return (project?.tableIds ?? []).map((tableId) => {
                  const t = tables[tableId]
                  if (!t || !project) return null
                  return (
                    <Item
                      key={tableId}
                      value={`table ${t.name} ${project.name} ${tableId}`}
                      icon={<Table2 size={14} />}
                      hint={`${project.name} · ${workspaces[wsId]?.name ?? ''}`}
                      onSelect={run(() => {
                        useUIStore.getState().toggleProject(project.id, true)
                        useUIStore.getState().openTable(tableId)
                      })}
                    >
                      {t.name}
                    </Item>
                  )
                })
              }),
            )}
          </Command.Group>
          {table && (
            <Command.Group heading={`Table « ${table.name} »`} className={GROUP}>
              <Item
                value="nouvelle ligne ajouter"
                icon={<Plus size={14} />}
                onSelect={run(() => void addRowAndSelect())}
              >
                Nouvelle ligne
              </Item>
              <Item
                value="filtrer filtre"
                icon={<ListFilter size={14} />}
                onSelect={run(panel('filter'))}
              >
                Filtrer…
              </Item>
              <Item
                value="trier tri"
                icon={<ArrowDownUp size={14} />}
                onSelect={run(panel('sort'))}
              >
                Trier…
              </Item>
              <Item
                value="rechercher dans la vue"
                icon={<Search size={14} />}
                shortcut={shortcut('F')}
                onSelect={run(panel('search'))}
              >
                Rechercher dans la vue
              </Item>
              <Item value="vue grille" icon={<Table2 size={14} />} onSelect={run(mode('hybrid'))}>
                Afficher la grille
              </Item>
              <Item
                value="vue tableur excel brut"
                icon={<Grid3x3 size={14} />}
                onSelect={run(mode('sheet'))}
              >
                Afficher le tableur
              </Item>
              <Item
                value="vue kanban cartes"
                icon={<Columns3 size={14} />}
                onSelect={run(mode('kanban'))}
              >
                Afficher le Kanban
              </Item>
              <Item
                value="importer csv"
                icon={<Upload size={14} />}
                onSelect={run(() =>
                  useUIStore
                    .getState()
                    .openImport({ projectId: table.projectId, tableId: table.id }),
                )}
              >
                Importer un fichier CSV…
              </Item>
              <Item
                value="exporter atelier projets envoyer"
                icon={<Send size={14} />}
                onSelect={run(panel('export'))}
              >
                Exporter vers Atelier Projets…
              </Item>
            </Command.Group>
          )}
          <Command.Group heading="Général" className={GROUP}>
            <Item
              value="annuler"
              icon={<Undo2 size={14} />}
              shortcut={shortcut('Z')}
              onSelect={run(() => void undo())}
            >
              Annuler
            </Item>
            <Item
              value="rétablir refaire"
              icon={<Redo2 size={14} />}
              shortcut={shortcut('Z', { shift: true })}
              onSelect={run(() => void redo())}
            >
              Rétablir
            </Item>
            <Item
              value="assistant ia"
              icon={<Sparkles size={14} />}
              shortcut={shortcut('J')}
              onSelect={run(() => useAssistant.getState().toggle())}
            >
              Assistant IA
            </Item>
            <Item
              value="panneau projets barre latérale"
              icon={<PanelLeft size={14} />}
              onSelect={run(() => useUIStore.getState().toggleSidebar())}
            >
              Afficher ou masquer les projets
            </Item>
            <Item
              value="thème clair"
              icon={<Sun size={14} />}
              onSelect={run(() => setTheme('light'))}
            >
              Thème clair
            </Item>
            <Item
              value="thème sombre"
              icon={<Moon size={14} />}
              onSelect={run(() => setTheme('dark'))}
            >
              Thème sombre
            </Item>
            <Item
              value="thème système"
              icon={<Monitor size={14} />}
              onSelect={run(() => setTheme('system'))}
            >
              Thème du système
            </Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>,
    document.body,
  )
}

const GROUP =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted'

function Item({
  value,
  icon,
  hint,
  shortcut: keys,
  onSelect,
  children,
}: {
  value: string
  icon: ReactNode
  hint?: string
  shortcut?: string
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-ink data-[selected=true]:bg-surface-hover"
    >
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="truncate text-[12px] text-faint">{hint}</span>}
      {keys && <kbd className="kbd">{keys}</kbd>}
    </Command.Item>
  )
}
