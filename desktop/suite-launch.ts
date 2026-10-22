/**
 * Ouverture d'une application de la Suite Atelier depuis l'app de bureau (docs/SUITE.md §3, §9.4).
 *
 * Une adresse d'app de la suite (127.0.0.1 / localhost, port connu ; ou l'adresse en ligne
 * d'Atelier Cuisine, https) ouvre l'application installée :
 * - macOS : `/usr/bin/open -b <identifiant>` (liste fermée, sans shell) ;
 * - Windows : lanceur enregistré par l'app dans `HKCU\Software\Atelier\Apps\<viz|tab|projets>`
 *   (valeur `Lanceur`), lu par PowerShell (sortie en UTF-8 : chemins accentués), démarré sans shell.
 * Si elle n'est pas installée (ou sous Linux), l'adresse part dans le navigateur par défaut.
 *
 * Environnement propre (§9.4) : l'app ouverte ne reçoit aucune variable de Tab, seulement un
 * environnement minimal (`minimalEnv`).
 */
import path from 'node:path'
import { cleanPathEntries, envPathValue } from './launcher/decision.cjs'

/** Port de l'interface → identifiant de l'application de bureau (contrat §3). */
export const SUITE_BUNDLES: Readonly<Record<string, string>> = {
  '8000': 'fr.atelier-viz.app',
  '4175': 'fr.atelier.tab',
  '4174': 'local.atelier-projets.desktop',
}

/**
 * Apps en ligne de la suite : hôte exact (https, port par défaut) → identifiant (contrat §3).
 * Atelier Cuisine : PWA sur Vercel, app Mac Tauri si installée.
 */
export const SUITE_ONLINE_BUNDLES: Readonly<Record<string, string>> = {
  'atelier-cuisine-iota.vercel.app': 'fr.ateliercuisine.app',
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

/** Identifiant de l'app de bureau correspondant à une adresse de la suite, sinon null. */
export function suiteBundleFor(url: unknown): string | null {
  if (typeof url !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (LOCAL_HOSTS.has(parsed.hostname)) return SUITE_BUNDLES[parsed.port] ?? null
  // App en ligne : https seulement, port par défaut, hôte exact (liste fermée).
  if (parsed.protocol !== 'https:' || parsed.port !== '') return null
  return Object.hasOwn(SUITE_ONLINE_BUNDLES, parsed.hostname)
    ? (SUITE_ONLINE_BUNDLES[parsed.hostname] ?? null)
    : null
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  options: { env: Record<string, string>; windowsHide?: boolean; timeout?: number },
  callback: (error: Error | null, stdout?: string) => unknown,
) => unknown

/** Démarre un programme détaché ; vrai s'il a pu être lancé. */
export type SpawnDetachedFn = (
  file: string,
  args: readonly string[],
  options: { env: Record<string, string>; windowsHide: boolean },
) => Promise<boolean>

export interface SuiteLaunchDeps {
  execFile: ExecFileFn
  openExternal: (url: string) => Promise<unknown>
  platform: string
  /** Environnement de l'app, d'où est tiré l'environnement minimal (défaut : `process.env`). */
  env?: Record<string, string | undefined>
  /** Windows : démarrage du lanceur lu dans le registre. */
  spawnDetached?: SpawnDetachedFn
  /**
   * Identifiant de l'app qui appelle (Tab : `fr.atelier.tab`) et moyen de ramener sa fenêtre.
   * Une adresse qui désigne l'app elle-même (ex. `http://127.0.0.1:4175`) ramène la fenêtre
   * au lieu de relancer `open -b` ou d'ouvrir le navigateur sur sa propre route de santé.
   */
  self?: { bundleId: string; focus: () => void }
}

/** Identifiant macOS → clé d'enregistrement Windows (`HKCU\Software\Atelier\Apps\<clé>`, §9.4). */
export const SUITE_WINDOWS_KEYS: Readonly<Record<string, string>> = {
  'fr.atelier-viz.app': 'viz',
  'fr.atelier.tab': 'tab',
  'local.atelier-projets.desktop': 'projets',
}

/** Variables transmises à une autre app de la suite (§9.4) : utilisateur, dossiers, langue, fuseau. */
const MINIMAL_ENV_KEYS = [
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LANGUAGE',
  'TZ',
  'TMPDIR',
  // Windows : profil, dossiers système et de l'utilisateur, interpréteur de commandes.
  'USERPROFILE',
  'USERNAME',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
]

/** PATH système POSIX transmis (le PATH d'un terminal de développement ne passe jamais). */
const POSIX_SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

/**
 * Environnement minimal passé à une autre app de la suite (docs/SUITE.md §9.4) : liste blanche
 * (`MINIMAL_ENV_KEYS`, `LC_*`) et PATH système. Aucune variable de Tab (`ATELIER_*`), d'Electron
 * (`ELECTRON_*`), de Node.js (`NODE_*`), de Python (`PYTHON*`) ni de base (`DATABASE_URL`).
 * Windows : PATH de la session nettoyé (entrées absolues, sans `node_modules\.bin`).
 */
export function minimalEnv(
  env: Record<string, string | undefined>,
  platform: string,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    const upper = key.toUpperCase()
    if (MINIMAL_ENV_KEYS.includes(upper) || upper.startsWith('LC_')) out[key] = value
  }
  out.PATH =
    platform === 'win32'
      ? cleanPathEntries((envPathValue(env) ?? '').split(';'), 'win32').join(';')
      : POSIX_SYSTEM_PATH
  return out
}

/** `open -b` : vrai si l'application a été trouvée et lancée. */
function openBundle(bundleId: string, deps: SuiteLaunchDeps): Promise<boolean> {
  const env = minimalEnv(deps.env ?? process.env, deps.platform)
  return new Promise((resolve) => {
    try {
      deps.execFile('/usr/bin/open', ['-b', bundleId], { env }, (error) => resolve(!error))
    } catch {
      resolve(false)
    }
  })
}

/** Dossier Windows (`%SystemRoot%`), par défaut `C:\Windows`. */
function systemRoot(env: Record<string, string | undefined>): string {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'SYSTEMROOT')
  return (key && env[key]) || 'C:\\Windows'
}

/**
 * Script PowerShell qui lit `Lanceur` dans `HKCU\Software\Atelier\Apps\<clé>` : texte fixe, la
 * clé arrive par la variable `ATELIER_CLE_APP` (jamais dans la commande), sortie en UTF-8.
 */
export const REGISTRY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  "$cle = 'HKCU:\\Software\\Atelier\\Apps\\' + $env:ATELIER_CLE_APP",
  "$valeur = (Get-ItemProperty -LiteralPath $cle -Name 'Lanceur').Lanceur",
  '[Console]::Out.Write([string]$valeur)',
].join('; ')

/** Lit le lanceur enregistré par une app de la suite (Windows), ou null. */
function readRegisteredLauncher(appKey: string, deps: SuiteLaunchDeps): Promise<string | null> {
  if (!/^[a-z]+$/.test(appKey)) return Promise.resolve(null)
  const env = deps.env ?? process.env
  const powershell = path.win32.join(
    systemRoot(env),
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const encoded = Buffer.from(REGISTRY_SCRIPT, 'utf16le').toString('base64')
  return new Promise((resolve) => {
    try {
      deps.execFile(
        powershell,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        {
          env: { ...minimalEnv(env, 'win32'), ATELIER_CLE_APP: appKey },
          windowsHide: true,
          timeout: 15_000,
        },
        (error, stdout) =>
          resolve(error ? null : (stdout ?? '').replace(/^\uFEFF/, '').trim() || null),
      )
    } catch {
      resolve(null)
    }
  })
}

/**
 * Commande qui démarre un lanceur enregistré (Windows), sans shell : `.exe` tel quel, `.vbs` /
 * `.js` / `.wsf` par `wscript.exe`, `.cmd` / `.bat` par `cmd.exe /d /c` (console masquée ; chemin
 * refusé s'il contient un caractère que cmd interpréterait). Autre chose, chemin relatif ou
 * suspect : null (navigateur).
 */
export function windowsLaunchCommand(
  launcher: string,
  env: Record<string, string | undefined>,
): { file: string; args: string[]; windowsHide: boolean } | null {
  if (!path.win32.isAbsolute(launcher) || !/^(?:[A-Za-z]:\\|\\\\)/.test(launcher)) return null
  // Caractères de contrôle et guillemets : jamais un chemin légitime.
  // eslint-disable-next-line no-control-regex
  if (/["\u0000-\u001f]/.test(launcher)) return null
  const ext = path.win32.extname(launcher).toLowerCase()
  const system32 = path.win32.join(systemRoot(env), 'System32')
  if (ext === '.exe') return { file: launcher, args: [], windowsHide: false }
  if (ext === '.vbs' || ext === '.js' || ext === '.wsf')
    return { file: path.win32.join(system32, 'wscript.exe'), args: [launcher], windowsHide: false }
  if (ext === '.cmd' || ext === '.bat') {
    if (/[%!^&|<>()]/.test(launcher)) return null
    return {
      file: path.win32.join(system32, 'cmd.exe'),
      args: ['/d', '/c', launcher],
      windowsHide: true,
    }
  }
  return null
}

/** Windows : démarre l'app enregistrée dans le registre ; vrai si elle a été lancée. */
async function openRegistered(bundleId: string, deps: SuiteLaunchDeps): Promise<boolean> {
  const appKey = SUITE_WINDOWS_KEYS[bundleId]
  if (!appKey || !deps.spawnDetached) return false
  const launcher = await readRegisteredLauncher(appKey, deps)
  if (!launcher) return false
  const env = deps.env ?? process.env
  const command = windowsLaunchCommand(launcher, env)
  if (!command) return false
  return deps.spawnDetached(command.file, command.args, {
    env: minimalEnv(env, 'win32'),
    windowsHide: command.windowsHide,
  })
}

/**
 * Ouvre l'application de bureau de la suite si l'adresse en désigne une (macOS, Windows),
 * sinon l'adresse dans le navigateur par défaut. Rend `'self'` (l'app elle-même, fenêtre
 * ramenée), `'app'` ou `'browser'`.
 */
export async function openSuiteOrExternal(
  url: string,
  deps: SuiteLaunchDeps,
): Promise<'self' | 'app' | 'browser'> {
  const bundleId = suiteBundleFor(url)
  if (bundleId && deps.self && bundleId === deps.self.bundleId) {
    deps.self.focus()
    return 'self'
  }
  if (bundleId && deps.platform === 'darwin' && (await openBundle(bundleId, deps))) return 'app'
  if (bundleId && deps.platform === 'win32' && (await openRegistered(bundleId, deps))) return 'app'
  await deps.openExternal(url)
  return 'browser'
}
