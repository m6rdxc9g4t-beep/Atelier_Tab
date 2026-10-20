import { afterEach, describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import type { ClaudeChatRequest, ClaudeChatResponse } from '@/services/desktop'
import { runAgent, type AgentEvent } from '../agent'
import {
  agentResponseSchema,
  CLAUDE_MAX_STEPS,
  CLAUDE_MODELS,
  claudeProvider,
  claudeSystemPrompt,
  parseAgentAction,
  toClaudeMessages,
  type ClaudeTransport,
} from '../claude'
import {
  CLAUDE_BROWSER_HINT,
  CLAUDE_OFFLINE_HINT,
  privacyNote,
  resolveEngine,
  type EngineInputs,
} from '../engine'
import { createHeadlessSession, type HeadlessSession } from '../headless'
import { toolSchemas } from '../tools'

let session: HeadlessSession | null = null
afterEach(() => session?.dispose())
const host = () => {
  session = createHeadlessSession(createDemoData(), async (name) => `/exports/${name}`)
  return session.host
}
const context = { today: '20/10/2026', table: { id: 'tbl_planning_lots', name: 'Planning & Lots' } }

/** Fausse CLI : renvoie des sorties structurées préparées et mémorise les requêtes. */
function fakeClaude(outputs: (ClaudeChatResponse | unknown)[]) {
  const requests: ClaudeChatRequest[] = []
  const cancelled: string[] = []
  const transport: ClaudeTransport = {
    async chat(req) {
      requests.push(structuredClone(req))
      const next = outputs.shift()
      if (next && typeof next === 'object' && 'ok' in next) return next as ClaudeChatResponse
      return { ok: true, output: next, text: '' }
    },
    cancel: (id) => void cancelled.push(id),
    status: async () => ({ online: true, found: true, available: true, detail: null }),
  }
  return { transport, requests, cancelled }
}

describe('protocole Claude (SUITE.md §5.3)', () => {
  it('schéma contraint : action tool|answer, nom d’outil parmi ceux de l’app', () => {
    const names = toolSchemas().map((t) => t.name)
    const schema = agentResponseSchema(names) as {
      properties: { action: { enum: string[] }; name: { enum: string[] } }
      required: string[]
      additionalProperties: boolean
    }
    expect(schema.properties.action.enum).toEqual(['tool', 'answer'])
    expect(schema.properties.name.enum).toEqual(names)
    expect(schema.required).toEqual(['action'])
    expect(schema.additionalProperties).toBe(false)
  })

  it('prompt système : protocole et catalogue des outils, de taille raisonnable', () => {
    const prompt = claudeSystemPrompt('Tu es l’assistant.', toolSchemas())
    expect(prompt).toMatch(/^Tu es l’assistant\./)
    expect(prompt).toContain('{"action":"tool","name":"<outil>","arguments":{…}}')
    expect(prompt).toContain('- set_cells : ')
    expect(prompt).toContain(`au plus de ${CLAUDE_MAX_STEPS} réponses`)
    // Passé en argument de ligne de commande : bien en deçà des limites du système.
    expect(prompt.length).toBeLessThan(40_000)
  })

  it('convertit l’historique commun (y compris venu d’Ollama) en transcription', () => {
    expect(
      toClaudeMessages([
        { role: 'user', content: 'Lis la table' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'read_table', arguments: '{"table":"Budget"}' } }],
        },
        { role: 'tool', tool_name: 'read_table', content: '{"rows":[]}' },
        { role: 'assistant', content: 'Elle est vide.' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Lis la table' },
      {
        role: 'assistant',
        content: '{"action":"tool","name":"read_table","arguments":{"table":"Budget"}}',
      },
      { role: 'user', content: '[Résultat de l’outil read_table]\n{"rows":[]}' },
      { role: 'assistant', content: 'Elle est vide.' },
    ])
  })

  it('lit l’action choisie, avec repli sur le texte', () => {
    expect(parseAgentAction({ action: 'tool', name: 'list_tables' })).toEqual({
      action: 'tool',
      name: 'list_tables',
      arguments: {},
    })
    expect(parseAgentAction({ action: 'answer', text: ' Fait. ' })).toEqual({
      action: 'answer',
      text: 'Fait.',
    })
    expect(parseAgentAction(undefined, 'voici {"action":"answer","text":"ok"}')).toEqual({
      action: 'answer',
      text: 'ok',
    })
    expect(parseAgentAction(undefined, 'Bonjour')).toEqual({ action: 'answer', text: 'Bonjour' })
    expect(parseAgentAction({ action: 'shell', command: 'rm -rf /' })).toBeNull()
    expect(parseAgentAction('texte')).toBeNull()
  })

  it('modèles proposés : Sonnet (défaut), Opus, Haiku', () => {
    expect(CLAUDE_MODELS.map((m) => m.alias)).toEqual(['sonnet', 'opus', 'haiku'])
  })
})

describe('runAgent avec Claude', () => {
  it('exécute l’outil demandé par l’app puis renvoie la réponse', async () => {
    const { transport, requests } = fakeClaude([
      {
        action: 'tool',
        name: 'add_rows',
        arguments: { table: 'tbl_planning_lots', rows: [{ A: 'Menuiseries', C: '12 000' }] },
      },
      { action: 'answer', text: 'J’ai ajouté « Menuiseries » (14 400 € TTC).' },
    ])
    const events: AgentEvent[] = []
    const h = host()
    const history = await runAgent({
      provider: claudeProvider(transport, 'opus'),
      history: [],
      prompt: 'Ajoute Menuiseries à 12 000 €',
      host: h,
      context,
      onEvent: (e) => events.push(e),
    })
    expect(events.map((e) => e.type)).toEqual(['tool_call', 'tool_result', 'answer'])
    expect(events[2]).toEqual({
      type: 'answer',
      text: 'J’ai ajouté « Menuiseries » (14 400 € TTC).',
    })
    // L'outil a été exécuté par l'app, sur son store.
    expect(h.getSheet('tbl_planning_lots')?.value('rec_total', 'cost_ttc')).toBe(120600)

    // Chaque tour : alias validé, schéma contraint, conversation seulement.
    expect(requests).toHaveLength(2)
    expect(Object.keys(requests[0]!).sort()).toEqual([
      'id',
      'messages',
      'model',
      'schema',
      'system',
    ])
    expect(requests[0]?.model).toBe('opus')
    expect(requests[0]?.messages).toEqual([
      { role: 'user', content: 'Ajoute Menuiseries à 12 000 €' },
    ])
    expect(requests[1]?.messages.at(-1)?.content).toMatch(/^\[Résultat de l’outil add_rows\]\n\{/)
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
  })

  it('8 tours au plus par demande', async () => {
    const loop = { action: 'tool', name: 'list_tables', arguments: {} }
    const { transport, requests } = fakeClaude(Array.from({ length: 12 }, () => loop))
    const events: AgentEvent[] = []
    await runAgent({
      provider: claudeProvider(transport, 'sonnet'),
      history: [],
      prompt: 'x',
      host: host(),
      context,
      onEvent: (e) => events.push(e),
    })
    expect(requests).toHaveLength(8)
    expect(events.at(-1)).toMatchObject({ message: expect.stringMatching(/Arrêt après 8 étapes/) })
  })

  it('un outil inconnu est signalé à Claude, qui peut se corriger', async () => {
    const { transport, requests } = fakeClaude([
      { action: 'tool', name: 'Bash', arguments: { command: 'ls' } },
      { action: 'answer', text: 'Je ne peux pas.' },
    ])
    const events: AgentEvent[] = []
    await runAgent({
      provider: claudeProvider(transport, 'sonnet'),
      history: [],
      prompt: 'x',
      host: host(),
      context,
      onEvent: (e) => events.push(e),
    })
    expect(events[1]).toMatchObject({ type: 'tool_result', ok: false })
    expect(requests[1]?.messages.at(-1)?.content).toMatch(/ERREUR : Outil inconnu : Bash/)
  })

  it('erreur (hors ligne) et annulation remontent proprement', async () => {
    const offline = fakeClaude([{ ok: false, code: 'offline', error: 'Mode hors ligne' }])
    const events: AgentEvent[] = []
    await runAgent({
      provider: claudeProvider(offline.transport, 'sonnet'),
      history: [],
      prompt: 'x',
      host: host(),
      context,
      onEvent: (e) => events.push(e),
    })
    expect(events).toEqual([{ type: 'error', message: 'Mode hors ligne' }])

    const cancelled = fakeClaude([{ ok: false, code: 'cancelled', error: 'Annulée' }])
    const more: AgentEvent[] = []
    await runAgent({
      provider: claudeProvider(cancelled.transport, 'sonnet'),
      history: [],
      prompt: 'x',
      host: host(),
      context,
      onEvent: (e) => more.push(e),
    })
    expect(more).toEqual([{ type: 'cancelled' }])
  })
})

describe('choix du moteur (SUITE.md §5.1–5.2)', () => {
  const ready = { online: true, found: true, available: true, detail: null }
  const base: EngineInputs = {
    choice: 'auto',
    online: true,
    desktop: true,
    claude: ready,
    ollamaReady: true,
  }

  it('Auto : Claude si en ligne et disponible, sinon Ollama', () => {
    expect(resolveEngine(base).engine).toBe('claude')
    expect(resolveEngine({ ...base, online: false }).engine).toBe('ollama')
    expect(resolveEngine({ ...base, claude: { ...ready, available: false } }).engine).toBe('ollama')
    expect(resolveEngine({ ...base, claude: null }).engine).toBe('ollama')
  })

  it('hors ligne : Claude grisé avec l’explication, retombe sur Auto', () => {
    const state = resolveEngine({ ...base, choice: 'claude', online: false })
    expect(state).toMatchObject({
      choice: 'auto',
      engine: 'ollama',
      claudeSelectable: false,
      claudeHint: CLAUDE_OFFLINE_HINT,
    })
  })

  it('navigateur : Claude indisponible, « disponible dans l’app de bureau »', () => {
    const state = resolveEngine({ ...base, choice: 'claude', desktop: false })
    expect(state).toMatchObject({ engine: 'ollama', claudeHint: CLAUDE_BROWSER_HINT })
    expect(CLAUDE_BROWSER_HINT).toMatch(/disponible dans l’app de bureau/)
  })

  it('choix explicite : le moteur indisponible est signalé, sans bascule silencieuse', () => {
    expect(
      resolveEngine({ ...base, choice: 'claude', claude: { ...ready, available: false } }),
    ).toMatchObject({ engine: 'claude', down: true })
    expect(resolveEngine({ ...base, choice: 'ollama', ollamaReady: false })).toMatchObject({
      engine: 'ollama',
      down: true,
    })
  })

  it('ligne bouclier : ce qui est envoyé', () => {
    expect(privacyNote('claude')).toMatch(/la demande et les cellules que l’assistant lit/)
    expect(privacyNote('ollama')).toMatch(/Rien ne quitte cet ordinateur/)
  })
})
