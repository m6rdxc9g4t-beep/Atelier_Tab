import { err, isError, type CellValue, type FormulaError } from './values'

const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/** Arrondit à 15 chiffres significatifs, comme Excel (0.1 + 0.2 → 0.3). */
export function normalizeNumber(n: number): number | FormulaError {
  if (!Number.isFinite(n)) return err('#NUM!')
  if (n === 0) return 0
  return Number(n.toPrecision(15))
}

/** Conversion en nombre pour l'arithmétique (vide → 0, booléen → 1/0, texte numérique accepté). */
export function toNumber(v: CellValue): number | FormulaError {
  if (isError(v)) return v
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const t = v.trim()
  if (NUMERIC_TEXT.test(t)) return Number(t)
  return err('#VALUE!', `« ${v} » n'est pas un nombre`)
}

/** Conversion en texte pour la concaténation. */
export function toText(v: CellValue): string | FormulaError {
  if (isError(v)) return v
  if (v === null) return ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return formatNumberAsText(v)
  return v
}

export function formatNumberAsText(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toPrecision(15)))
}

/** Conversion en booléen pour IF / AND / OR / NOT. */
export function toBoolean(v: CellValue): boolean | FormulaError {
  if (isError(v)) return v
  if (v === null) return false
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const t = v.trim().toUpperCase()
  if (t === 'TRUE' || t === 'VRAI') return true
  if (t === 'FALSE' || t === 'FAUX') return false
  return err('#VALUE!', `« ${v} » n'est pas une valeur logique`)
}

/**
 * Comparaison à la manière d'Excel : nombres < textes < booléens, textes insensibles
 * à la casse, cellule vide assimilée à 0 / "" / FALSE selon l'autre opérande.
 * Renvoie un entier négatif, nul ou positif.
 */
export function compareValues(
  a: Exclude<CellValue, FormulaError>,
  b: Exclude<CellValue, FormulaError>,
): number {
  if (a === null) return b === null ? 0 : compareValues(emptyLike(b), b)
  if (b === null) return compareValues(a, emptyLike(a))

  const rank = (x: number | string | boolean) =>
    typeof x === 'number' ? 0 : typeof x === 'string' ? 1 : 2
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb

  if (typeof a === 'string' && typeof b === 'string') {
    const la = a.toLocaleLowerCase('fr')
    const lb = b.toLocaleLowerCase('fr')
    return la < lb ? -1 : la > lb ? 1 : 0
  }
  const na = Number(a)
  const nb = Number(b)
  return na < nb ? -1 : na > nb ? 1 : 0
}

function emptyLike(v: number | string | boolean): number | string | boolean {
  return typeof v === 'number' ? 0 : typeof v === 'string' ? '' : false
}
