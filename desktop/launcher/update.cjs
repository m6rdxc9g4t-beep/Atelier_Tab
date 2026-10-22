// @ts-check
/**
 * Mise à jour automatique de l'app de bureau (docs/SUITE.md §8, ADR 0005) : mesures et exécution.
 *
 * - état du dépôt (commit, contenu des fichiers modifiés localement, lockfile) comparé au tampon
 *   `.mise-a-jour/tampon.json` (dossier ignoré par git) ;
 * - verrou `.mise-a-jour/verrou` : une seule mise à jour à la fois (app lancée deux fois, terminal) ;
 * - Node.js et npm cherchés comme depuis le Finder (PATH du shell de connexion, Homebrew, nvm…) ;
 * - `npm ci` si les dépendances l'exigent, puis compilation dans `.mise-a-jour/compilation/` et
 *   remplacement de `dist/` et `dist-desktop/` par renommage : la compilation précédente reste en
 *   place tant que la nouvelle n'a pas entièrement réussi ;
 * - tampon écrit seulement après une mise à jour entièrement réussie.
 *
 * Partagé par le lanceur Electron (`main.cjs`) et le terminal (`cli.cjs`, `npm run app:update`).
 * Les décisions sont dans `decision.cjs` (pur). Jamais de `git pull`, jamais d'accès aux données
 * (~/Atelier_Tab, préférences, secrets) : seuls `node_modules/`, `dist/`, `dist-desktop/` et
 * `.mise-a-jour/` du dépôt sont écrits.
 */
'use strict'

const { execFileSync, spawn } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const d = require('./decision.cjs')

/** Dossier de travail de la mise à jour, à la racine du dépôt (ignoré par git). */
const WORK_DIR = '.mise-a-jour'

/** @typedef {import('./decision.cjs').RepoState} RepoState */
/** @typedef {import('./decision.cjs').Stamp} Stamp */
/** @typedef {import('./decision.cjs').Step} Step */

/**
 * @typedef {object} Log
 * @property {string} file
 * @property {(line: string) => void} write
 */

/**
 * @typedef {object} Toolchain
 * @property {string} node    Exécutable `node` retenu (absolu).
 * @property {string} npm     Exécutable `npm` du même dossier.
 * @property {string} version `v22.12.0`.
 * @property {string} path    PATH des commandes lancées (dossier de Node en tête).
 */

/** Erreur de mise à jour : message en français pour l'utilisateur, fin du journal en `tail`. */
class UpdateError extends Error {
  /** @param {string} message @param {string} [tail] */
  constructor(message, tail = '') {
    super(message)
    this.name = 'UpdateError'
    this.tail = tail
  }
}

/** @param {string} repo */
function workPaths(repo) {
  const dir = path.join(repo, WORK_DIR)
  return {
    dir,
    stamp: path.join(dir, 'tampon.json'),
    lock: path.join(dir, 'verrou'),
    staging: path.join(dir, 'compilation'),
    previous: path.join(dir, 'precedente'),
    toolchain: path.join(dir, 'environnement.json'),
  }
}

/** @param {string | Buffer} value */
function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** @param {string} file */
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** @param {string} file */
function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// État du dépôt
// ---------------------------------------------------------------------------

/**
 * @param {string} git
 * @param {string} repo
 * @param {string[]} args
 */
function runGit(git, repo, args) {
  try {
    return execFileSync(git, ['-C', repo, '-c', 'core.fsmonitor=false', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20_000,
      maxBuffer: 64 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

/**
 * État du dépôt : commit courant, contenu des fichiers suivis modifiés (`git diff --name-only HEAD`)
 * et des fichiers nouveaux non ignorés, empreinte du lockfile.
 * @param {string} repo
 * @param {{ git?: string }} [options]
 * @returns {RepoState}
 */
function repoState(repo, { git = 'git' } = {}) {
  const head = runGit(git, repo, ['rev-parse', 'HEAD'])?.trim() || 'sans-git'
  /** @type {Set<string>} */
  const changed = new Set()
  const lists = [
    runGit(git, repo, ['diff', '--name-only', '-z', 'HEAD']),
    runGit(git, repo, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]
  for (const list of lists) {
    for (const file of (list ?? '').split('\0')) {
      if (file && !file.startsWith(`${WORK_DIR}/`)) changed.add(file)
    }
  }
  const entries = [...changed].sort().map((file) => {
    try {
      return `${file}:${hash(fs.readFileSync(path.join(repo, file)))}`
    } catch {
      return `${file}:supprimé`
    }
  })
  const local = entries.length > 0 ? hash(entries.join('\n')) : ''
  let lock = 'absent'
  try {
    lock = hash(fs.readFileSync(path.join(repo, 'package-lock.json')))
  } catch {
    /* pas de lockfile */
  }
  return { head, local, code: hash(`${head}\n${local}`), lock }
}

/** @param {string} repo */
function readStamp(repo) {
  return d.parseStamp(readText(workPaths(repo).stamp))
}

/** Oublie la dernière mise à jour réussie : le prochain lancement recompilera. @param {string} repo */
function invalidateStamp(repo) {
  fs.rmSync(workPaths(repo).stamp, { force: true })
}

/** Compilation complète présente (interface, processus principal, serveur MCP). @param {string} repo */
function isBuilt(repo) {
  return d.BUILD_OUTPUTS.every((file) => fs.existsSync(path.join(repo, file)))
}

/** Dépendances installées par npm (lockfile caché écrit en fin d'installation). @param {string} repo */
function depsInstalled(repo) {
  return fs.existsSync(path.join(repo, 'node_modules', '.package-lock.json'))
}

/**
 * Ce qu'il faut refaire maintenant (synchrone et rapide : appelé à chaque lancement).
 * @param {string} repo
 * @param {{ git?: string }} [options]
 */
function planUpdate(repo, options = {}) {
  const state = repoState(repo, options)
  const stamp = readStamp(repo)
  const built = isBuilt(repo)
  return {
    state,
    stamp,
    built,
    ...d.decide({ state, stamp, depsInstalled: depsInstalled(repo), built }),
  }
}

/** Version d'Electron installée dans le dépôt. @param {string} repo */
function repoElectronVersion(repo) {
  const text = readText(path.join(repo, 'node_modules', 'electron', 'package.json'))
  try {
    const version = text ? JSON.parse(text).version : null
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

/** Version de l'app dans le dépôt (`package.json`). @param {string} repo */
function repoVersion(repo) {
  try {
    const version = JSON.parse(readText(path.join(repo, 'package.json')) ?? '').version
    return typeof version === 'string' ? version : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Verrou
// ---------------------------------------------------------------------------

/** @param {number} pid */
function processAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM'
  }
}

/**
 * Tente de prendre le verrou (création exclusive). Un verrou périmé (processus disparu, trop ancien,
 * illisible depuis plus de 10 s) est repris.
 * @param {string} repo
 * @param {{ by: string, pid?: number, now?: () => number, isAlive?: (pid: number) => boolean }} options
 * @returns {{ ok: true, release: () => void } | { ok: false, holder: import('./decision.cjs').LockHolder | null }}
 */
function tryLock(repo, { by, pid = process.pid, now = Date.now, isAlive = processAlive }) {
  const { dir, lock } = workPaths(repo)
  fs.mkdirSync(dir, { recursive: true })
  /** @type {import('./decision.cjs').LockHolder | null} */
  let holder = null
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = JSON.stringify({ pid, startedAt: new Date(now()).toISOString(), by })
    try {
      fs.writeFileSync(lock, content, { flag: 'wx' })
      return { ok: true, release: () => releaseLock(lock, pid) }
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error
    }
    holder = d.parseLock(readText(lock))
    const mtime = fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs
    if (mtime === undefined) continue // libéré entre-temps
    const fileAgeMs = now() - mtime
    if (!d.lockIsStale(holder, { now: now(), isAlive, fileAgeMs })) return { ok: false, holder }
    try {
      fs.unlinkSync(lock)
    } catch {
      /* déjà retiré */
    }
  }
  return { ok: false, holder }
}

/** @param {string} lock @param {number} pid */
function releaseLock(lock, pid) {
  const holder = d.parseLock(readText(lock))
  if (holder && holder.pid !== pid) return
  try {
    fs.unlinkSync(lock)
  } catch {
    /* déjà libéré */
  }
}

/**
 * Prend le verrou, en attendant la fin d'une autre mise à jour si besoin.
 * @param {string} repo
 * @param {{ by: string, onWait?: (holder: import('./decision.cjs').LockHolder | null) => void, timeoutMs?: number, intervalMs?: number, isAlive?: (pid: number) => boolean, now?: () => number }} options
 */
async function acquireLock(
  repo,
  { by, onWait, timeoutMs = 30 * 60_000, intervalMs = 1000, isAlive, now = Date.now },
) {
  const start = now()
  let notified = false
  for (;;) {
    const attempt = tryLock(repo, { by, now, ...(isAlive ? { isAlive } : {}) })
    if (attempt.ok) return attempt.release
    if (!notified) {
      onWait?.(attempt.holder)
      notified = true
    }
    if (now() - start > timeoutMs) {
      throw new UpdateError(
        'Une autre mise à jour d’Atelier Tab est en cours depuis trop longtemps. Fermez les autres fenêtres « Atelier Tab » et les terminaux qui la lancent, puis réessayez.',
      )
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

// ---------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------

/** Taille au-delà de laquelle le journal est archivé (`.1`) avant d'écrire. */
const LOG_MAX_BYTES = 1024 * 1024

/**
 * Ouvre (crée) le journal de la mise à jour. Écriture best effort : un journal impossible à écrire
 * ne bloque jamais le lancement.
 * @param {string} file
 * @returns {Log}
 */
function openLog(file) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if ((fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0) > LOG_MAX_BYTES) {
      fs.renameSync(file, `${file}.1`)
    }
  } catch {
    /* journal facultatif */
  }
  return {
    file,
    write(line) {
      try {
        fs.appendFileSync(file, `[${new Date().toLocaleString('fr-FR')}] ${line}\n`)
      } catch {
        /* journal facultatif */
      }
    },
  }
}

/**
 * Fin du journal (après un échec), à partir de `from` (début de la sortie de la commande en échec).
 * @param {string} file
 * @param {number} [lines]
 * @param {number} [from]
 */
function logTail(file, lines = 15, from = 0) {
  try {
    const size = fs.statSync(file).size
    const start = Math.max(from, size - 16 * 1024, 0)
    const length = size - start
    if (length <= 0) return ''
    const fd = fs.openSync(file, 'r')
    const buffer = Buffer.alloc(length)
    fs.readSync(fd, buffer, 0, length, start)
    fs.closeSync(fd)
    return d.tailLines(buffer.toString('utf8'), lines)
  } catch {
    return ''
  }
}

/** Taille actuelle du journal (0 s'il n'existe pas). @param {string} file */
function logSize(file) {
  return fs.statSync(file, { throwIfNoEntry: false })?.size ?? 0
}

// ---------------------------------------------------------------------------
// Outils (git, Node.js, npm)
// ---------------------------------------------------------------------------

/**
 * @param {string} repo
 * @returns {{ nodeDir?: string, git?: string }}
 */
function readToolchainCache(repo) {
  try {
    const value = JSON.parse(readText(workPaths(repo).toolchain) ?? '')
    return {
      ...(typeof value.nodeDir === 'string' ? { nodeDir: value.nodeDir } : {}),
      ...(typeof value.git === 'string' ? { git: value.git } : {}),
    }
  } catch {
    return {}
  }
}

/** @param {string} repo @param {{ nodeDir: string, git: string }} value */
function writeToolchainCache(repo, value) {
  try {
    const { dir, toolchain } = workPaths(repo)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(toolchain, `${JSON.stringify(value, null, 2)}\n`)
  } catch {
    /* simple accélération du lancement suivant */
  }
}

/**
 * `git` à utiliser (absolu si trouvé ; sinon `git` du PATH).
 * @param {{ repo: string, env: NodeJS.ProcessEnv, home: string }} input
 */
function findGit({ repo, env, home }) {
  const dirs = d.candidateGitDirs({
    cachedGit: readToolchainCache(repo).git ?? null,
    envPath: env.PATH ?? '',
    home,
  })
  for (const dir of dirs) {
    const candidate = path.join(dir, 'git')
    if (isExecutable(candidate)) return candidate
  }
  return 'git'
}

/**
 * PATH du shell de connexion (zsh -l -i : lit .zprofile et .zshrc, donc Homebrew, nvm…). Le Finder
 * ne transmet qu'un PATH minimal (`/usr/bin:/bin:/usr/sbin:/sbin`).
 * @param {{ env: NodeJS.ProcessEnv, timeoutMs?: number }} input
 * @returns {string | null}
 */
function loginShellPath({ env, timeoutMs = 8000 }) {
  const shells = d.cleanPathEntries([env.SHELL, '/bin/zsh']).filter(isExecutable)
  for (const shell of shells) {
    try {
      const out = execFileSync(shell, ['-l', '-i', '-c', d.LOGIN_PATH_COMMAND], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: timeoutMs,
        env: {
          HOME: env.HOME,
          USER: env.USER,
          LOGNAME: env.LOGNAME,
          SHELL: shell,
          LANG: env.LANG,
          TERM: 'dumb',
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        },
      })
      const found = d.parseLoginPath(out)
      if (found) return found
    } catch {
      /* shell suivant */
    }
  }
  return null
}

/** @param {string} dir */
function listDir(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * Cherche `node` (≥ `engines.node` du dépôt) et `npm` dans un même dossier.
 * @param {object} input
 * @param {string} input.repo
 * @param {NodeJS.ProcessEnv} input.env
 * @param {string} input.home
 * @param {string} [input.preferDir]  Dossier essayé en premier (terminal : Node qui exécute la commande).
 * @param {(env: NodeJS.ProcessEnv) => string | null} [input.probeLoginPath] Injectable (tests).
 * @param {readonly string[]} [input.commonDirs] Injectable (tests) : dossiers usuels.
 * @returns {Toolchain}
 */
function findNode({
  repo,
  env,
  home,
  preferDir,
  probeLoginPath = (e) => loginShellPath({ env: e }),
  commonDirs,
}) {
  let minimum = d.parseEngineMinimum(undefined)
  try {
    minimum = d.parseEngineMinimum(
      JSON.parse(readText(path.join(repo, 'package.json')) ?? '').engines?.node,
    )
  } catch {
    /* minimum par défaut */
  }
  /** @type {string[]} */
  const rejected = []
  /** @param {string[]} dirs */
  const pick = (dirs) => {
    for (const dir of dirs) {
      const node = path.join(dir, 'node')
      const npm = path.join(dir, 'npm')
      if (!isExecutable(node) || !isExecutable(npm)) continue
      /** @type {string} */
      let text
      try {
        text = execFileSync(node, ['--version'], {
          encoding: 'utf8',
          timeout: 10_000,
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      } catch {
        continue
      }
      const version = d.parseNodeVersion(text)
      if (version && d.meetsMinimum(version, minimum))
        return { dir, node, npm, version: text.trim() }
      if (!rejected.includes(`${node} ${text.trim()}`)) rejected.push(`${node} ${text.trim()}`)
    }
    return null
  }
  const cache = readToolchainCache(repo)
  const nvmDir = env.NVM_DIR || path.join(home, '.nvm')
  const nvm = {
    home,
    nvmDir,
    nvmDefault: readText(path.join(nvmDir, 'alias', 'default'))?.trim() || null,
    nvmVersions: listDir(path.join(nvmDir, 'versions', 'node')),
  }
  // Dossier connu (terminal, ou retenu la dernière fois) : pas besoin d'interroger le shell.
  let found = pick(d.cleanPathEntries([preferDir, cache.nodeDir]))
  /** @type {string | null} */
  let loginPath = null
  if (!found) {
    loginPath = probeLoginPath(env)
    found = pick(
      d.candidateNodeDirs({
        ...nvm,
        cachedDir: null,
        envPath: env.PATH ?? '',
        loginPath,
        ...(commonDirs ? { commonDirs } : {}),
      }),
    )
  }
  if (!found) {
    const detail =
      rejected.length > 0 ? ` Versions trouvées, trop anciennes : ${rejected.join(', ')}.` : ''
    throw new UpdateError(
      `Node.js ${minimum.join('.')} ou plus récent introuvable (avec npm).${detail} Installez Node.js (par exemple « brew install node »), puis relancez Atelier Tab — ou lancez une fois « npm run app:update » dans le dépôt depuis un terminal.`,
    )
  }
  const pathEntries = d.cleanPathEntries([
    found.dir,
    ...(loginPath ?? '').split(':'),
    ...(env.PATH ?? '').split(':'),
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ])
  return { node: found.node, npm: found.npm, version: found.version, path: pathEntries.join(':') }
}

/**
 * Environnement des commandes npm : celui du processus sans les variables d'Electron
 * (`ELECTRON_RUN_AS_NODE`…), avec le PATH de la chaîne d'outils.
 * @param {NodeJS.ProcessEnv} env
 * @param {Toolchain} toolchain
 * @param {Record<string, string>} [extra]
 */
function childEnv(env, toolchain, extra = {}) {
  /** @type {NodeJS.ProcessEnv} */
  const out = {}
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('ELECTRON_') && value !== undefined) out[key] = value
  }
  return { ...out, PATH: toolchain.path, ...extra }
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

/**
 * Lance une commande, sortie dans le journal. Groupe de processus à part : `cancel` arrête aussi
 * les sous-processus (tsc, vite…).
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, log: Log, onChild?: (child: import('node:child_process').ChildProcess) => void }} options
 * @returns {Promise<void>}
 */
function runCommand(command, args, { cwd, env, log, onChild }) {
  const shown = `${path.basename(command)} ${args.join(' ')}`
  log.write(`$ ${shown}`)
  // Sortie de cette commande seulement, pour l'extrait affiché après un échec.
  const from = logSize(log.file)
  return new Promise((resolve, reject) => {
    /** @type {number | null} */
    let fd
    try {
      fd = fs.openSync(log.file, 'a')
    } catch {
      fd = null
    }
    /** @type {import('node:child_process').ChildProcess} */
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        detached: true,
        stdio: ['ignore', fd ?? 'ignore', fd ?? 'ignore'],
      })
    } catch (error) {
      reject(new UpdateError(`« ${shown} » n’a pas pu être lancé : ${String(error)}`))
      return
    } finally {
      if (fd !== null) fs.closeSync(fd)
    }
    onChild?.(child)
    child.once('error', (error) =>
      reject(new UpdateError(`« ${shown} » n’a pas pu être lancé : ${error.message}`)),
    )
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else
        reject(
          new UpdateError(
            `« ${shown} » a échoué (${signal ? `arrêt ${signal}` : `code ${code}`}).`,
            logTail(log.file, 15, from),
          ),
        )
    })
  })
}

/** Arrête une commande lancée par `runCommand` et ses sous-processus. @param {import('node:child_process').ChildProcess} child */
function stopCommand(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    try {
      child.kill('SIGTERM')
    } catch {
      /* déjà arrêté */
    }
  }
}

/**
 * Remplace `dist/` et `dist-desktop/` par ceux de `staging`, chaque dossier par un renommage
 * (atomique). Échec en cours de route : l'ancienne compilation est remise en place.
 * @param {string} repo
 * @param {string} staging
 * @param {string} previous
 */
function swapBuild(repo, staging, previous) {
  fs.rmSync(previous, { recursive: true, force: true })
  fs.mkdirSync(previous, { recursive: true })
  /** @type {string[]} */
  const moved = []
  /** @type {string[]} */
  const installed = []
  try {
    for (const dir of d.BUILD_DIRS) {
      if (fs.existsSync(path.join(repo, dir))) {
        fs.renameSync(path.join(repo, dir), path.join(previous, dir))
        moved.push(dir)
      }
    }
    for (const dir of d.BUILD_DIRS) {
      fs.renameSync(path.join(staging, dir), path.join(repo, dir))
      installed.push(dir)
    }
  } catch (error) {
    for (const dir of installed) fs.renameSync(path.join(repo, dir), path.join(staging, dir))
    for (const dir of moved) fs.renameSync(path.join(previous, dir), path.join(repo, dir))
    throw error
  }
  fs.rmSync(previous, { recursive: true, force: true })
}

/**
 * Exécute les étapes décidées (sous verrou). Le tampon n'est écrit qu'à la toute fin.
 * @param {string} repo
 * @param {object} input
 * @param {RepoState} input.state        État mesuré avant la mise à jour (écrit dans le tampon).
 * @param {Step[]} input.steps
 * @param {Toolchain} input.toolchain
 * @param {NodeJS.ProcessEnv} input.env
 * @param {Log} input.log
 * @param {(label: string, index: number, total: number) => void} [input.onStatus]
 * @param {(child: import('node:child_process').ChildProcess) => void} [input.onChild]
 * @param {() => Date} [input.now]
 */
async function runSteps(
  repo,
  { state, steps, toolchain, env, log, onStatus, onChild, now = () => new Date() },
) {
  const paths = workPaths(repo)
  /** @type {{ label: string, run: () => Promise<void> | void }[]} */
  const tasks = []
  if (steps.includes('install')) {
    tasks.push({
      label: d.STEP_LABELS.install,
      run: () =>
        runCommand(toolchain.npm, ['ci', '--no-audit', '--no-fund'], {
          cwd: repo,
          // Réseau limité au registre npm (§8.2) : le binaire Electron du dépôt n'est pas téléchargé,
          // l'app installée embarque le sien (`npm run app` le télécharge au besoin).
          env: childEnv(env, toolchain, { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' }),
          log,
          ...(onChild ? { onChild } : {}),
        }).catch((error) => {
          throw new UpdateError(
            `L’installation des dépendances a échoué (${error.message}) Vérifiez la connexion au registre npm.`,
            error instanceof UpdateError ? error.tail : '',
          )
        }),
    })
  }
  if (steps.includes('build')) {
    const outDist = path.join(paths.staging, 'dist')
    const outDesktop = path.join(paths.staging, 'dist-desktop')
    tasks.push({
      label: d.STEP_LABELS.buildUi,
      run: () => {
        fs.rmSync(paths.staging, { recursive: true, force: true })
        fs.mkdirSync(paths.staging, { recursive: true })
        return runCommand(toolchain.npm, ['run', 'build'], {
          cwd: repo,
          env: childEnv(env, toolchain, { ATELIER_TAB_DIST_DIR: outDist }),
          log,
          ...(onChild ? { onChild } : {}),
        })
      },
    })
    tasks.push({
      label: d.STEP_LABELS.buildDesktop,
      run: () =>
        runCommand(toolchain.npm, ['run', 'build:desktop'], {
          cwd: repo,
          env: childEnv(env, toolchain, { ATELIER_TAB_DESKTOP_DIR: outDesktop }),
          log,
          ...(onChild ? { onChild } : {}),
        }),
    })
    tasks.push({
      label: d.STEP_LABELS.swap,
      run: () => {
        const missing = d.BUILD_OUTPUTS.filter(
          (file) => !fs.existsSync(path.join(paths.staging, file)),
        )
        if (missing.length > 0)
          throw new UpdateError(`Compilation incomplète : ${missing.join(', ')} manquant.`)
        swapBuild(repo, paths.staging, paths.previous)
        fs.rmSync(paths.staging, { recursive: true, force: true })
      },
    })
  }
  for (const [index, task] of tasks.entries()) {
    onStatus?.(task.label, index + 1, tasks.length)
    try {
      await task.run()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.write(`ÉCHEC : ${message}`)
      throw error instanceof UpdateError ? error : new UpdateError(message)
    }
  }
  fs.writeFileSync(paths.stamp, d.formatStamp(state, now()))
}

/**
 * Mise à jour complète : verrou, état, étapes nécessaires, tampon. Rien à faire → retour immédiat.
 * @param {string} repo
 * @param {object} options
 * @param {'app' | 'terminal'} options.by
 * @param {Log} options.log
 * @param {NodeJS.ProcessEnv} options.env
 * @param {string} options.home
 * @param {string} [options.git]
 * @param {string} [options.preferDir]
 * @param {(label: string, index: number, total: number) => void} [options.onStatus]
 * @param {(reasons: string[]) => void} [options.onPlan]
 * @param {(holder: import('./decision.cjs').LockHolder | null) => void} [options.onWait]
 * @param {(child: import('node:child_process').ChildProcess) => void} [options.onChild]
 * @param {(env: NodeJS.ProcessEnv) => string | null} [options.probeLoginPath]
 * @param {readonly string[]} [options.commonDirs]
 * @param {{ timeoutMs?: number, intervalMs?: number, isAlive?: (pid: number) => boolean }} [options.lock]
 * @returns {Promise<{ steps: Step[], reasons: string[], toolchain: Toolchain | null }>}
 */
async function update(repo, options) {
  const { by, log, env, home, onStatus, onPlan, onWait, onChild } = options
  const git = options.git ?? findGit({ repo, env, home })
  const release = await acquireLock(repo, {
    by,
    ...(onWait ? { onWait } : {}),
    ...(options.lock ?? {}),
  })
  try {
    // Mesuré sous verrou : une autre mise à jour vient peut-être de tout faire.
    const plan = planUpdate(repo, { git })
    if (plan.steps.length === 0) {
      log.write('Déjà à jour.')
      return { steps: [], reasons: [], toolchain: null }
    }
    log.write(
      `Mise à jour (${by}) : ${plan.steps.join(' + ')} — ${plan.reasons.join(', ')}. Dépôt : ${repo}`,
    )
    onPlan?.(plan.reasons)
    let toolchain
    try {
      toolchain = findNode({
        repo,
        env,
        home,
        ...(options.preferDir ? { preferDir: options.preferDir } : {}),
        ...(options.probeLoginPath ? { probeLoginPath: options.probeLoginPath } : {}),
        ...(options.commonDirs ? { commonDirs: options.commonDirs } : {}),
      })
    } catch (error) {
      log.write(`ÉCHEC : ${error instanceof Error ? error.message : String(error)}`)
      throw error
    }
    log.write(`Node.js ${toolchain.version} (${toolchain.node}), git ${git}`)
    try {
      await runSteps(repo, {
        state: plan.state,
        steps: plan.steps,
        toolchain,
        env,
        log,
        ...(onStatus ? { onStatus } : {}),
        ...(onChild ? { onChild } : {}),
      })
    } catch (error) {
      const failure = error instanceof UpdateError ? error : new UpdateError(String(error))
      failure.tail = failure.tail || logTail(log.file)
      throw failure
    }
    writeToolchainCache(repo, { nodeDir: path.dirname(toolchain.node), git })
    log.write('Mise à jour réussie.')
    return { steps: plan.steps, reasons: plan.reasons, toolchain }
  } finally {
    release()
  }
}

module.exports = {
  UpdateError,
  WORK_DIR,
  acquireLock,
  childEnv,
  depsInstalled,
  findGit,
  findNode,
  invalidateStamp,
  isBuilt,
  loginShellPath,
  logTail,
  openLog,
  planUpdate,
  readStamp,
  repoElectronVersion,
  repoState,
  repoVersion,
  runCommand,
  stopCommand,
  swapBuild,
  tryLock,
  update,
  workPaths,
}
