/**
 * Route de santé de l'app de bureau (docs/SUITE.md §3).
 *
 * Atelier Tab n'a pas d'API de données : le processus principal écoute seulement sur
 * `127.0.0.1:4175` (jamais une autre interface réseau) pour que les autres apps de la suite
 * sachent qu'il est « en marche ». Deux routes, aucune donnée :
 *
 * - `GET /api/health` → `{"status":"ok","app":"atelier-tab"}` ;
 * - `GET /` → page minimale « Atelier Tab est ouvert », qui ramène la fenêtre au premier plan.
 *
 * Tout le reste → 404. Port pris : journalisé, l'app fonctionne sans indicateur.
 * Module sans Electron : testé avec `node:http`.
 */
import http from 'node:http'

/** Seule interface d'écoute admise (contrat §3). */
export const HEALTH_HOST = '127.0.0.1'
/** Port de l'interface « aperçu / app » d'Atelier Tab (contrat §2). */
export const HEALTH_PORT = 4175

export const HEALTH_BODY = { status: 'ok', app: 'atelier-tab' } as const

/** Noms d'hôte admis dans l'en-tête Host (parade contre le DNS rebinding). */
const ALLOWED_HOSTNAMES = new Set(['127.0.0.1', 'localhost'])

export interface HealthHandlerOptions {
  /** Ramène la fenêtre de l'app au premier plan (appelé par `GET /`). */
  onFocus?: () => void
}

/** Nom d'hôte de l'en-tête Host, sans le port. */
function hostnameOf(host: string | undefined): string | null {
  if (!host) return null
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return null
  }
}

/**
 * Seule une navigation de premier niveau (onglet ouvert par l'utilisateur) ramène la
 * fenêtre : une image ou un `fetch` posés par une page web n'ont pas cet effet. Sans
 * en-tête `Sec-Fetch-Dest` (curl, ancien navigateur), la navigation est admise.
 */
function isTopLevelNavigation(req: http.IncomingMessage): boolean {
  const dest = req.headers['sec-fetch-dest']
  return dest === undefined || dest === 'document'
}

export const OPEN_PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atelier Tab</title>
<style>
  /* Page autonome (aucune ressource chargée) : valeurs recopiées du design system
     (src/styles/atelier-ds/light.css, dark.css) et de la marque (atelier-brand.css). */
  :root { color-scheme: light dark; --bg-main: #F8FAFC; --bg-surface: #FFFFFF; --text-primary: #0F172A;
    --text-muted: #64748B; --border-color: #E2E8F0; --tile-from: #38bdf8; --tile-to: #0369a1; }
  @media (prefers-color-scheme: dark) {
    :root { --bg-main: #0B0F19; --bg-surface: #111827; --text-primary: #F8FAFC; --text-muted: #94A3B8;
      --border-color: #1E293B; }
  }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg-main);
    color: var(--text-primary); font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 32px 40px;
    border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-surface); }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 20px; }
  .tile { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px;
    background: linear-gradient(135deg, var(--tile-from), var(--tile-to)); color: #fff; }
  .prefix { color: var(--text-muted); }
  strong { font-weight: 700; }
  p { margin: 0; color: var(--text-muted); }
</style>
</head>
<body>
<main>
  <div class="brand" aria-label="Atelier Tab">
    <span class="tile" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/></svg></span>
    <span><span class="prefix">atelier_</span><strong>Tab</strong></span>
  </div>
  <h1 style="margin:0;font-size:17px">Atelier Tab est ouvert</h1>
  <p>La fenêtre de l’application vient d’être ramenée au premier plan.</p>
</main>
</body>
</html>
`

/** Gestionnaire HTTP des deux routes (pur : aucune donnée de l'app n'est accessible). */
export function createHealthHandler(options: HealthHandlerOptions = {}): http.RequestListener {
  return (req, res) => {
    const common = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    }
    const notFound = () => {
      res.writeHead(404, { ...common, 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Introuvable')
    }
    const hostname = hostnameOf(req.headers.host)
    if (!hostname || !ALLOWED_HOSTNAMES.has(hostname) || req.method !== 'GET') return notFound()
    const pathname = (req.url ?? '').split('?')[0]
    if (pathname === '/api/health') {
      res.writeHead(200, { ...common, 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(HEALTH_BODY))
      return
    }
    if (pathname === '/') {
      if (isTopLevelNavigation(req)) options.onFocus?.()
      res.writeHead(200, {
        ...common,
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      })
      res.end(OPEN_PAGE)
      return
    }
    notFound()
  }
}

export interface StartHealthServerOptions extends HealthHandlerOptions {
  /** Port d'écoute (4175 ; 0 dans les tests). L'interface est toujours 127.0.0.1. */
  port?: number
  log?: (message: string) => void
}

/**
 * Démarre le serveur sur `127.0.0.1` uniquement. Ne lève jamais : si le port est pris
 * (autre instance, `npm run preview`…), l'erreur est journalisée et la promesse rend null.
 */
export function startHealthServer(
  options: StartHealthServerOptions = {},
): Promise<http.Server | null> {
  const port = options.port ?? HEALTH_PORT
  const log = options.log ?? ((m: string) => console.warn(m))
  const server = http.createServer(createHealthHandler(options))
  return new Promise((resolve) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      log(
        error.code === 'EADDRINUSE'
          ? `Route de santé indisponible : ${HEALTH_HOST}:${port} est déjà utilisé (l'app fonctionne sans indicateur « en marche »).`
          : `Route de santé indisponible : ${error.message}`,
      )
      resolve(null)
    })
    server.listen(port, HEALTH_HOST, () => {
      server.removeAllListeners('error')
      server.on('error', (error) => log(`Route de santé : ${error.message}`))
      resolve(server)
    })
  })
}

/**
 * Greffon Vite : même réponse `GET /api/health` en `npm run dev` (5175) et
 * `npm run preview` (4175). Le reste est servi normalement par Vite.
 */
export function healthPlugin(): {
  name: string
  configureServer(server: { middlewares: { use: (fn: HealthMiddleware) => void } }): void
  configurePreviewServer(server: { middlewares: { use: (fn: HealthMiddleware) => void } }): void
} {
  return {
    name: 'atelier-health',
    // Corps en bloc : un crochet qui renvoie une fonction serait rappelé par Vite après coup.
    configureServer(server) {
      server.middlewares.use(healthMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(healthMiddleware)
    },
  }
}

export type HealthMiddleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void,
) => void

/** Répond à `GET /api/health`, passe la main pour toute autre requête. */
export const healthMiddleware: HealthMiddleware = (req, res, next) => {
  const pathname = (req.url ?? '').split('?')[0]
  if (req.method !== 'GET' || pathname !== '/api/health') return next()
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(HEALTH_BODY))
}
