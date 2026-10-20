/**
 * Cache de l'interface dans l'app de bureau.
 *
 * Le protocole `app://atelier` est déclaré « standard » : Chromium peut garder en cache disque
 * `index.html` et ses scripts. Après une mise à jour, la fenêtre réaffichait alors l'ancienne
 * interface. Trois parades :
 * - `index.html` (et tout ce qui n'est pas un fichier haché) est servi en `no-cache, no-store` ;
 * - les fichiers hachés de `assets/` gardent un cache long (leur nom change à chaque build) ;
 * - au démarrage, si l'interface a changé depuis le dernier lancement (empreinte d'`index.html`),
 *   le cache HTTP et le cache de code sont vidés avant d'ouvrir la fenêtre, dont l'adresse
 *   porte en plus cette empreinte.
 *
 * Module pur (hors lecture / écriture du fichier d'empreinte), testé dans `__tests__/ui-cache.test.ts`.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Fichier, dans le dossier de l'app (`userData`), qui retient l'empreinte de la dernière interface ouverte. */
export const UI_STAMP_FILE = 'ui-build.txt'

/** Empreinte courte d'une interface compilée, à partir du contenu de son `index.html`. */
export function uiBuildStamp(indexHtml: string): string {
  return createHash('sha256').update(indexHtml).digest('hex').slice(0, 16)
}

/** Fichier haché par Vite (`assets/nom-AbC123xy.js`) : son contenu ne change jamais sous ce nom. */
export function isHashedAsset(relative: string): boolean {
  return /^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(relative.replace(/\\/g, '/'))
}

/** En-tête `Cache-Control` à servir pour un chemin relatif de `dist/`. */
export function cacheControlFor(relative: string): string {
  return isHashedAsset(relative)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache, no-store, must-revalidate'
}

/**
 * Compare l'empreinte de l'interface à celle du dernier lancement et retient la nouvelle.
 * Renvoie `true` si l'interface a changé (ou au premier lancement) : il faut vider les caches.
 */
export function uiChangedSinceLastLaunch(userDataDir: string, stamp: string): boolean {
  const file = path.join(userDataDir, UI_STAMP_FILE)
  let previous: string | null
  try {
    previous = fs.readFileSync(file, 'utf8').trim()
  } catch {
    previous = null
  }
  if (previous === stamp) return false
  try {
    fs.mkdirSync(userDataDir, { recursive: true })
    fs.writeFileSync(file, `${stamp}\n`, 'utf8')
  } catch {
    /* sans fichier d'empreinte, les caches seront simplement revidés au prochain lancement */
  }
  return true
}
