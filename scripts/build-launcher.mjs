/**
 * Prépare la construction du lanceur Atelier_Tab.app (`npm run app:build`, ADR 0005).
 *
 * L'app installée ne contient pas le code d'Atelier Tab : elle lit au lancement, dans
 * `Contents/Resources/atelier-repo`, le chemin de ce dépôt, puis exécute le code du dépôt
 * (`desktop/launcher/stub.cjs` → `desktop/launcher/main.cjs` → `dist-desktop/main.cjs`). Le serveur
 * MCP livré dans l'app (`Contents/Resources/atelier-mcp`) s'en sert aussi pour lancer
 * `dist-desktop/atelier-mcp.mjs`. Ce script écrit ce chemin dans `dist-launcher/atelier-repo`,
 * qu'electron-builder copie dans l'app (`extraResources` de package.json).
 *
 * Le lanceur ne se reconstruit qu'une fois, ou si le dépôt change de place.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = realpathSync(path.resolve(import.meta.dirname, '..'))
if (/[\r\n]/.test(root)) {
  console.error(`Chemin du dépôt inutilisable (retour à la ligne) : ${JSON.stringify(root)}`)
  process.exit(1)
}

const out = path.join(root, 'dist-launcher')
mkdirSync(out, { recursive: true })
writeFileSync(path.join(out, 'atelier-repo'), `${root}\n`, 'utf8')
console.log(`✓ Lanceur : l'app exécutera le dépôt ${root}`)
