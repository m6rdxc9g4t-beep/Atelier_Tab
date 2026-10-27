// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { getSheet, useDataStore, useUIStore } from '@/store'
import { addRowAndSelect, duplicateRows } from '../grid-actions'
import { clearHistory, undo } from '../history'
import { duplicateField, moveRowsTo, saveField } from '../field-actions'
import { addFilter, updateFilter } from '../view-actions'
import { getViewRows } from '../view-rows'

const T = 'tbl_planning_lots'
const table = () => useDataStore.getState().tables[T]!
const value = (recordId: string, fieldId: string) => getSheet(T)?.value(recordId, fieldId)
const activeView = () => table().views.find((v) => v.id === table().activeViewId)!

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

describe('dupliquer une ligne', () => {
  it('la copie calcule sur ses propres cellules, comme une recopie Excel', () => {
    useDataStore.getState().setCell(T, 'rec_02', 'task_name', '=C2*2')
    duplicateRows(['rec_02'])
    const copy = table().rowOrder[2]!
    expect(table().records[copy]?.cells.task_name).toBe('=C3*2')
    useDataStore.getState().setCell(T, copy, 'cost_ht', 500)
    expect(value(copy, 'task_name')).toBe(1000)
    expect(value('rec_02', 'task_name')).toBe(57000)
  })

  it('une seule étape annulable', () => {
    duplicateRows(['rec_02'])
    expect(table().rowOrder).toHaveLength(5)
    undo()
    expect(table().rowOrder).toEqual(['rec_01', 'rec_02', 'rec_03', 'rec_total'])
  })

  it('pas d’auto-référence : un cumul dupliqué ne se compte pas lui-même', () => {
    useDataStore.getState().setCell(T, 'rec_01', 'due_date', '=SUM(C2:C3)')
    duplicateRows(['rec_01'])
    const copy = table().rowOrder[1]!
    expect(table().records[copy]?.cells.due_date).toBe('=SUM(C3:C4)')
    expect(value(copy, 'due_date')).toBe(43500)
  })
})

describe('dupliquer une colonne', () => {
  it('le total de la copie additionne la copie ; annuler retire la copie', () => {
    const copyId = duplicateField(T, 'cost_ht')!
    expect(table().fields[copyId]?.label).toBe('Coût HT (copie)')
    expect(table().records.rec_total?.cells[copyId]).toBe('=SUM(D1:D3)')
    useDataStore.getState().setCell(T, 'rec_01', copyId, 1000)
    expect(value('rec_total', copyId)).toBe(44500)
    expect(value('rec_total', 'cost_ht')).toBe(88500)
  })

  it('une seule étape annulable', () => {
    const copyId = duplicateField(T, 'cost_ht')!
    undo()
    expect(table().fields[copyId]).toBeUndefined()
    expect(table().fieldOrder).not.toContain(copyId)
  })

  it('une colonne-formule dupliquée calcule comme l’original (pas de #CYCLE!)', () => {
    // Coût TTC (C) lit Coût HT, juste à sa droite (D) : la copie s'insère entre les deux.
    useDataStore.getState().moveField(T, 'cost_ht', 4)
    const copyId = duplicateField(T, 'cost_ttc')!
    expect(table().fields[copyId]?.columnFormula).toBe('=E1*1.2')
    expect(value('rec_01', copyId)).toBe(54000)
    expect(value('rec_01', 'cost_ttc')).toBe(54000)
  })
})

describe('colonnes-formules et lignes', () => {
  it('une ligne ajoutée au-dessus du total : la part du total reste juste', () => {
    useDataStore.getState().updateField(T, 'cost_ttc', { columnFormula: '=C1/$C$4' })
    addRowAndSelect()
    expect(table().fields.cost_ttc?.columnFormula).toBe('=C1/$C$5')
    expect(value('rec_01', 'cost_ttc')).toBeCloseTo(45000 / 88500, 10)
  })

  it('une ligne déplacée sous le total : la part du total reste juste', () => {
    useDataStore.getState().updateField(T, 'cost_ttc', { columnFormula: '=C1/$C$4' })
    moveRowsTo(T, ['rec_01'], 4)
    expect(table().fields.cost_ttc?.columnFormula).toBe('=C1/$C$3')
    expect(value('rec_02', 'cost_ttc')).toBeCloseTo(28500 / 43500, 10)
  })
})

describe('retirer un choix', () => {
  /** Retire le choix « En cours » (opt_doing, porté par rec_01) dans l'éditeur de champ. */
  const removeDoing = () => {
    const field = table().fields.status!
    const choices = field.options!.choices!.filter((c) => c.id !== 'opt_doing')
    saveField(T, 'status', { label: field.label, type: 'select', options: { choices } })
  }

  it('vide ses cellules et retire les filtres qui le visaient', () => {
    addFilter(T, 'status')
    updateFilter(T, activeView().filters[0]!.id, { value: 'opt_doing' })
    expect(getViewRows(table())).toEqual(['rec_01', 'rec_total'])
    removeDoing()
    expect(table().records.rec_01?.cells.status).toBeUndefined()
    expect(table().records.rec_02?.cells.status).toBe('opt_done')
    expect(activeView().filters).toEqual([])
    expect(getViewRows(table())).toHaveLength(4)
    // Un nouveau choix du même libellé ne fait pas revenir les anciennes valeurs.
    const id = useDataStore.getState().addChoice(T, 'status', 'En cours')
    useDataStore.getState().setCell(T, 'rec_02', 'status', id)
    expect(value('rec_01', 'status')).toBeNull()
    expect(value('rec_02', 'status')).toBe('En cours')
  })

  it('dans la même étape annulable que la modification du champ', () => {
    removeDoing()
    undo()
    expect(table().records.rec_01?.cells.status).toBe('opt_doing')
    expect(table().fields.status?.options?.choices?.some((c) => c.id === 'opt_doing')).toBe(true)
  })
})
