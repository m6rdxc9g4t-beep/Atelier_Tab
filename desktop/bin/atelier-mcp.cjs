// @ts-check
/**
 * Serveur MCP d'Atelier_Tab livré dans l'app Windows (`resources\atelier-mcp.cjs`, ADR 0005).
 *
 * Exécuté par le Node.js d'Electron (`Atelier_Tab.exe` avec `ELECTRON_RUN_AS_NODE=1`, lancé par
 * `atelier-mcp.cmd` ou directement par Claude Code) : lit le chemin du dépôt dans `atelier-repo`
 * (à côté) et charge `dist-desktop/atelier-mcp.mjs` **du dépôt**, compilé par la mise à jour
 * automatique au lancement de l'app. Ne déclenche jamais de mise à jour. Équivalent Windows du
 * script `atelier-mcp` de macOS et Linux (lire le fichier ici évite les pièges d'encodage de cmd.exe
 * avec les chemins accentués).
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

/** @param {string} message */
function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

let repo = ''
try {
  repo = fs.readFileSync(path.join(__dirname, 'atelier-repo'), 'utf8').trim()
} catch {
  /* absent */
}
if (!repo) {
  fail(
    `Atelier_Tab : chemin du dépôt absent de l'application (${path.join(__dirname, 'atelier-repo')}).\n` +
      'Depuis le dépôt, relancez : npm run app:install',
  )
}

const server = path.join(repo, 'dist-desktop', 'atelier-mcp.mjs')
// Remplacement de la compilation en cours (renommage) : un court délai de grâce.
if (!fs.existsSync(server)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000)
if (!fs.existsSync(server)) {
  fail(
    `Atelier_Tab : le serveur MCP n'est pas compilé (${server}).\n` +
      `Ouvrez Atelier_Tab une fois (mise à jour automatique), ou lancez « npm run app:update » dans le dépôt ${repo}.`,
  )
}

import(pathToFileURL(server).href).catch((/** @type {unknown} */ error) =>
  fail(`Atelier_Tab : démarrage du serveur MCP impossible : ${String(error)}`),
)
