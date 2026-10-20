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
import { contextBlock, toolResultBlock } from './tool-data'

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
  /** Consignes seulement (aucune donnée de table). */
  system: string
  /** Contexte de l'app (table ouverte…) : données, que chaque moteur place dans un bloc délimité. */
  context?: string
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
    step: ({ id, system, context, messages, tools }) =>
      chat(
        transport,
        {
          model,
          messages: [
            { role: 'system', content: context ? `${system}\n\n${contextBlock(context)}` : system },
            ...messages.map(asOllamaMessage),
          ],
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

/**
 * Message de l'historique commun tel qu'envoyé à Ollama : un résultat d'outil garde son rôle
 * `tool` et son contenu est placé dans un bloc de données délimité (docs/SUITE.md §5.4).
 */
export function asOllamaMessage(m: ChatMessage): ChatMessage {
  return m.role === 'tool'
    ? { ...m, content: toolResultBlock(m.tool_name ?? 'outil', m.content) }
    : m
}
