import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import type { Filter, Table, View } from '@/types/domain'
import { kanbanColumns, matchesFilter, operatorsFor, TableSheet, viewRecordIds } from '..'

const data = createDemoData()
const ctx = { collaborators: data.collaborators }

function setup(patch: Partial<View> = {}) {
  const table = structuredClone(data.tables.tbl_planning_lots) as Table
  const sheet = new TableSheet()
  sheet.sync(table, ctx)
  const view: View = { ...(table.views[0] as View), ...patch }
  const ids = (options = {}) =>
    viewRecordIds(table, view, (r, f) => sheet.value(r, f), ctx, options)
  return { table, view, ids }
}

const filter = (fieldId: string, operator: Filter['operator'], value?: Filter['value']) => ({
  id: `flt_${fieldId}`,
  fieldId,
  operator,
  ...(value !== undefined ? { value } : {}),
})

describe('viewRecordIds', () => {
  it('sans filtre ni tri : l’ordre de la table, même référence', () => {
    const { table, ids } = setup()
    expect(ids()).toBe(table.rowOrder)
  })

  it('filtre sur un statut (id du choix) ; la ligne de total reste visible, à la fin', () => {
    const { ids } = setup({ filters: [filter('status', 'equals', 'opt_doing')] })
    expect(ids()).toEqual(['rec_01', 'rec_total'])
  })

  it('filtre « différent de » et filtre numérique sur une colonne-formule', () => {
    expect(setup({ filters: [filter('status', 'not_equals', 'opt_doing')] }).ids()).toEqual([
      'rec_02',
      'rec_03',
      'rec_total',
    ])
    // Coût TTC (= HT × 1,2) supérieur à 30 000 : Gros œuvre (54 000) et Charpente (34 200).
    expect(setup({ filters: [filter('cost_ttc', 'gt', 30000)] }).ids()).toEqual([
      'rec_01',
      'rec_02',
      'rec_total',
    ])
  })

  it('filtres cumulés (ET), responsable et date', () => {
    const { ids } = setup({
      filters: [filter('owner', 'not_equals', 'usr_md'), filter('due_date', 'lt', '2027-01-01')],
    })
    expect(ids()).toEqual(['rec_02', 'rec_total'])
  })

  it('ignore un filtre incomplet (valeur absente)', () => {
    const { table, ids } = setup({ filters: [filter('status', 'equals')] })
    expect(ids()).toBe(table.rowOrder)
  })

  it('tri croissant et décroissant, cellules vides toujours à la fin', () => {
    const { table, ids } = setup({ sorts: [{ fieldId: 'cost_ht', direction: 'asc' }] })
    expect(ids()).toEqual(['rec_03', 'rec_02', 'rec_01', 'rec_total'])
    table.records.rec_02!.cells = { task_name: 'Charpente bois' }
    const desc = setup({ sorts: [{ fieldId: 'cost_ht', direction: 'desc' }] })
    desc.table.records.rec_02!.cells = {}
    const sheet = new TableSheet()
    sheet.sync(desc.table, ctx)
    expect(
      viewRecordIds(desc.table, desc.view, (r, f) => sheet.value(r, f), ctx).slice(0, 3),
    ).toEqual(['rec_01', 'rec_03', 'rec_02'])
  })

  it('trie un statut dans l’ordre des choix, comme Airtable', () => {
    const { table, ids } = setup({ sorts: [{ fieldId: 'status', direction: 'asc' }] })
    const order = (table.fields.status!.options!.choices ?? []).map((c) => c.label)
    const labels = ids()
      .slice(0, 3)
      .map((id) => table.records[id]!.cells.status)
      .map((choiceId) => table.fields.status!.options!.choices!.find((c) => c.id === choiceId)!.label)
    expect([...labels].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(labels)
  })

  it('recherche rapide, sans accents ni casse, dans les valeurs affichées', () => {
    const { ids } = setup()
    expect(ids({ search: 'gros oeuvre' })).toEqual(['rec_01', 'rec_total'])
    expect(ids({ search: 'karim' })).toEqual(['rec_02', 'rec_total'])
    expect(ids({ search: '15/12' })).toEqual(['rec_02', 'rec_total'])
  })

  it('une ligne épinglée reste visible malgré le filtre', () => {
    const { ids } = setup({ filters: [filter('status', 'equals', 'opt_doing')] })
    expect(ids({ pinned: new Set(['rec_03']) })).toEqual(['rec_01', 'rec_03', 'rec_total'])
  })
})

describe('matchesFilter', () => {
  const { table } = setup()
  const f = (id: string) => table.fields[id]!

  it('texte : contient, sans accents ni ligatures', () => {
    expect(matchesFilter(f('task_name'), filter('task_name', 'contains', 'OEUV'), 'Gros œuvre', ctx)).toBe(
      true,
    )
    expect(matchesFilter(f('task_name'), filter('task_name', 'contains', 'eléc'), 'Électricité', ctx)).toBe(
      true,
    )
  })

  it('vide / non vide, case à cocher', () => {
    const checkbox = { id: 'c', label: 'Fait', type: 'checkbox' as const }
    expect(matchesFilter(checkbox, filter('c', 'equals', true), true, ctx)).toBe(true)
    expect(matchesFilter(checkbox, filter('c', 'equals', false), null, ctx)).toBe(true)
    expect(matchesFilter(f('task_name'), filter('task_name', 'is_empty'), '  ', ctx)).toBe(true)
    expect(matchesFilter(f('task_name'), filter('task_name', 'is_not_empty'), 'x', ctx)).toBe(true)
  })

  it('opérateurs proposés selon le type', () => {
    expect(operatorsFor(f('task_name'))).toContain('contains')
    expect(operatorsFor(f('cost_ht'))).toContain('gt')
    expect(operatorsFor(f('status'))).not.toContain('gt')
  })
})

describe('kanbanColumns', () => {
  it('une colonne par choix, puis « Sans statut » ; la ligne de total est exclue', () => {
    const { table } = setup()
    table.records.rec_03!.cells = { task_name: 'Isolation thermique' }
    const columns = kanbanColumns(table, table.fields.status!, table.rowOrder)
    const byChoice = Object.fromEntries(columns.map((c) => [c.choiceId ?? 'none', c.recordIds]))
    expect(byChoice.opt_doing).toEqual(['rec_01'])
    expect(byChoice.opt_done).toEqual(['rec_02'])
    expect(byChoice.none).toEqual(['rec_03'])
    expect(columns.at(-1)?.choiceId).toBeNull()
  })
})
