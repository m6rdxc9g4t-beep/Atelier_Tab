import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import type { Field, Table, View } from '@/types/domain'
import {
  KANBAN_NO_LANE,
  TableSheet,
  isBlankOnCard,
  kanbanCardLayout,
  kanbanCells,
  kanbanLaneField,
  kanbanLanes,
} from '..'

const data = createDemoData()
const ctx = { collaborators: data.collaborators }

function setup(edit?: (t: Table) => void) {
  const table = structuredClone(data.tables.tbl_planning_lots) as Table
  edit?.(table)
  const sheet = new TableSheet()
  sheet.sync(table, ctx)
  const value = (r: string, f: string) => sheet.value(r, f)
  return { table, value }
}

const dataRows = (t: Table) => t.rowOrder.filter((id) => t.records[id]?.kind === 'data')

describe('isBlankOnCard', () => {
  const text = { id: 't', label: 'T', type: 'text' } as Field
  const box = { id: 'b', label: 'B', type: 'checkbox' } as Field
  it('vide, blanc ou case décochée : rien à montrer', () => {
    expect(isBlankOnCard(text, null)).toBe(true)
    expect(isBlankOnCard(text, '  ')).toBe(true)
    expect(isBlankOnCard(text, 'x')).toBe(false)
    expect(isBlankOnCard(text, 0)).toBe(false)
    expect(isBlankOnCard(box, false)).toBe(true)
    expect(isBlankOnCard(box, true)).toBe(false)
  })
})

describe('kanbanCardLayout', () => {
  it('titre = première colonne ; la pastille sort de la grille ; colonnes exclues retirées', () => {
    const { table, value } = setup()
    const layout = kanbanCardLayout(table, table.fieldOrder, [], value)
    expect(layout.primary?.id).toBe('task_name')
    expect(layout.badge?.id).toBe('status')
    expect(layout.fields.map((f) => f.id)).toEqual(['cost_ht', 'cost_ttc', 'owner'])
    // Statut en colonnes, Échéance en lignes : ni l'un ni l'autre sur la carte.
    const excluded = kanbanCardLayout(table, table.fieldOrder, ['status', 'due_date'], value)
    expect(excluded.badge).toBeUndefined()
    expect(excluded.fields.map((f) => f.id)).toEqual(['cost_ht', 'cost_ttc', 'owner'])
  })

  it('une colonne vide partout ne prend pas de rangée ; vide sur une seule carte, elle la garde', () => {
    const { table, value } = setup((t) => {
      for (const id of dataRows(t)) delete t.records[id]?.cells.owner
      delete t.records.rec_02?.cells.due_date
    })
    const layout = kanbanCardLayout(table, table.fieldOrder, ['status'], value)
    expect(layout.fields.map((f) => f.id)).toEqual(['cost_ht', 'cost_ttc', 'due_date'])
  })

  it('suit les colonnes visibles et s’arrête au maximum', () => {
    const { table, value } = setup()
    const visible = ['task_name', 'due_date', 'cost_ht', 'cost_ttc']
    expect(kanbanCardLayout(table, visible, [], value, 2).fields.map((f) => f.id)).toEqual([
      'due_date',
      'cost_ht',
    ])
  })
})

describe('kanbanLaneField', () => {
  it('lit le réglage de la vue, sauf la colonne des colonnes ou une colonne disparue', () => {
    const { table } = setup()
    const status = table.fields.status
    const view = (laneByFieldId?: string) =>
      ({ ...(table.views[1] as View), ...(laneByFieldId ? { laneByFieldId } : {}) }) as View
    expect(kanbanLaneField(table, view(), status)).toBeUndefined()
    expect(kanbanLaneField(table, view('due_date'), status)?.id).toBe('due_date')
    expect(kanbanLaneField(table, view('status'), status)).toBeUndefined()
    expect(kanbanLaneField(table, view('fld_absent'), status)).toBeUndefined()
  })
})

describe('kanbanLanes et kanbanCells', () => {
  it('une ligne par date affichée, dans l’ordre des dates, cartes sans date à la fin', () => {
    const { table, value } = setup((t) => {
      // rec_03 prend la date de rec_01 ; une nouvelle carte n'a pas de date.
      t.records.rec_03!.cells.due_date = '2026-11-30'
      t.records.rec_04 = { id: 'rec_04', kind: 'data', cells: { task_name: 'Sans date' } }
      t.rowOrder.splice(3, 0, 'rec_04')
    })
    const field = table.fields.due_date!
    const ids = ['rec_04', 'rec_02', 'rec_01', 'rec_03']
    const lanes = kanbanLanes(field, ids, value)
    expect(lanes.map((l) => [l.label, l.recordIds])).toEqual([
      ['30/11/2026', ['rec_01', 'rec_03']],
      ['15/12/2026', ['rec_02']],
      [KANBAN_NO_LANE, ['rec_04']],
    ])
    expect(kanbanLanes(field, ids, value, 'desc').map((l) => l.label)).toEqual([
      '15/12/2026',
      '30/11/2026',
      KANBAN_NO_LANE,
    ])

    // Colonne « En cours » (rec_01) et « À faire » (rec_03) : même ligne, une carte chacune.
    const doing = kanbanCells(lanes, ['rec_01'])
    expect(doing).toEqual({ cells: [['rec_01'], [], []], across: 1 })
    // Deux cartes de la même date dans une colonne : côte à côte, plafonnées.
    expect(kanbanCells(lanes, ['rec_01', 'rec_03', 'rec_02']).across).toBe(2)
    expect(kanbanCells(lanes, ['rec_01', 'rec_03'], 1).across).toBe(1)
    // Colonne vide : une carte de large, une case vide par ligne.
    expect(kanbanCells(lanes, [])).toEqual({ cells: [[], [], []], across: 1 })
  })

  it('case à cocher : deux lignes, dans l’ordre du tri (Non coché puis Coché)', () => {
    const box = { id: 'done', label: 'Fait', type: 'checkbox' } as Field
    const values: Record<string, boolean | null> = { a: true, b: null, c: false }
    const lanes = kanbanLanes(box, ['a', 'b', 'c'], (r) => values[r] ?? null)
    expect(lanes.map((l) => [l.label, l.recordIds])).toEqual([
      ['Non coché', ['b', 'c']],
      ['Coché', ['a']],
    ])
  })
})
