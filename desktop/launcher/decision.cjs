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

const path = require('node:path')

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

/** @param {string | undefined} platform */
const isWin = (platform) => platform === 'win32'

/**
 * Chemin absolu pour la plateforme : `/…` (macOS, Linux) ; `C:\…` ou `\\serveur\…` (Windows).
 * @param {string} entry
 * @param {string} [platform]
 */
function isAbsoluteFor(entry, platform) {
  return isWin(platform) ? /^(?:[A-Za-z]:[\\/]|\\\\[^\\])/.test(entry) : entry.startsWith('/')
}

/**
 * Entrées de PATH utilisables : absolues, sans `node_modules/.bin` ni dossiers ajoutés par npm
 * (`node-gyp-bin`), sans doublon. Windows : guillemets retirés, `\` final retiré (sauf `C:\`),
 * doublons comparés sans tenir compte de la casse.
 * @param {Iterable<string | undefined | null>} entries
 * @param {string} [platform] `process.platform` (défaut : règles POSIX).
 * @returns {string[]}
 */
function cleanPathEntries(entries, platform) {
  const win = isWin(platform)
  /** @type {string[]} */
  const out = []
  /** @type {Set<string>} */
  const seen = new Set()
  for (const raw of entries) {
    if (typeof raw !== 'string') continue
    let entry = raw.trim()
    if (win) {
      entry = entry.replace(/^"(.*)"$/, '$1').trim()
      entry = /^[A-Za-z]:[\\/]$/.test(entry) ? entry : entry.replace(/[\\/]+$/, '')
    } else {
      entry = entry.replace(/\/+$/, '') || (entry === '/' ? '/' : '')
    }
    if (!isAbsoluteFor(entry, platform)) continue
    if (/(^|[\\/])node_modules[\\/]\.bin$/i.test(entry) || entry.includes('node-gyp-bin')) continue
    const key = win ? entry.toLowerCase().replace(/\//g, '\\') : entry
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/**
 * Découpe un PATH (`:` ; Windows : `;`).
 * @param {string | undefined} value
 * @param {string} [platform]
 */
function splitPath(value, platform) {
  return value ? value.split(isWin(platform) ? ';' : ':') : []
}

/**
 * Valeur de PATH d'un environnement : sous Windows la clé peut s'écrire `Path`.
 * @param {Record<string, string | undefined>} env
 * @returns {string | undefined}
 */
function envPathValue(env) {
  if (env.PATH !== undefined) return env.PATH
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH')
  return key ? env[key] : undefined
}

/**
 * Copie d'un environnement avec un nouveau PATH, sans doublon de casse (`Path` et `PATH` côte à
 * côte : Windows n'en garderait qu'un, au hasard).
 * @param {Record<string, string | undefined>} env
 * @param {string} value
 * @returns {Record<string, string>}
 */
function withPath(env, value) {
  /** @type {Record<string, string>} */
  const out = {}
  for (const [key, v] of Object.entries(env)) {
    if (v !== undefined && key.toUpperCase() !== 'PATH') out[key] = v
  }
  out.PATH = value
  return out
}

/** Noms des exécutables cherchés. @param {string} [platform] */
function toolNames(platform) {
  return isWin(platform) ? { node: 'node.exe', git: 'git.exe' } : { node: 'node', git: 'git' }
}

/**
 * npm à côté de `node` : Windows → `node_modules\npm\bin\npm-cli.js`, lancé par `node.exe`
 * (jamais `npm.cmd` : un `.cmd` exige `cmd.exe`, donc une ligne de commande à échapper) ;
 * ailleurs → l'exécutable `npm`.
 * @param {string} dir
 * @param {string} [platform]
 */
function npmBeside(dir, platform) {
  return isWin(platform)
    ? path.win32.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : path.posix.join(dir, 'npm')
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
 * développement Apple (qui ouvrent une fenêtre d'installation s'ils manquent). Windows : PATH, puis
 * Git for Windows (`%ProgramFiles%\Git\cmd`, installation par utilisateur).
 * @param {{ cachedGit?: string | null, envPath?: string, home: string, platform?: string, env?: Record<string, string | undefined> }} input
 * @returns {string[]}
 */
function candidateGitDirs({ cachedGit, envPath, home, platform, env = {} }) {
  if (isWin(platform)) {
    const cached =
      cachedGit && /[\\/]git\.exe$/i.test(cachedGit) ? path.win32.dirname(cachedGit) : null
    return cleanPathEntries(
      [
        cached,
        ...splitPath(envPath, platform),
        ...programFilesDirs(env).map((p) => path.win32.join(p, 'Git', 'cmd')),
        env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'cmd') : null,
      ],
      platform,
    )
  }
  const cached = cachedGit && cachedGit.endsWith('/git') ? cachedGit.slice(0, -4) : null
  return cleanPathEntries([
    cached,
    `${home}/.homebrew/bin`,
    ...COMMON_BIN_DIRS,
    ...splitPath(envPath),
    '/usr/bin',
  ])
}

/** `%ProgramFiles%` et `%ProgramW6432%` (Node.js x64 depuis un processus ARM64 ou 32 bits). @param {Record<string, string | undefined>} env */
function programFilesDirs(env) {
  return [env.ProgramFiles, env.ProgramW6432, env['ProgramFiles(x86)']].filter(
    /** @returns {p is string} */ (p) => typeof p === 'string' && p !== '',
  )
}

/**
 * Dossiers où chercher `node.exe` (et npm à côté) sous Windows, dans l'ordre (docs/SUITE.md §9.3) :
 * dossier retenu la dernière fois, PATH, nvm-windows (`%NVM_SYMLINK%`), `%ProgramFiles%\nodejs`,
 * `%LOCALAPPDATA%\Programs\nodejs`, fnm (alias `default`, puis la version la plus récente),
 * nvm-windows (`%NVM_HOME%\v…`), Volta (`tools\image\node\…`).
 * @param {object} input
 * @param {string | null} [input.cachedDir]
 * @param {string} [input.envPath]
 * @param {Record<string, string | undefined>} input.env
 * @param {string[]} [input.nvmVersions]   Dossiers de `%NVM_HOME%` (`v22.12.0`…).
 * @param {string[]} [input.fnmVersions]   Dossiers de `<fnm>\node-versions`.
 * @param {string[]} [input.voltaVersions] Dossiers de `<volta>\tools\image\node`.
 * @returns {string[]}
 */
function candidateNodeDirsWin32({
  cachedDir,
  envPath,
  env,
  nvmVersions = [],
  fnmVersions = [],
  voltaVersions = [],
}) {
  const j = path.win32.join
  const dirs = windowsToolRoots(env)
  return cleanPathEntries(
    [
      cachedDir,
      ...splitPath(envPath, 'win32'),
      env.NVM_SYMLINK,
      ...programFilesDirs(env).map((p) => j(p, 'nodejs')),
      env.LOCALAPPDATA ? j(env.LOCALAPPDATA, 'Programs', 'nodejs') : null,
      dirs.fnm ? j(dirs.fnm, 'aliases', 'default') : null,
      ...(dirs.fnm
        ? nvmVersionsDescending(fnmVersions).map((v) =>
            j(dirs.fnm ?? '', 'node-versions', v, 'installation'),
          )
        : []),
      ...(dirs.nvm ? nvmVersionsDescending(nvmVersions).map((v) => j(dirs.nvm ?? '', v)) : []),
      ...(dirs.volta
        ? nvmVersionsDescending(voltaVersions).map((v) =>
            j(dirs.volta ?? '', 'tools', 'image', 'node', v),
          )
        : []),
    ],
    'win32',
  )
}

/**
 * Dossiers des gestionnaires de versions de Node.js sous Windows (à lister par `update.cjs`).
 * @param {Record<string, string | undefined>} env
 * @returns {{ nvm: string | null, fnm: string | null, volta: string | null }}
 */
function windowsToolRoots(env) {
  const j = path.win32.join
  return {
    nvm: env.NVM_HOME || (env.APPDATA ? j(env.APPDATA, 'nvm') : null),
    fnm: env.FNM_DIR || (env.APPDATA ? j(env.APPDATA, 'fnm') : null),
    volta: env.VOLTA_HOME || (env.LOCALAPPDATA ? j(env.LOCALAPPDATA, 'Volta') : null),
  }
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
/**
 * Mise à jour seule, sans fenêtre : l'app met à jour la compilation puis s'arrête (code 0 : à jour,
 * 1 : échec). Sert à la CI Windows (docs/SUITE.md §9.5) et au diagnostic.
 */
const FLAG_UPDATE_ONLY = '--atelier-mise-a-jour-seule'

/** @param {string[]} argv */
function parseFlags(argv) {
  return {
    skipUpdate: argv.includes(FLAG_SKIP_UPDATE),
    afterUpdate: argv.includes(FLAG_AFTER_UPDATE),
    updateOnly: argv.includes(FLAG_UPDATE_ONLY),
  }
}

/**
 * Arguments d'une relance : ceux du lancement sans nos drapeaux, plus `flag` s'il est donné.
 * @param {string[]} argv `process.argv`
 * @param {string} [flag]
 */
function relaunchArgs(argv, flag) {
  const ours = [FLAG_SKIP_UPDATE, FLAG_AFTER_UPDATE, FLAG_UPDATE_ONLY]
  const kept = argv.slice(1).filter((a) => !ours.includes(a))
  return flag ? [...kept, flag] : kept
}

/**
 * Dossiers propres à l'app hors du dépôt et hors du dossier de données (docs/SUITE.md §9.2), seule
 * source de ces emplacements (lanceur, préférences, secrets) :
 * - macOS : `~/Library/Application Support/Atelier_Tab`, journaux `~/Library/Logs/Atelier_Tab` ;
 * - Windows : `%APPDATA%\Atelier_Tab`, journaux `%LOCALAPPDATA%\Atelier_Tab\Logs` ;
 * - Linux : XDG (`~/.config/Atelier_Tab`, journaux `~/.local/state/Atelier_Tab`).
 * @param {{ platform: string, home: string, env: Record<string, string | undefined> }} input
 * @returns {{ config: string, logs: string }}
 */
function appDirs({ platform, home, env }) {
  const name = 'Atelier_Tab'
  if (platform === 'darwin')
    return {
      config: path.posix.join(home, 'Library', 'Application Support', name),
      logs: path.posix.join(home, 'Library', 'Logs', name),
    }
  if (isWin(platform)) {
    const j = path.win32.join
    return {
      config: j(env.APPDATA || j(home, 'AppData', 'Roaming'), name),
      logs: j(env.LOCALAPPDATA || j(home, 'AppData', 'Local'), name, 'Logs'),
    }
  }
  return {
    config: path.posix.join(env.XDG_CONFIG_HOME || path.posix.join(home, '.config'), name),
    logs: path.posix.join(env.XDG_STATE_HOME || path.posix.join(home, '.local', 'state'), name),
  }
}

/**
 * Journal de la mise à jour : `~/Library/Logs/Atelier_Tab/mise-a-jour.log` sur macOS,
 * `%LOCALAPPDATA%\Atelier_Tab\Logs\mise-a-jour.log` sous Windows.
 * @param {{ platform: string, home: string, env: Record<string, string | undefined> }} input
 */
function logFilePath({ platform, home, env }) {
  const p = isWin(platform) ? path.win32 : path.posix
  if (env.ATELIER_TAB_LOG_DIR) return p.join(env.ATELIER_TAB_LOG_DIR, 'mise-a-jour.log')
  return p.join(appDirs({ platform, home, env }).logs, 'mise-a-jour.log')
}

/**
 * Variables héritées ignorées au lancement de l'app de bureau (docs/SUITE.md §9.4). Tab n'en
 * reçoit aucune qui désigne d'autres données (`ATELIER_TAB_DATA` est la sienne), mais celles-ci,
 * posées par un terminal ou une autre app, casseraient sa relance ou sa mise à jour :
 * - `ELECTRON_RUN_AS_NODE` : l'app relancée (ou Electron lancé par npm) démarrerait en simple Node.js ;
 * - `ELECTRON_NO_ASAR` : le point d'entrée de l'app (dans `app.asar`) deviendrait illisible ;
 * - `NODE_OPTIONS` : options injectées dans npm, la compilation et l'app relancée (`--require`,
 *   `--inspect`…) ;
 * - `NODE_ENV` : `production` ferait sauter les devDependencies à `npm ci` (compilation impossible).
 */
const IGNORED_INHERITED_ENV = Object.freeze([
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'NODE_OPTIONS',
  'NODE_ENV',
])

/**
 * Noms des variables de `env` à ignorer (casse indifférente, comme sous Windows).
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
function inheritedEnvToIgnore(env) {
  return Object.keys(env).filter((key) => IGNORED_INHERITED_ENV.includes(key.toUpperCase()))
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

// ---------------------------------------------------------------------------
// Installation Windows et serveur MCP livré
// ---------------------------------------------------------------------------

/**
 * Dossier d'installation du lanceur sous Windows (docs/SUITE.md §9.1) :
 * `%LOCALAPPDATA%\Programs\Atelier_Tab` (installation pour l'utilisateur, sans droits
 * d'administrateur). L'exécutable est `Atelier_Tab.exe`, le serveur MCP dans `resources\`.
 * @param {{ home: string, env: Record<string, string | undefined> }} input
 */
function windowsInstallDir({ home, env }) {
  const local = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local')
  return path.win32.join(local, 'Programs', 'Atelier_Tab')
}

/**
 * Serveur MCP livré avec l'app installée (ADR 0005) :
 * - macOS / Linux : script `atelier-mcp` des ressources (il lance le Node.js d'Electron) ;
 * - Windows : `Atelier_Tab.exe resources\atelier-mcp.cjs` avec `ELECTRON_RUN_AS_NODE=1`, lancé
 *   sans shell ; `resources\atelier-mcp.cmd` fait de même pour les outils qui attendent un seul
 *   fichier (Nexus : `TAB_MCP_COMMAND`).
 * `file` est le chemin stable à documenter ; `command` + `args` + `env`, ce que lance un client MCP.
 * @param {{ platform: string, resourcesPath: string, exePath: string }} input
 * @returns {{ file: string, command: string, args: string[], env: Record<string, string> }}
 */
function mcpServerCommand({ platform, resourcesPath, exePath }) {
  if (isWin(platform)) {
    return {
      file: path.win32.join(resourcesPath, 'atelier-mcp.cmd'),
      command: exePath,
      args: [path.win32.join(resourcesPath, 'atelier-mcp.cjs')],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  const file = path.posix.join(resourcesPath, 'atelier-mcp')
  return { file, command: file, args: [], env: {} }
}

/**
 * Arguments de `claude mcp add` (portée « user ») pour le serveur MCP livré. Avec des variables,
 * `--env` n'est jamais suivi du nom du serveur (Claude Code le lirait comme une autre variable).
 * @param {{ command: string, args: string[], env: Record<string, string> }} server
 * @returns {string[]}
 */
function claudeMcpAddArgs(server) {
  const env = Object.entries(server.env).flatMap(([k, v]) => ['--env', `${k}=${v}`])
  return [
    'mcp',
    'add',
    ...env,
    ...(env.length > 0 ? ['--transport', 'stdio'] : []),
    '--scope',
    'user',
    'atelier-tab',
    '--',
    server.command,
    ...server.args,
  ]
}

/**
 * Commande `claude mcp add …` à copier dans un terminal (affichée par l'app et le README) : chaque
 * argument du serveur entre guillemets (chemins avec espaces), valable dans PowerShell, cmd et zsh.
 * @param {{ command: string, args: string[], env: Record<string, string> }} server
 */
function claudeMcpAddCommand(server) {
  const args = claudeMcpAddArgs(server)
  const sep = args.indexOf('--')
  return ['claude', ...args.slice(0, sep + 1), ...args.slice(sep + 1).map((a) => `"${a}"`)].join(
    ' ',
  )
}

module.exports = {
  BUILD_DIRS,
  claudeMcpAddArgs,
  claudeMcpAddCommand,
  mcpServerCommand,
  windowsInstallDir,
  FLAG_UPDATE_ONLY,
  IGNORED_INHERITED_ENV,
  appDirs,
  candidateNodeDirsWin32,
  envPathValue,
  inheritedEnvToIgnore,
  isAbsoluteFor,
  npmBeside,
  splitPath,
  toolNames,
  windowsToolRoots,
  withPath,
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
