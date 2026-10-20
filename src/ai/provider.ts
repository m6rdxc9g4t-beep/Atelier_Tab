/**
 * Fournisseurs de l'assistant (docs/SUITE.md §5) : Ollama (local) et Claude (CLI Claude Code,
 * app de bureau seulement). Module pur, sans React : la boucle `runAgent` ne connaît que
 * cette interface.
 *
 * L'historique est commun aux deux moteurs (format `ChatMessage` d'Ollama : messages
 * `assistant` avec `tool_calls`, messages `tool` avec le résultat) : on peut changer de
 * moteur au milieu d'une conversation.
 */
import { chat, type ChatMessage, type ChatResult, type OllamaTransport } from './ollama'

export type EngineId = 'ollama' | 'claude'

/** Nom affiché du moteur (« 1 réponse · Claude »). */
export const ENGINE_LABELS: Record<EngineId, string> = { ollama: 'Ollama', claude: 'Claude' }

/** Outil tel que décrit au modèle (nom, description, JSON Schema des arguments). */
export interface ToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface StepRequest {
  /** Identifiant de la requête, pour pouvoir l'annuler. */
  id: string
  system: string
  /** Conversation (sans message système). */
  messages: ChatMessage[]
  tools: ToolSchema[]
}

export interface ChatProvider {
  engine: EngineId
  /** Modèle, pour l'affichage (« qwen3:8b », « Sonnet »). */
  model: string
  /** Nombre maximal d'étapes (appels au modèle) par demande. */
  maxSteps: number
  /** Un tour : le modèle répond ou demande des outils (`message.tool_calls`). */
  step(request: StepRequest): Promise<ChatResult>
  cancel(id: string): void
}

/** Ollama : API `/api/chat` avec ses outils natifs. */
export function ollamaProvider(transport: OllamaTransport, model: string): ChatProvider {
  return {
    engine: 'ollama',
    model,
    maxSteps: 12,
    step: ({ id, system, messages, tools }) =>
      chat(
        transport,
        {
          model,
          messages: [{ role: 'system', content: system }, ...messages],
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        },
        id,
      ),
    cancel: (id) => transport.cancel(id),
  }
}
