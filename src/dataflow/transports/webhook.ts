/**
 * Envoi du payload vers l'API d'`atelier_projets` (POST JSON).
 * - En-tête `Idempotency-Key` : un renvoi après coupure ne crée pas de doublon côté cible.
 * - Nouvelles tentatives (3 au total, délai exponentiel) sur erreur réseau, 429 et 5xx.
 * - `fetch` et l'attente sont injectables pour les tests.
 */
import type { AtelierPayload } from '../schema/atelier.v2_1'

export interface WebhookConfig {
  url: string
  token?: string
}

export interface WebhookResult {
  ok: boolean
  status: number | null
  attempts: number
  message: string
}

export interface WebhookDeps {
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  idempotencyKey?: string
  maxAttempts?: number
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

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

  const doFetch = deps.fetch ?? fetch
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
      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          attempts: attempt,
          message: `Reçu par atelier_projets (${res.status})`,
        }
      }
      last = {
        ok: false,
        status: res.status,
        attempts: attempt,
        message: describeStatus(res.status),
      }
      const retryable = res.status === 429 || res.status >= 500
      if (!retryable) return last
    } catch {
      last = {
        ok: false,
        status: null,
        attempts: attempt,
        message: 'Serveur injoignable : vérifiez l’adresse et votre connexion',
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
