// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'
import { useDataStore, useNotices, useUIStore } from '@/store'
import { useAssistant } from '@/store/assistant.store'
import { clearHistory, undo } from '@/store/history'

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
const grid = () => screen.getByRole('grid')
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')
const planning = () => useDataStore.getState().tables.tbl_planning_lots!

function typeInCell(recordId: string, fieldId: string, value: string, key = 'Enter') {
  fireEvent.mouseDown(cell(recordId, fieldId))
  fireEvent.keyDown(grid(), { key: 'Enter' })
  const input = within(cell(recordId, fieldId)).getByRole('textbox')
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key })
}

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
    // Les messages d'un test précédent ne doivent pas rester à l'écran.
    useNotices.setState({ notices: [] })
    clearHistory()
  })
})
afterEach(cleanup)

describe('rôle d’export et historique', () => {
  // Le dialogue est chargé à la demande.
  const openExport = async () => {
    fireEvent.click(screen.getByRole('button', { name: /Exporter vers Atelier Projets/ }))
    return screen.findByRole('dialog', { name: 'Exporter vers Atelier Projets' })
  }

  it('changer le rôle d’une colonne est une étape annulable qui garde la saisie précédente', async () => {
    render(<App />)
    typeInCell('rec_03', 'cost_ht', '20 000')
    expect(text(cell('rec_03', 'cost_ht'))).toBe('20 000 €')

    const dialog = await openExport()
    const role = within(dialog).getByRole('combobox', {
      name: 'Rôle de la colonne Statut dans Atelier Projets',
    }) as HTMLSelectElement
    expect(role.value).toBe('workflow_state')
    fireEvent.change(role, { target: { value: 'custom' } })
    expect(planning().fields.status?.atelierMapping).toBe('custom')

    // Le bouton d'annulation de la barre annonce le changement de rôle (l'historique est gardé).
    const undoButton = screen.getByRole('button', {
      name: 'Annuler la dernière action',
    }) as HTMLButtonElement
    expect(undoButton.disabled).toBe(false)
    expect(undoButton.getAttribute('title')).toContain('Rôle d’export de « Statut »')

    // Première annulation : le rôle revient, la saisie reste.
    const labels: (string | null)[] = []
    act(() => {
      labels.push(undo())
    })
    expect(labels[0]).toBe('Rôle d’export de « Statut »')
    expect(planning().fields.status?.atelierMapping).toBe('workflow_state')
    expect(
      (
        within(dialog).getByRole('combobox', {
          name: 'Rôle de la colonne Statut dans Atelier Projets',
        }) as HTMLSelectElement
      ).value,
    ).toBe('workflow_state')
    expect(text(cell('rec_03', 'cost_ht'))).toBe('20 000 €')

    // Seconde annulation : la saisie faite avant d'ouvrir le dialogue est défaite.
    act(() => {
      labels.push(undo())
    })
    expect(labels[1]).toMatch(/^Modifier /)
    expect(planning().records.rec_03?.cells.cost_ht).toBe(15000)
    expect(text(cell('rec_03', 'cost_ht'))).toBe('15 000 €')
    expect(planning().fields.status?.atelierMapping).toBe('workflow_state')
  })
})

describe('« Annuler » d’un message après une autre action', () => {
  const deleteRow2 = () => {
    fireEvent.mouseDown(cell('rec_02', 'task_name'), { button: 2 })
    fireEvent.contextMenu(cell('rec_02', 'task_name'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Supprimer la ligne/ }))
  }
  const toast = (title: string) => screen.getByText(title).closest('[role="status"]') as HTMLElement

  it('le bouton disparaît quand une saisie suit la suppression ; il n’annule jamais la saisie', () => {
    render(<App />)
    deleteRow2()
    expect(planning().rowOrder).toHaveLength(3)
    expect(within(toast('Ligne supprimée')).getByRole('button', { name: 'Annuler' })).toBeTruthy()
    // Action du bouton, gardée comme un clic parti avant que le bouton ne disparaisse.
    const action = useNotices.getState().notices.find((n) => n.title === 'Ligne supprimée')?.action
    expect(action).toBeDefined()

    typeInCell('rec_03', 'cost_ht', '20 000')
    expect(text(cell('rec_03', 'cost_ht'))).toBe('20 000 €')

    // Le message reste, sans son bouton : il annulerait une autre action que la suppression.
    expect(within(toast('Ligne supprimée')).queryByRole('button', { name: 'Annuler' })).toBeNull()

    // Un clic arrivé quand même n'annule rien et le dit.
    act(() => {
      action?.run()
    })
    expect(screen.getByText('Rien n’a été annulé')).toBeTruthy()
    expect(screen.getByText(/D’autres modifications ont suivi : annulez-les d’abord/)).toBeTruthy()
    expect(planning().rowOrder).toHaveLength(3)
    expect(planning().records.rec_03?.cells.cost_ht).toBe(20000)
    expect(text(cell('rec_03', 'cost_ht'))).toBe('20 000 €')

    // ⌘Z reste dans l'ordre : la saisie d'abord, puis la suppression.
    act(() => {
      undo()
    })
    expect(planning().records.rec_03?.cells.cost_ht).toBe(15000)
    expect(planning().rowOrder).toHaveLength(3)
    act(() => {
      undo()
    })
    expect(planning().rowOrder).toHaveLength(4)
  })
})
