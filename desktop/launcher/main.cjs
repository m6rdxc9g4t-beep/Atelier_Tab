// @ts-check
/**
 * Lanceur de l'app installée (docs/SUITE.md §8, ADR 0005).
 *
 * `Atelier_Tab.app` ne contient que `stub.cjs`, qui connaît le chemin du dépôt et appelle `start` ici.
 * Ce module, lu dans le dépôt (donc à jour après un `git pull`), décide avant que l'app soit prête :
 *
 * - rien n'a changé depuis la dernière mise à jour réussie → `dist-desktop/main.cjs` est chargé
 *   aussitôt, exactement comme une app empaquetée (aucune compilation, aucun écran en plus) ;
 * - sinon → écran « Mise à jour… » avec l'étape en cours, `npm ci` si nécessaire, compilation, puis
 *   relance de l'app (le processus principal doit être chargé avant `ready` : protocole `app://`) ;
 * - échec → message, chemin du journal, « Ouvrir quand même avec la version précédente » si une
 *   compilation existe (relance sans mise à jour), « Réessayer », « Ouvrir le journal », « Quitter ».
 *
 * L'écran de démarrage est une page locale sans pont ni IPC (`contextIsolation`, `sandbox`) ; les
 * choix passent par une boîte de dialogue native. Les dépendances Electron sont injectées : la
 * logique est testée sous Linux (`desktop/__tests__/launcher-main.test.ts`).
 */
'use strict'

const os = require('node:os')
const path = require('node:path')
const d = require('./decision.cjs')
const u = require('./update.cjs')

const PRODUCT = 'Atelier Tab'

/** @typedef {typeof import('./update.cjs')} UpdateModule */
/** @typedef {import('electron').BrowserWindow} BrowserWindow */

/**
 * État affiché par l'écran de démarrage (`splash.html`, `window.atelierSplash`).
 * @typedef {object} SplashState
 * @property {'progress' | 'wait' | 'done' | 'error'} phase
 * @property {string} title
 * @property {string} [step]
 * @property {string} [detail]
 * @property {string} [hint]
 * @property {string} [log]
 * @property {string} [tail]
 */

/**
 * @typedef {object} LauncherDeps
 * @property {Pick<typeof import('electron'), 'app' | 'BrowserWindow' | 'dialog' | 'shell' | 'nativeTheme' | 'Menu'>} electron
 * @property {string} repo
 * @property {string[]} [argv]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [home]
 * @property {string} [platform]
 * @property {string | undefined} [electronVersion]
 * @property {(file: string) => unknown} [requireMain]
 * @property {UpdateModule} [updater]
 */

/**
 * @param {LauncherDeps} deps
 */
function createLauncher(deps) {
  const { electron, repo } = deps
  const { app, dialog, shell } = electron
  const argv = deps.argv ?? process.argv
  const env = deps.env ?? process.env
  const home = deps.home ?? os.homedir()
  const platform = deps.platform ?? process.platform
  const updater = deps.updater ?? u
  const requireMain = deps.requireMain ?? ((file) => require(file))
  const electronVersion =
    'electronVersion' in deps ? deps.electronVersion : process.versions.electron
  const logFile = d.logFilePath({ platform, home, env })
  const log = updater.openLog(logFile)
  const mainEntry = path.join(repo, 'dist-desktop', 'main.cjs')

  /** @type {BrowserWindow | null} */
  let win = null
  let quitting = false
  /** @type {Set<import('node:child_process').ChildProcess>} */
  const children = new Set()

  function stopChildren() {
    for (const child of children) updater.stopCommand(child)
    children.clear()
  }

  /** @param {string} [flag] */
  function relaunch(flag) {
    app.relaunch({ args: d.relaunchArgs(argv, flag) })
    app.exit(0)
  }

  /** Charge le processus principal compilé (`dist-desktop/main.cjs`). */
  function openMain() {
    try {
      requireMain(mainEntry)
      return 'main'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.write(`ÉCHEC du démarrage : ${message}`)
      void app.whenReady().then(async () => {
        const { response } = await dialog.showMessageBox({
          type: 'error',
          title: PRODUCT,
          message: `${PRODUCT} n’a pas pu démarrer`,
          detail: `${message}\n\nJournal : ${logFile}`,
          buttons: ['Recompiler', 'Quitter'],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        })
        if (response === 0) {
          updater.invalidateStamp(repo)
          relaunch()
        } else {
          app.quit()
        }
      })
      return 'error'
    }
  }

  /** @param {SplashState} state */
  function setSplash(state) {
    const target = win
    if (!target || target.isDestroyed()) return
    target.webContents
      .executeJavaScript(`window.atelierSplash && window.atelierSplash(${JSON.stringify(state)})`)
      .catch(() => undefined)
  }

  function createSplash() {
    const dark = electron.nativeTheme.shouldUseDarkColors
    const splash = new electron.BrowserWindow({
      width: 560,
      height: 400,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      title: PRODUCT,
      show: false,
      autoHideMenuBar: true,
      // Même fond que la fenêtre principale (--atelier-bg, vert de Tab).
      backgroundColor: dark ? '#0A0E0F' : '#F2F7F5',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    })
    splash.once('ready-to-show', () => splash.show())
    splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    splash.webContents.on('will-navigate', (event) => event.preventDefault())
    splash.on('closed', () => {
      if (win === splash) win = null
    })
    win = splash
    return splash
  }

  /** Menu réduit pendant la mise à jour : quitter, copier le message d'erreur. */
  function buildUpdateMenu() {
    const { Menu } = electron
    if (!Menu) return
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: PRODUCT,
          submenu: [{ role: 'quit', label: `Quitter ${PRODUCT}` }],
        },
        {
          label: 'Édition',
          submenu: [
            { role: 'copy', label: 'Copier' },
            { role: 'selectAll', label: 'Tout sélectionner' },
          ],
        },
      ]),
    )
  }

  /** @param {string[]} reasons */
  function hintFor(reasons) {
    return `Le dépôt a changé (${reasons.join(', ')}). Cela peut prendre une minute ; vos données ne sont pas touchées.`
  }

  /** @param {string[]} reasons */
  async function runUpdate(reasons) {
    let currentReasons = reasons
    try {
      const result = await updater.update(repo, {
        by: 'app',
        log,
        env,
        home,
        onPlan: (r) => {
          currentReasons = r
        },
        onWait: () =>
          setSplash({
            phase: 'wait',
            title: 'Mise à jour…',
            detail:
              'Une autre mise à jour d’Atelier Tab est en cours (autre fenêtre ou terminal) : attente de sa fin.',
          }),
        onStatus: (label, index, total) =>
          setSplash({
            phase: 'progress',
            title: 'Mise à jour…',
            step: `Étape ${index} sur ${total}`,
            detail: label,
            hint: hintFor(currentReasons),
          }),
        onChild: (child) => {
          children.add(child)
          child.once('exit', () => children.delete(child))
        },
      })
      if (quitting) return
      const drift = d.electronDrift(electronVersion, updater.repoElectronVersion(repo))
      if (drift) log.write(drift)
      setSplash({
        phase: 'done',
        title: result.steps.length > 0 ? 'Mise à jour terminée' : 'Déjà à jour',
        detail: 'Ouverture d’Atelier Tab…',
        ...(drift ? { hint: drift } : {}),
      })
      if (drift) await new Promise((resolve) => setTimeout(resolve, 4000))
      relaunch(d.FLAG_AFTER_UPDATE)
    } catch (error) {
      if (quitting) return
      await showFailure(error)
    }
  }

  /** @param {unknown} error */
  async function showFailure(error) {
    const message = error instanceof Error ? error.message : String(error)
    const tail =
      error && typeof error === 'object' && 'tail' in error ? String(error.tail ?? '') : ''
    const previous = updater.isBuilt(repo)
    setSplash({
      phase: 'error',
      title: 'La mise à jour a échoué',
      detail: message,
      hint: previous
        ? 'La version précédente reste utilisable. Le prochain lancement réessaiera.'
        : 'Aucune version compilée n’est disponible. Le prochain lancement réessaiera.',
      log: logFile,
      tail,
    })
    const OPEN_PREVIOUS = 'Ouvrir quand même avec la version précédente'
    const RETRY = 'Réessayer'
    const OPEN_LOG = 'Ouvrir le journal'
    const QUIT = 'Quitter'
    const buttons = previous ? [OPEN_PREVIOUS, RETRY, OPEN_LOG, QUIT] : [RETRY, OPEN_LOG, QUIT]
    /** @type {import('electron').MessageBoxOptions} */
    const options = {
      type: 'error',
      title: PRODUCT,
      message: 'La mise à jour d’Atelier Tab a échoué',
      detail: `${message}\n\nJournal : ${logFile}`,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    }
    const { response } =
      win && !win.isDestroyed()
        ? await dialog.showMessageBox(win, options)
        : await dialog.showMessageBox(options)
    const choice = buttons[response]
    if (choice === OPEN_PREVIOUS) {
      log.write('Ouverture avec la version précédente, à la demande de l’utilisateur.')
      relaunch(d.FLAG_SKIP_UPDATE)
    } else if (choice === RETRY) {
      log.write('Nouvel essai.')
      await runUpdate([])
    } else if (choice === OPEN_LOG) {
      await shell.openPath(logFile)
      await showFailure(error)
    } else {
      app.quit()
    }
  }

  /** @param {string[]} reasons */
  function enterUpdateMode(reasons) {
    app.on('second-instance', () => {
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.focus()
    })
    // Fermer l'écran de démarrage arrête la mise à jour : la compilation précédente reste en place.
    app.on('window-all-closed', () => {
      quitting = true
      stopChildren()
      app.quit()
    })
    app.on('will-quit', () => {
      quitting = true
      stopChildren()
    })
    void app.whenReady().then(async () => {
      buildUpdateMenu()
      const splash = createSplash()
      await splash.loadFile(path.join(__dirname, 'splash.html')).catch(() => undefined)
      setSplash({
        phase: 'progress',
        title: 'Mise à jour…',
        detail: 'Préparation…',
        hint: hintFor(reasons),
      })
      await runUpdate(reasons)
    })
  }

  /**
   * Mise à jour seule, sans fenêtre (`--atelier-mise-a-jour-seule`, CI Windows, docs/SUITE.md §9.5) :
   * même mise à jour, même verrou et même journal, puis arrêt avec le code 0 (à jour) ou 1 (échec).
   * Le verrou d'instance n'est pas pris : la fenêtre de l'app peut rester ouverte.
   */
  async function runUpdateOnly() {
    log.write('Mise à jour seule (sans fenêtre).')
    try {
      const result = await updater.update(repo, { by: 'app', log, env, home })
      log.write(
        result.steps.length > 0
          ? `Mise à jour seule : terminée (${result.steps.join(' + ')}).`
          : 'Mise à jour seule : rien à refaire.',
      )
      app.exit(0)
    } catch (error) {
      log.write(
        `Mise à jour seule : échec — ${error instanceof Error ? error.message : String(error)}`,
      )
      app.exit(1)
    }
  }

  /**
   * Décide et lance. Synchrone jusqu'au choix : sans mise à jour, `main.cjs` est chargé avant `ready`.
   * @returns {'second-instance' | 'main' | 'update' | 'update-only' | 'error'}
   */
  function start() {
    const flags = d.parseFlags(argv)
    if (flags.updateOnly) {
      void runUpdateOnly()
      return 'update-only'
    }
    if (!app.requestSingleInstanceLock()) {
      // Une fenêtre est déjà ouverte (ou une mise à jour en cours) : elle est ramenée au premier plan.
      app.quit()
      return 'second-instance'
    }
    const version = updater.repoVersion(repo)
    if (version && typeof app.setAboutPanelOptions === 'function') {
      app.setAboutPanelOptions({
        applicationName: PRODUCT,
        applicationVersion: version,
        version: '',
      })
    }
    if (flags.skipUpdate && updater.isBuilt(repo)) {
      log.write('Ouverture avec la version précédente (sans mise à jour).')
      return openMain()
    }
    /** @type {{ steps: string[], reasons: string[] }} */
    let plan
    try {
      plan = updater.planUpdate(repo, { git: updater.findGit({ repo, env, home }) })
    } catch (error) {
      plan = {
        steps: ['build'],
        reasons: [
          `état du dépôt illisible (${error instanceof Error ? error.message : String(error)})`,
        ],
      }
    }
    if (plan.steps.length === 0) {
      log.write('À jour : lancement direct.')
      return openMain()
    }
    if (flags.afterUpdate && updater.isBuilt(repo)) {
      // Pas de seconde mise à jour d'affilée (dépôt modifié pendant la compilation) : au prochain lancement.
      log.write(
        `Le dépôt a encore changé (${plan.reasons.join(', ')}) : pris en compte au prochain lancement.`,
      )
      return openMain()
    }
    log.write(`Mise à jour nécessaire : ${plan.reasons.join(', ')}.`)
    enterUpdateMode(plan.reasons)
    return 'update'
  }

  return { start, logFile }
}

/**
 * Point d'entrée appelé par `stub.cjs` (dans l'app installée).
 * @param {{ repo: string }} options
 */
function start({ repo }) {
  forgetInheritedEnv(process.env)
  const electron = require('electron')
  return createLauncher({ electron, repo }).start()
}

/**
 * Oublie les variables héritées qui casseraient la relance ou la mise à jour de l'app
 * (`IGNORED_INHERITED_ENV`, docs/SUITE.md §9.4) : elles ne passent ni à npm, ni à l'app relancée,
 * ni aux programmes que l'app lance.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]} Variables retirées.
 */
function forgetInheritedEnv(env) {
  const removed = d.inheritedEnvToIgnore(env)
  for (const key of removed) delete env[key]
  return removed
}

module.exports = { createLauncher, forgetInheritedEnv, start }
