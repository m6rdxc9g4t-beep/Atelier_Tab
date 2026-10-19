/**
 * Garde-fou des écritures disque : toute cible doit rester sous le dossier attendu, même
 * si un identifiant venu de l'interface (ou d'un fichier édité à la main) contient `..`,
 * un séparateur ou un chemin absolu.
 */
import path from 'node:path'

export class UnsafePathError extends Error {
  constructor(base: string, relative: string) {
    super(`Chemin refusé hors de ${base} : ${relative}`)
    this.name = 'UnsafePathError'
  }
}

/** Vrai si `target` (absolu) est strictement sous `base`. */
export function isInside(base: string, target: string): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(target))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Chemin absolu de `relative` sous `base` ; lève `UnsafePathError` s'il en sort (ou désigne
 * `base` lui-même).
 */
export function resolveInside(base: string, relative: string): string {
  const target = path.resolve(base, relative)
  if (!isInside(base, target)) throw new UnsafePathError(base, relative)
  return target
}
