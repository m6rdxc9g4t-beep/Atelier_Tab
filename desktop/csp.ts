/**
 * Politique de contenu de l'interface de l'app de bureau (docs/SUITE.md §5.4). Module pur.
 *
 * - `connect-src` : l'app elle-même et cette machine seulement (`http://127.0.0.1:*`,
 *   `http://localhost:*` : santé des autres apps de la suite). Un envoi vers l'extérieur ne
 *   peut donc pas partir de la page : il passe par le processus principal (`webhook:post`),
 *   qui applique le mode hors ligne et la règle du jeton.
 * - Scripts : ceux de l'app, plus les scripts en ligne de `index.html` autorisés par leur
 *   empreinte SHA-256 (thème appliqué avant le premier rendu) ; aucun `eval`.
 * - Images, polices : l'app et `data:` / `blob:` ; aucun cadre, aucun objet, aucun formulaire.
 */
import { createHash } from 'node:crypto'

export const CSP_HEADER = 'Content-Security-Policy'

/** Origines admises pour `fetch` / XHR / WebSocket depuis l'interface. */
export const CONNECT_SRC = ["'self'", 'http://127.0.0.1:*', 'http://localhost:*'] as const

/** Empreintes `'sha256-…'` des scripts en ligne (sans `src`) d'une page HTML. */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = match[1] ?? ''
    const body = match[2] ?? ''
    if (/\bsrc\s*=/i.test(attributes) || !body) continue
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
  }
  return [...new Set(hashes)]
}

/** En-tête `Content-Security-Policy` d'une page de l'interface. */
export function rendererCsp(html: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes(html).join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${CONNECT_SRC.join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')
}
