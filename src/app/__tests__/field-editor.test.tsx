// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'
import { useDataStore, useUIStore } from '@/store'
import { useAssistant } from '@/store/assistant.store'
import { clearHistory } from '@/store/history'
import { activeView } from '@/store/view-rows'

// jsdom ne calcule pas de mise en page : on donne une taille au conteneur de la grille
// pour que la virtualisation rende les lignes.
Object.defineProperties(HTMLElement.prototype, {
  clientHeight: { configurable: true, get: () => 800 },
  clientWidth: { configurable: true, get: () => 1200 },
})
// La palette ⌘K (cmdk) observe la taille de sa liste et fait défiler l'option active.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Element.prototype.scrollIntoView ??= () => {}

const cell = (recordId: string, fieldId: string) =>
  document.querySelector<HTMLElement>(`[data-cell="${recordId}:${fieldId}"]`) as HTMLElement
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')
const planning = () => useDataStore.getState().tables.tbl_planning_lots!

beforeEach(() => {
  act(() => {
    useDataStore.getState().reset()
    useAssistant.setState({ open: false, model: null, entries: [], history: [], running: false })
    useUIStore.setState({
      activeTableId: 'tbl_planning_lots',
      selection: null,
      rangeEnd: null,
      editing: null,
      inputError: null,
      sidebarCollapsed: false,
      search: '',
      pinnedRecordIds: [],
      expandedRecordId: null,
      paletteOpen: false,
    })
    clearHistory()
  })
})
afterEach(cleanup)

describe('éditeur de colonne : passage en Formule', () => {
  const openFieldEditor = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Options de la colonne Coût HT' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Modifier la colonne/ }))
    return screen.getByRole('dialog', { name: 'Modifier la colonne Coût HT' })
  }

  it('remplacer les valeurs saisies demande de cocher la confirmation ; annulable', () => {
    render(<App />)
    const dialog = openFieldEditor()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Formule' }))
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Formule de la colonne' }), {
      target: { value: '=100' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))

    // Sans la case cochée : rien ne change, l'éditeur reste ouvert et dit quoi faire.
    expect(text(within(dialog).getByRole('alert'))).toMatch(
      /Cochez « Remplacer ces 3 valeurs par la formule » pour confirmer/,
    )
    expect(screen.getByRole('dialog', { name: 'Modifier la colonne Coût HT' })).toBe(dialog)
    expect(planning().fields.cost_ht?.type).toBe('currency')
    expect(planning().records.rec_01?.cells.cost_ht).toBe(45000)
    expect(text(cell('rec_01', 'cost_ht'))).toBe('45 000 €')

    fireEvent.click(
      within(dialog).getByRole('checkbox', { name: 'Remplacer ces 3 valeurs par la formule' }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }))
    expect(screen.queryByRole('dialog', { name: /Modifier la colonne/ })).toBeNull()
    expect(planning().fields.cost_ht?.type).toBe('formula')
    expect(planning().fields.cost_ht?.columnFormula).toBe('=100')
    expect(text(cell('rec_01', 'cost_ht'))).toBe('100 €')

    fireEvent.click(screen.getByRole('button', { name: 'Annuler la dernière action' }))
    expect(planning().fields.cost_ht?.type).toBe('currency')
    expect(planning().records.rec_01?.cells.cost_ht).toBe(45000)
    expect(text(cell('rec_01', 'cost_ht'))).toBe('45 000 €')
  })
})

describe('menu Filtres', () => {
  it('changer la colonne d’un filtre vide sa valeur : le champ repart de zéro', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /^Filtrer/ }))
    const panel = screen.getByRole('dialog', { name: 'Filtres' })
    fireEvent.click(within(panel).getByRole('button', { name: /Ajouter un filtre/ }))
    // Premier filtre : sur « Lot / Tâche », « contient ».
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Valeur du filtre' }), {
      target: { value: 'Gros' },
    })
    expect(cell('rec_02', 'task_name')).toBeNull()
    expect(screen.getByText(/1 ligne sur 3/)).toBeTruthy()

    fireEvent.change(within(panel).getByRole('combobox', { name: 'Champ du filtre' }), {
      target: { value: 'cost_ht' },
    })
    const value = within(panel).getByRole('textbox', {
      name: 'Valeur du filtre',
    }) as HTMLInputElement
    expect(value.value).toBe('')
    expect(activeView(planning())?.filters[0]?.value).toBeUndefined()
    // Filtre sans valeur : inactif, toutes les lignes reviennent.
    expect(cell('rec_02', 'task_name')).toBeTruthy()
    expect(screen.queryByText(/lignes? sur 3/)).toBeNull()

    // Une nouvelle saisie filtre bien la nouvelle colonne.
    fireEvent.change(value, { target: { value: '28500' } })
    expect(cell('rec_02', 'task_name')).toBeTruthy()
    expect(cell('rec_01', 'task_name')).toBeNull()
    expect(screen.getByText(/1 ligne sur 3/)).toBeTruthy()
  })
})
