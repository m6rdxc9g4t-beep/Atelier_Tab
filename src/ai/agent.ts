/**
 * Boucle de l'assistant, indépendante du moteur (Ollama ou Claude, `provider.ts`) : le modèle
 * répond ou demande des outils ; les outils sont exécutés sur le store de l'app par ses
 * actions habituelles, leurs résultats renvoyés au modèle, jusqu'à la réponse.
 *
 * Données et consignes restent séparées (docs/SUITE.md §5.3–5.4) : le prompt système ne
 * contient que des consignes ; le contexte (table ouverte, cellule sélectionnée) et les
 * résultats d'outils sont des blocs de données délimités (`tool-data.ts`).
 */
import { requestId, type ChatMessage, type ToolCall } from './ollama'
import type { ChatProvider } from './provider'
import { DATA_RULE } from './tool-data'
import { runTool, toolSchemas, type ToolHost } from './tools'

export type AgentEvent =
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; ok: boolean; content: string }
  | { type: 'answer'; text: string }
  | { type: 'error'; message: string }
  | { type: 'cancelled' }

export interface AgentContext {
  /** Table ouverte dans l'app. */
  table?: { id: string; name: string }
  /** Cellule sélectionnée (ex. « D2, colonne Coût TTC »). */
  selection?: string
  today: string
}

/**
 * Prompt système : **uniquement des consignes**, identiques quelle que soit la table (aucune
 * donnée : il part en argument de la CLI Claude, visible par `ps`).
 */
export function systemPrompt(ctx: Pick<AgentContext, 'today'>): string {
  return [
    'Tu es l’assistant d’Atelier_Tab, un tableur-base de données. Tu réponds en français, brièvement.',
    'Tu agis sur les données uniquement avec les outils fournis. Ne prétends jamais avoir modifié quelque chose sans avoir appelé un outil.',
    'Méthode : lis d’abord la table avec read_table (et list_tables si tu ne connais pas son nom), puis modifie avec les outils, puis résume ce que tu as fait en une ou deux phrases.',
    'Les colonnes ont des lettres (A, B, C…) et les lignes des numéros à partir de 1. Les valeurs s’écrivent comme dans la grille : "45 000", "30/11/2026", libellé du statut, nom du responsable, formule "=SUM(C1:C3)".',
    'Une colonne de type formula a une formule écrite pour la ligne 1, recopiée sur chaque ligne. Les lignes total_row sont des totaux : add_rows insère avant elles.',
    'Si un outil renvoie une erreur, lis le message, corrige et réessaie une fois. Si une demande est ambiguë, pose une question. Si l’utilisateur refuse une confirmation, n’insiste pas : dis-le et arrête.',
    DATA_RULE,
    `Date du jour : ${ctx.today}.`,
  ].join('\n')
}

/**
 * Contexte de l'app (données : nom de table, libellé de colonne). Chaque moteur le transmet
 * dans un bloc de données délimité, hors du prompt système (`tool-data.ts`).
 */
export function contextText(ctx: AgentContext): string {
  return [
    ctx.table
      ? `Table ouverte : « ${ctx.table.name} » (id ${ctx.table.id}).`
      : 'Aucune table ouverte.',
    ctx.selection ? `Cellule sélectionnée : ${ctx.selection}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function parseArgs(call: ToolCall): Record<string, unknown> {
  const raw = call.function.arguments
  if (typeof raw !== 'string') return raw ?? {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

export interface RunAgentOptions {
  provider: ChatProvider
  /** Conversation précédente (sans message système). */
  history: ChatMessage[]
  prompt: string
  host: ToolHost
  context: AgentContext
  onEvent(event: AgentEvent): void
  /** Reçoit l'identifiant de la requête en cours, pour pouvoir l'annuler. */
  onRequest?(id: string): void
  isCancelled?(): boolean
  /** Par défaut : celui du fournisseur (Ollama 12, Claude 8). */
  maxSteps?: number
}

/** Exécute un tour de conversation. Renvoie l'historique mis à jour (sans message système). */
export async function runAgent(opts: RunAgentOptions): Promise<ChatMessage[]> {
  const tools = toolSchemas()
  const history: ChatMessage[] = [...opts.history, { role: 'user', content: opts.prompt }]
  const maxSteps = opts.maxSteps ?? opts.provider.maxSteps
  const system = systemPrompt(opts.context)
  const context = contextText(opts.context)

  for (let step = 0; step < maxSteps; step++) {
    if (opts.isCancelled?.()) {
      opts.onEvent({ type: 'cancelled' })
      return history
    }
    const id = requestId()
    opts.onRequest?.(id)
    const res = await opts.provider.step({ id, system, context, messages: history, tools })
    if (res.cancelled || opts.isCancelled?.()) {
      opts.onEvent({ type: 'cancelled' })
      return history
    }
    if (!res.ok || !res.message) {
      opts.onEvent({ type: 'error', message: res.error ?? 'Erreur inconnue' })
      return history
    }

    const message = res.message
    const calls = message.tool_calls ?? []
    history.push({
      role: 'assistant',
      content: message.content,
      ...(calls.length ? { tool_calls: calls } : {}),
    })

    if (calls.length === 0) {
      opts.onEvent({ type: 'answer', text: message.content || 'C’est fait.' })
      return history
    }

    for (const call of calls) {
      const name = call.function.name
      const args = parseArgs(call)
      opts.onEvent({ type: 'tool_call', name, args })
      const result = await runTool(name, args, opts.host)
      opts.onEvent({ type: 'tool_result', name, ok: result.ok, content: result.content })
      history.push({
        role: 'tool',
        tool_name: name,
        content: result.ok ? result.content : `ERREUR : ${result.content}`,
      })
    }
  }

  opts.onEvent({
    type: 'error',
    message: `Arrêt après ${maxSteps} étapes sans réponse finale. Reformulez ou découpez la demande.`,
  })
  return history
}
