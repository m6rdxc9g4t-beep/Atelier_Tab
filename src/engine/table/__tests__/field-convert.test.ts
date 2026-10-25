import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import type { Table } from '@/types/domain'
import { changeFieldType, TableSheet } from '..'

const data = createDemoData()
const ctx = { collaborators: data.collaborators }
const planning = () => structuredClone(data.tables.tbl_planning_lots) as Table

describe('changeFieldType', () => {
  it('texte → nombre : les nombres sont relus, le reste est gardé', () => {
    const t = planning()
    t.records.rec_01!.cells.task_name = '45 000'
    const report = changeFieldType(t, 'task_name', 'number', ctx)
    expect(t.fields.task_name!.type).toBe('number')
    expect(t.records.rec_01!.cells.task_name).toBe(45000)
    expect(t.records.rec_02!.cells.task_name).toBe('Charpente bois')
    expect(report).toEqual({ converted: 1, kept: 3 })
  })

  it('texte → statut : un choix par valeur distincte', () => {
    const t = planning()
    changeFieldType(t, 'task_name', 'select', ctx)
    const choices = t.fields.task_name!.options!.choices!
    expect(choices.map((c) => c.label)).toEqual([
      'Gros œuvre',
      'Charpente bois',
      'Isolation thermique',
      'TOTAL',
    ])
    expect(t.records.rec_01!.cells.task_name).toBe(choices[0]!.id)
  })

  it('statut → texte et responsable → texte : les libellés', () => {
    const t = planning()
    changeFieldType(t, 'status', 'text', ctx)
    changeFieldType(t, 'owner', 'text', ctx)
    expect(t.records.rec_01!.cells.status).toBe('En cours')
    expect(t.records.rec_02!.cells.owner).toBe('Karim Benali')
    expect(t.fields.status!.options?.choices).toBeUndefined()
  })

  it('date → texte → date', () => {
    const t = planning()
    changeFieldType(t, 'due_date', 'text', ctx)
    expect(t.records.rec_01!.cells.due_date).toBe('30/11/2026')
    changeFieldType(t, 'due_date', 'date', ctx)
    expect(t.records.rec_01!.cells.due_date).toBe('2026-11-30')
  })

  it('formule → devise : les valeurs calculées sont figées, les formules de cellule gardées', () => {
    const t = planning()
    const sheet = new TableSheet()
    sheet.sync(t, ctx)
    changeFieldType(t, 'cost_ttc', 'currency', ctx, { computed: (r, f) => sheet.value(r, f) })
    expect(t.fields.cost_ttc!.columnFormula).toBeUndefined()
    expect(t.fields.cost_ttc!.options?.currency).toBe('EUR')
    expect(t.records.rec_01!.cells.cost_ttc).toBe(54000)
    expect(t.records.rec_total!.cells.cost_ttc).toBe('=SUM(D1:D3)')
  })

  it('nombre → formule : la formule de colonne remplace les valeurs des lignes de données', () => {
    const t = planning()
    changeFieldType(t, 'cost_ht', 'formula', ctx, { formula: '=1+1' })
    expect(t.fields.cost_ht!.columnFormula).toBe('=1+1')
    expect(t.fields.cost_ht!.options?.resultFormat).toBe('currency')
    expect(t.records.rec_01!.cells.cost_ht).toBeUndefined()
    expect(t.records.rec_total!.cells.cost_ht).toBe('=SUM(C1:C3)')
  })

  it('retire les filtres devenus invalides et le regroupement Kanban', () => {
    const t = planning()
    const kanban = t.views.find((v) => v.mode === 'kanban')!
    kanban.filters = [
      { id: 'f1', fieldId: 'status', operator: 'equals', value: 'opt_doing' },
      { id: 'f2', fieldId: 'status', operator: 'is_empty' },
      { id: 'f3', fieldId: 'cost_ht', operator: 'gt', value: 1 },
    ]
    changeFieldType(t, 'status', 'text', ctx)
    expect(kanban.filters.map((f) => f.id)).toEqual(['f2', 'f3'])
    expect(kanban.groupByFieldId).toBeUndefined()
  })

  it('même type : rien ne change', () => {
    const t = planning()
    expect(changeFieldType(t, 'status', 'select', ctx)).toEqual({ converted: 0, kept: 0 })
  })
})
