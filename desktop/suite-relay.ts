/**
 * Relais `webhook:post` : envois webhook de l'interface, faits par le processus principal
 * (docs/SUITE.md §4.1, §5.4). Module pur.
 *
 * - La requête part **sans en-tête `Origin`** : Atelier Projets la traite comme un appel local.
 *   Elle ne dépend jamais de l'origine `null`, refusée par Projets : un en-tête `Origin` (ou tout
 *   autre en-tête hors contrat) fourni par l'interface est ignoré.
 * - Adresses : https, ou http vers cette machine (127.0.0.1 / localhost), sans identifiants.
 * - **Hors ligne** (préférences du processus principal, hors de portée des IA), seules les
 *   adresses de cette machine sont admises, quel que soit le chemin suivi par l'interface.
 * - Le jeton (`Authorization`) n'est transmis qu'à la route d'import d'Atelier Projets locale.
 * - Le processus principal envoie avec `redirect: 'error'` : jamais de redirection suivie.
 */
import { tokenAllowedFor, webhookBlockReason } from '@/dataflow'

/** Seuls en-têtes transmis (contrat §4.1). */
export const RELAY_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'X-Atelier-Schema-Version',
] as const

/** Corps maximal relayé (un export de table reste bien en deçà). */
export const RELAY_MAX_BODY = 20 * 1024 * 1024

export interface RelayRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export type RelayDecision = { ok: true; request: RelayRequest } | { ok: false; error: string }

/** Requête à envoyer, ou la raison du refus (adresse, mode hors ligne, corps). */
export function buildRelayRequest(req: unknown, policy: { online: boolean }): RelayDecision {
  if (typeof req !== 'object' || req === null) return { ok: false, error: 'Requête invalide' }
  const { url, headers, body } = req as { url?: unknown; headers?: unknown; body?: unknown }
  if (typeof url !== 'string' || url.length > 2048) return { ok: false, error: 'Adresse invalide' }
  if (typeof body !== 'string' || body.length > RELAY_MAX_BODY)
    return { ok: false, error: 'Corps de la requête invalide' }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'Adresse invalide' }
  }
  if (parsed.username || parsed.password)
    return { ok: false, error: 'Adresse refusée : identifiants dans l’adresse' }
  const blocked = webhookBlockReason(url, policy.online)
  if (blocked) return { ok: false, error: blocked }
  const given = typeof headers === 'object' && headers !== null ? headers : {}
  const out: Record<string, string> = {}
  for (const name of RELAY_HEADERS) {
    const value = (given as Record<string, unknown>)[name]
    if (typeof value !== 'string') continue
    if (name === 'Authorization' && !tokenAllowedFor(url)) continue
    out[name] = value
  }
  return { ok: true, request: { url, headers: out, body } }
}
