import { Trash2 } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { useDataStore, useNotices, useUIStore } from '@/store'

export type DeleteTarget =
  | { kind: 'table'; id: string }
  | { kind: 'project'; id: string }
  | { kind: 'workspace'; id: string }

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

const KIND = {
  table: { the: 'la table', Label: 'Table', removed: 'supprimée' },
  project: { the: 'le projet', Label: 'Projet', removed: 'supprimé' },
  workspace: { the: 'l’espace', Label: 'Espace', removed: 'supprimé' },
} as const

/**
 * Confirmation avant de supprimer une table, un projet ou un espace (irréversible). Si la table
 * ouverte disparaît, une autre table du même projet est ouverte à sa place, sinon la première
 * qui reste.
 */
export function DeleteDialog({ target, onClose }: { target: DeleteTarget; onClose: () => void }) {
  const table = useDataStore((s) => (target.kind === 'table' ? s.tables[target.id] : undefined))
  const project = useDataStore((s) =>
    target.kind === 'project' ? s.projects[target.id] : undefined,
  )
  const workspace = useDataStore((s) =>
    target.kind === 'workspace' ? s.workspaces[target.id] : undefined,
  )
  const tables = useDataStore((s) => s.tables)
  const projects = useDataStore((s) => s.projects)
  if (!table && !project && !workspace) return null

  /** Nombre de lignes de chaque table emportée par la suppression d'un projet ou d'un espace. */
  const rowsOf = (tableIds: string[]) => tableIds.map((id) => tables[id]?.rowOrder.length ?? 0)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

  const kind = KIND[target.kind]
  const name = table?.name ?? project?.name ?? workspace?.name ?? ''
  const title = `Supprimer ${kind.the} « ${name} » ?`

  let detail: string
  if (table) {
    detail = `Ses ${plural(table.fieldOrder.length, 'colonne', 'colonnes')} et ses ${plural(table.rowOrder.length, 'ligne', 'lignes')} seront supprimées.`
  } else if (project) {
    const rows = rowsOf(project.tableIds)
    detail = `Ses ${plural(rows.length, 'table', 'tables')} (${plural(sum(rows), 'ligne', 'lignes')} au total) seront supprimées.`
  } else {
    const projectIds = workspace?.projectIds ?? []
    const rows = rowsOf(projectIds.flatMap((id) => projects[id]?.tableIds ?? []))
    detail =
      projectIds.length === 0
        ? 'Cet espace ne contient aucun projet.'
        : `Ses ${plural(projectIds.length, 'projet', 'projets')} et leurs ${plural(rows.length, 'table', 'tables')} (${plural(sum(rows), 'ligne', 'lignes')} au total) seront supprimés.`
  }

  const confirm = () => {
    const data = useDataStore.getState()
    const ui = useUIStore.getState()
    let removed: string[]
    let projectId: string | undefined
    if (target.kind === 'table') {
      removed = [target.id]
      projectId = data.tables[target.id]?.projectId
      data.deleteTable(target.id)
    } else if (target.kind === 'project') {
      removed = data.projects[target.id]?.tableIds ?? []
      data.deleteProject(target.id)
    } else {
      removed = (data.workspaces[target.id]?.projectIds ?? []).flatMap(
        (id) => data.projects[id]?.tableIds ?? [],
      )
      data.deleteWorkspace(target.id)
    }

    if (ui.activeTableId && removed.includes(ui.activeTableId)) {
      // Une table voisine du même projet, sinon la première qui reste.
      const after = useDataStore.getState()
      const sibling = projectId ? after.projects[projectId]?.tableIds[0] : undefined
      ui.openTable(sibling ?? Object.keys(after.tables)[0] ?? null)
    }
    useNotices
      .getState()
      .push({ tone: 'info', title: `${kind.Label} « ${name} » ${kind.removed}` }, 4000)
    onClose()
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      className="max-w-md"
      footer={
        <>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg px-3 text-muted hover:bg-surface-hover hover:text-ink"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={confirm}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-danger px-3 font-medium text-solid-ink hover:brightness-110"
          >
            <Trash2 size={14} />
            Supprimer
          </button>
        </>
      }
    >
      <p>{detail}</p>
      <p className="mt-2 text-muted">
        Cette action est définitive. Pour garder une copie, exportez d’abord en CSV enrichi : il se
        réimporte sans perte.
      </p>
    </Dialog>
  )
}
