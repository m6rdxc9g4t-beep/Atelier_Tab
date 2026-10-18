/**
 * Client Ollama minimal (API locale http://127.0.0.1:11434).
 * Dans l'app de bureau, les requêtes passent par le processus principal ; dans le
 * navigateur (npm run dev), elles partent directement vers Ollama.
 */
import { getDesktopApi, type OllamaRequest, type OllamaResponse } from '@/services/desktop'

export interface OllamaTransport {
  request(req: OllamaRequest): Promise<OllamaResponse>
  cancel(id: string): void
}

export function createOllamaTransport(baseUrl = 'http://127.0.0.1:11434'): OllamaTransport {
  const desktop = getDesktopApi()
  if (desktop) {
    return { request: (req) => desktop.ollama(req), cancel: (id) => void desktop.ollamaCancel(id) }
  }
  const controllers = new Map<string, AbortController>()
  return {
    async request(req) {
      const controller = new AbortController()
      controllers.set(req.id, controller)
      try {
        const res = await fetch(`${baseUrl}${req.path}`, {
          method: req.method ?? (req.body ? 'POST' : 'GET'),
          headers: { 'Content-Type': 'application/json' },
          body: req.body ? JSON.stringify(req.body) : undefined,
          signal: controller.signal,
        })
        const text = await res.text()
        let data: unknown = text
        try {
          data = JSON.parse(text)
        } catch {
          /* texte */
        }
        return { ok: res.ok, status: res.status, data }
      } catch (e) {
        return {
          ok: false,
          status: 0,
          data: null,
          error: controller.signal.aborted
            ? 'Requête annulée'
            : `Ollama injoignable : ${e instanceof Error ? e.message : e}`,
        }
      } finally {
        controllers.delete(req.id)
      }
    },
    cancel: (id) => controllers.get(id)?.abort(),
  }
}

let counter = 0
export function requestId(): string {
  counter += 1
  return `req_${Date.now().toString(36)}_${counter}`
}

export interface OllamaModel {
  name: string
  /** Taille lisible (ex. « 8.2B »). */
  parameters?: string
  /** Le modèle sait appeler des outils (indispensable pour agir dans l'app). */
  tools: boolean
}

export type ModelsResult =
  | { ok: true; models: OllamaModel[] }
  | { ok: false; reason: 'unreachable' | 'error'; message: string }

interface TagsResponse {
  models?: { name: string; details?: { parameter_size?: string } }[]
}

interface ShowResponse {
  capabilities?: string[]
}

export async function listModels(t: OllamaTransport): Promise<ModelsResult> {
  const tags = await t.request({ id: requestId(), path: '/api/tags', method: 'GET' })
  if (!tags.ok) {
    return tags.status === 0
      ? { ok: false, reason: 'unreachable', message: tags.error ?? 'Ollama injoignable' }
      : { ok: false, reason: 'error', message: `Ollama a répondu ${tags.status}` }
  }
  const list = (tags.data as TagsResponse).models ?? []
  const models = await Promise.all(
    list.map(async (m): Promise<OllamaModel | null> => {
      const show = await t.request({
        id: requestId(),
        path: '/api/show',
        method: 'POST',
        body: { model: m.name },
      })
      const caps = show.ok ? (show.data as ShowResponse).capabilities : undefined
      // Modèles d'embedding : inutilisables pour converser.
      if (caps && !caps.includes('completion')) return null
      return {
        name: m.name,
        parameters: m.details?.parameter_size,
        tools: caps ? caps.includes('tools') : true,
      }
    }),
  )
  return { ok: true, models: models.filter((m): m is OllamaModel => m !== null) }
}

/** Modèle proposé par défaut : le premier qui sait appeler des outils, en privilégiant les familles réputées fiables. */
export function preferredModel(models: OllamaModel[]): string | undefined {
  const capable = models.filter((m) => m.tools)
  const ranked = ['qwen3', 'qwen2.5', 'gpt-oss', 'llama3.1', 'llama3.2', 'mistral']
  for (const family of ranked) {
    const hit = capable.find((m) => m.name.startsWith(family))
    if (hit) return hit.name
  }
  return capable[0]?.name
}

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> | string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: ToolCall[]
  tool_name?: string
}

export interface ChatResult {
  ok: boolean
  message?: ChatMessage
  error?: string
  cancelled?: boolean
}

export async function chat(
  t: OllamaTransport,
  body: { model: string; messages: ChatMessage[]; tools: unknown[] },
  id: string,
): Promise<ChatResult> {
  const res = await t.request({
    id,
    path: '/api/chat',
    method: 'POST',
    body: { ...body, stream: false, options: { temperature: 0.2 } },
  })
  if (!res.ok) {
    if (res.error === 'Requête annulée') return { ok: false, cancelled: true, error: res.error }
    const apiError = (res.data as { error?: string } | null)?.error
    if (apiError && /does not support tools/i.test(apiError)) {
      return {
        ok: false,
        error: 'Ce modèle ne sait pas utiliser d’outils : choisissez-en un autre (ex. qwen3).',
      }
    }
    return { ok: false, error: apiError ?? res.error ?? `Erreur Ollama (${res.status})` }
  }
  const message = (res.data as { message?: ChatMessage }).message
  if (!message) return { ok: false, error: 'Réponse d’Ollama inattendue' }
  return { ok: true, message: { ...message, content: stripThinking(message.content ?? '') } }
}

/** Retire un éventuel raisonnement <think>…</think> laissé dans la réponse. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
}
