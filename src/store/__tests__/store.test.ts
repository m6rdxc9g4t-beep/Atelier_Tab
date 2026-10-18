import { afterEach, describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import { memoryAdapter } from '@/services/persistence'
import { connectComputed, selectCellValue, type ComputedEngine } from '../computed.store'
import { createDataStore, DATA_STORAGE_KEY } from '../data.store'

let engine: ComputedEngine | null = null
afterEach(() => engine?.disconnect())

function setup() {
  const adapter = memoryAdapter()
  const data = createDataStore({ adapter, initialData: createDemoData() })
  engine = connectComputed(data)
  const value = (tableId: string, recordId: string, fieldId: string) =>
    selectCellValue(tableId, recordId, fieldId)(engine!.store.getState())
  return { adapter, data, engine, value }
}

describe('store de données + valeurs calculées', () => {
  it('calcule les valeurs au démarrage', () => {
    const { value } = setup()
    expect(value('tbl_planning_lots', 'rec_total', 'cost_ttc')).toBe(106200)
  })

  it('setCell recalcule et ne renouvelle que les cellules modifiées', () => {
    const { data, engine, value } = setup()
    const before = engine.store.getState().values.tbl_planning_lots!
    data.getState().setCell('tbl_planning_lots', 'rec_03', 'cost_ht', 20000)
    const after = engine.store.getState().values.tbl_planning_lots!

    expect(value('tbl_planning_lots', 'rec_03', 'cost_ttc')).toBe(24000)
    expect(value('tbl_planning_lots', 'rec_total', 'cost_ttc')).toBe(112200)
    // Cellule non concernée : même entrée, donc aucun re-rendu.
    expect(after['rec_01:cost_ttc']).toBe(before['rec_01:cost_ttc'])
    // Autre table : intacte.
    expect(engine.store.getState().values.tbl_materiaux).toBeDefined()
  })

  it('addRecord insère avant le total et met à jour les sommes', () => {
    const { data, value } = setup()
    const id = data.getState().addRecord('tbl_planning_lots', {
      cells: { task_name: 'Menuiseries', cost_ht: 10000 },
    })
    const table = data.getState().tables.tbl_planning_lots!
    expect(table.rowOrder.at(-2)).toBe(id)
    expect(value('tbl_planning_lots', id, 'cost_ttc')).toBe(12000)
    expect(value('tbl_planning_lots', 'rec_total', 'cost_ttc')).toBe(118200)
  })

  it('deleteRecords retire les lignes et leurs valeurs', () => {
    const { data, engine, value } = setup()
    data.getState().deleteRecords('tbl_planning_lots', ['rec_01'])
    expect(value('tbl_planning_lots', 'rec_total', 'cost_ht')).toBe(43500)
    expect(engine.store.getState().values.tbl_planning_lots?.['rec_01:cost_ht']).toBeUndefined()
  })

  it('addField / deleteField', () => {
    const { data, value } = setup()
    const s = data.getState()
    const fid = s.addField('tbl_planning_lots', {
      label: 'Marge',
      type: 'formula',
      columnFormula: '=D1-C1',
    })
    expect(value('tbl_planning_lots', 'rec_01', fid)).toBe(9000)
    s.deleteField('tbl_planning_lots', fid)
    expect(data.getState().tables.tbl_planning_lots?.fields[fid]).toBeUndefined()
  })

  it('crée, duplique et supprime des projets et des tables', () => {
    const { data, engine, value } = setup()
    const s = data.getState()
    const { projectId, tableId } = s.createProject('ws_arch_01', 'Extension école')
    expect(data.getState().workspaces.ws_arch_01?.projectIds).toContain(projectId)
    expect(data.getState().tables[tableId]?.fieldOrder).toHaveLength(3)

    const copyId = s.duplicateProject('proj_renovation_2026')!
    const copy = data.getState().projects[copyId]!
    expect(copy.name).toBe('Rénovation Urbaine 2026 (copie)')
    expect(copy.tableIds).toHaveLength(3)
    const copiedPlanning = copy.tableIds[1]!
    expect(value(copiedPlanning, 'rec_total', 'cost_ttc')).toBe(106200)

    s.deleteProject(copyId)
    expect(data.getState().tables[copiedPlanning]).toBeUndefined()
    expect(engine.store.getState().values[copiedPlanning]).toBeUndefined()
  })

  it('setViewMode active ou crée la vue demandée', () => {
    const { data } = setup()
    const s = data.getState()
    s.setViewMode('tbl_planning_lots', 'kanban')
    expect(data.getState().tables.tbl_planning_lots?.activeViewId).toBe('view_planning_kanban')
    s.setViewMode('tbl_materiaux', 'kanban')
    const t = data.getState().tables.tbl_materiaux!
    expect(t.views.find((v) => v.id === t.activeViewId)?.mode).toBe('kanban')
  })

  it('persiste les données (sans les actions) dans l’adaptateur', async () => {
    const { adapter, data } = setup()
    data.getState().renameTable('tbl_materiaux', 'Matériaux v2')
    await new Promise((r) => setTimeout(r, 0))
    const saved = JSON.parse((await adapter.getItem(DATA_STORAGE_KEY)) ?? '{}')
    expect(saved.state.tables.tbl_materiaux.name).toBe('Matériaux v2')
    expect(saved.state.reset).toBeUndefined()
  })

  it('réhydrate depuis l’adaptateur', async () => {
    const first = setup()
    first.data.getState().renameProject('proj_renovation_2026', 'Rénovation 2027')
    await new Promise((r) => setTimeout(r, 0))

    const second = createDataStore({ adapter: first.adapter })
    await second.persist.rehydrate()
    expect(second.getState().projects.proj_renovation_2026?.name).toBe('Rénovation 2027')
  })
})
