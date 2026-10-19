/**
 * Envoi du payload vers une API d'import (POST JSON), en premier lieu Atelier Projets.
 * - En-tête `Idempotency-Key` : un renvoi après coupure ne crée pas de doublon côté cible.
 * - Nouvelles tentatives (3 au total, délai exponentiel) sur erreur réseau, 429 et 5xx.
 * - La réponse JSON est lue : résumé d'import d'Atelier Projets (`created`, `updated`…)
 *   en cas de succès, message d'erreur de la cible sinon.
 * - `fetch` et l'attente sont injectables pour les tests (et pour l'app de bureau, qui
 *   relaie la requête par son processus principal).
 */
import type { AtelierPayload } from '../schema/atelier.v2_1'
import { describeProjetsSummary, parseProjetsSummary, type ProjetsImportSummary } from './projets'

export interface WebhookConfig {
  url: string
  token?: string
}

export interface WebhookResult {
  ok: boolean
  status: number | null
  attempts: number
  message: string
  /** Résumé renvoyé par Atelier Projets, quand la cible en est une. */
  summary?: ProjetsImportSummary
}

/** Sous-ensemble de `fetch` utilisé ici (une réponse dont on lit le statut et le texte). */
export type WebhookFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export interface WebhookDeps {
  fetch?: WebhookFetch
  sleep?: (ms: number) => Promise<void>
  idempotencyKey?: string
  maxAttempts?: number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** https obligatoire ; http accepté pour cette machine (`localhost`, `127.0.0.1`). */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' ||
      (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))
    )
  } catch {
    return false
  }
}

async function readJson(res: { text(): Promise<string> }): Promise<unknown> {
  try {
    const text = await res.text()
    return text ? JSON.parse(text) : null
  } catch {
    return null
  }
}

/** Message d'erreur lisible fourni par la cible (`{ message }` d'Atelier Projets). */
function serverMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const message = (body as { message?: unknown }).message
  return typeof message === 'string' && message.trim() ? message.trim() : null
}

export async function sendToWebhook(
  payload: AtelierPayload,
  config: WebhookConfig,
  deps: WebhookDeps = {},
): Promise<WebhookResult> {
  if (!isValidWebhookUrl(config.url)) {
    return {
      ok: false,
      status: null,
      attempts: 0,
      message: 'Adresse invalide : utilisez https:// (ou http://localhost en développement)',
    }
  }

  const doFetch: WebhookFetch = deps.fetch ?? ((url, init) => fetch(url, init))
  const sleep = deps.sleep ?? defaultSleep
  const maxAttempts = deps.maxAttempts ?? 3
  const key = deps.idempotencyKey ?? crypto.randomUUID()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
    'X-Atelier-Schema-Version': payload.schema_version,
  }
  if (config.token) headers.Authorization = `Bearer ${config.token}`
  const body = JSON.stringify(payload)

  let last: WebhookResult = { ok: false, status: null, attempts: 0, message: '' }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await doFetch(config.url, { method: 'POST', headers, body })
      const json = await readJson(res)
      if (res.ok) {
        const summary = parseProjetsSummary(json)
        return {
          ok: true,
          status: res.status,
          attempts: attempt,
          message: summary
            ? `Atelier Projets : ${describeProjetsSummary(summary)}`
            : `Reçu par atelier_projets (${res.status})`,
          ...(summary ? { summary } : {}),
        }
      }
      const detail = serverMessage(json)
      last = {
        ok: false,
        status: res.status,
        attempts: attempt,
        message: describeStatus(res.status) + (detail ? ` — ${detail}` : ''),
      }
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable) return last
    } catch {
      last = {
        ok: false,
        status: null,
        attempts: attempt,
        message: 'Serveur injoignable : vérifiez l’adresse et que l’application cible est lancée',
      }
    }
    if (attempt < maxAttempts) await sleep(500 * 2 ** (attempt - 1))
  }
  return last
}

function describeStatus(status: number): string {
  if (status === 401 || status === 403) return `Accès refusé (${status}) : vérifiez le jeton`
  if (status === 404) return 'Adresse introuvable (404) : vérifiez l’URL du webhook'
  if (status === 413) return 'Payload trop volumineux (413) : exportez moins de lignes'
  if (status === 422 || status === 400) return `Payload refusé par atelier_projets (${status})`
  if (status === 429) return 'Trop de requêtes (429) : réessayez dans un instant'
  return `Erreur du serveur (${status})`
}
