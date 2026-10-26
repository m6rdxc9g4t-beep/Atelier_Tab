// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'
import { useDataStore, useUIStore } from '@/store'
import { useAssistant } from '@/store/assistant.store'
import { clearHistory, useHistory } from '@/store/history'
import { sortBy } from '@/store/view-actions'

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

const T = 'tbl_planning_lots'
const cell = (recordId: string, fieldId: string) =>
  document.querySelector<HTMLElement>(`[data-cell="${recordId}:${fieldId}"]`) as HTMLElement
const grid = () => screen.getByRole('grid')
const stored = (recordId: string, fieldId: string) =>
  useDataStore.getState().tables[T]?.records[recordId]?.cells[fieldId]

/** Espace sur une cellule de la ligne : ouvre sa fiche (comme dans app.test.tsx). */
function openPanel(recordId: string, rowNumber: number) {
  fireEvent.mouseDown(cell(recordId, 'task_name'))
  fireEvent.keyDown(grid(), { key: ' ' })
  return screen.getByRole('dialog', { name: `Fiche de la ligne ${rowNumber}` })
}

beforeEach(() => {
  act(() => {
    useDataStore.getState().reset()
    useAssistant.setState({ open: false, model: null, entries: [], history: [], running: false })
    useUIStore.setState({
      activeTableId: T,
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

describe('fiche de la ligne', () => {
  it('vue triée : enregistrer un champ ne reprend pas le focus du champ suivant', () => {
    act(() => {
      sortBy(T, 'cost_ht', 'asc')
    })
    render(<App />)
    // Tri croissant du coût HT : Isolation (15 000), Charpente (28 500), Gros œuvre (45 000).
    const panel = openPanel('rec_02', 2)
    expect(within(panel).getByText('2 / 4')).toBeTruthy()

    const name = within(panel).getByRole('textbox', { name: 'Lot / Tâche' })
    const cost = within(panel).getByRole('textbox', { name: 'Coût HT' })
    act(() => {
      name.focus()
    })
    fireEvent.change(name, { target: { value: 'Charpente métallique' } })
    // Passer au champ suivant : la sortie du premier l'enregistre.
    act(() => {
      cost.focus()
    })
    expect(stored('rec_02', 'task_name')).toBe('Charpente métallique')
    expect(document.activeElement).toBe(cost)

    // Le coût change l'ordre de la vue triée : la fiche suit la ligne, le focus reste.
    fireEvent.change(cost, { target: { value: '50000' } })
    const nameAgain = within(panel).getByRole('textbox', { name: 'Lot / Tâche' })
    act(() => {
      nameAgain.focus()
    })
    expect(stored('rec_02', 'cost_ht')).toBe(50000)
    expect(within(panel).getByText('3 / 4')).toBeTruthy()
    expect(document.activeElement).toBe(nameAgain)
  })

  it('date : enregistrée une fois à la sortie du champ, annulée en une seule étape', () => {
    render(<App />)
    const panel = openPanel('rec_01', 1)
    const date = within(panel).getByLabelText('Échéance') as HTMLInputElement
    expect(date.value).toBe('2026-11-30')

    // Le champ date signale des années intermédiaires pendant la frappe de « 2027 ».
    for (const partial of ['0002-05-10', '0020-05-10', '0202-05-10', '2027-05-10']) {
      fireEvent.change(date, { target: { value: partial } })
    }
    expect(stored('rec_01', 'due_date')).toBe('2026-11-30')
    expect(useHistory.getState().past).toHaveLength(0)

    fireEvent.blur(date)
    expect(stored('rec_01', 'due_date')).toBe('2027-05-10')
    expect(useHistory.getState().past).toHaveLength(1)

    // ⌘Z hors d'un champ de saisie : annule l'étape de la fiche.
    fireEvent.keyDown(panel, { key: 'z', metaKey: true })
    expect(stored('rec_01', 'due_date')).toBe('2026-11-30')
    expect(useHistory.getState().past).toHaveLength(0)
    expect((within(panel).getByLabelText('Échéance') as HTMLInputElement).value).toBe('2026-11-30')
  })

  it('⌘K ouvre la palette sans changer la ligne affichée', () => {
    render(<App />)
    const panel = openPanel('rec_02', 2)
    fireEvent.keyDown(panel, { key: 'k', metaKey: true })
    expect(screen.getByPlaceholderText('Ouvrir une table ou lancer une action…')).toBeTruthy()
    expect(useUIStore.getState().expandedRecordId).toBe('rec_02')
    expect(screen.getByRole('dialog', { name: 'Fiche de la ligne 2' })).toBeTruthy()
  })

  it('⌘J ouvre l’assistant sans changer la ligne affichée', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    try {
      render(<App />)
      const panel = openPanel('rec_02', 2)
      fireEvent.keyDown(panel, { key: 'j', metaKey: true })
      expect(useAssistant.getState().open).toBe(true)
      expect(useUIStore.getState().expandedRecordId).toBe('rec_02')
      expect(screen.getByRole('dialog', { name: 'Fiche de la ligne 2' })).toBeTruthy()
      // Le panneau de l'assistant est chargé à la demande : on attend qu'il soit affiché (délai
      // large : le premier import du module peut être lent sur la CI).
      expect(
        await screen.findByText('Ollama n’est pas lancé', undefined, { timeout: 4000 }),
      ).toBeTruthy()
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('Kanban : annuler « Nouvelle carte » ferme sa fiche, ↓ ne la rouvre pas', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: /Kanban/ }))
    const board = screen.getByRole('region', { name: 'Kanban de Planning & Lots' })
    const doing = within(board).getByRole('region', { name: 'En cours' })
    fireEvent.click(within(doing).getByRole('button', { name: /Nouvelle carte/ }))

    const created = useUIStore.getState().expandedRecordId
    expect(created).toBeTruthy()
    expect(useDataStore.getState().tables[T]?.rowOrder).toHaveLength(5)
    expect(stored(created ?? '', 'status')).toBe('opt_doing')
    const panel = screen.getByRole('dialog', { name: /^Fiche de la ligne/ })

    fireEvent.keyDown(panel, { key: 'z', metaKey: true })
    expect(useDataStore.getState().tables[T]?.rowOrder).toHaveLength(4)
    expect(useUIStore.getState().expandedRecordId).toBeNull()
    expect(screen.queryByRole('dialog', { name: /^Fiche de la ligne/ })).toBeNull()

    // Le raccourci de la fiche écoute le document : ↓ ne doit plus ouvrir une autre ligne.
    fireEvent.keyDown(document.body, { key: 'ArrowDown' })
    expect(useUIStore.getState().expandedRecordId).toBeNull()
    expect(screen.queryByRole('dialog', { name: /^Fiche de la ligne/ })).toBeNull()
  })
})
