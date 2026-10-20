/**
 * Suite Atelier (docs/SUITE.md §2 et §3) : adresses des applications du sélecteur, état
 * « en marche / arrêtée » des trois apps locales et ouverture d'une application.
 *
 * Adresses = colonne « Interface (aperçu / app) » du contrat, surchargeables par variables
 * Vite : VITE_ATELIER_VIZ_URL, VITE_ATELIER_TAB_URL, VITE_ATELIER_PROJETS_URL (interfaces),
 * VITE_ATELIER_PROJETS_API_URL (API d'Atelier Projets, pour l'indicateur) et
 * VITE_ATELIER_CUISINE_URL (Atelier Cuisine, app en ligne : jamais sondée).
 */
import { getDesktopApi } from '@/services/desktop'

export type SuiteAppId = 'viz' | 'tab' | 'projets' | 'cuisine'

export interface SuiteApp {
  id: SuiteAppId
  /** Nom accessible (« Atelier Viz »). */
  name: string
  /** Nom court affiché dans la marque « atelier_Viz » (docs/SUITE.md §1.6). */
  short: string
  description: string
  /** Adresse ouverte par le sélecteur. */
  url: string
  /**
   * Route de santé (`/api/health`), sondée pour les autres apps ; l'app courante est toujours
   * « en marche ». `null` : app en ligne sans API locale (Atelier Cuisine), jamais sondée,
   * affichée « en ligne » (§3).
   */
  healthUrl: string | null
}

/** Application courante. */
export const CURRENT_APP: SuiteAppId = 'tab'

/** Délai d'attente de la route de santé (contrat : 1,5 s). */
export const HEALTH_TIMEOUT_MS = 1500

const env = (import.meta.env ?? {}) as Record<string, string | undefined>

function urlFrom(variable: string, fallback: string): string {
  const value = env[variable]?.trim()
  return (value || fallback).replace(/\/+$/, '')
}

const VIZ_URL = urlFrom('VITE_ATELIER_VIZ_URL', 'http://127.0.0.1:8000')
const TAB_URL = urlFrom('VITE_ATELIER_TAB_URL', 'http://127.0.0.1:4175')
const PROJETS_URL = urlFrom('VITE_ATELIER_PROJETS_URL', 'http://127.0.0.1:4174')
const PROJETS_API_URL = urlFrom('VITE_ATELIER_PROJETS_API_URL', 'http://127.0.0.1:3000')
const CUISINE_URL = urlFrom('VITE_ATELIER_CUISINE_URL', 'https://atelier-cuisine-iota.vercel.app')

export const SUITE_APPS: readonly SuiteApp[] = [
  {
    id: 'viz',
    name: 'Atelier Viz',
    short: 'Viz',
    description: 'BI locale : rapports, visuels, IA',
    url: VIZ_URL,
    // L'API de Viz est servie par la même adresse que son interface (FastAPI).
    healthUrl: `${VIZ_URL}/api/health`,
  },
  {
    id: 'tab',
    name: 'Atelier Tab',
    short: 'Tab',
    description: 'Tableur et base de données typée',
    url: TAB_URL,
    // Route de santé seule : processus principal de l'app de bureau, ou greffon Vite (§3).
    healthUrl: `${TAB_URL}/api/health`,
  },
  {
    id: 'projets',
    name: 'Atelier Projets',
    short: 'Projets',
    description: 'Projets agiles, Git, temps passé',
    url: PROJETS_URL,
    healthUrl: `${PROJETS_API_URL}/api/health`,
  },
  {
    id: 'cuisine',
    name: 'Atelier Cuisine',
    short: 'Cuisine',
    description: 'Stock, repas, courses et budget du foyer',
    url: CUISINE_URL,
    // App en ligne (PWA + app Mac, données Supabase) : aucune API locale, jamais sondée.
    // La politique de contenu de Tab n'admet d'ailleurs aucune requête vers l'extérieur.
    healthUrl: null,
  },
]

export type SuiteStatus = 'up' | 'down'

/**
 * Teste une route de santé sans bloquer : délai de 1,5 s, jamais d'exception.
 *
 * Les autres applications sont sur une autre origine et n'autorisent pas forcément CORS :
 * `mode: 'no-cors'` donne une réponse opaque (statut illisible) dont la simple arrivée
 * prouve que le serveur écoute (« en marche ») ; une erreur réseau ou le délai dépassé
 * signifient « arrêtée ». Limite assumée : une API qui répond 500 paraît « en marche ».
 */
export async function checkHealth(
  healthUrl: string,
  timeoutMs = HEALTH_TIMEOUT_MS,
  doFetch: typeof fetch = fetch,
): Promise<SuiteStatus> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await doFetch(healthUrl, {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
    return response.type === 'opaque' || response.ok ? 'up' : 'down'
  } catch {
    return 'down'
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Ouvre une application de la suite : dans l'app de bureau, le processus principal ouvre
 * l'application installée (sinon le navigateur par défaut) ; dans un navigateur, nouvel onglet.
 * Une adresse que le processus principal ne reconnaît pas (adresse de Cuisine surchargée)
 * repasse par `window.open`, que l'app de bureau envoie au navigateur par défaut.
 */
export function openSuiteApp(app: SuiteApp): void {
  const desktop = getDesktopApi()
  if (desktop) {
    void desktop.openLocalApp(app.url).then(
      (opened) => {
        if (!opened) window.open(app.url, '_blank', 'noopener,noreferrer')
      },
      () => undefined,
    )
    return
  }
  window.open(app.url, '_blank', 'noopener,noreferrer')
}
