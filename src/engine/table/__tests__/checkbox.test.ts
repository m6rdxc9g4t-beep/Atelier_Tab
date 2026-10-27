import { describe, expect, it } from 'vitest'
import type { Table } from '@/types/domain'
import { TableSheet } from '..'

const ctx = { collaborators: {} }

/** A : case à cocher (cochée, décochée, jamais touchée, jamais touchée) ; B : formules. */
function table(formulas: Record<string, string>, kinds: Record<string, 'summary'> = {}): Table {
  const ids = ['r1', 'r2', 'r3', 'r4']
  const done: Record<string, boolean> = { r1: true, r2: false }
  return {
    id: 'tbl_cases',
    projectId: 'proj',
    name: 'Cases',
    fieldOrder: ['done', 'calc'],
    rowOrder: ids,
    fields: {
      done: { id: 'done', label: 'Fait', type: 'checkbox' },
      calc: { id: 'calc', label: 'Calcul', type: 'number' },
    },
    records: Object.fromEntries(
      ids.map((id) => {
        const cells: Table['records'][string]['cells'] = {}
        if (done[id] !== undefined) cells.done = done[id]
        if (formulas[id]) cells.calc = formulas[id]
        return [id, { id, kind: kinds[id] ?? 'data', cells }]
      }),
    ),
    views: [],
    activeViewId: '',
  }
}

describe('case à cocher jamais touchée', () => {
  it('vaut FAUX pour les formules, comme une case décochée', () => {
    const sheet = new TableSheet()
    sheet.sync(table({ r1: '=COUNTIF(A1:A4,FALSE)', r2: '=IF(A3=FALSE,1,0)' }), ctx)
    expect(sheet.value('r1', 'calc')).toBe(3)
    expect(sheet.value('r2', 'calc')).toBe(1)
    expect(sheet.value('r3', 'done')).toBe(false)
  })

  it('reste vide sur une ligne de total, et suit un changement de type de ligne', () => {
    const sheet = new TableSheet()
    const t = table({ r1: '=COUNTIF(A1:A4,FALSE)' }, { r4: 'summary' })
    sheet.sync(t, ctx)
    expect(sheet.value('r4', 'done')).toBeNull()
    expect(sheet.value('r1', 'calc')).toBe(2)
    // La ligne 4 redevient une ligne de données : sa case compte de nouveau.
    const r4 = t.records.r4!
    sheet.sync({ ...t, records: { ...t.records, r4: { ...r4, kind: 'data' } } }, ctx)
    expect(sheet.value('r1', 'calc')).toBe(3)
  })
})
