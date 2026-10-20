import { afterEach, describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import type { OllamaRequest, OllamaResponse } from '@/services/desktop'
import { runAgent, systemPrompt, type AgentEvent } from '../agent'
import { createHeadlessSession, type HeadlessSession } from '../headless'
import { listModels, preferredModel, stripThinking, type OllamaTransport } from '../ollama'
import { ollamaProvider } from '../provider'

/** Faux Ollama : renvoie des réponses /api/chat préparées et mémorise les requêtes. */
function fakeOllama(chatReplies: unknown[], extra: Partial<Record<string, OllamaResponse>> = {}) {
  const requests: OllamaRequest[] = []
  const transport: OllamaTransport = {
    async request(req) {
      requests.push(req)
      if (req.path === '/api/chat') {
        const next = chatReplies.shift()
        return next === undefined
          ? { ok: false, status: 500, data: { error: 'plus de réponse' } }
          : { ok: true, status: 200, data: { message: next } }
      }
      return extra[req.path] ?? { ok: false, status: 404, data: null }
    },
    cancel() {},
  }
  return { transport, requests }
}

let session: HeadlessSession | null = null
afterEach(() => session?.dispose())
const host = () => {
  session = createHeadlessSession(createDemoData(), async (name) => `/exports/${name}`)
  return session.host
}

const context = { today: '19/10/2026', table: { id: 'tbl_planning_lots', name: 'Planning & Lots' } }

describe('runAgent', () => {
  it('exécute les outils demandés puis renvoie la réponse', async () => {
    const { transport, requests } = fakeOllama([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'add_rows',
              arguments: { table: 'tbl_planning_lots', rows: [{ A: 'Menuiseries', C: '12 000' }] },
            },
          },
        ],
      },
      {
        role: 'assistant',
        content: '<think>ok</think>J’ai ajouté la ligne 4 « Menuiseries » (14 400 € TTC).',
      },
    ])
    const events: AgentEvent[] = []
    const h = host()
    const history = await runAgent({
      provider: ollamaProvider(transport, 'qwen3:8b'),
      history: [],
      prompt: 'Ajoute Menuiseries à 12 000 €',
      host: h,
      context,
      onEvent: (e) => events.push(e),
    })

    expect(events.map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'answer'])
    expect(events[2]).toEqual({
      type: 'answer',
      text: 'J’ai ajouté la ligne 4 « Menuiseries » (14 400 € TTC).',
    })
    // L'action a bien eu lieu dans le store.
    const table = h.store.getState().tables.tbl_planning_lots!
    expect(table.rowOrder).toHaveLength(5)
    expect(h.getSheet('tbl_planning_lots')?.value('rec_total', 'cost_ttc')).toBe(120600)

    // Le second appel au modèle contient le résultat de l'outil.
    const second = requests.filter((r) => r.path === '/api/chat')[1]?.body as {
      messages: { role: string; tool_name?: string; content: string }[]
      tools: { function: { name: string } }[]
    }
    expect(second.messages[0]?.role).toBe('system')
    expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_name: 'add_rows' })
    expect(second.tools).toHaveLength(16)
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })

  it('transmet l’erreur d’un outil au modèle pour qu’il se corrige', async () => {
    const { transport, requests } = fakeOllama([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: 'read_table', arguments: '{"table":"Planning"}' } }],
      },
      { role: 'assistant', content: 'Laquelle ?' },
    ])
    const events: AgentEvent[] = []
    await runAgent({
      provider: ollamaProvider(transport, 'm'),
      history: [],
      prompt: 'Lis',
      host: host(),
      context,
      onEvent: (e) => events.push(e),
    })
    expect(events[1]).toMatchObject({ type: 'tool_result', ok: false })
    const last = (requests.at(-1)?.body as { messages: { content: string }[] }).messages.at(-1)
    expect(last?.content).toMatch(/^ERREUR : table introuvable/)
  })

  it('s’arrête proprement sur une erreur d’Ollama', async () => {
    const transport: OllamaTransport = {
      request: async () => ({
        ok: false,
        status: 400,
        data: { error: 'model does not support tools' },
      }),
      cancel() {},
    }
    const events: AgentEvent[] = []
    await runAgent({
      provider: ollamaProvider(transport, 'gemma'),
      history: [],
      prompt: 'x',
      host: host(),
      context,
      onEvent: (e) => events.push(e),
    })
    expect(events).toEqual([
      {
        type: 'error',
        message: 'Ce modèle ne sait pas utiliser d’outils : choisissez-en un autre (ex. qwen3).',
      },
    ])
  })

  it('limite le nombre d’étapes', async () => {
    const loop = {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'list_tables', arguments: {} } }],
    }
    const { transport } = fakeOllama([loop, loop, loop])
    const events: AgentEvent[] = []
    await runAgent({
      provider: ollamaProvider(transport, 'm'),
      history: [],
      prompt: 'x',
      host: host(),
      context,
      onEvent: (e) => events.push(e),
      maxSteps: 2,
    })
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      message: expect.stringMatching(/Arrêt après 2 étapes/),
    })
  })

  it('décrit le contexte de l’app dans le message système', () => {
    const prompt = systemPrompt({ ...context, selection: 'D2 (Coût TTC)' })
    expect(prompt).toContain('Table ouverte : « Planning & Lots » (id tbl_planning_lots)')
    expect(prompt).toContain('Cellule sélectionnée : D2 (Coût TTC)')
  })
})

describe('modèles Ollama', () => {
  it('liste les modèles et repère ceux qui savent utiliser des outils', async () => {
    const transport: OllamaTransport = {
      async request(req) {
        if (req.path === '/api/tags') {
          return {
            ok: true,
            status: 200,
            data: {
              models: [
                { name: 'gemma3:4b' },
                { name: 'qwen3:8b', details: { parameter_size: '8.2B' } },
                { name: 'nomic-embed-text' },
              ],
            },
          }
        }
        const model = (req.body as { model: string }).model
        const caps: Record<string, string[]> = {
          'gemma3:4b': ['completion', 'vision'],
          'qwen3:8b': ['completion', 'tools', 'thinking'],
          'nomic-embed-text': ['embedding'],
        }
        return { ok: true, status: 200, data: { capabilities: caps[model] } }
      },
      cancel() {},
    }
    const res = await listModels(transport)
    expect(res).toEqual({
      ok: true,
      models: [
        { name: 'gemma3:4b', parameters: undefined, tools: false },
        { name: 'qwen3:8b', parameters: '8.2B', tools: true },
      ],
    })
    expect(preferredModel(res.ok ? res.models : [])).toBe('qwen3:8b')
  })

  it('signale un Ollama non lancé', async () => {
    const transport: OllamaTransport = {
      request: async () => ({ ok: false, status: 0, data: null, error: 'Ollama injoignable' }),
      cancel() {},
    }
    expect(await listModels(transport)).toEqual({
      ok: false,
      reason: 'unreachable',
      message: 'Ollama injoignable',
    })
  })

  it('retire le raisonnement laissé dans la réponse', () => {
    expect(stripThinking('<think>\nhmm\n</think>\n\nBonjour')).toBe('Bonjour')
  })
})
