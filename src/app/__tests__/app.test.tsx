// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from '@/app/App'
import { useDataStore, useUIStore } from '@/store'
import { useAssistant } from '@/store/assistant.store'
import { clearHistory } from '@/store/history'

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
    clearHistory()
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
    fireEvent.change(input, { target: { value: 'term' } })
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Terminée' }))
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
    fireEvent.click(screen.getByRole('button', { name: /^Calculs Surfaces/ }))
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
  // Le dialogue est chargé à la demande.
  const openExport = async () => {
    fireEvent.click(screen.getByRole('button', { name: /Exporter vers Atelier Projets/ }))
    return screen.findByRole('dialog', { name: 'Exporter vers Atelier Projets' })
  }

  it('montre une table prête et la pastille correspondante', async () => {
    render(<App />)
    expect(
      screen.getAllByRole('img', { name: 'Prête pour Atelier Projets' }).length,
    ).toBeGreaterThan(0)
    const dialog = await openExport()
    expect(within(dialog).getByText(/Tout est conforme au schéma 2.1.0/)).toBeTruthy()
    expect(within(dialog).getByText(/Toute la table/).textContent).toContain('3 lignes')
  })

  it('bloque l’export quand plus aucune colonne ne porte le titre', async () => {
    render(<App />)
    const dialog = await openExport()
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
    const dialog = await openExport()
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Télécharger le JSON' }))
    })
    expect(within(dialog).getByRole('status').textContent).toMatch(/3 lignes exportées en JSON/)
    const json = JSON.parse(await created[0]!.text())
    expect(json.project.summary_metrics.computed_totals).toEqual({ C: 88500, D: 106200 })
    expect(useDataStore.getState().integrations.atelierProjets.lastExport?.ok).toBe(true)
  })

  it('envoi direct sans adresse : préréglage « Atelier Projets (local) » actif par défaut', async () => {
    expect(useDataStore.getState().integrations.atelierProjets.webhookUrl).toBeUndefined()
    render(<App />)
    const dialog = await openExport()
    fireEvent.click(within(dialog).getByText('Envoi direct'))
    const url = within(dialog).getByPlaceholderText(/atelier-projets.example/) as HTMLInputElement
    expect(url.value).toBe('http://127.0.0.1:3000/api/imports/atelier-tab')
    expect(
      within(dialog)
        .getByRole('button', { name: /Atelier Projets \(local\)/ })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(useDataStore.getState().integrations.atelierProjets.webhookUrl).toBe(
      'http://127.0.0.1:3000/api/imports/atelier-tab',
    )
    expect(
      (
        within(dialog).getByRole('button', {
          name: 'Envoyer à Atelier Projets',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
  })

  it('envoi direct : une adresse déjà enregistrée n’est pas remplacée', async () => {
    act(() => {
      useDataStore
        .getState()
        .setAtelierIntegration({ webhookUrl: 'https://atelier.example/api/import' })
    })
    render(<App />)
    const dialog = await openExport()
    const url = within(dialog).getByPlaceholderText(/atelier-projets.example/) as HTMLInputElement
    expect(url.value).toBe('https://atelier.example/api/import')
    expect(
      within(dialog)
        .getByRole('button', { name: /Atelier Projets \(local\)/ })
        .getAttribute('aria-pressed'),
    ).toBe('false')
    expect(useDataStore.getState().integrations.atelierProjets.webhookUrl).toBe(
      'https://atelier.example/api/import',
    )
  })

  const sendTo = async (address: string) => {
    const calls: [string, RequestInit][] = []
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push([url, init])
      return new Response('{}', { status: 201 })
    }) as typeof fetch
    render(<App />)
    const dialog = await openExport()
    fireEvent.click(within(dialog).getByText('Envoi direct'))
    const url = within(dialog).getByPlaceholderText(/atelier-projets.example/)
    fireEvent.change(url, { target: { value: address } })
    fireEvent.blur(url)
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer à Atelier Projets' }))
    })
    // Seuls les envois vers l'adresse (l'en-tête interroge aussi Ollama en local).
    return { dialog, sent: calls.filter(([u]) => u.startsWith(address)) }
  }

  it('envoie au webhook configuré (en ligne), sans suivre de redirection', async () => {
    act(() => {
      useDataStore.getState().setOnlineMode(true)
    })
    const { dialog, sent } = await sendTo('https://atelier.example/api/import')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.[1].redirect).toBe('error')
    expect(within(dialog).getByRole('status').textContent).toMatch(/3 lignes envoyées/)
    expect(screen.getByText(/envoi direct configuré/)).toBeTruthy()
  })

  it('hors ligne : refuse une adresse extérieure, même depuis l’interface (SUITE.md §5.4)', async () => {
    const { dialog, sent } = await sendTo('https://atelier.example/api/import')
    expect(
      within(dialog).getByText(
        /Hors ligne : l’envoi vers une adresse hors de cet ordinateur est refusé/,
      ),
    ).toBeTruthy()
    expect(sent).toEqual([])
    expect(within(dialog).getByRole('status').textContent).toMatch(
      /Mode hors ligne : envoi vers atelier\.example refusé/,
    )
  })
})

describe('assistant Ollama', () => {
  function mockOllama(chatReplies: unknown[]) {
    const chatBodies: { messages: { role: string; content: string }[] }[] = []
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
      if (path === '/api/tags')
        return json({ models: [{ name: 'qwen3:8b', details: { parameter_size: '8.2B' } }] })
      if (path === '/api/show') return json({ capabilities: ['completion', 'tools'] })
      if (path === '/api/chat') {
        chatBodies.push(JSON.parse(String(init?.body)))
        return json({ message: chatReplies.shift() })
      }
      return json({}, 404)
    }) as typeof fetch
    return chatBodies
  }

  const openAssistant = async () => {
    fireEvent.click(screen.getByRole('button', { name: /Assistant/ }))
    // Le panneau est chargé à la demande.
    const panel = await screen.findByRole('complementary', { name: 'Assistant' })
    await screen.findByRole('combobox', { name: 'Modèle Ollama' })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    return panel
  }

  it('choisit un modèle compatible et applique les actions dans la grille', async () => {
    const bodies = mockOllama([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'set_cells',
              arguments: {
                table: 'tbl_planning_lots',
                cells: [{ row: 3, column: 'C', value: '20 000' }],
              },
            },
          },
        ],
      },
      { role: 'assistant', content: 'Coût HT de la ligne 3 passé à 20 000 €.' },
    ])
    render(<App />)
    const panel = await openAssistant()
    expect(
      (within(panel).getByRole('combobox', { name: 'Modèle Ollama' }) as HTMLSelectElement).value,
    ).toBe('qwen3:8b')

    fireEvent.mouseDown(cell('rec_02', 'cost_ht'))
    const input = within(panel).getByRole('textbox', { name: 'Message à l’assistant' })
    fireEvent.change(input, { target: { value: 'Passe l’isolation à 20 000 €' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(await within(panel).findByText('Coût HT de la ligne 3 passé à 20 000 €.')).toBeTruthy()
    expect(
      within(panel).getByText('Modification de 1 cellule dans « Planning & Lots »'),
    ).toBeTruthy()
    expect(text(cell('rec_total', 'cost_ttc'))).toBe('112 200 €')
    // Le contexte de l'app (table ouverte, cellule sélectionnée) est donné au modèle.
    expect(bodies[0]?.messages[0]?.content).toContain(
      'Cellule sélectionnée : C2 (colonne « Coût HT »)',
    )
  })

  it('explique comment lancer Ollama quand il est absent', async () => {
    globalThis.fetch = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /Assistant/ }))
    expect(await screen.findByText('Ollama n’est pas lancé')).toBeTruthy()
    expect(screen.getByText('ollama serve')).toBeTruthy()
  })
})

describe('fonctions Excel de la grille', () => {
  it('Maj + flèches sélectionne une plage ; la barre d’état en donne la somme', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_01', 'cost_ht'))
    fireEvent.keyDown(grid(), { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(grid(), { key: 'ArrowDown', shiftKey: true })
    expect(screen.getByText('C1:C3')).toBeTruthy()
    expect(text(screen.getByText(/^Somme :/))).toBe('Somme : 88 500 €')
  })

  it('copier : texte au format d’Excel dans le presse-papiers', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_01', 'task_name'))
    fireEvent.keyDown(grid(), { key: 'ArrowRight', shiftKey: true })
    const data = new Map<string, string>()
    fireEvent.copy(grid(), {
      clipboardData: { setData: (k: string, v: string) => data.set(k, v), getData: () => '' },
    })
    expect(data.get('text/plain')).toBe('Gros œuvre\tEn cours')
  })

  it('coller depuis Excel puis annuler avec ⌘Z', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_03', 'cost_ht'))
    fireEvent.paste(grid(), {
      clipboardData: { getData: () => '20 000\r\n', setData: () => {} },
    })
    expect(text(cell('rec_total', 'cost_ht'))).toBe('93 500 €')
    fireEvent.keyDown(grid(), { key: 'z', metaKey: true })
    expect(text(cell('rec_total', 'cost_ht'))).toBe('88 500 €')
    fireEvent.keyDown(grid(), { key: 'z', metaKey: true, shiftKey: true })
    expect(text(cell('rec_total', 'cost_ht'))).toBe('93 500 €')
  })

  it('menu contextuel : insérer une ligne au-dessus', () => {
    render(<App />)
    // Un clic droit commence par un mousedown du bouton droit, qui sélectionne la cellule.
    fireEvent.mouseDown(cell('rec_02', 'task_name'), { button: 2 })
    fireEvent.contextMenu(cell('rec_02', 'task_name'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Insérer une ligne au-dessus/ }))
    const table = useDataStore.getState().tables.tbl_planning_lots!
    expect(table.rowOrder).toHaveLength(5)
    expect(table.rowOrder[2]).toBe('rec_02')
  })

  it('supprimer une ligne affiche « Annuler »', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_02', 'task_name'), { button: 2 })
    fireEvent.contextMenu(cell('rec_02', 'task_name'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Supprimer la ligne/ }))
    expect(useDataStore.getState().tables.tbl_planning_lots!.rowOrder).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    expect(useDataStore.getState().tables.tbl_planning_lots!.rowOrder).toHaveLength(4)
  })

  it('autocomplétion des fonctions dans la barre de formules', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_01', 'task_name'))
    const bar = screen.getByRole('textbox', { name: 'Barre de formules' }) as HTMLInputElement
    fireEvent.focus(bar)
    fireEvent.change(bar, { target: { value: '=somme.s', selectionStart: 8 } })
    const list = screen.getByRole('listbox', { name: 'Fonctions' })
    expect(within(list).getByText('SOMME.SI')).toBeTruthy()
    fireEvent.keyDown(bar, { key: 'Tab' })
    expect(useUIStore.getState().editing?.draft).toBe('=SOMME.SI(')
  })
})

describe('fonctions Airtable', () => {
  it('Espace ouvre la fiche de la ligne ; une modification y est enregistrée', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_02', 'task_name'))
    fireEvent.keyDown(grid(), { key: ' ' })
    const panel = screen.getByRole('dialog', { name: 'Fiche de la ligne 2' })
    const name = within(panel).getByRole('textbox', { name: 'Lot / Tâche' })
    fireEvent.change(name, { target: { value: 'Charpente métallique' } })
    fireEvent.blur(name)
    expect(text(cell('rec_02', 'task_name'))).toBe('Charpente métallique')
    fireEvent.click(within(panel).getByRole('button', { name: 'Ligne suivante' }))
    expect(screen.getByRole('dialog', { name: 'Fiche de la ligne 3' })).toBeTruthy()
  })

  it('filtre la vue depuis la barre d’outils', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /^Filtrer/ }))
    const panel = screen.getByRole('dialog', { name: 'Filtres' })
    fireEvent.click(within(panel).getByRole('button', { name: /Ajouter un filtre/ }))
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Champ du filtre' }), {
      target: { value: 'status' },
    })
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Valeur du filtre' }), {
      target: { value: 'opt_doing' },
    })
    expect(cell('rec_01', 'task_name')).toBeTruthy()
    expect(cell('rec_02', 'task_name')).toBeNull()
    expect(screen.getByText(/1 ligne sur 3/)).toBeTruthy()
  })

  it('recherche rapide dans la vue', () => {
    render(<App />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher dans la vue' }), {
      target: { value: 'charpente' },
    })
    expect(cell('rec_02', 'task_name')).toBeTruthy()
    expect(cell('rec_01', 'task_name')).toBeNull()
  })

  it('tri depuis le menu d’une colonne, sans changer les numéros de ligne', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Options de la colonne Coût HT' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Trier par ordre croissant/ }))
    const rows = screen.getAllByRole('row').slice(1)
    expect(text(rows[0] as HTMLElement)).toContain('Isolation thermique')
    // L'isolation garde son numéro de ligne (3) : les formules lisent toujours C3.
    expect(text(rows[0] as HTMLElement)).toMatch(/^3/)
  })

  it('Kanban : une colonne par statut, une carte par ligne', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: /Kanban/ }))
    const board = screen.getByRole('region', { name: 'Kanban de Planning & Lots' })
    const doing = within(board).getByRole('region', { name: 'En cours' })
    expect(within(doing).getByRole('button', { name: 'Ouvrir Gros œuvre' })).toBeTruthy()
    fireEvent.click(within(doing).getByRole('button', { name: 'Ouvrir Gros œuvre' }))
    expect(screen.getByRole('dialog', { name: 'Fiche de la ligne 1' })).toBeTruthy()
  })

  it('palette de commandes (⌘K) : ouvrir une table', () => {
    render(<App />)
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const input = screen.getByPlaceholderText('Ouvrir une table ou lancer une action…')
    fireEvent.change(input, { target: { value: 'surfaces' } })
    fireEvent.click(screen.getByRole('option', { name: /Calculs Surfaces/ }))
    return new Promise((r) => requestAnimationFrame(r)).then(() => {
      expect(useUIStore.getState().activeTableId).toBe('tbl_calculs_surfaces')
    })
  })
})

describe('grille : listes, cases et clavier', () => {
  const stored = (tableId: string, recordId: string, fieldId: string) =>
    useDataStore.getState().tables[tableId]?.records[recordId]?.cells[fieldId]
  const openEditor = (recordId: string, fieldId: string) => {
    fireEvent.mouseDown(cell(recordId, fieldId))
    fireEvent.keyDown(grid(), { key: 'Enter' })
    return within(cell(recordId, fieldId)).getByRole('textbox') as HTMLInputElement
  }
  const showMaterials = () =>
    act(() => {
      useUIStore.setState({ activeTableId: 'tbl_materiaux' })
    })

  it('la liste des statuts et l’aide aux formules s’ouvrent hors de la cellule (jamais rognées)', () => {
    render(<App />)
    const input = openEditor('rec_03', 'status')
    fireEvent.change(input, { target: { value: 'e' } })
    const list = screen.getByRole('listbox', { name: 'Choix pour Statut' })
    expect(cell('rec_03', 'status').contains(list)).toBe(false)
    fireEvent.keyDown(input, { key: 'Escape' })

    const formula = openEditor('rec_01', 'task_name')
    fireEvent.change(formula, { target: { value: '=SO', selectionStart: 3 } })
    const functions = screen.getByRole('listbox', { name: 'Fonctions' })
    expect(within(functions).getByText('SOMME')).toBeTruthy()
    expect(cell('rec_01', 'task_name').contains(functions)).toBe(false)
  })

  it('Entrée sur un statut effacé vide la cellule ; ↓ puis Entrée prend le choix visé', async () => {
    render(<App />)
    const input = openEditor('rec_01', 'status')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(stored('tbl_planning_lots', 'rec_01', 'status')).toBeUndefined()

    const choices =
      useDataStore.getState().tables.tbl_planning_lots?.fields.status?.options?.choices ?? []
    const again = openEditor('rec_02', 'status')
    fireEvent.change(again, { target: { value: '' } })
    fireEvent.keyDown(again, { key: 'ArrowDown' })
    fireEvent.keyDown(again, { key: 'Enter' })
    await act(async () => {
      await Promise.resolve()
    })
    // Le premier ↓ vise le premier choix.
    expect(stored('tbl_planning_lots', 'rec_02', 'status')).toBe(choices[0]?.id)
  })

  it('Entrée pendant une composition (méthode de saisie) ne valide pas la cellule', () => {
    render(<App />)
    const input = openEditor('rec_01', 'task_name')
    fireEvent.change(input, { target: { value: 'とうきょう' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(useUIStore.getState().editing?.draft).toBe('とうきょう')
    expect(stored('tbl_planning_lots', 'rec_01', 'task_name')).toBe('Gros œuvre')
  })

  it('une case à cocher vide reste visible et se coche d’un clic', () => {
    showMaterials()
    render(<App />)
    fireEvent.mouseDown(cell('rec_mt_1', 'mt_ordered'))
    fireEvent.keyDown(grid(), { key: 'Delete' })
    expect(stored('tbl_materiaux', 'rec_mt_1', 'mt_ordered')).toBeUndefined()
    const box = cell('rec_mt_1', 'mt_ordered').querySelector('[data-check]')
    expect(box).toBeTruthy()
    fireEvent.click(box as Element)
    expect(stored('tbl_materiaux', 'rec_mt_1', 'mt_ordered')).toBe(true)
  })

  it('entrer dans la barre de formules sur une case à cocher ne la modifie pas', () => {
    showMaterials()
    render(<App />)
    fireEvent.mouseDown(cell('rec_mt_1', 'mt_ordered'))
    fireEvent.focus(screen.getByRole('textbox', { name: 'Barre de formules' }))
    expect(stored('tbl_materiaux', 'rec_mt_1', 'mt_ordered')).toBe(true)
    expect(useUIStore.getState().editing?.draft).toBe('oui')
  })

  it('développer la ligne pendant une saisie la valide d’abord', () => {
    render(<App />)
    const input = openEditor('rec_02', 'task_name')
    fireEvent.change(input, { target: { value: 'Charpente métallique' } })
    const expand = screen.getByRole('button', { name: 'Développer la ligne 2' })
    fireEvent.mouseDown(expand)
    fireEvent.click(expand)
    expect(stored('tbl_planning_lots', 'rec_02', 'task_name')).toBe('Charpente métallique')
    expect(useUIStore.getState().expandedRecordId).toBe('rec_02')
  })

  it('un clic sur un en-tête de colonne pendant une saisie la valide et rend le clavier', () => {
    render(<App />)
    const input = openEditor('rec_01', 'task_name')
    fireEvent.change(input, { target: { value: 'Fondations' } })
    fireEvent.mouseDown(screen.getByRole('columnheader', { name: 'C Coût HT' }))
    expect(useUIStore.getState().editing).toBeNull()
    expect(stored('tbl_planning_lots', 'rec_01', 'task_name')).toBe('Fondations')
    expect(useUIStore.getState().selection?.fieldId).toBe('cost_ht')
    expect(document.activeElement).toBe(grid())
  })

  it('menu contextuel au clavier (Maj+F10) : focus sur le premier choix, flèches, Échap', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_02', 'task_name'))
    fireEvent.keyDown(grid(), { key: 'F10', shiftKey: true })
    const menu = screen.getByRole('menu')
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: /Copier/ }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: /Couper/ }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
    expect(document.activeElement).toBe(
      within(menu).getByRole('menuitem', { name: /Supprimer la ligne/ }),
    )
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(grid())
    expect(useUIStore.getState().selection).toEqual({ recordId: 'rec_02', fieldId: 'task_name' })
  })
})

describe('éditeur de colonne', () => {
  const openFieldEditor = () => {
    fireEvent.doubleClick(screen.getByRole('columnheader', { name: 'D Coût TTC' }))
    return screen.getByRole('dialog', { name: /Modifier la colonne/ })
  }

  it('Échap ferme d’abord la liste des fonctions, puis l’éditeur', () => {
    render(<App />)
    const dialog = openFieldEditor()
    const formula = within(dialog).getByRole('textbox', { name: 'Formule de la colonne' })
    fireEvent.change(formula, { target: { value: '=SO', selectionStart: 3 } })
    expect(within(dialog).getByRole('listbox', { name: 'Fonctions' })).toBeTruthy()
    fireEvent.keyDown(formula, { key: 'Escape' })
    expect(within(dialog).queryByRole('listbox', { name: 'Fonctions' })).toBeNull()
    expect(screen.getByRole('dialog', { name: /Modifier la colonne/ })).toBe(dialog)
    fireEvent.keyDown(formula, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Modifier la colonne/ })).toBeNull()
  })

  it('clic droit et clic dans l’éditeur : ni menu de la colonne, ni sélection de la colonne', () => {
    render(<App />)
    const dialog = openFieldEditor()
    const name = within(dialog).getByRole('textbox', { name: 'Nom de la colonne' })
    // Le menu natif (coller…) n'est pas empêché.
    expect(fireEvent.contextMenu(name)).toBe(true)
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.mouseDown(within(dialog).getByRole('textbox', { name: 'Formule de la colonne' }))
    expect(useUIStore.getState().selection).toBeNull()
  })
})

describe('recherche dans la vue', () => {
  it('⌘F depuis la grille place le curseur dans la recherche', () => {
    render(<App />)
    fireEvent.mouseDown(cell('rec_01', 'task_name'))
    fireEvent.keyDown(grid(), { key: 'f', metaKey: true })
    expect(document.activeElement).toBe(
      screen.getByRole('searchbox', { name: 'Rechercher dans la vue' }),
    )
  })

  it('barre étroite : la loupe déplie la recherche', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir la recherche' }))
    const search = screen.getByRole('searchbox', { name: 'Rechercher dans la vue' })
    expect(document.activeElement).toBe(search)
    expect(screen.queryByRole('button', { name: 'Ouvrir la recherche' })).toBeNull()
  })
})
