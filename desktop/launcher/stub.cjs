// @ts-check
/**
 * Point d'entrée d'Atelier_Tab.app (seul fichier de code dans `app.asar`, docs/SUITE.md §8).
 *
 * L'app installée ne contient pas le code d'Atelier Tab : elle lit le chemin du dépôt dans
 * `Contents/Resources/atelier-repo` (écrit par `npm run app:build`) et passe la main au lanceur du
 * dépôt (`desktop/launcher/main.cjs`), qui met à jour la compilation si besoin puis charge
 * `dist-desktop/main.cjs`. Après un `git pull`, il suffit de relancer l'app.
 *
 * Volontairement minimal et stable : le modifier impose de relancer `npm run app:install`.
 */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

/** @returns {string} */
function readRepo() {
  try {
    return fs.readFileSync(path.join(process.resourcesPath, 'atelier-repo'), 'utf8').trim()
  } catch {
    return ''
  }
}

const repo = readRepo()
const valid = repo !== '' && path.isAbsolute(repo)
const launcher = path.join(repo, 'desktop', 'launcher', 'main.cjs')
const compiled = path.join(repo, 'dist-desktop', 'main.cjs')

if (valid && fs.existsSync(launcher)) {
  require(launcher).start({ repo })
} else if (valid && fs.existsSync(compiled)) {
  // Dépôt revenu à une version sans lanceur : sa compilation est ouverte telle quelle.
  require(compiled)
} else {
  const { app, dialog } = require('electron')
  void app.whenReady().then(() => {
    dialog.showErrorBox(
      'Atelier Tab',
      `Dépôt d’Atelier Tab introuvable :\n${repo || '(chemin absent)'}\n\n` +
        'Depuis le dépôt (déplacé ?), relancez : npm run app:install',
    )
    app.quit()
  })
}
