import { useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  PanelLeftClose,
  PlugZap,
  Plus,
  Search,
  Table,
  Trash2,
  Unplug,
  Upload,
  X,
} from 'lucide-react'
import { STATUS_LABELS, useExportStatus } from '@/components/dataflow/useExportStatus'
import { AtelierBrand } from '@/components/layout/AtelierBrand'
import { SuiteSwitcher } from '@/components/layout/SuiteSwitcher'
import { useDataStore, useUIStore } from '@/store'
import type { Project } from '@/types/domain'
import { cn } from '@/lib/cn'
import { shortcut } from '@/lib/keys'
import { DeleteDialog, type DeleteTarget } from './DeleteDialog'

/**
 * Barre latérale, sur le modèle du portail (DESIGN.md « Layout ») : suite et marque en haut,
 * recherche ⌘K, puis la navigation Espaces de travail › Projets › Tables. Double-clic sur un
 * projet ou une table pour le renommer.
 */
/** Bouton d'action d'une ligne : visible au survol ou au clavier, toujours sur écran tactile. */
const ROW_ACTION =
  'grid size-6 shrink-0 place-items-center rounded-md text-faint opacity-0 group-hover:opacity-100 hover:bg-selection hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100'
const ROW_ACTION_IN_GROUP =
  'grid size-6 shrink-0 place-items-center rounded-md text-faint hover:bg-selection hover:text-ink'
/** Groupe d'actions d'un projet : par-dessus la fin du nom, au survol ou au clavier. */
const ROW_ACTIONS =
  'pointer-events-none absolute inset-y-0 right-0 flex items-center gap-px rounded-r-lg bg-surface-hover pr-1 pl-1 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:static pointer-coarse:bg-transparent pointer-coarse:opacity-100'

export function Sidebar() {
  const workspaceOrder = useDataStore((s) => s.workspaceOrder)
  const workspaces = useDataStore((s) => s.workspaces)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const setPaletteOpen = useUIStore((s) => s.setPaletteOpen)

  return (
    <aside
      aria-label="Projets"
      className="flex w-[232px] shrink-0 flex-col border-r border-line bg-sidebar max-[760px]:fixed max-[760px]:inset-y-0 max-[760px]:left-0 max-[760px]:z-50 max-[760px]:w-[min(300px,85vw)] max-[760px]:shadow-glow-strong"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <SuiteSwitcher />
        <AtelierBrand />
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Replier le panneau"
          title="Replier le panneau"
          className="btn-icon ml-auto"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Rechercher une table ou une action"
          title={`Rechercher une table ou une action (${shortcut('K')})`}
          className="flex h-[30px] w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-2.5 text-faint hover:bg-surface-hover hover:text-muted"
        >
          <Search size={14} aria-hidden />
          <span className="flex-1 text-left">Rechercher…</span>
          <kbd className="kbd">{shortcut('K')}</kbd>
        </button>
      </div>

      <nav aria-label="Espaces de travail" className="flex-1 overflow-y-auto px-2 pt-2 pb-3">
        {workspaceOrder.map((wsId) => {
          const ws = workspaces[wsId]
          if (!ws) return null
          return (
            <WorkspaceSection
              key={ws.id}
              workspaceId={ws.id}
              name={ws.name}
              projectIds={ws.projectIds}
            />
          )
        })}
      </nav>

      <ExamplesButton />
      <PipelineStatus />
    </aside>
  )
}

function WorkspaceSection({
  workspaceId,
  name,
  projectIds,
}: {
  workspaceId: string
  name: string
  projectIds: string[]
}) {
  const projects = useDataStore((s) => s.projects)
  const createProject = useDataStore((s) => s.createProject)
  const openTable = useUIStore((s) => s.openTable)
  const toggleProject = useUIStore((s) => s.toggleProject)
  const [naming, setNaming] = useState(false)

  const create = (raw: string) => {
    setNaming(false)
    const projectName = raw.trim()
    if (!projectName) return
    const { projectId, tableId } = createProject(workspaceId, projectName)
    toggleProject(projectId, true)
    openTable(tableId)
  }

  return (
    <section className="mb-3">
      <div className="group flex h-7 items-center pr-1 pl-2">
        <h2 className="flex-1 truncate text-[11.5px] font-medium text-faint">{name}</h2>
        <button
          type="button"
          onClick={() => setNaming(true)}
          aria-label={`Nouveau projet dans ${name}`}
          title="Nouveau projet"
          className={ROW_ACTION}
        >
          <Plus size={14} />
        </button>
      </div>
      <ul className="flex flex-col gap-px">
        {projectIds.map((id) => {
          const project = projects[id]
          return project ? <ProjectItem key={id} project={project} /> : null
        })}
        {naming && (
          <li className="px-1 py-0.5">
            <NameInput
              placeholder="Nom du projet"
              onSubmit={create}
              onCancel={() => setNaming(false)}
            />
          </li>
        )}
      </ul>
    </section>
  )
}

function ProjectItem({ project }: { project: Project }) {
  const tables = useDataStore((s) => s.tables)
  const createTable = useDataStore((s) => s.createTable)
  const expanded = useUIStore((s) => s.expandedProjectIds.includes(project.id))
  const activeTableId = useUIStore((s) => s.activeTableId)
  const toggleProject = useUIStore((s) => s.toggleProject)
  const openTable = useUIStore((s) => s.openTable)
  const openImport = useUIStore((s) => s.openImport)
  const [naming, setNaming] = useState(false)
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)
  const [renamingProject, setRenamingProject] = useState(false)
  const [renamingTable, setRenamingTable] = useState<string | null>(null)
  const renameProject = useDataStore((s) => s.renameProject)
  const renameTable = useDataStore((s) => s.renameTable)
  const containsActive = activeTableId !== null && project.tableIds.includes(activeTableId)
  const Folder = expanded ? FolderOpen : FolderClosed

  const create = (raw: string) => {
    setNaming(false)
    const tableName = raw.trim()
    if (tableName) openTable(createTable(project.id, tableName))
  }

  return (
    <li>
      <div className="group relative flex items-center rounded-lg hover:bg-surface-hover">
        {renamingProject ? (
          <div className="flex h-[30px] min-w-0 flex-1 items-center gap-1.5 px-1.5">
            <ChevronRight size={13} className="shrink-0 text-faint" />
            <Folder size={14} className="shrink-0 text-muted" />
            <RenameInput
              value={project.name}
              label="Nom du projet"
              onDone={(name) => {
                if (name && name !== project.name) renameProject(project.id, name)
                setRenamingProject(false)
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => toggleProject(project.id)}
            onDoubleClick={() => setRenamingProject(true)}
            aria-expanded={expanded}
            title="Double-cliquez pour renommer"
            className={cn(
              'flex h-[30px] min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left font-medium',
              containsActive && !expanded ? 'text-ink' : 'text-ink-2',
            )}
          >
            <ChevronRight
              size={13}
              className={cn(
                'shrink-0 text-faint transition-transform duration-150',
                expanded && 'rotate-90',
              )}
            />
            <Folder size={15} className="shrink-0 text-faint" />
            <span className="truncate">{project.name}</span>
          </button>
        )}
        {/* Actions au survol, posées sur le nom (il garde toute sa largeur au repos). */}
        <div className={ROW_ACTIONS}>
          <button
            type="button"
            onClick={() => setDeleting({ kind: 'project', id: project.id })}
            aria-label={`Supprimer le projet ${project.name}`}
            title="Supprimer le projet"
            className={cn(ROW_ACTION_IN_GROUP, 'hover:text-down')}
          >
            <Trash2 size={13} />
          </button>
          <button
            type="button"
            onClick={() => openImport({ projectId: project.id, tableId: null })}
            aria-label={`Importer un CSV dans ${project.name}`}
            title="Nouvelle table depuis un fichier CSV"
            className={ROW_ACTION_IN_GROUP}
          >
            <Upload size={13} />
          </button>
          <button
            type="button"
            onClick={() => {
              toggleProject(project.id, true)
              setNaming(true)
            }}
            aria-label={`Nouvelle table dans ${project.name}`}
            title="Nouvelle table"
            className={ROW_ACTION_IN_GROUP}
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <ul className="mt-px flex flex-col gap-px pl-[19px]">
          {project.tableIds.map((tableId) => {
            const table = tables[tableId]
            if (!table) return null
            const active = tableId === activeTableId
            return (
              <li key={tableId} className="group/table relative">
                {renamingTable === tableId ? (
                  <div className="flex h-[30px] w-full items-center gap-2 pr-1 pl-2">
                    <Table size={14} className="shrink-0 text-faint" />
                    <RenameInput
                      value={table.name}
                      label="Nom de la table"
                      onDone={(name) => {
                        if (name && name !== table.name) renameTable(tableId, name)
                        setRenamingTable(null)
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => openTable(tableId)}
                    onDoubleClick={() => setRenamingTable(tableId)}
                    aria-current={active ? 'page' : undefined}
                    title="Double-cliquez pour renommer"
                    className={cn(
                      'flex h-[30px] w-full items-center gap-2 rounded-lg pr-7 pl-2 text-left font-medium',
                      active
                        ? 'atelier-nav-active'
                        : 'text-ink-2 hover:bg-surface-hover hover:text-ink',
                    )}
                  >
                    <Table
                      size={14}
                      className={cn('shrink-0', active ? 'text-ink' : 'text-faint')}
                    />
                    <span className="min-w-0 flex-1 truncate">{table.name}</span>
                    <span className="text-[11.5px] font-medium text-faint tabular-nums group-hover/table:opacity-0">
                      {table.rowOrder.filter((id) => table.records[id]?.kind === 'data').length}
                    </span>
                    <ExportStatusDot tableId={tableId} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDeleting({ kind: 'table', id: tableId })}
                  aria-label={`Supprimer la table ${table.name}`}
                  title="Supprimer la table"
                  className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 place-items-center rounded-md text-faint opacity-0 group-hover/table:opacity-100 hover:bg-selection hover:text-down focus-visible:opacity-100 pointer-coarse:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            )
          })}
          {naming && (
            <li className="py-0.5">
              <NameInput
                placeholder="Nom de la table"
                onSubmit={create}
                onCancel={() => setNaming(false)}
              />
            </li>
          )}
        </ul>
      )}
      {deleting && <DeleteDialog target={deleting} onClose={() => setDeleting(null)} />}
    </li>
  )
}

function ExportStatusDot({ tableId }: { tableId: string }) {
  const status = useExportStatus(tableId)
  // Règle du témoin muet (DESIGN.md) : une table prête pour l'export n'affiche rien ;
  // seuls les avertissements (ambre) et les erreurs (rouge) se signalent.
  if (!status || status === 'ready') return null
  const tone = status === 'warnings' ? 'bg-warn' : 'bg-down'
  return (
    <span
      className={`${tone} size-1.5 shrink-0 rounded-full`}
      title={STATUS_LABELS[status]}
      aria-label={STATUS_LABELS[status]}
      role="img"
    />
  )
}

/** Pied de sidebar : état de la connexion à Atelier Projets et dernier export. */
/** Ouvre « Exemples de la suite » : histoires fictives à suivre d'une app à l'autre. */
function ExamplesButton() {
  const setExamplesOpen = useUIStore((s) => s.setExamplesOpen)
  return (
    <div className="shrink-0 px-2 pb-1">
      <button
        type="button"
        onClick={() => setExamplesOpen(true)}
        className="flex h-7 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] text-muted hover:bg-surface-hover hover:text-ink"
      >
        <BookOpen size={14} className="shrink-0 text-faint" aria-hidden />
        Exemples de la suite
      </button>
    </div>
  )
}

function PipelineStatus() {
  const integration = useDataStore((s) => s.integrations.atelierProjets)
  const tables = useDataStore((s) => s.tables)
  const connected = Boolean(integration.webhookUrl)
  const last = integration.lastExport
  const Icon = connected ? PlugZap : Unplug

  return (
    <div className="shrink-0 border-t border-line px-3 py-2.5 text-[12px] text-muted">
      <div className="flex items-center gap-2">
        <Icon size={14} className="shrink-0 text-faint" aria-hidden />
        <span
          className="flex-1 truncate"
          title={
            connected
              ? 'Atelier Projets : envoi direct configuré'
              : 'Atelier Projets : export par fichier'
          }
        >
          {connected
            ? 'Atelier Projets : envoi direct configuré'
            : 'Atelier Projets : export par fichier'}
        </span>
      </div>
      {last && (
        <p
          className={cn('mt-1 flex items-center gap-1 truncate pl-[22px]', !last.ok && 'text-down')}
          title={last.message}
        >
          {last.ok ? (
            <Check size={12} className="shrink-0" aria-label="Envoyé" />
          ) : (
            <X size={12} className="shrink-0" aria-label="Échec" />
          )}
          {tables[last.tableId]?.name ?? 'Table supprimée'},{' '}
          {new Date(last.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
  )
}

/** Renommage en place (Entrée valide, Échap annule). */
function RenameInput({
  value,
  label,
  onDone,
}: {
  value: string
  label: string
  onDone: (name: string | null) => void
}) {
  return (
    <input
      autoFocus
      defaultValue={value}
      aria-label={label}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => onDone(e.target.value.trim() || null)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') onDone(null)
      }}
      className="h-6 min-w-0 flex-1 rounded-md border border-focus bg-field px-1.5 text-ink shadow-focus outline-none"
    />
  )
}

function NameInput({
  placeholder,
  onSubmit,
  onCancel,
}: {
  placeholder: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  return (
    <input
      autoFocus
      placeholder={placeholder}
      onBlur={(e) => onSubmit(e.target.value)}
      onKeyDown={(e) => {
        // Saisie en cours dans un éditeur de méthode (IME) : Entrée valide le mot.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return
        if (e.key === 'Enter') onSubmit(e.currentTarget.value)
        if (e.key === 'Escape') onCancel()
      }}
      className="h-[30px] w-full rounded-lg border border-focus bg-field px-2 shadow-focus outline-none placeholder:text-faint"
    />
  )
}
