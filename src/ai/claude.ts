/**
 * Claude dans l'assistant (docs/SUITE.md §5.2–5.3). Module pur.
 *
 * La CLI Claude Code est lancée sans aucun outil (`--tools ""`) : Claude ne fait que répondre.
 * Les actions passent par un protocole JSON contraint (`--json-schema`) :
 *
 *   {"action":"tool","name":"read_table","arguments":{…}}   → l'app exécute l'outil
 *   {"action":"answer","text":"…"}                           → réponse à l'utilisateur
 *
 * L'app exécute l'outil avec ses actions habituelles (`src/ai/tools.ts`, seule définition des
 * outils) et renvoie le résultat au tour suivant, 8 tours au plus par demande.
 */
import { getDesktopApi } from '@/services/desktop'
import type {
  ClaudeChatRequest,
  ClaudeChatResponse,
  ClaudeMessage,
  ClaudeModelAlias,
  ClaudeStatus,
} from '@/services/desktop'
import type { ChatMessage, ChatResult } from './ollama'
import type { ChatProvider, ToolSchema } from './provider'

export type { ClaudeModelAlias, ClaudeStatus }

/** Tours maximum par demande (contrat §5.3). */
export const CLAUDE_MAX_STEPS = 8

export const CLAUDE_MODELS: readonly { alias: ClaudeModelAlias; label: string }[] = [
  { alias: 'sonnet', label: 'Sonnet' },
  { alias: 'opus', label: 'Opus' },
  { alias: 'haiku', label: 'Haiku' },
]

export const DEFAULT_CLAUDE_MODEL: ClaudeModelAlias = 'sonnet'

export function isClaudeModel(value: unknown): value is ClaudeModelAlias {
  return CLAUDE_MODELS.some((m) => m.alias === value)
}

export function claudeModelLabel(alias: ClaudeModelAlias): string {
  return CLAUDE_MODELS.find((m) => m.alias === alias)?.label ?? alias
}

/** Transport vers la CLI (processus principal de l'app de bureau). */
export interface ClaudeTransport {
  chat(request: ClaudeChatRequest): Promise<ClaudeChatResponse>
  cancel(id: string): void
  status(refresh?: boolean): Promise<ClaudeStatus>
}

/** Transport de l'app de bureau ; null dans un navigateur (Claude indisponible). */
export function createClaudeTransport(): ClaudeTransport | null {
  const desktop = getDesktopApi()
  if (!desktop?.claudeChat) return null
  return {
    chat: (request) => desktop.claudeChat(request),
    cancel: (id) => void desktop.claudeCancel(id),
    status: (refresh) => desktop.claudeStatus(refresh),
  }
}

// ---------------------------------------------------------------------------
// Protocole
// ---------------------------------------------------------------------------

/** Schéma de la réponse de Claude à chaque tour (`--json-schema`). */
export function agentResponseSchema(toolNames: readonly string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['tool', 'answer'],
        description: '« tool » pour appeler un outil de l’app, « answer » pour répondre',
      },
      name: { type: 'string', enum: [...toolNames], description: 'Outil à appeler (action tool)' },
      arguments: { type: 'object', description: 'Arguments de l’outil (action tool)' },
      text: { type: 'string', description: 'Réponse à l’utilisateur, en français (action answer)' },
    },
    required: ['action'],
    additionalProperties: false,
  }
}

/** Prompt système : celui de l'assistant, plus le protocole et le catalogue des outils. */
export function claudeSystemPrompt(base: string, tools: readonly ToolSchema[]): string {
  const catalogue = tools
    .map((t) => `- ${t.name} : ${t.description}\n  Arguments : ${JSON.stringify(t.parameters)}`)
    .join('\n')
  return [
    base,
    '',
    'Protocole de réponse (obligatoire) : chaque réponse est un seul objet JSON conforme au schéma fourni.',
    '- Pour utiliser un outil : {"action":"tool","name":"<outil>","arguments":{…}}. Un seul outil par réponse : l’application l’exécute et te renvoie son résultat au message suivant.',
    '- Pour répondre à l’utilisateur : {"action":"answer","text":"…"}.',
    `Tu disposes au plus de ${CLAUDE_MAX_STEPS} réponses par demande : va à l’essentiel.`,
    'Tu n’as aucun autre moyen d’agir (ni fichiers, ni commandes) : seulement ces outils, exécutés par l’application.',
    '',
    'Outils :',
    catalogue,
  ].join('\n')
}

/**
 * Historique commun (format Ollama) → messages pour la CLI. Les appels d'outils deviennent
 * l'objet JSON que Claude aurait produit ; les résultats gardent un rôle `tool` distinct :
 * le processus principal les rend en blocs de données délimités, jamais comme des messages
 * de l'utilisateur (docs/SUITE.md §5.4).
 */
export function toClaudeMessages(history: readonly ChatMessage[]): ClaudeMessage[] {
  const out: ClaudeMessage[] = []
  for (const m of history) {
    if (m.role === 'system') continue
    if (m.role === 'tool') {
      out.push({ role: 'tool', name: m.tool_name ?? 'outil', content: m.content })
      continue
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      for (const call of m.tool_calls) {
        const raw = call.function.arguments
        let args: unknown = raw
        if (typeof raw === 'string') {
          try {
            args = JSON.parse(raw)
          } catch {
            args = {}
          }
        }
        out.push({
          role: 'assistant',
          content: JSON.stringify({ action: 'tool', name: call.function.name, arguments: args }),
        })
      }
      continue
    }
    out.push({ role: m.role, content: m.content })
  }
  return out
}

export type AgentAction =
  | { action: 'tool'; name: string; arguments: Record<string, unknown> }
  | { action: 'answer'; text: string }

/** Lit l'action choisie par Claude ; null si la sortie ne suit pas le protocole. */
export function parseAgentAction(output: unknown, text = ''): AgentAction | null {
  let value = output
  if (value === undefined || value === null) {
    // Repli : JSON dans le texte final (sortie non structurée).
    const match = /\{[\s\S]*\}/.exec(text)
    if (!match) return text.trim() ? { action: 'answer', text: text.trim() } : null
    try {
      value = JSON.parse(match[0])
    } catch {
      return null
    }
  }
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (v.action === 'tool') {
    const args = v.arguments
    return {
      action: 'tool',
      name: typeof v.name === 'string' ? v.name : '',
      arguments:
        typeof args === 'object' && args !== null && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {},
    }
  }
  if (v.action === 'answer') {
    return { action: 'answer', text: typeof v.text === 'string' ? v.text.trim() : '' }
  }
  return null
}

/** Claude comme fournisseur de l'assistant : un appel isolé de la CLI par tour. */
export function claudeProvider(transport: ClaudeTransport, model: ClaudeModelAlias): ChatProvider {
  return {
    engine: 'claude',
    model: claudeModelLabel(model),
    maxSteps: CLAUDE_MAX_STEPS,
    async step({ id, system, context, messages, tools }): Promise<ChatResult> {
      const res = await transport.chat({
        id,
        model,
        system: claudeSystemPrompt(system, tools),
        // Données : sur l'entrée standard, jamais en argument (contrat §5.3).
        ...(context ? { context } : {}),
        messages: toClaudeMessages(messages),
        schema: agentResponseSchema(tools.map((t) => t.name)),
      })
      if (!res.ok) {
        return res.code === 'cancelled'
          ? { ok: false, cancelled: true, error: res.error }
          : { ok: false, error: res.error }
      }
      const action = parseAgentAction(res.output, res.text)
      if (!action)
        return { ok: false, error: 'Réponse de Claude inattendue (protocole non suivi).' }
      if (action.action === 'answer') {
        return { ok: true, message: { role: 'assistant', content: action.text } }
      }
      return {
        ok: true,
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: action.name, arguments: action.arguments } }],
        },
      }
    },
    cancel: (id) => transport.cancel(id),
  }
}
