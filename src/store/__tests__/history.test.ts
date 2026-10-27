// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { analyzeCsv, suggestPlan } from '@/dataflow/import'
import { useDataStore, useNotices, useUIStore } from '@/store'
import type { AppData, Filter } from '@/types/domain'
import { keepUnchanged, pickData } from '../data.store'
import { deleteField, saveField } from '../field-actions'
import { deleteRows } from '../grid-actions'
import { clearHistory, redo, undo, undoable, useHistory } from '../history'
import { commitImport, lookupContext } from '../import-actions'
import { getViewRows } from '../view-rows'

const T = 'tbl_planning_lots'
const B = 'tbl_budget_global'
const table = (id = T) => useDataStore.getState().tables[id]!
const view = (viewId: string) => table().views.find((v) => v.id === viewId)!
const notice = (title: string) => useNotices.getState().notices.find((n) => n.title === title)

/** Saisie enregistrée comme une étape, comme dans la grille. */
function edit(recordId: string, fieldId: string, input: string | number, tableId = T) {
  undoable('Modifier', tableId, () =>
    useDataStore.getState().setCell(tableId, recordId, fieldId, input),
  )
}

beforeEach(() => {
  useDataStore.getState().reset()
  clearHistory()
  useNotices.setState({ notices: [] })
  useUIStore.setState({
    activeTableId: T,
    selection: null,
    rangeEnd: null,
    editing: null,
    inputError: null,
    search: '',
    pinnedRecordIds: [],
    expandedRecordId: null,
  })
})

describe('bouton « Annuler » d’un message', () => {
  it('annule la suppression annoncée', () => {
    deleteRows(['rec_02'])
    notice('Ligne supprimée')?.action?.run()
    expect(table().rowOrder).toEqual(['rec_01', 'rec_02', 'rec_03', 'rec_total'])
  })

  it('n’annule pas une saisie faite après la suppression', () => {
    deleteRows(['rec_02'])
    const run = notice('Ligne supprimée')?.action?.run
    edit('rec_01', 'task_name', 'Fondations')
    // Le bouton disparaît : il annulerait la saisie, pas la suppression.
    expect(notice('Ligne supprimée')).toBeDefined()
    expect(notice('Ligne supprimée')?.action).toBeUndefined()
    run?.()
    expect(table().records.rec_01?.cells.task_name).toBe('Fondations')
    expect(table().records.rec_02).toBeUndefined()
    expect(notice('Rien n’a été annulé')).toBeDefined()
  })

  it('après ⌘Z, le message s’en va et le bouton n’annule rien de plus', () => {
    edit('rec_01', 'task_name', 'Fondations')
    deleteRows(['rec_02'])
    const run = notice('Ligne supprimée')?.action?.run
    undo()
    expect(notice('Ligne supprimée')).toBeUndefined()
    run?.()
    expect(table().rowOrder).toContain('rec_02')
    expect(table().records.rec_01?.cells.task_name).toBe('Fondations')
  })

  it('table modifiée ailleurs après une suppression de colonne : rien d’autre n’est annulé', () => {
    edit('rec_bg_1', 'bg_item', 'Études', B)
    deleteField(T, 'owner')
    const run = notice('Colonne « Responsable » supprimée')?.action?.run
    // L'assistant modifie la table : son historique est oublié.
    useDataStore.getState().setCell(T, 'rec_03', 'task_name', 'Isolation')
    expect(notice('Colonne « Responsable » supprimée')?.action).toBeUndefined()
    run?.()
    expect(table(B).records.rec_bg_1?.cells.bg_item).toBe('Études')
    expect(useUIStore.getState().activeTableId).toBe(T)
  })

  it('pas de bouton quand rien n’a été supprimé', () => {
    deleteRows(['rec_inconnue'])
    expect(notice('Ligne supprimée')?.action).toBeUndefined()
  })
})

describe('vues et annulation', () => {
  const doing: Filter = {
    id: 'flt_doing',
    fieldId: 'status',
    operator: 'equals',
    value: 'opt_doing',
  }

  it('annuler la suppression d’une colonne rend ses filtres, tri, masquage et regroupement', () => {
    const data = useDataStore.getState()
    data.updateView(T, 'view_planning_grid', {
      filters: [doing],
      sorts: [{ fieldId: 'status', direction: 'asc' }],
    })
    data.updateView(T, 'view_planning_kanban', { hiddenFieldIds: ['status', 'owner'] })
    expect(getViewRows(table())).toEqual(['rec_01', 'rec_total'])

    deleteField(T, 'status')
    expect(view('view_planning_grid').filters).toEqual([])
    expect(view('view_planning_kanban').groupByFieldId).toBeUndefined()

    undo()
    expect(view('view_planning_grid').filters).toEqual([doing])
    expect(view('view_planning_grid').sorts).toEqual([{ fieldId: 'status', direction: 'asc' }])
    expect(view('view_planning_kanban').hiddenFieldIds).toEqual(['status', 'owner'])
    expect(view('view_planning_kanban').groupByFieldId).toBe('status')
    expect(getViewRows(table())).toEqual(['rec_01', 'rec_total'])

    redo()
    expect(view('view_planning_grid').filters).toEqual([])
    expect(view('view_planning_kanban').hiddenFieldIds).toEqual(['owner'])
  })

  it('une vue retouchée depuis garde ses réglages, sans ceux qui ne valent plus', () => {
    saveField(T, 'status', { label: 'Statut', type: 'text' })
    undo()
    expect(table().fields.status?.type).toBe('select')
    // Filtre posé sur le statut redevenu un statut, puis on rétablit la conversion en texte.
    useDataStore.getState().updateView(T, 'view_planning_grid', { filters: [doing] })
    expect(getViewRows(table())).toEqual(['rec_01', 'rec_total'])
    redo()
    expect(table().fields.status?.type).toBe('text')
    expect(view('view_planning_grid').filters).toEqual([])
    expect(getViewRows(table())).toHaveLength(4)
    expect(view('view_planning_kanban').groupByFieldId).toBeUndefined()
  })

  it('annuler un ajout de statut retire le filtre posé ensuite sur ce statut', () => {
    const id = undoable('Ajouter « Reporté »', T, () =>
      useDataStore.getState().addChoice(T, 'status', 'Reporté'),
    )!
    useDataStore.getState().updateView(T, 'view_planning_grid', {
      filters: [{ ...doing, value: id }],
    })
    undo()
    expect(view('view_planning_grid').filters).toEqual([])
    expect(getViewRows(table())).toHaveLength(4)
  })

  it('annuler ne défait pas un renommage de la table fait ensuite', () => {
    edit('rec_01', 'task_name', 'Fondations')
    useDataStore.getState().renameTable(T, 'Planning 2026')
    undo()
    expect(table().records.rec_01?.cells.task_name).toBe('Gros œuvre')
    expect(table().name).toBe('Planning 2026')
    redo()
    expect(table().name).toBe('Planning 2026')
  })
})

describe('import CSV dans une table existante', () => {
  it('une étape annulable, l’historique d’avant reste', () => {
    edit('rec_01', 'task_name', 'Fondations')
    const analysis = analyzeCsv('Lot / Tâche;Coût HT\ncharpente bois;30 000\n')
    const plan = {
      ...suggestPlan(analysis, table(), lookupContext()),
      mode: 'upsert' as const,
      key: 0,
    }
    commitImport(analysis, plan, { kind: 'table', tableId: T })
    expect(table().records.rec_02?.cells.cost_ht).toBe(30000)
    expect(notice('Import CSV : 1 ligne mise à jour')?.action?.label).toBe('Annuler')

    expect(undo()).toBe('Importer le CSV')
    expect(table().records.rec_02?.cells.cost_ht).toBe(28500)
    expect(undo()).toBe('Modifier')
    expect(table().records.rec_01?.cells.task_name).toBe('Gros œuvre')
  })
})

describe('rechargement après une modification externe', () => {
  it('seule la table modifiée par l’autre programme perd son historique', () => {
    // Valeur `undefined` en mémoire, absente du fichier : la table reste inchangée.
    saveField(T, 'task_name', { label: 'Lot', type: 'text' })
    edit('rec_01', 'task_name', 'Fondations')
    edit('rec_bg_1', 'bg_item', 'Études', B)
    const before = table()

    const disk = JSON.parse(JSON.stringify(pickData(useDataStore.getState()))) as AppData
    disk.tables[B]!.records.rec_bg_2!.cells.bg_item = 'Travaux'
    useDataStore.setState(pickData(keepUnchanged(useDataStore.getState(), disk)))

    expect(table()).toBe(before)
    expect(table(B).records.rec_bg_2?.cells.bg_item).toBe('Travaux')
    expect(useHistory.getState().past.map((e) => e.tableId)).toEqual([T, T])
    expect(undo()).toBe('Modifier')
    expect(table().records.rec_01?.cells.task_name).toBe('Gros œuvre')
  })
})
