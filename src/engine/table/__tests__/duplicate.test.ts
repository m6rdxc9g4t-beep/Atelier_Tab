import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import type { Field, Table, TableRecord } from '@/types/domain'
import { duplicateField, duplicateRecord, moveField, TableSheet } from '..'

const data = createDemoData()
const ctx = { collaborators: data.collaborators }
const planning = () => structuredClone(data.tables.tbl_planning_lots) as Table
const blank = (kind: TableRecord['kind'] = 'data'): TableRecord => ({
  id: 'rec_copy',
  kind,
  cells: {},
})
const value = (t: Table, recordId: string, fieldId: string) => {
  const s = new TableSheet()
  s.sync(t, ctx)
  return s.value(recordId, fieldId)
}

describe('duplicateRecord', () => {
  it('les références relatives de la copie visent sa propre ligne', () => {
    const t = planning()
    t.records.rec_02!.cells.task_name = '=C2*2'
    expect(duplicateRecord(t, 'rec_02', blank())).toBe(true)
    expect(t.rowOrder).toEqual(['rec_01', 'rec_02', 'rec_copy', 'rec_03', 'rec_total'])
    expect(t.records.rec_02!.cells.task_name).toBe('=C2*2')
    expect(t.records.rec_copy!.cells.task_name).toBe('=C3*2')
    expect(t.records.rec_copy!.cells.cost_ht).toBe(28500)
    t.records.rec_copy!.cells.cost_ht = 1
    expect(value(t, 'rec_copy', 'task_name')).toBe(2)
    expect(t.records.rec_total!.cells.cost_ht).toBe('=SUM(C1:C4)')
  })

  it('une référence sous l’original garde son décalage (pas d’auto-référence)', () => {
    const t = planning()
    t.records.rec_02!.cells.task_name = '=C3-C2'
    t.records.rec_01!.cells.due_date = '=SUM(C2:C3)'
    duplicateRecord(t, 'rec_02', blank())
    expect(t.records.rec_02!.cells.task_name).toBe('=C4-C2')
    expect(t.records.rec_copy!.cells.task_name).toBe('=C4-C3')
    const t2 = planning()
    t2.records.rec_01!.cells.due_date = '=SUM(C2:C3)'
    duplicateRecord(t2, 'rec_01', blank())
    expect(t2.records.rec_01!.cells.due_date).toBe('=SUM(C3:C4)')
    expect(t2.records.rec_copy!.cells.due_date).toBe('=SUM(C3:C4)')
    expect(value(t2, 'rec_copy', 'due_date')).toBe(43500)
  })

  it('les références absolues suivent l’insertion', () => {
    const t = planning()
    t.records.rec_02!.cells.task_name = '=C2/$C$4'
    duplicateRecord(t, 'rec_02', blank())
    expect(t.records.rec_02!.cells.task_name).toBe('=C2/$C$5')
    expect(t.records.rec_copy!.cells.task_name).toBe('=C3/$C$5')
    expect(value(t, 'rec_copy', 'task_name')).toBeCloseTo(28500 / 117000, 10)
  })

  it('un total dupliqué garde les plages de l’original', () => {
    const t = planning()
    duplicateRecord(t, 'rec_total', blank('summary'))
    expect(t.rowOrder.at(-1)).toBe('rec_copy')
    expect(t.records.rec_copy!.cells.cost_ht).toBe('=SUM(C1:C3)')
    expect(t.records.rec_copy!.cells.cost_ttc).toBe('=SUM(D1:D3)')
    expect(t.records.rec_total!.cells.cost_ht).toBe('=SUM(C1:C3)')
  })

  it('ligne inconnue : rien ne change', () => {
    const t = planning()
    expect(duplicateRecord(t, 'rec_x', blank())).toBe(false)
    expect(t.rowOrder).toHaveLength(4)
  })
})

describe('duplicateField', () => {
  const copyOf = (field: Field): Field => ({
    id: 'fld_copy',
    label: `${field.label} (copie)`,
    type: field.type,
    ...(field.options ? { options: structuredClone(field.options) } : {}),
  })

  it('le total de la copie additionne la copie', () => {
    const t = planning()
    expect(duplicateField(t, 'cost_ht', copyOf(t.fields.cost_ht!))).toBe(true)
    expect(t.fieldOrder.slice(2, 5)).toEqual(['cost_ht', 'fld_copy', 'cost_ttc'])
    expect(t.records.rec_total!.cells.fld_copy).toBe('=SUM(D1:D3)')
    expect(t.records.rec_total!.cells.cost_ttc).toBe('=SUM(E1:E3)')
    expect(t.records.rec_01!.cells.fld_copy).toBe(45000)
    t.records.rec_01!.cells.fld_copy = 1000
    expect(value(t, 'rec_total', 'fld_copy')).toBe(44500)
    expect(value(t, 'rec_total', 'cost_ht')).toBe(88500)
  })

  it('la formule de colonne de la copie lit les mêmes colonnes que l’original', () => {
    const t = planning()
    // Coût TTC (C) lit Coût HT, à sa droite (D).
    moveField(t, 'cost_ht', 4)
    expect(t.fields.cost_ttc!.columnFormula).toBe('=D1*1.2')
    duplicateField(t, 'cost_ttc', copyOf(t.fields.cost_ttc!))
    expect(t.fields.cost_ttc!.columnFormula).toBe('=E1*1.2')
    expect(t.fields.fld_copy!.columnFormula).toBe('=E1*1.2')
    expect(value(t, 'rec_01', 'fld_copy')).toBe(54000)
    expect(value(t, 'rec_total', 'fld_copy')).toBe(106200)
  })
})
