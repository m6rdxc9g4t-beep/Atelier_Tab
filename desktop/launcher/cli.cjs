#!/usr/bin/env node
// @ts-check
/**
 * Mise à jour de l'app de bureau depuis le terminal : `npm run app:update` (aussi appelé par
 * `npm run app:install` pour que le premier lancement soit immédiat, et par la CI macOS).
 *
 * Même logique, même verrou, même tampon et même journal que l'app (`update.cjs`) : rien n'est
 * refait si le dépôt n'a pas changé depuis la dernière mise à jour réussie.
 */
'use strict'

const os = require('node:os')
const path = require('node:path')
const d = require('./decision.cjs')
const u = require('./update.cjs')

/**
 * @param {{ repo?: string, env?: NodeJS.ProcessEnv, out?: (line: string) => void, err?: (line: string) => void }} [options]
 * @returns {Promise<number>} Code de sortie.
 */
async function main(options = {}) {
  const repo = options.repo ?? path.resolve(__dirname, '..', '..')
  const env = options.env ?? process.env
  const out = options.out ?? ((line) => console.log(line))
  const err = options.err ?? ((line) => console.error(line))
  const home = os.homedir()
  const log = u.openLog(d.logFilePath({ platform: process.platform, home, env }))
  try {
    const result = await u.update(repo, {
      by: 'terminal',
      log,
      env,
      home,
      // Le Node.js qui exécute cette commande (et le npm à côté) est le choix de l'utilisateur.
      preferDir: path.dirname(process.execPath),
      onPlan: (reasons) => out(`Mise à jour d’Atelier Tab : ${reasons.join(', ')}.`),
      onWait: () =>
        out('  … une autre mise à jour est en cours (app ouverte ?) : attente de sa fin.'),
      onStatus: (label, index, total) => out(`  → [${index}/${total}] ${label}`),
    })
    out(
      result.steps.length > 0
        ? '✓ Atelier Tab est à jour (compilé).'
        : '✓ Atelier Tab était déjà à jour.',
    )
    return 0
  } catch (error) {
    err(`✗ ${error instanceof Error ? error.message : String(error)}`)
    const tail =
      error && typeof error === 'object' && 'tail' in error ? String(error.tail ?? '') : ''
    if (tail) err(tail.replace(/^/gm, '    '))
    err(`  Journal : ${log.file}`)
    err('  La compilation précédente est conservée.')
    return 1
  }
}

if (require.main === module) {
  void main().then((code) => {
    process.exitCode = code
  })
}

module.exports = { main }
