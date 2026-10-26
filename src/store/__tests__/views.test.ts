// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useDataStore, useUIStore } from '@/store'
import { defaultSummary, summaryFor } from '@/components/grid/summary'
import { clearHistory } from '../history'
import { moveFieldTo } from '../field-actions'
import { setFieldHidden, setSummary } from '../view-actions'
import { activeView, hiddenFieldSet, visibleFieldIds } from '../view-rows'

const T = 'tbl_planning_lots'
const table = () => useDataStore.getState().tables[T]!

beforeEach(() => {
  useDataStore.getState().reset()
  clearHistory()
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

describe('première colonne toujours visible', () => {
  it('un champ masqué déplacé en première position est affiché', () => {
    setFieldHidden(T, 'status', true)
    expect(visibleFieldIds(table())).not.toContain('status')
    // Glisser « Lot / Tâche » plus loin : le statut masqué devient la première colonne.
    moveFieldTo(T, 'task_name', 2)
    expect(table().fieldOrder[0]).toBe('status')
    expect(visibleFieldIds(table())[0]).toBe('status')
    expect(hiddenFieldSet(table()).has('status')).toBe(false)
  })

  it('le prochain réglage des champs masqués nettoie la vue', () => {
    setFieldHidden(T, 'status', true)
    moveFieldTo(T, 'task_name', 2)
    setFieldHidden(T, 'owner', true)
    expect(activeView(table())?.hiddenFieldIds).toEqual(['owner'])
  })
})

describe('agrégats du pied de grille', () => {
  it('un agrégat numérique est oublié quand la colonne n’est plus numérique', () => {
    setSummary(T, 'cost_ht', 'average')
    const stored = activeView(table())?.summaries?.cost_ht
    expect(stored).toBe('average')
    expect(summaryFor(table().fields.cost_ht!, stored)).toBe('average')
    const asText = { ...table().fields.cost_ht!, type: 'text' as const }
    expect(summaryFor(asText, stored)).toBe(defaultSummary(asText))
    expect(summaryFor(asText, 'filled')).toBe('filled')
    expect(summaryFor(table().fields.cost_ht!, undefined)).toBe('sum')
  })
})
