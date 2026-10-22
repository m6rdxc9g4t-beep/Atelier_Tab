// @ts-check
/**
 * Mise à jour automatique de l'app de bureau (docs/SUITE.md §8, ADR 0005) : décisions pures.
 *
 * Aucun accès au disque, au réseau ni aux processus ici : `update.cjs` mesure l'état du dépôt et
 * exécute, ce module décide (quoi refaire, verrou périmé ou non, quel Node.js retenir…). Testé dans
 * `desktop/__tests__/launcher-decision.test.ts`.
 *
 * Écrit en CommonJS (vérifié par TypeScript avec `checkJs`) et jamais compilé : le lanceur doit
 * pouvoir tourner avant toute compilation, puisque c'est lui qui la déclenche.
 */
'use strict'

/**
 * État du dépôt au moment du lancement.
 * @typedef {object} RepoState
 * @property {string} head  Commit courant (`git rev-parse HEAD`), ou `sans-git`.
 * @property {string} local Empreinte du contenu des fichiers modifiés localement (vide : aucun).
 * @property {string} code  Empreinte de `head` + `local` : ce qui est compilé.
 * @property {string} lock  Empreinte de `package-lock.json` (`absent` sans lockfile).
 */

/**
 * Tampon de la dernière mise à jour réussie (`.mise-a-jour/tampon.json`, ignoré par git).
 * @typedef {object} Stamp
 * @property {string} head
 * @property {string} code
 * @property {string} lock
 * @property {string} [builtAt]
 */

/** @typedef {'install' | 'build'} Step */

/**
 * @typedef {object} Plan
 * @property {Step[]} steps     Étapes à faire, dans l'ordre (vide : lancement direct).
 * @property {string[]} reasons Raisons lisibles, pour le journal et l'écran de démarrage.
 */

/** Libellés des étapes affichés par l'écran de démarrage et le terminal. */
const STEP_LABELS = Object.freeze({
  install: 'Installation des dépendances (npm ci)…',
  buildUi: 'Compilation de l’interface…',
  buildDesktop: 'Compilation du processus principal et du serveur MCP…',
  swap: 'Remplacement de la version précédente…',
})

/** Fichiers produits par la compilation, relatifs au dépôt : sans eux, l'app ne peut pas démarrer. */
const BUILD_OUTPUTS = Object.freeze([
  'dist/index.html',
  'dist-desktop/main.cjs',
  'dist-desktop/preload.cjs',
  'dist-desktop/atelier-mcp.mjs',
])

/** Dossiers remplacés en bloc par une compilation réussie. */
const BUILD_DIRS = Object.freeze(['dist', 'dist-desktop'])

/**
 * Ce qu'il faut refaire avant de lancer l'app.
 *
 * - dépendances absentes ou lockfile changé depuis le tampon → `npm ci` puis compilation ;
 * - commit changé, modification locale (ou annulée), compilation absente, pas de tampon → compilation ;
 * - sinon rien.
 *
 * @param {{ state: RepoState, stamp: Stamp | null, depsInstalled: boolean, built: boolean }} input
 * @returns {Plan}
 */
function decide({ state, stamp, depsInstalled, built }) {
  /** @type {string[]} */
  const reasons = []
  let install = false
  if (!depsInstalled) {
    install = true
    reasons.push('dépendances absentes (node_modules)')
  } else if (stamp && stamp.lock !== state.lock) {
    install = true
    reasons.push('package-lock.json a changé')
  }
  let build = install
  if (!stamp) {
    build = true
    reasons.push('première mise à jour')
  } else if (stamp.code !== state.code) {
    build = true
    reasons.push(
      stamp.head !== state.head
        ? 'nouveau commit'
        : state.local
          ? 'modification locale non commitée'
          : 'modification locale annulée',
    )
  }
  if (!built) {
    build = true
    reasons.push('compilation absente ou incomplète')
  }
  /** @type {Step[]} */
  const steps = []
  if (install) steps.push('install')
  if (build) steps.push('build')
  return { steps, reasons }
}

/**
 * Lit un tampon. Tolérant : contenu absent, illisible ou incomplet → `null` (tout sera refait).
 * @param {string | null} text
 * @returns {Stamp | null}
 */
function parseStamp(text) {
  if (!text) return null
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object') return null
    const { head, code, lock, builtAt } = value
    if (typeof head !== 'string' || typeof code !== 'string' || typeof lock !== 'string')
      return null
    return { head, code, lock, ...(typeof builtAt === 'string' ? { builtAt } : {}) }
  } catch {
    return null
  }
}

/**
 * Contenu du tampon écrit après une mise à jour entièrement réussie : l'état mesuré **avant** la
 * mise à jour (une modification faite pendant la compilation sera reprise au lancement suivant).
 * @param {RepoState} state
 * @param {Date} now
 * @returns {string}
 */
function formatStamp(state, now) {
  const stamp = { head: state.head, code: state.code, lock: state.lock, builtAt: now.toISOString() }
  return `${JSON.stringify(stamp, null, 2)}\n`
}

// ---------------------------------------------------------------------------
// Verrou : une seule mise à jour à la fois
// ---------------------------------------------------------------------------

/**
 * @typedef {object} LockHolder
 * @property {number} pid
 * @property {string} startedAt ISO 8601.
 * @property {string} [by]      `app` ou `terminal`.
 */

/** Au-delà, un verrou est considéré comme abandonné même si son processus semble vivant. */
const LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000

/**
 * @param {string | null} text
 * @returns {LockHolder | null}
 */
function parseLock(text) {
  if (!text) return null
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object') return null
    const { pid, startedAt, by } = value
    if (!Number.isInteger(pid) || pid <= 0 || typeof startedAt !== 'string') return null
    return { pid, startedAt, ...(typeof by === 'string' ? { by } : {}) }
  } catch {
    return null
  }
}

/** Un verrou illisible plus récent que cela est peut-être en cours d'écriture : il est respecté. */
const LOCK_UNREADABLE_GRACE_MS = 10_000

/**
 * Le verrou peut-il être repris ? Oui si son processus n'existe plus, s'il est trop ancien
 * (processus planté, pid réattribué) ou illisible depuis plus de 10 s.
 * @param {LockHolder | null} holder
 * @param {{ now: number, isAlive: (pid: number) => boolean, fileAgeMs?: number, maxAgeMs?: number }} options
 */
function lockIsStale(holder, { now, isAlive, fileAgeMs = Infinity, maxAgeMs = LOCK_MAX_AGE_MS }) {
  if (!holder) return fileAgeMs > LOCK_UNREADABLE_GRACE_MS
  const started = Date.parse(holder.startedAt)
  if (Number.isNaN(started) || now - started > maxAgeMs) return true
  return !isAlive(holder.pid)
}

// ---------------------------------------------------------------------------
// Node.js et git depuis le Finder
// ---------------------------------------------------------------------------

/** Dossiers d'outils courants sur macOS, après ceux du shell de connexion. */
const COMMON_BIN_DIRS = Object.freeze(['/opt/homebrew/bin', '/usr/local/bin'])

/**
 * Entrées de PATH utilisables : absolues, sans `node_modules/.bin` ni dossiers ajoutés par npm
 * (`node-gyp-bin`), sans doublon.
 * @param {Iterable<string | undefined | null>} entries
 * @returns {string[]}
 */
function cleanPathEntries(entries) {
  /** @type {string[]} */
  const out = []
  for (const raw of entries) {
    if (typeof raw !== 'string') continue
    const entry = raw.trim().replace(/\/+$/, '') || (raw.trim() === '/' ? '/' : '')
    if (!entry.startsWith('/')) continue
    if (/(^|\/)node_modules\/\.bin$/.test(entry) || entry.includes('node-gyp-bin')) continue
    if (!out.includes(entry)) out.push(entry)
  }
  return out
}

/** @param {string | undefined} value */
function splitPath(value) {
  return value ? value.split(':') : []
}

/** Repère qui entoure le PATH imprimé par le shell de connexion (le shell peut écrire autre chose). */
const LOGIN_PATH_MARKER = '__ATELIER_TAB_PATH__'

/** Commande passée au shell de connexion pour obtenir son PATH. */
const LOGIN_PATH_COMMAND = `printf '\\n${LOGIN_PATH_MARKER}%s${LOGIN_PATH_MARKER}\\n' "$PATH"`

/**
 * Extrait le PATH de la sortie du shell de connexion.
 * @param {string} stdout
 * @returns {string | null}
 */
function parseLoginPath(stdout) {
  const match = new RegExp(`${LOGIN_PATH_MARKER}([^\\n]*?)${LOGIN_PATH_MARKER}`).exec(stdout)
  return match && match[1] ? match[1] : null
}

/**
 * Versions installées par nvm, de la plus récente à la plus ancienne.
 * @param {string[]} names Noms de dossiers de `~/.nvm/versions/node` (`v22.12.0`…).
 */
function nvmVersionsDescending(names) {
  return names
    .map((name) => ({ name, version: parseNodeVersion(name) }))
    .filter((v) => v.version !== null)
    .sort((a, b) =>
      compareVersions(/** @type {number[]} */ (b.version), /** @type {number[]} */ (a.version)),
    )
    .map((v) => v.name)
}

/**
 * Dossiers où chercher `node` et `npm`, dans l'ordre de préférence.
 * @param {object} input
 * @param {string | null} [input.cachedDir]   Dossier retenu la dernière fois (environnement.json).
 * @param {string} [input.envPath]            PATH du processus (Finder : minimal).
 * @param {string | null} [input.loginPath]   PATH du shell de connexion (zsh -l).
 * @param {string} input.home
 * @param {string} [input.nvmDir]             NVM_DIR, sinon ~/.nvm.
 * @param {string | null} [input.nvmDefault]  Version de l'alias `default` de nvm, si lisible.
 * @param {string[]} [input.nvmVersions]      Dossiers de `<nvm>/versions/node`.
 * @param {readonly string[]} [input.commonDirs] Dossiers usuels (défaut : Homebrew, /usr/local/bin).
 * @returns {string[]}
 */
function candidateNodeDirs({
  cachedDir,
  envPath,
  loginPath,
  home,
  nvmDir,
  nvmDefault,
  nvmVersions = [],
  commonDirs = COMMON_BIN_DIRS,
}) {
  const nvm = nvmDir || `${home}/.nvm`
  const versions = nvmVersionsDescending(nvmVersions)
  const def = nvmDefault ? versions.find((v) => matchesNvmAlias(v, nvmDefault)) : undefined
  return cleanPathEntries([
    cachedDir,
    ...splitPath(loginPath ?? undefined),
    ...splitPath(envPath),
    `${home}/.homebrew/bin`,
    ...commonDirs,
    ...(def ? [`${nvm}/versions/node/${def}/bin`] : []),
    ...versions.map((v) => `${nvm}/versions/node/${v}/bin`),
    `${home}/.volta/bin`,
  ])
}

/**
 * Dossiers où chercher `git` : Homebrew avant `/usr/bin/git`, simple relais vers les outils de
 * développement Apple (qui ouvrent une fenêtre d'installation s'ils manquent).
 * @param {{ cachedGit?: string | null, envPath?: string, home: string }} input
 * @returns {string[]}
 */
function candidateGitDirs({ cachedGit, envPath, home }) {
  const cached = cachedGit && cachedGit.endsWith('/git') ? cachedGit.slice(0, -4) : null
  return cleanPathEntries([
    cached,
    `${home}/.homebrew/bin`,
    ...COMMON_BIN_DIRS,
    ...splitPath(envPath),
    '/usr/bin',
  ])
}

/** @param {string} name @param {string} alias */
function matchesNvmAlias(name, alias) {
  const a = alias.trim().replace(/^v/, '')
  const n = name.replace(/^v/, '')
  return n === a || n.startsWith(`${a}.`)
}

/**
 * `v22.12.0` → `[22, 12, 0]`.
 * @param {string} text
 * @returns {number[] | null}
 */
function parseNodeVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/**
 * Version minimale d'un champ `engines.node` simple (`>=20.19`). Autre forme → 20.19.0.
 * @param {string | undefined} range
 * @returns {number[]}
 */
function parseEngineMinimum(range) {
  const match = /^\s*>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(range ?? '')
  if (!match) return [20, 19, 0]
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

/** @param {number[]} a @param {number[]} b */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/** @param {number[]} version @param {number[]} minimum */
function meetsMinimum(version, minimum) {
  return compareVersions(version, minimum) >= 0
}

// ---------------------------------------------------------------------------
// Divers
// ---------------------------------------------------------------------------

/** Ouvre l'app avec la compilation précédente, sans mise à jour (après un échec). */
const FLAG_SKIP_UPDATE = '--atelier-sans-mise-a-jour'
/** Relance qui suit une mise à jour réussie : jamais de seconde mise à jour d'affilée. */
const FLAG_AFTER_UPDATE = '--atelier-apres-mise-a-jour'

/** @param {string[]} argv */
function parseFlags(argv) {
  return {
    skipUpdate: argv.includes(FLAG_SKIP_UPDATE),
    afterUpdate: argv.includes(FLAG_AFTER_UPDATE),
  }
}

/**
 * Arguments d'une relance : ceux du lancement sans nos drapeaux, plus `flag` s'il est donné.
 * @param {string[]} argv `process.argv`
 * @param {string} [flag]
 */
function relaunchArgs(argv, flag) {
  const kept = argv.slice(1).filter((a) => a !== FLAG_SKIP_UPDATE && a !== FLAG_AFTER_UPDATE)
  return flag ? [...kept, flag] : kept
}

/**
 * Journal de la mise à jour : `~/Library/Logs/Atelier_Tab/mise-a-jour.log` sur macOS.
 * @param {{ platform: string, home: string, env: Record<string, string | undefined> }} input
 */
function logFilePath({ platform, home, env }) {
  if (env.ATELIER_TAB_LOG_DIR)
    return `${env.ATELIER_TAB_LOG_DIR.replace(/\/+$/, '')}/mise-a-jour.log`
  if (platform === 'darwin') return `${home}/Library/Logs/Atelier_Tab/mise-a-jour.log`
  const state = env.XDG_STATE_HOME || `${home}/.local/state`
  return `${state}/Atelier_Tab/mise-a-jour.log`
}

/**
 * Electron de l'app installée différent de celui du dépôt : l'app continue de fonctionner, mais
 * `npm run app:install` intégrera la nouvelle version.
 * @param {string | undefined} running `process.versions.electron`
 * @param {string | null} repo Version de `node_modules/electron`.
 * @returns {string | null}
 */
function electronDrift(running, repo) {
  if (!running || !repo || running === repo) return null
  return `Electron ${repo} dans le dépôt, ${running} dans l’app : relancez « npm run app:install » pour l’intégrer.`
}

/**
 * Dernières lignes non vides d'un texte (fin du journal affichée après un échec).
 * @param {string} text
 * @param {number} count
 */
function tailLines(text, count) {
  return text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter(Boolean)
    .slice(-count)
    .join('\n')
}

module.exports = {
  BUILD_DIRS,
  BUILD_OUTPUTS,
  COMMON_BIN_DIRS,
  FLAG_AFTER_UPDATE,
  FLAG_SKIP_UPDATE,
  LOCK_MAX_AGE_MS,
  LOGIN_PATH_COMMAND,
  STEP_LABELS,
  candidateGitDirs,
  candidateNodeDirs,
  cleanPathEntries,
  compareVersions,
  decide,
  electronDrift,
  formatStamp,
  lockIsStale,
  logFilePath,
  meetsMinimum,
  nvmVersionsDescending,
  parseEngineMinimum,
  parseFlags,
  parseLock,
  parseLoginPath,
  parseNodeVersion,
  parseStamp,
  relaunchArgs,
  tailLines,
}
