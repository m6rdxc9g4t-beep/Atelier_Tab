import { useState } from 'react'
import {
  ChevronRight,
  FolderClosed,
  FolderOpen,
  PanelLeftClose,
  Plus,
  Table2,
  PlugZap,
  Unplug,
} from 'lucide-react'
import { STATUS_LABELS, useExportStatus } from '@/components/dataflow/useExportStatus'
import { useDataStore, useUIStore } from '@/store'
import type { Project } from '@/types/domain'
import { cn } from '@/lib/cn'

/**
 * Navigation : Espaces de travail › Projets › Tables.
 * La recherche rapide (Ctrl/Cmd + K), le renommage et la duplication arrivent en phase 4.
 */
export function Sidebar() {
  const workspaceOrder = useDataStore((s) => s.workspaceOrder)
  const workspaces = useDataStore((s) => s.workspaces)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)

  return (
    <aside
      aria-label="Projets"
      className="atelier-glass flex w-60 shrink-0 flex-col border-r border-line bg-surface-sunken"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
        <FolderOpen size={14} className="text-muted" aria-hidden />
        <span className="flex-1 font-semibold tracking-tight">Projets</span>
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Replier le panneau"
          title="Replier le panneau"
          className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-ink"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
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
    <section className="mb-4">
      <div className="group flex h-7 items-center px-2">
        <h2 className="flex-1 truncate text-[12px] font-medium text-muted">{name}</h2>
        <button
          type="button"
          onClick={() => setNaming(true)}
          aria-label={`Nouveau projet dans ${name}`}
          title="Nouveau projet"
          className="rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-hover hover:text-ink focus-visible:opacity-100"
        >
          <Plus size={14} />
        </button>
      </div>
      <ul>
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
  const [naming, setNaming] = useState(false)
  const containsActive = activeTableId !== null && project.tableIds.includes(activeTableId)
  const Folder = expanded ? FolderOpen : FolderClosed

  const create = (raw: string) => {
    setNaming(false)
    const tableName = raw.trim()
    if (tableName) openTable(createTable(project.id, tableName))
  }

  return (
    <li>
      <div className="group flex items-center rounded-md hover:bg-surface-hover">
        <button
          type="button"
          onClick={() => toggleProject(project.id)}
          aria-expanded={expanded}
          className={cn(
            'flex h-7 min-w-0 flex-1 items-center gap-1.5 px-1.5 text-left',
            containsActive && !expanded ? 'font-medium text-ink' : 'text-ink',
          )}
        >
          <ChevronRight
            size={13}
            className={cn('shrink-0 text-faint transition-transform', expanded && 'rotate-90')}
          />
          <Folder size={14} className="shrink-0 text-muted" />
          <span className="truncate">{project.name}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            toggleProject(project.id, true)
            setNaming(true)
          }}
          aria-label={`Nouvelle table dans ${project.name}`}
          title="Nouvelle table"
          className="mr-1 rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:text-ink focus-visible:opacity-100"
        >
          <Plus size={13} />
        </button>
      </div>

      {expanded && (
        <ul className="ml-[18px] border-l border-line pl-1.5">
          {project.tableIds.map((tableId) => {
            const table = tables[tableId]
            if (!table) return null
            const active = tableId === activeTableId
            return (
              <li key={tableId}>
                <button
                  type="button"
                  onClick={() => openTable(tableId)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left',
                    active
                      ? 'bg-accent-soft font-medium text-ink'
                      : 'text-muted hover:bg-surface-hover hover:text-ink',
                  )}
                >
                  <Table2 size={13} className={cn('shrink-0', active && 'text-accent-fg')} />
                  <span className="min-w-0 flex-1 truncate">{table.name}</span>
                  <ExportStatusDot tableId={tableId} />
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
    </li>
  )
}

function ExportStatusDot({ tableId }: { tableId: string }) {
  const status = useExportStatus(tableId)
  if (!status) return null
  const tone = status === 'ready' ? 'tone-green' : status === 'warnings' ? 'tone-amber' : 'tone-red'
  return (
    <span
      className={`${tone} tone-dot size-1.5 shrink-0 rounded-full`}
      title={STATUS_LABELS[status]}
      aria-label={STATUS_LABELS[status]}
      role="img"
    />
  )
}

/** Pied de sidebar : état de la connexion à Atelier Projets et dernier export. */
function PipelineStatus() {
  const integration = useDataStore((s) => s.integrations.atelierProjets)
  const tables = useDataStore((s) => s.tables)
  const connected = Boolean(integration.webhookUrl)
  const last = integration.lastExport
  const Icon = connected ? PlugZap : Unplug

  return (
    <div className="shrink-0 border-t border-line px-3 py-2.5 text-[12px] text-muted">
      <div className="flex items-center gap-2">
        <Icon size={13} className={cn('shrink-0', connected && 'text-success')} />
        <span className="flex-1 truncate">
          {connected
            ? 'Atelier Projets : envoi direct configuré'
            : 'Atelier Projets : export par fichier'}
        </span>
      </div>
      {last && (
        <p className="mt-1 truncate pl-[21px]" title={last.message}>
          <span className={last.ok ? 'text-success' : 'text-danger'}>{last.ok ? '✓' : '✕'}</span>{' '}
          {tables[last.tableId]?.name ?? 'Table supprimée'},{' '}
          {new Date(last.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </div>
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
        if (e.key === 'Enter') onSubmit(e.currentTarget.value)
        if (e.key === 'Escape') onCancel()
      }}
      className="h-7 w-full rounded-md border border-accent bg-surface px-2 outline-none placeholder:text-faint"
    />
  )
}
