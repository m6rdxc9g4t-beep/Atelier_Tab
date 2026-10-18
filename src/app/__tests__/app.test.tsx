// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'
import { useDataStore, useUIStore } from '@/store'

// jsdom ne calcule pas de mise en page : on donne une taille au conteneur de la grille
// pour que la virtualisation rende les lignes.
Object.defineProperties(HTMLElement.prototype, {
  clientHeight: { configurable: true, get: () => 800 },
  clientWidth: { configurable: true, get: () => 1200 },
})

const cell = (recordId: string, fieldId: string) =>
  document.querySelector<HTMLElement>(`[data-cell="${recordId}:${fieldId}"]`) as HTMLElement
const grid = () => screen.getByRole('grid')
const text = (el: HTMLElement) => (el.textContent ?? '').replace(/[\u00a0\u202f]/g, ' ')

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
    useUIStore.setState({
      activeTableId: 'tbl_planning_lots',
      selection: null,
      editing: null,
      inputError: null,
      sidebarCollapsed: false,
    })
  })
})
afterEach(cleanup)

describe('grille hybride', () => {
  it('affiche la table de démonstration avec ses totaux', () => {
    render(<App />)
    expect(text(cell('rec_01', 'task_name'))).toBe('Gros œuvre')
    expect(text(cell('rec_01', 'status'))).toBe('En cours')
    expect(text(cell('rec_total', 'cost_ttc'))).toBe('106 200 €')
  })

  it('une saisie met à jour la ligne et le total', () => {
    render(<App />)
    typeInCell('rec_03', 'cost_ht', '20 000')
    expect(text(cell('rec_03', 'cost_ht'))).toBe('20 000 €')
    expect(text(cell('rec_03', 'cost_ttc'))).toBe('24 000 €')
    expect(text(cell('rec_total', 'cost_ttc'))).toBe('112 200 €')
    // Entrée valide et descend d'une ligne.
    expect(useUIStore.getState().selection).toEqual({ recordId: 'rec_total', fieldId: 'cost_ht' })
  })

  it('refuse une saisie invalide et garde l’éditeur ouvert', () => {
    render(<App />)
    typeInCell('rec_01', 'cost_ht', 'beaucoup')
    expect(screen.getByRole('alert').textContent).toMatch(/n'est pas un nombre/)
    expect(within(cell('rec_01', 'cost_ht')).getByRole('textbox')).toBeTruthy()
  })

  it('choisit un statut dans la liste', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_03', 'status'))
    fireEvent.keyDown(grid(), { key: 'Enter' })
    const input = within(cell('rec_03', 'status')).getByRole('textbox')
    fireEvent.change(input, { target: { value: 'val' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Validé' }))
    return Promise.resolve().then(() => {
      expect(useDataStore.getState().tables.tbl_planning_lots?.records.rec_03?.cells.status).toBe(
        'opt_done',
      )
    })
  })

  it('une frappe de caractère commence la saisie', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_02', 'task_name'))
    fireEvent.keyDown(grid(), { key: 'C' })
    const input = within(cell('rec_02', 'task_name')).getByRole('textbox') as HTMLInputElement
    expect(input.value).toBe('C')
  })

  it('les flèches déplacent la sélection, Suppr vide la cellule', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_01', 'task_name'))
    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    fireEvent.keyDown(grid(), { key: 'ArrowRight' })
    fireEvent.keyDown(grid(), { key: 'ArrowDown' })
    expect(useUIStore.getState().selection).toEqual({ recordId: 'rec_02', fieldId: 'cost_ht' })
    fireEvent.keyDown(grid(), { key: 'Delete' })
    expect(text(cell('rec_total', 'cost_ht'))).toBe('60 000 €')
  })

  it('Échap annule la saisie', () => {
    render(<App />)
    typeInCell('rec_01', 'task_name', 'Autre chose', 'Escape')
    expect(text(cell('rec_01', 'task_name'))).toBe('Gros œuvre')
  })

  it('ajoute une ligne au-dessus du total', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Ajouter une ligne/ }))
    const table = useDataStore.getState().tables.tbl_planning_lots!
    expect(table.rowOrder).toHaveLength(5)
    expect(table.rowOrder.at(-1)).toBe('rec_total')
    expect(table.records.rec_total?.cells.cost_ht).toBe('=SUM(C1:C4)')
  })
})

describe('barre de formules', () => {
  it('affiche l’adresse, le champ et la formule de la cellule', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_02', 'cost_ttc'))
    const bar = screen.getByRole('textbox', { name: 'Barre de formules' }) as HTMLInputElement
    expect(bar.value).toBe('=C2*1.2')
    expect(screen.getByText('D2')).toBeTruthy()
  })

  it('prévisualise une formule pendant la frappe puis la valide', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_01', 'task_name'))
    const bar = screen.getByRole('textbox', { name: 'Barre de formules' })
    fireEvent.focus(bar)
    fireEvent.change(bar, { target: { value: '=SUM(C1:C3)' } })
    expect(text(screen.getByTitle('Résultat si vous validez'))).toBe('= 88 500')
    fireEvent.keyDown(bar, { key: 'Enter' })
    expect(text(cell('rec_01', 'task_name'))).toBe('88 500')
  })

  it('colore les cellules lues par la formule sélectionnée', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_total', 'cost_ttc'))
    expect(cell('rec_01', 'cost_ttc').classList.contains('ref-outline')).toBe(true)
    expect(cell('rec_03', 'cost_ttc').classList.contains('ref-outline')).toBe(true)
    expect(cell('rec_01', 'cost_ht').classList.contains('ref-outline')).toBe(false)
  })
})

describe('modes et navigation', () => {
  it('le mode Tableur affiche des valeurs brutes', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: /Tableur/ }))
    expect(cell('rec_01', 'owner').textContent).toBe('Marie Dubois')
    expect(cell('rec_01', 'status').querySelector('.tone-soft')).toBeNull()
    expect(screen.queryByText('Lot / Tâche')).toBeNull()
  })

  it('ouvre une autre table depuis la sidebar', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Calculs Surfaces/ }))
    expect(text(cell('rec_sf_total', 'sf_area'))).toBe('272,44')
  })

  it('crée un projet', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Nouveau projet dans Espace Ingénierie' }))
    const input = screen.getByPlaceholderText('Nom du projet')
    fireEvent.change(input, { target: { value: 'Extension école' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getAllByText('Extension école').length).toBeGreaterThan(0)
    expect(screen.getByRole('columnheader', { name: /Nom/ })).toBeTruthy()
  })
})

describe('export DataFlow', () => {
  const openExport = () => {
    fireEvent.click(screen.getByRole('button', { name: /Exporter vers atelier_projets/ }))
    return screen.getByRole('dialog', { name: 'Exporter vers atelier_projets' })
  }

  it('montre une table prête et la pastille correspondante', () => {
    render(<App />)
    expect(
      screen.getAllByRole('img', { name: 'Prête pour atelier_projets' }).length,
    ).toBeGreaterThan(0)
    const dialog = openExport()
    expect(within(dialog).getByText(/Tout est conforme au schéma 2.1.0/)).toBeTruthy()
    expect(within(dialog).getByText(/Toute la table/).textContent).toContain('3 lignes')
  })

  it('bloque l’export quand plus aucune colonne ne porte le titre', () => {
    render(<App />)
    const dialog = openExport()
    fireEvent.change(within(dialog).getByRole('combobox', { name: /Lot \/ Tâche/ }), {
      target: { value: 'custom' },
    })
    expect(within(dialog).getByText(/Aucune colonne n’est associée au titre/)).toBeTruthy()
    expect(
      (within(dialog).getByRole('button', { name: 'Télécharger le JSON' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('télécharge le JSON et mémorise l’export', async () => {
    const created: Blob[] = []
    URL.createObjectURL = (b: Blob) => {
      created.push(b)
      return 'blob:test'
    }
    URL.revokeObjectURL = () => {}
    render(<App />)
    const dialog = openExport()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Télécharger le JSON' }))
    })
    expect(within(dialog).getByRole('status').textContent).toMatch(/3 lignes exportées en JSON/)
    const json = JSON.parse(await created[0]!.text())
    expect(json.project.summary_metrics.computed_totals).toEqual({ C: 88500, D: 106200 })
    expect(useDataStore.getState().integrations.atelierProjets.lastExport?.ok).toBe(true)
  })

  it('envoie au webhook configuré', async () => {
    const calls: [string, RequestInit][] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response('{}', { status: 201 })
    }) as typeof fetch
    render(<App />)
    const dialog = openExport()
    fireEvent.click(within(dialog).getByText('Envoi direct'))
    const url = within(dialog).getByPlaceholderText(/atelier-projets.example/)
    fireEvent.change(url, { target: { value: 'https://atelier.example/api/import' } })
    fireEvent.blur(url)
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer à atelier_projets' }))
    })
    expect(calls[0]?.[0]).toBe('https://atelier.example/api/import')
    expect(within(dialog).getByRole('status').textContent).toMatch(/3 lignes envoyées/)
    expect(screen.getByText(/envoi direct configuré/)).toBeTruthy()
  })
})
