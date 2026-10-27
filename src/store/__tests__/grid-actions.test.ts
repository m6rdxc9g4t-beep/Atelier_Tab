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
  selectColumns,
  selectedCells,
  selectionRect,
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

describe('presse-papiers : cellules calculées, lignes de total, couper', () => {
  it('cellule calculée : sa valeur collée ailleurs, calculée dans sa colonne', () => {
    useUIStore.getState().select(cell('rec_01', 'cost_ttc'))
    const text = copySelection()!
    useUIStore.getState().select(cell('rec_02', 'cost_ht'))
    expect(pasteText(text)).toEqual({ written: 1, skipped: 0, addedRows: 0 })
    expect(table().records.rec_02?.cells.cost_ht).toBe(54000)
    expect(value('rec_total', 'cost_ht')).toBe(45000 + 54000 + 15000)
    // Sur la ligne de total : la valeur, jamais l'effacement de la formule du total.
    useUIStore.getState().select(cell('rec_total', 'cost_ttc'))
    pasteText(text)
    expect(table().records.rec_total?.cells.cost_ttc).toBe(54000)
    // Dans sa colonne, sur une ligne de données : la valeur forcée cède la place à la formule.
    useDataStore.getState().setCell(T, 'rec_03', 'cost_ttc', 1)
    useUIStore.getState().select(cell('rec_03', 'cost_ttc'))
    pasteText(text)
    expect(table().records.rec_03?.cells.cost_ttc).toBeUndefined()
    expect(value('rec_03', 'cost_ttc')).toBe(18000)
  })

  it('coller sur une colonne entière n’ajoute pas de ligne et ne recopie pas le total', () => {
    // Clic sur l'en-tête : la sélection comprend la ligne de total, qui est sautée.
    selectColumns('cost_ht')
    expect(pasteText('1000')).toEqual({ written: 3, skipped: 0, addedRows: 0 })
    expect(table().rowOrder).toHaveLength(4)
    expect(value('rec_total', 'cost_ht')).toBe(3000)
    // Colonne entière copiée sur une autre : la formule du total source reste où elle est.
    selectColumns('cost_ht')
    const text = copySelection()!
    selectColumns('task_name')
    expect(pasteText(text)?.addedRows).toBe(0)
    expect(table().rowOrder).toHaveLength(4)
    expect(table().records.rec_03?.cells.task_name).toBe('1000')
    expect(table().records.rec_total?.cells.task_name).toBe('TOTAL')
  })

  it('les lignes ajoutées par un long collage suivent la zone collée', () => {
    const data = useDataStore.getState()
    const sub = data.addRecord(T, {
      index: 1,
      kind: 'summary',
      cells: { task_name: 'Sous-total', cost_ht: '=SUM(C1:C1)' },
    })
    data.setCell(T, 'rec_total', 'cost_ht', '=SUM(C3:C4)')
    useUIStore.getState().select(cell('rec_02', 'cost_ht'))
    expect(pasteText('1\r\n2\r\n3')?.addedRows).toBe(1)
    const added = table().rowOrder[4]!
    expect(table().rowOrder).toEqual(['rec_01', sub, 'rec_02', 'rec_03', added, 'rec_total'])
    expect(table().records[added]?.cells.cost_ht).toBe(3)
    // Le sous-total de la première section ne bouge pas ; le total suivant inclut la ligne.
    expect(table().records[sub]?.cells.cost_ht).toBe('=SUM(C1:C1)')
    expect(value('rec_total', 'cost_ht')).toBe(6)
    expect(useUIStore.getState().rangeEnd).toEqual(cell(added, 'cost_ht'))
  })

  it('couper puis modifier la source : le collage devient une copie', () => {
    useUIStore.getState().select(cell('rec_01', 'task_name'))
    const text = copySelection(true)!
    type('rec_01', 'task_name', 'Fondations')
    useUIStore.getState().select(cell('rec_02', 'task_name'))
    pasteText(text)
    expect(table().records.rec_02?.cells.task_name).toBe('Gros œuvre')
    expect(table().records.rec_01?.cells.task_name).toBe('Fondations')
  })
})

describe('recopie entre colonnes de types différents', () => {
  it('une cellule calculée donne sa valeur, ou rien si elle ne se convertit pas', () => {
    useUIStore.getState().select(cell('rec_01', 'cost_ttc'))
    fillTo(cell('rec_01', 'owner'))
    expect(table().records.rec_01?.cells.owner).toBe('usr_md')
    useUIStore.getState().select(cell('rec_02', 'cost_ttc'))
    fillTo(cell('rec_02', 'cost_ht'))
    expect(table().records.rec_02?.cells.cost_ht).toBe(34200)
  })

  it('une valeur est retapée dans le type de la colonne, ou la cellule est gardée', () => {
    // Statut → montant : incompatible, le montant reste.
    useUIStore.getState().selectRange(cell('rec_01', 'status'), cell('rec_01', 'cost_ht'))
    fillSelection('right')
    expect(table().records.rec_01?.cells.cost_ht).toBe(45000)
    // Texte → statut : relu par son libellé.
    useDataStore.getState().setCell(T, 'rec_02', 'task_name', 'En cours')
    useUIStore.getState().selectRange(cell('rec_02', 'task_name'), cell('rec_02', 'status'))
    fillSelection('right')
    expect(table().records.rec_02?.cells.status).toBe('opt_doing')
  })

  it('recopiée dans sa colonne, une cellule calculée le reste', () => {
    useDataStore.getState().setCell(T, 'rec_02', 'cost_ttc', 1)
    useUIStore.getState().selectRange(cell('rec_01', 'cost_ttc'), cell('rec_02', 'cost_ttc'))
    fillSelection('down')
    expect(table().records.rec_02?.cells.cost_ttc).toBeUndefined()
    expect(value('rec_02', 'cost_ttc')).toBe(34200)
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

  it('Suppr garde visible la ligne vidée, et la sélection avec elle', () => {
    addFilter(T, 'owner')
    const filter = table().views.find((v) => v.id === table().activeViewId)!.filters[0]!
    updateFilter(T, filter.id, { operator: 'is_not_empty' })
    useUIStore.getState().select(cell('rec_02', 'owner'))
    clearSelection()
    expect(table().records.rec_02?.cells.owner).toBeUndefined()
    expect(getViewRows(table())).toContain('rec_02')
    expect(selectionRect()).not.toBeNull()
  })

  it('une recopie garde visible la ligne qui ne correspond plus au filtre', () => {
    addFilter(T, 'status')
    const filter = table().views.find((v) => v.id === table().activeViewId)!.filters[0]!
    updateFilter(T, filter.id, { value: 'opt_doing' })
    useDataStore.getState().setCell(T, 'rec_01', 'task_name', 'Terminée')
    useUIStore.getState().selectRange(cell('rec_01', 'task_name'), cell('rec_01', 'status'))
    fillSelection('right')
    expect(table().records.rec_01?.cells.status).toBe('opt_done')
    expect(getViewRows(table())).toEqual(['rec_01', 'rec_total'])
  })
})
