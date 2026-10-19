/**
 * Relais `suite:post` vers Atelier Projets local (docs/SUITE.md §4.1). Module pur.
 *
 * La requête part du processus principal **sans en-tête `Origin`** : Projets la traite comme
 * un appel local. Elle ne dépend jamais de l'origine `null`, refusée par Projets : un en-tête
 * `Origin` (ou tout autre en-tête hors contrat) fourni par l'interface est ignoré.
 */
import { isLocalProjetsImportUrl } from '@/lib/local-url'

/** Seuls en-têtes transmis (contrat §4.1). */
export const RELAY_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
  'X-Atelier-Schema-Version',
] as const

export interface RelayRequest {
  url: string
  headers: Record<string, string>
  body: string
}

/** Requête à envoyer, ou null si l'adresse ou le corps sont refusés. */
export function buildRelayRequest(req: unknown): RelayRequest | null {
  if (typeof req !== 'object' || req === null) return null
  const { url, headers, body } = req as { url?: unknown; headers?: unknown; body?: unknown }
  if (!isLocalProjetsImportUrl(url) || typeof body !== 'string') return null
  const given = typeof headers === 'object' && headers !== null ? headers : {}
  const out: Record<string, string> = {}
  for (const name of RELAY_HEADERS) {
    const value = (given as Record<string, unknown>)[name]
    if (typeof value === 'string') out[name] = value
  }
  return { url, headers: out, body }
}
