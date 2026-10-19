/**
 * Atelier Projets comme cible du webhook (docs/SUITE.md §4.1) : préréglage d'adresse,
 * paramètres de requête et lecture du résumé d'import renvoyé. Module pur.
 */

/** Préréglage « Atelier Projets (local) ». */
export const PROJETS_LOCAL_IMPORT_URL = 'http://127.0.0.1:3000/api/imports/atelier-tab'
export const PROJETS_PRESET_LABEL = 'Atelier Projets (local)'

export interface WebhookPreset {
  id: 'atelier-projets-local'
  label: string
  url: string
}

export const WEBHOOK_PRESETS: readonly WebhookPreset[] = [
  { id: 'atelier-projets-local', label: PROJETS_PRESET_LABEL, url: PROJETS_LOCAL_IMPORT_URL },
]

/** Vrai si l'adresse vise la route d'import d'Atelier Projets (locale ou non). */
export function isProjetsImportUrl(url: string): boolean {
  try {
    return /\/api\/imports\/atelier-tab\/?$/.test(new URL(url).pathname)
  } catch {
    return false
  }
}

/**
 * Ajoute le projet cible (`projectId`) à l'adresse d'import d'Atelier Projets. Sans projet,
 * Projets range les éléments dans le projet qui porte le nom du projet Atelier Tab.
 */
export function withProjetsParams(url: string, params: { projectId?: string }): string {
  const projectId = params.projectId?.trim()
  if (!projectId || !isProjetsImportUrl(url)) return url
  const u = new URL(url)
  u.searchParams.set('projectId', projectId)
  return u.toString()
}

/** Résumé renvoyé par `POST /api/imports/atelier-tab`. */
export interface ProjetsImportSummary {
  projectId: number | string | null
  created: number
  updated: number
  unchanged: number
  skipped: number
  warnings: string[]
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Lit le résumé d'import dans une réponse JSON ; null si ce n'est pas une réponse d'Atelier Projets. */
export function parseProjetsSummary(body: unknown): ProjetsImportSummary | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.created !== 'number' || typeof b.updated !== 'number') return null
  const projectId = b.projectId
  return {
    projectId: typeof projectId === 'number' || typeof projectId === 'string' ? projectId : null,
    created: count(b.created),
    updated: count(b.updated),
    unchanged: count(b.unchanged),
    skipped: count(b.skipped),
    warnings: Array.isArray(b.warnings)
      ? b.warnings.filter((w): w is string => typeof w === 'string')
      : [],
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/** « 3 créés, 1 mis à jour, 1 ignoré » (les compteurs nuls sont omis, sauf s'ils le sont tous). */
export function describeProjetsSummary(s: ProjetsImportSummary): string {
  const parts = [
    s.created ? plural(s.created, 'créé', 'créés') : '',
    s.updated ? plural(s.updated, 'mis à jour', 'mis à jour') : '',
    s.unchanged ? plural(s.unchanged, 'inchangé', 'inchangés') : '',
    s.skipped ? plural(s.skipped, 'ignoré', 'ignorés') : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'aucun élément importé'
}
