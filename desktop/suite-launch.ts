/**
 * Ouverture d'une application de la Suite Atelier depuis l'app de bureau (docs/SUITE.md §3).
 *
 * Une adresse d'app de la suite (127.0.0.1 / localhost, port connu) ouvre l'application
 * installée avec `/usr/bin/open -b <identifiant>` (macOS, liste fermée, sans shell) ;
 * si elle n'est pas installée ou hors macOS, l'adresse part dans le navigateur par défaut.
 */

/** Port de l'interface → identifiant de l'application de bureau (contrat §3). */
export const SUITE_BUNDLES: Readonly<Record<string, string>> = {
  '8000': 'fr.atelier-viz.app',
  '4175': 'fr.atelier.tab',
  '4174': 'local.atelier-projets.desktop',
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
  if (!LOCAL_HOSTS.has(parsed.hostname)) return null
  return SUITE_BUNDLES[parsed.port] ?? null
}

export type ExecFileFn = (
  file: string,
  args: readonly string[],
  callback: (error: Error | null) => void,
) => unknown

export interface SuiteLaunchDeps {
  execFile: ExecFileFn
  openExternal: (url: string) => Promise<unknown>
  platform: string
  /**
   * Identifiant de l'app qui appelle (Tab : `fr.atelier.tab`) et moyen de ramener sa fenêtre.
   * Une adresse qui désigne l'app elle-même (ex. `http://127.0.0.1:4175`) ramène la fenêtre
   * au lieu de relancer `open -b` ou d'ouvrir le navigateur sur sa propre route de santé.
   */
  self?: { bundleId: string; focus: () => void }
}

/** `open -b` : vrai si l'application a été trouvée et lancée. */
function openBundle(bundleId: string, execFile: ExecFileFn): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile('/usr/bin/open', ['-b', bundleId], (error) => resolve(!error))
    } catch {
      resolve(false)
    }
  })
}

/**
 * Ouvre l'application de bureau de la suite si l'adresse en désigne une (macOS),
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
  if (bundleId && deps.platform === 'darwin' && (await openBundle(bundleId, deps.execFile)))
    return 'app'
  await deps.openExternal(url)
  return 'browser'
}
