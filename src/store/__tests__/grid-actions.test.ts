// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { getSheet, useDataStore, useUIStore } from '@/store'
import {
  beginEdit,
  clearSelection,
  commitEdit,
  copySelection,
  deleteRows,
  extendSelection,
  fillSelection,
  fillTo,
  insertRows,
  pasteText,
  selectedCells,
  selectRows,
} from '../grid-actions'
import { clearHistory, redo, undo, useHistory } from '../history'
import { deleteField, saveField } from '../field-actions'
import { addFilter, updateFilter } from '../view-actions'
import { getViewRows } from '../view-rows'

const T = 'tbl_planning_lots'
const table = () => useDataStore.getState().tables[T]!
const value = (recordId: string, fieldId: string) => getSheet(T)?.value(recordId, fieldId)
const cell = (recordId: string, fieldId: string) => ({ recordId, fieldId })

function type(recordId: string, fieldId: string, text: string) {
  useUIStore.getState().select(cell(recordId, fieldId))
  beginEdit(cell(recordId, fieldId))
  useUIStore.getState().updateDraft(text)
  return commitEdit('none')
}

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

describe('annuler / rétablir', () => {
  it('annule et rétablit une saisie, totaux compris', () => {
    expect(type('rec_03', 'cost_ht', '20 000')).toBe(true)
    expect(value('rec_total', 'cost_ht')).toBe(93500)
    expect(useHistory.getState().past.at(-1)?.label).toBe('Modifier C3')
    expect(undo()).toBe('Modifier C3')
    expect(value('rec_total', 'cost_ht')).toBe(88500)
    expect(useUIStore.getState().selection).toEqual(cell('rec_03', 'cost_ht'))
    expect(redo()).toBe('Modifier C3')
    expect(value('rec_total', 'cost_ht')).toBe(93500)
  })

  it('une suppression de lignes est annulable, formule du total comprise', () => {
    deleteRows(['rec_01'])
    expect(table().records.rec_total?.cells.cost_ht).toBe('=SUM(C1:C2)')
    undo()
    expect(table().rowOrder).toEqual(['rec_01', 'rec_02', 'rec_03', 'rec_total'])
    expect(table().records.rec_total?.cells.cost_ht).toBe('=SUM(C1:C3)')
  })

  it('une suppression de colonne est annulable', () => {
    deleteField(T, 'cost_ht')
    expect(table().fields.cost_ht).toBeUndefined()
    expect(table().fields.cost_ttc?.columnFormula).toBe('=#REF!*1.2')
    undo()
    expect(table().fieldOrder).toContain('cost_ht')
    expect(value('rec_total', 'cost_ttc')).toBe(106200)
  })

  it('un changement de type est annulable en une étape', () => {
    saveField(T, 'due_date', { label: 'Échéance', type: 'text' })
    expect(table().records.rec_01?.cells.due_date).toBe('30/11/2026')
    undo()
    expect(table().fields.due_date?.type).toBe('date')
    expect(table().records.rec_01?.cells.due_date).toBe('2026-11-30')
  })

  it('oublie l’historique d’une table modifiée ailleurs (assistant, fichier)', () => {
    type('rec_01', 'task_name', 'Fondations')
    useDataStore.getState().setCell(T, 'rec_02', 'task_name', 'Toiture')
    expect(useHistory.getState().past).toHaveLength(0)
    expect(undo()).toBeNull()
    expect(table().records.rec_01?.cells.task_name).toBe('Fondations')
  })

  it('annuler une saisie garde les filtres posés ensuite', () => {
    type('rec_01', 'task_name', 'Fondations')
    addFilter(T, 'task_name')
    undo()
    expect(table().records.rec_01?.cells.task_name).toBe('Gros œuvre')
    const view = table().views.find((v) => v.id === table().activeViewId)
    expect(view?.filters).toHaveLength(1)
  })
})

describe('plage, presse-papiers et recopie', () => {
  it('Maj + flèches étend la plage depuis la cellule active', () => {
    useUIStore.getState().select(cell('rec_01', 'task_name'))
    extendSelection('down')
    extendSelection('right')
    const cells = selectedCells()
    expect(cells).toHaveLength(2)
    expect(cells[1]?.[1]).toEqual(cell('rec_02', 'status'))
    expect(useUIStore.getState().selection).toEqual(cell('rec_01', 'task_name'))
  })

  it('copie au format d’Excel : tabulations, valeurs lisibles', () => {
    useUIStore.getState().selectRange(cell('rec_01', 'task_name'), cell('rec_02', 'cost_ht'))
    expect(copySelection()).toBe('Gros œuvre\tEn cours\t45000\r\nCharpente bois\tTerminée\t28500')
  })

  it('colle un bloc d’Excel, en ajoutant des lignes au-dessus du total', () => {
    useUIStore.getState().select(cell('rec_03', 'task_name'))
    const report = pasteText('Menuiserie\tÀ faire\t12 000\r\nPeinture\tEn cours\t8 000\r\n')
    expect(report).toEqual({ written: 6, skipped: 0, addedRows: 1 })
    expect(table().rowOrder).toHaveLength(5)
    expect(table().rowOrder.at(-1)).toBe('rec_total')
    expect(value('rec_03', 'cost_ht')).toBe(12000)
    // La nouvelle ligne est incluse dans le total.
    expect(value('rec_total', 'cost_ht')).toBe(28500 + 45000 + 12000 + 8000)
  })

  it('refuse une valeur incompatible et crée un statut inconnu', () => {
    useUIStore.getState().select(cell('rec_01', 'status'))
    const report = pasteText('Urgent\tbeaucoup')
    expect(report?.skipped).toBe(1)
    const choice = table().fields.status?.options?.choices?.find((c) => c.label === 'Urgent')
    expect(choice).toBeDefined()
    expect(table().records.rec_01?.cells.status).toBe(choice?.id)
    expect(table().records.rec_01?.cells.cost_ht).toBe(45000)
  })

  it('une cellule copiée remplit toute la plage ; une formule copiée est décalée', () => {
    useUIStore.getState().select(cell('rec_total', 'cost_ht'))
    const text = copySelection()!
    useUIStore.getState().select(cell('rec_total', 'cost_ttc'))
    pasteText(text)
    expect(table().records.rec_total?.cells.cost_ttc).toBe('=SUM(D1:D3)')
    useUIStore.getState().select(cell('rec_01', 'task_name'))
    const one = copySelection()!
    useUIStore.getState().selectRange(cell('rec_02', 'task_name'), cell('rec_03', 'task_name'))
    pasteText(one)
    expect(table().records.rec_03?.cells.task_name).toBe('Gros œuvre')
  })

  it('couper puis coller déplace les valeurs', () => {
    useUIStore.getState().select(cell('rec_01', 'task_name'))
    const text = copySelection(true)!
    useUIStore.getState().select(cell('rec_01', 'cost_ht'))
    // Le texte ne se convertit pas en montant : rien n'est écrit, la source reste.
    expect(pasteText(text)?.skipped).toBe(1)
    useUIStore.getState().select(cell('rec_01', 'task_name'))
    copySelection(true)
    useUIStore.getState().select(cell('rec_02', 'task_name'))
    pasteText(text)
    expect(table().records.rec_01?.cells.task_name).toBeUndefined()
    expect(table().records.rec_02?.cells.task_name).toBe('Gros œuvre')
  })

  it('Suppr vide toute la plage, en une étape annulable', () => {
    useUIStore.getState().selectRange(cell('rec_01', 'cost_ht'), cell('rec_03', 'cost_ht'))
    clearSelection()
    expect(value('rec_total', 'cost_ht')).toBe(0)
    undo()
    expect(value('rec_total', 'cost_ht')).toBe(88500)
  })

  it('⌘D recopie la première ligne de la plage', () => {
    useUIStore.getState().selectRange(cell('rec_01', 'owner'), cell('rec_03', 'owner'))
    fillSelection('down')
    expect(table().records.rec_03?.cells.owner).toBe('usr_md')
  })

  it('la poignée prolonge une série et ne touche jamais la ligne de total', () => {
    useUIStore.getState().selectRange(cell('rec_01', 'cost_ht'), cell('rec_02', 'cost_ht'))
    fillTo(cell('rec_total', 'cost_ht'))
    expect(table().records.rec_03?.cells.cost_ht).toBe(12000)
    expect(table().records.rec_total?.cells.cost_ht).toBe('=SUM(C1:C3)')
  })

  it('insère autant de lignes que de lignes sélectionnées', () => {
    selectRows('rec_01', 'rec_02')
    insertRows('below')
    expect(table().rowOrder).toHaveLength(6)
    expect(table().records.rec_total?.cells.cost_ht).toBe('=SUM(C1:C5)')
  })
})

describe('vues filtrées', () => {
  it('la navigation suit l’ordre de la vue et une ligne modifiée reste visible', () => {
    addFilter(T, 'status')
    const filter = table().views.find((v) => v.id === table().activeViewId)!.filters[0]!
    updateFilter(T, filter.id, { value: 'opt_doing' })
    expect(getViewRows(table())).toEqual(['rec_01', 'rec_total'])
    type('rec_01', 'status', 'Terminée')
    // La ligne ne correspond plus au filtre, mais reste affichée tant que le filtre ne change pas.
    expect(getViewRows(table())).toEqual(['rec_01', 'rec_total'])
    updateFilter(T, filter.id, { value: 'opt_doing' })
    expect(getViewRows(table())).toEqual(['rec_total'])
  })
})
