/**
 * Ouverture d'une application de la Suite Atelier depuis l'app de bureau (docs/SUITE.md §3, §9.4).
 *
 * Une adresse d'app de la suite (127.0.0.1 / localhost, port connu ; ou l'adresse en ligne
 * d'Atelier Cuisine, https) ouvre l'application installée :
 * - macOS : `/usr/bin/open -b <identifiant>` (liste fermée, sans shell) ;
 * - Windows (§9.6) : lanceur inscrit par l'app dans `HKCU\Software\Atelier\Apps\<viz|tab|projets>`
 *   (valeur `Lanceur` = raccourci `.lnk` du menu Démarrer), lu par PowerShell (sortie UTF-8 : chemins
 *   accentués), puis **toujours** ouvert par le shell : `explorer.exe "<Lanceur>"`, sans cmd.exe.
 *   L'Explorateur démarre l'app avec son propre environnement de session ; le chemin n'est jamais
 *   exécuté directement, quelle que soit son extension.
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
  /** Windows : démarrage d'`explorer.exe` sur le lanceur lu dans le registre. */
  spawnDetached?: SpawnDetachedFn
  /** Windows : le lanceur inscrit existe-t-il encore ? (défaut : oui) */
  exists?: (file: string) => boolean
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

/**
 * Variables transmises à une autre app de la suite (§9.4, liste de §9.6) : utilisateur, dossiers,
 * langue, fuseau. Noms comparés sans tenir compte de la casse (Windows).
 */
const MINIMAL_ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'USER',
  'USERNAME',
  'USERDOMAIN',
  'LOGNAME',
  'LANG',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'COMSPEC',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
]

/** PATH système POSIX transmis (le PATH d'un terminal de développement ne passe jamais). */
const POSIX_SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin'

/**
 * Environnement minimal passé à une autre app de la suite (docs/SUITE.md §9.4, §9.6) : liste
 * blanche (`MINIMAL_ENV_KEYS`, `LC_*`) et PATH système. Aucune variable de Tab (`ATELIER_*`),
 * d'Electron (`ELECTRON_*`), de Node.js (`NODE_*`), de Python (`PYTHON*`) ni de base
 * (`DATABASE_URL`). Windows : `systemPath` = PATH machine + utilisateur lu dans le registre ; à
 * défaut, PATH de la session nettoyé (entrées absolues, sans `node_modules\.bin`).
 */
export function minimalEnv(
  env: Record<string, string | undefined>,
  platform: string,
  systemPath?: string | null,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue
    const upper = key.toUpperCase()
    if (MINIMAL_ENV_KEYS.includes(upper) || upper.startsWith('LC_')) out[key] = value
  }
  out.PATH =
    platform === 'win32'
      ? cleanPathEntries((systemPath || envPathValue(env) || '').split(';'), 'win32').join(';')
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
 * Script PowerShell (texte fixe) : `Lanceur` de `HKCU\Software\Atelier\Apps\<clé>` — la clé arrive
 * par la variable `ATELIER_CLE_APP`, jamais dans la commande — et PATH machine + utilisateur du
 * registre (§9.6), en JSON UTF-8.
 */
export const REGISTRY_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
  "$cle = 'HKCU:\\Software\\Atelier\\Apps\\' + $env:ATELIER_CLE_APP",
  "$lanceur = [string](Get-ItemProperty -LiteralPath $cle -Name 'Lanceur').Lanceur",
  "$chemin = @([Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User')) -join ';'",
  '[Console]::Out.Write((ConvertTo-Json -Compress -InputObject @{ lanceur = $lanceur; path = $chemin }))',
].join('; ')

/** Lit le lanceur inscrit par une app de la suite (Windows) et le PATH du registre, ou null. */
function readRegisteredLauncher(
  appKey: string,
  deps: SuiteLaunchDeps,
): Promise<{ launcher: string; systemPath: string } | null> {
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
        (error, stdout) => resolve(error ? null : parseRegistryOutput(stdout ?? '')),
      )
    } catch {
      resolve(null)
    }
  })
}

/** Sortie JSON du script : `{ lanceur, path }` (BOM toléré), ou null. */
export function parseRegistryOutput(
  stdout: string,
): { launcher: string; systemPath: string } | null {
  try {
    const value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()) as unknown
    if (typeof value !== 'object' || value === null) return null
    const { lanceur, path: systemPath } = value as Record<string, unknown>
    if (typeof lanceur !== 'string' || lanceur.trim() === '') return null
    return {
      launcher: lanceur.trim(),
      systemPath: typeof systemPath === 'string' ? systemPath : '',
    }
  } catch {
    return null
  }
}

/**
 * Lanceur inscrit utilisable (§9.6) : chemin absolu Windows, sans guillemet, virgule (séparateur
 * des options d'explorer.exe) ni caractère de contrôle. Son extension n'importe pas : il est
 * toujours ouvert par l'Explorateur, jamais exécuté.
 */
export function isUsableLauncher(launcher: string): boolean {
  if (!/^(?:[A-Za-z]:\\|\\\\)/.test(launcher) || !path.win32.isAbsolute(launcher)) return false
  // eslint-disable-next-line no-control-regex
  return !/[",\u0000-\u001f]/.test(launcher)
}

/** Windows : ouvre l'app inscrite par `explorer.exe "<Lanceur>"` ; vrai si c'est parti. */
async function openRegistered(bundleId: string, deps: SuiteLaunchDeps): Promise<boolean> {
  const appKey = SUITE_WINDOWS_KEYS[bundleId]
  if (!appKey || !deps.spawnDetached) return false
  const found = await readRegisteredLauncher(appKey, deps)
  if (!found || !isUsableLauncher(found.launcher)) return false
  // Lanceur introuvable (app désinstallée, raccourci supprimé) : navigateur.
  if (!(deps.exists ?? (() => true))(found.launcher)) return false
  const env = deps.env ?? process.env
  return deps.spawnDetached(path.win32.join(systemRoot(env), 'explorer.exe'), [found.launcher], {
    env: minimalEnv(env, 'win32', found.systemPath),
    windowsHide: false,
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
