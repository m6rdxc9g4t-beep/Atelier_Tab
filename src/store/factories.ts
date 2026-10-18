/** Fabriques d'objets du domaine, partagées par le store et les données de démonstration. */
import { newId } from '@/lib/ids'
import type { Field, SelectChoice, Table, TableRecord, View, ViewMode } from '@/types/domain'

export const DEFAULT_STATUS_CHOICES: SelectChoice[] = [
  { id: 'opt_todo', label: 'À faire', color: 'gray' },
  { id: 'opt_doing', label: 'En cours', color: 'blue' },
  { id: 'opt_done', label: 'Validé', color: 'green' },
  { id: 'opt_blocked', label: 'Bloqué', color: 'red' },
]

export function createView(mode: ViewMode, patch: Partial<View> = {}): View {
  const names: Record<ViewMode, string> = { hybrid: 'Grille', sheet: 'Tableur', kanban: 'Kanban' }
  return {
    id: newId('view'),
    name: names[mode],
    mode,
    filters: [],
    sorts: [],
    hiddenFieldIds: [],
    ...patch,
  }
}

export function createField(patch: Partial<Field> & Pick<Field, 'label' | 'type'>): Field {
  return { id: newId('fld'), ...patch }
}

export function createRecord(
  cells: TableRecord['cells'] = {},
  kind: TableRecord['kind'] = 'data',
  id: string = newId('rec'),
): TableRecord {
  return { id, kind, cells }
}

/** Table vierge : un titre, un statut, trois lignes vides. */
export function createDefaultTable(projectId: string, name: string): Table {
  const title = createField({
    label: 'Nom',
    type: 'text',
    atelierMapping: 'entity_title',
    width: 240,
  })
  const status = createField({
    label: 'Statut',
    type: 'select',
    atelierMapping: 'workflow_state',
    options: { choices: DEFAULT_STATUS_CHOICES.map((c) => ({ ...c })) },
  })
  const notes = createField({
    label: 'Notes',
    type: 'text',
    atelierMapping: 'description',
    width: 280,
  })
  const records = [createRecord(), createRecord(), createRecord()]
  const grid = createView('hybrid')
  return {
    id: newId('tbl'),
    projectId,
    name,
    fieldOrder: [title.id, status.id, notes.id],
    rowOrder: records.map((r) => r.id),
    fields: { [title.id]: title, [status.id]: status, [notes.id]: notes },
    records: Object.fromEntries(records.map((r) => [r.id, r])),
    views: [grid, createView('kanban', { groupByFieldId: status.id })],
    activeViewId: grid.id,
  }
}

/** Assemble une table à partir de listes ordonnées de champs et de lignes. */
export function buildTable(input: {
  id: string
  projectId: string
  name: string
  fields: Field[]
  records: TableRecord[]
  views?: View[]
}): Table {
  const views = input.views ?? [createView('hybrid')]
  const first = views[0]
  if (!first) throw new Error('Une table doit avoir au moins une vue')
  return {
    id: input.id,
    projectId: input.projectId,
    name: input.name,
    fieldOrder: input.fields.map((f) => f.id),
    rowOrder: input.records.map((r) => r.id),
    fields: Object.fromEntries(input.fields.map((f) => [f.id, f])),
    records: Object.fromEntries(input.records.map((r) => [r.id, r])),
    views,
    activeViewId: first.id,
  }
}
