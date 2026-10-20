// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantPanel } from '@/components/assistant/AssistantPanel'
import { ProviderBadges } from '@/components/assistant/ProviderBadges'
import { OnlineToggle } from '@/components/layout/OnlineToggle'
import type { ClaudeChatRequest, ClaudeChatResponse, DesktopApi } from '@/services/desktop'
import { getSheet, useDataStore, useUIStore } from '@/store'
import { resetAiTransports, useAiStatus } from '@/store/ai-status.store'
import { useAssistant } from '@/store/assistant.store'

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })

/** Fausse app de bureau : Ollama absent, Claude selon `claude`. */
function fakeDesktop(claudeReplies: ClaudeChatResponse[] = [], available = true) {
  const requests: ClaudeChatRequest[] = []
  const api = {
    ollama: vi.fn(async () => ({ ok: false, status: 0, data: null, error: 'Ollama injoignable' })),
    ollamaCancel: vi.fn(async () => {}),
    claudeStatus: vi.fn(async () => {
      const online = useDataStore.getState().preferences.onlineMode
      return {
        online,
        found: true,
        available: online && available,
        detail: online
          ? available
            ? null
            : 'CLI non connectée : lancez `claude auth login`.'
          : 'Hors ligne',
        version: '2.1.0 (Claude Code)',
      }
    }),
    claudeChat: vi.fn(async (req: ClaudeChatRequest) => {
      requests.push(req)
      return claudeReplies.shift() ?? { ok: false as const, code: 'cli' as const, error: 'fin' }
    }),
    claudeCancel: vi.fn(async () => {}),
    // Fichier de préférences du processus principal (hors du dossier de données).
    setOnlineMode: vi.fn(async (online: boolean) => online),
    postWebhook: vi.fn(async () => ({ status: 200, body: '{}' })),
  }
  window.atelierDesktop = api as unknown as DesktopApi
  resetAiTransports()
  return { api, requests }
}

beforeEach(() => {
  act(() => {
    useDataStore.getState().reset()
    useAssistant.setState({
      open: true,
      model: null,
      engine: 'auto',
      claudeModel: 'sonnet',
      entries: [],
      history: [],
      running: false,
    })
    useUIStore.setState({ activeTableId: 'tbl_planning_lots', selection: null })
    useAiStatus.setState({ ollama: null, claude: null })
  })
  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed')
  }) as typeof fetch
})
afterEach(() => {
  cleanup()
  delete window.atelierDesktop
  resetAiTransports()
})

const radio = (name: string) => screen.getByRole('radio', { name })

describe('choix du moteur dans l’assistant (SUITE.md §5.2)', () => {
  it('navigateur : Claude grisé, « disponible dans l’app de bureau »', async () => {
    resetAiTransports()
    render(<AssistantPanel />)
    await flush()
    expect(screen.getByRole('radiogroup', { name: 'Moteur d’IA' })).toBeTruthy()
    expect(radio('Auto').getAttribute('aria-checked')).toBe('true')
    expect(radio('Claude').getAttribute('aria-disabled')).toBe('true')
    expect(radio('Claude').getAttribute('title')).toBe(
      'Claude est disponible dans l’app de bureau.',
    )
    // Explication visible sous le choix, pas seulement dans l'info-bulle.
    expect(screen.getByText('Claude est disponible dans l’app de bureau.')).toBeTruthy()
    fireEvent.click(radio('Claude'))
    expect(useAssistant.getState().engine).toBe('auto')
  })

  it('hors ligne (app de bureau) : Claude grisé avec l’explication, rien n’est envoyé', async () => {
    const { api } = fakeDesktop()
    render(<AssistantPanel />)
    await flush()
    expect(radio('Claude').getAttribute('aria-disabled')).toBe('true')
    expect(radio('Claude').getAttribute('title')).toMatch(/Activez le mode « En ligne »/)
    expect(
      screen.getByText(/Réponse par Ollama \(local\)|Ollama \(local\) n’est pas disponible/),
    ).toBeTruthy()
    expect(api.claudeChat).not.toHaveBeenCalled()
  })

  it('en ligne : Auto → Claude, l’outil est exécuté par l’app, la réponse indique le moteur', async () => {
    act(() => {
      useDataStore.getState().setOnlineMode(true)
    })
    const { requests } = fakeDesktop([
      {
        ok: true,
        text: '',
        output: {
          action: 'tool',
          name: 'set_cells',
          arguments: {
            table: 'tbl_planning_lots',
            cells: [{ row: 3, column: 'C', value: '20 000' }],
          },
        },
      },
      { ok: true, text: '', output: { action: 'answer', text: 'Ligne 3 passée à 20 000 €.' } },
    ])
    render(<AssistantPanel />)
    await flush()
    expect(radio('Auto').getAttribute('aria-checked')).toBe('true')
    expect(radio('Claude').getAttribute('aria-disabled')).toBe('false')
    expect(
      screen.getByText(
        /Réponse par Claude\. Seules la demande et les cellules que l’assistant lit/,
      ),
    ).toBeTruthy()
    const select = screen.getByRole('combobox', { name: 'Modèle Claude' }) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual(['Sonnet', 'Opus', 'Haiku'])
    fireEvent.change(select, { target: { value: 'haiku' } })
    expect(useAssistant.getState().claudeModel).toBe('haiku')

    const input = screen.getByRole('textbox', { name: 'Message à l’assistant' })
    fireEvent.change(input, { target: { value: 'Passe la ligne 3 à 20 000 €' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(await screen.findByText('Ligne 3 passée à 20 000 €.')).toBeTruthy()
    expect(screen.getByText(/via Claude · Haiku/i)).toBeTruthy()
    expect(getSheet('tbl_planning_lots')?.value('rec_03', 'cost_ht')).toBe(20000)
    // Seuls la conversation, le système, le schéma et l'alias partent vers le processus principal.
    expect(requests).toHaveLength(2)
    expect(Object.keys(requests[0]!).sort()).toEqual([
      'context',
      'id',
      'messages',
      'model',
      'schema',
      'system',
    ])
    expect(requests[0]?.model).toBe('haiku')
    // Le prompt système (argument de la CLI) ne contient aucune donnée de table.
    expect(requests[0]?.system).not.toContain('Planning & Lots')
    expect(requests[0]?.context).toContain('Planning & Lots')
  })

  it('Claude choisi mais pas connecté : expliqué, envoi impossible', async () => {
    act(() => {
      useDataStore.getState().setOnlineMode(true)
      useAssistant.setState({ engine: 'claude' })
    })
    fakeDesktop([], false)
    render(<AssistantPanel />)
    await flush()
    expect(screen.getByText('Claude n’est pas prêt')).toBeTruthy()
    expect(screen.getAllByText(/claude auth login/).length).toBeGreaterThan(0)
    expect(
      (screen.getByRole('textbox', { name: 'Message à l’assistant' }) as HTMLTextAreaElement)
        .disabled,
    ).toBe(true)
  })
})

describe('en-tête : interrupteur et pastilles (SUITE.md §5.1–5.2)', () => {
  it('hors ligne par défaut ; un clic passe en ligne et relit l’état de Claude', async () => {
    const { api } = fakeDesktop()
    render(
      <>
        <OnlineToggle />
        <ProviderBadges />
      </>,
    )
    await flush()
    const toggle = screen.getByRole('switch', { name: 'Mode en ligne' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(toggle.textContent).toBe('Hors ligne')
    const badges = screen.getByRole('button', { name: /Moteurs d’IA/ })
    expect(badges.getAttribute('aria-label')).toMatch(/Claude indisponible/)

    api.claudeStatus.mockClear()
    fireEvent.click(toggle)
    await flush()
    // Enregistré par le processus principal (hors du dossier de données), puis affiché.
    expect(api.setOnlineMode).toHaveBeenCalledWith(true)
    expect(useDataStore.getState().preferences.onlineMode).toBe(true)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(within(toggle).getByText('En ligne')).toBeTruthy()
    expect(api.claudeStatus).toHaveBeenCalledWith(true)
    expect(badges.getAttribute('aria-label')).toMatch(/Claude disponible/)
    expect(badges.getAttribute('title')).toMatch(/CLI 2\.1\.0/)
  })
})

describe('confirmations de l’assistant (SUITE.md §5.4)', () => {
  const ask = async (text: string) => {
    const input = screen.getByRole('textbox', { name: 'Message à l’assistant' })
    fireEvent.change(input, { target: { value: text } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await new Promise((r) => setTimeout(r, 30))
    })
  }

  it('envoi hors de la machine demandé par Claude : carte « Autoriser / Refuser », rien ne part si refusé', async () => {
    act(() => {
      useDataStore.getState().setOnlineMode(true)
    })
    const { api } = fakeDesktop([
      {
        ok: true,
        text: '',
        output: {
          action: 'tool',
          name: 'configure_export',
          arguments: { url: 'https://evil.example/collect' },
        },
      },
      { ok: true, text: '', output: { action: 'answer', text: 'D’accord, je n’envoie rien.' } },
    ])
    render(<AssistantPanel />)
    await flush()
    await ask('Configure l’export')
    const card = await screen.findByRole('group', {
      name: 'Confirmation : Adresse d’envoi hors de cet ordinateur',
    })
    expect(within(card).getByText('https://evil.example/collect')).toBeTruthy()
    expect(useDataStore.getState().integrations.atelierProjets.webhookUrl).toBeUndefined()
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Refuser' }))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(await screen.findByText('D’accord, je n’envoie rien.')).toBeTruthy()
    expect(within(card).getByText('Refusé : rien n’a été fait.')).toBeTruthy()
    expect(within(card).queryByRole('button')).toBeNull()
    expect(useDataStore.getState().integrations.atelierProjets.webhookUrl).toBeUndefined()
    expect(api.postWebhook).not.toHaveBeenCalled()
  })

  it('suppression de lignes : exécutée seulement après « Autoriser »', async () => {
    act(() => {
      useDataStore.getState().setOnlineMode(true)
    })
    fakeDesktop([
      {
        ok: true,
        text: '',
        output: {
          action: 'tool',
          name: 'delete_rows',
          arguments: { table: 'tbl_planning_lots', rows: [1] },
        },
      },
      { ok: true, text: '', output: { action: 'answer', text: 'Ligne 1 supprimée.' } },
    ])
    render(<AssistantPanel />)
    await flush()
    const before = useDataStore.getState().tables.tbl_planning_lots!.rowOrder.length
    await ask('Supprime la ligne 1')
    const card = await screen.findByRole('group', { name: 'Confirmation : Suppression' })
    expect(card.textContent).toMatch(
      /L’assistant veut supprimer 1 ligne \(1\) de « Planning & Lots »/,
    )
    expect(useDataStore.getState().tables.tbl_planning_lots!.rowOrder.length).toBe(before)
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Autoriser' }))
      await new Promise((r) => setTimeout(r, 30))
    })
    expect(await screen.findByText('Ligne 1 supprimée.')).toBeTruthy()
    expect(useDataStore.getState().tables.tbl_planning_lots!.rowOrder.length).toBe(before - 1)
  })
})
