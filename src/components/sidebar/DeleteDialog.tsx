import { Trash2 } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import { useDataStore, useNotices, useUIStore } from '@/store'

export type DeleteTarget = { kind: 'table'; id: string } | { kind: 'project'; id: string }

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/**
 * Confirmation avant de supprimer une table ou un projet (irréversible). Si la table ouverte
 * disparaît, une autre table du même projet est ouverte à sa place.
 */
export function DeleteDialog({ target, onClose }: { target: DeleteTarget; onClose: () => void }) {
  const table = useDataStore((s) => (target.kind === 'table' ? s.tables[target.id] : undefined))
  const project = useDataStore((s) =>
    target.kind === 'project' ? s.projects[target.id] : undefined,
  )
  const tables = useDataStore((s) => s.tables)
  const projectTables = project
    ? project.tableIds.map((id) => tables[id]?.rowOrder.length ?? 0)
    : []
  if (!table && !project) return null

  const name = table?.name ?? project?.name ?? ''
  const title = table ? `Supprimer la table « ${name} » ?` : `Supprimer le projet « ${name} » ?`
  const detail = table
    ? `Ses ${plural(table.fieldOrder.length, 'colonne', 'colonnes')} et ses ${plural(table.rowOrder.length, 'ligne', 'lignes')} seront supprimées.`
    : `Ses ${plural(projectTables.length, 'table', 'tables')} (${plural(
        projectTables.reduce((a, b) => a + b, 0),
        'ligne',
        'lignes',
      )} au total) seront supprimées.`

  const confirm = () => {
    const data = useDataStore.getState()
    const ui = useUIStore.getState()
    const removed =
      target.kind === 'table' ? [target.id] : (data.projects[target.id]?.tableIds ?? [])
    const projectId = target.kind === 'table' ? data.tables[target.id]?.projectId : undefined
    if (target.kind === 'table') data.deleteTable(target.id)
    else data.deleteProject(target.id)

    if (ui.activeTableId && removed.includes(ui.activeTableId)) {
      // Une table voisine du même projet, sinon la première qui reste.
      const after = useDataStore.getState()
      const sibling = projectId ? after.projects[projectId]?.tableIds[0] : undefined
      ui.openTable(sibling ?? Object.keys(after.tables)[0] ?? null)
    }
    useNotices.getState().push(
      {
        tone: 'info',
        title: `${table ? 'Table' : 'Projet'} « ${name} » supprimé${table ? 'e' : ''}`,
      },
      4000,
    )
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
