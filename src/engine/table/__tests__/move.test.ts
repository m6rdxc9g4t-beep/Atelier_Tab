import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import type { Table } from '@/types/domain'
import { moveField, moveRecords, TableSheet } from '..'

const data = createDemoData()
const ctx = { collaborators: data.collaborators }
const planning = () => structuredClone(data.tables.tbl_planning_lots) as Table

describe('déplacement de lignes et de colonnes', () => {
  it('réordonne les lignes de données sans changer le total', () => {
    const t = planning()
    expect(moveRecords(t, ['rec_03'], 0)).toBe(true)
    expect(t.rowOrder).toEqual(['rec_03', 'rec_01', 'rec_02', 'rec_total'])
    const s = new TableSheet()
    s.sync(t, ctx)
    expect(s.value('rec_total', 'cost_ht')).toBe(88500)
    // La colonne-formule TTC lit toujours la ligne courante.
    expect(s.value('rec_03', 'cost_ttc')).toBe(18000)
  })

  it('refuse des lignes non consécutives ou un déplacement sur place', () => {
    const t = planning()
    expect(moveRecords(t, ['rec_01', 'rec_03'], 4)).toBe(false)
    expect(moveRecords(t, ['rec_02'], 1)).toBe(false)
    expect(moveRecords(t, ['rec_02'], 2)).toBe(false)
  })

  it('déplace une colonne et réécrit les formules qui la lisent', () => {
    const t = planning()
    // Coût HT (C) déplacé en tête : il devient A, la formule TTC suit.
    expect(moveField(t, 'cost_ht', 0)).toBe(true)
    expect(t.fieldOrder[0]).toBe('cost_ht')
    expect(t.fields.cost_ttc!.columnFormula).toBe('=A1*1.2')
    expect(t.records.rec_total!.cells.cost_ht).toBe('=SUM(A1:A3)')
    const s = new TableSheet()
    s.sync(t, ctx)
    expect(s.value('rec_total', 'cost_ttc')).toBe(106200)
  })
})
