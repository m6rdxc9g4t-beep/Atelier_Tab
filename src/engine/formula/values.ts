/**
 * Valeurs manipulées par le moteur de formules.
 *
 * - `null` représente une cellule vide.
 * - Les erreurs sont des instances de `FormulaError` (jamais des chaînes), pour qu'une
 *   cellule contenant le texte "#REF!" ne soit pas confondue avec une vraie erreur.
 */

export type ErrorCode =
  '#REF!' | '#DIV/0!' | '#VALUE!' | '#NAME?' | '#NUM!' | '#N/A' | '#CYCLE!' | '#ERROR!'

export const ERROR_CODES: readonly ErrorCode[] = [
  '#REF!',
  '#DIV/0!',
  '#VALUE!',
  '#NAME?',
  '#NUM!',
  '#N/A',
  '#CYCLE!',
  '#ERROR!',
]

const ERROR_DESCRIPTIONS: Record<ErrorCode, string> = {
  '#REF!': 'Référence invalide (cellule supprimée ou hors de la grille)',
  '#DIV/0!': 'Division par zéro',
  '#VALUE!': 'Type de valeur incorrect pour cette opération',
  '#NAME?': 'Fonction inconnue',
  '#NUM!': 'Résultat numérique invalide',
  '#N/A': 'Valeur non disponible',
  '#CYCLE!': 'Référence circulaire',
  '#ERROR!': 'Formule mal formée',
}

export class FormulaError {
  readonly code: ErrorCode
  readonly message: string

  constructor(code: ErrorCode, message?: string) {
    this.code = code
    this.message = message ?? ERROR_DESCRIPTIONS[code]
  }

  toString(): string {
    return this.code
  }
}

export type Scalar = number | string | boolean | null
export type CellValue = Scalar | FormulaError

/** Plage évaluée, passée aux fonctions (`SUM(A1:B3)`) : lignes × colonnes. */
export interface RangeValue {
  readonly kind: 'range'
  readonly rows: CellValue[][]
}

export type Arg = CellValue | RangeValue

export function isError(v: unknown): v is FormulaError {
  return v instanceof FormulaError
}

export function isRange(v: Arg): v is RangeValue {
  return typeof v === 'object' && v !== null && !(v instanceof FormulaError) && v.kind === 'range'
}

export function err(code: ErrorCode, message?: string): FormulaError {
  return new FormulaError(code, message)
}

/** Égalité de valeurs (deux erreurs de même code sont égales). */
export function sameValue(a: CellValue, b: CellValue): boolean {
  if (isError(a) || isError(b)) return isError(a) && isError(b) && a.code === b.code
  return Object.is(a, b)
}

/** Représentation sérialisable (export JSON, affichage brut). */
export function serializeValue(v: CellValue): Scalar {
  return isError(v) ? v.code : v
}
