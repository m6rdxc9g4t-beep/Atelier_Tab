/**
 * Outils communs aux bibliothèques de fonctions : lecture et conversion des arguments.
 *
 * Une fonction reçoit des arguments déjà évalués : une valeur scalaire, ou une plage
 * (`RangeValue`) quand l'argument est une référence ou une plage de cellules.
 */
import { toBoolean, toNumber, toText } from './coerce'
import {
  err,
  isError,
  isRange,
  type Arg,
  type CellValue,
  type FormulaError,
  type RangeValue,
} from './values'

export interface FunctionSpec {
  minArgs: number
  maxArgs: number // Infinity = variadique
  impl: (args: Arg[]) => CellValue
}

/** Nombres d'une liste d'arguments, ou la première erreur rencontrée. */
export function numbersOf(args: Arg[]): number[] | FormulaError {
  const out: number[] = []
  for (const a of args) {
    if (isRange(a)) {
      for (const row of a.rows) {
        for (const v of row) {
          if (isError(v)) return v
          if (typeof v === 'number') out.push(v)
        }
      }
    } else {
      const n = toNumber(a)
      if (isError(n)) return n
      out.push(n)
    }
  }
  return out
}

/** Aplatit les arguments en une liste de valeurs (plages déroulées ligne par ligne). */
export function flatten(args: Arg[]): CellValue[] {
  const out: CellValue[] = []
  for (const a of args) {
    if (isRange(a)) for (const row of a.rows) out.push(...row)
    else out.push(a)
  }
  return out
}

/** Une plage passée là où une valeur unique est attendue : seule une cellule 1×1 est acceptée. */
export function scalarOf(a: Arg): CellValue {
  if (!isRange(a)) return a
  const first = a.rows[0]?.[0]
  if (a.rows.length === 1 && a.rows[0]?.length === 1 && first !== undefined) return first
  return err('#VALUE!', 'Une plage ne peut pas être utilisée comme valeur unique')
}

/** Argument vu comme une plage (une valeur seule devient une plage 1×1). */
export function asRange(a: Arg): RangeValue {
  return isRange(a) ? a : { kind: 'range', rows: [[a]] }
}

/** Valeurs d'une plage à une dimension (ligne ou colonne), sinon `null`. */
export function vectorOf(a: Arg): CellValue[] | null {
  const r = asRange(a)
  if (r.rows.length === 1) return [...(r.rows[0] ?? [])]
  if (r.rows.every((row) => row.length === 1)) return r.rows.map((row) => row[0] ?? null)
  return null
}

/** Argument numérique facultatif : absent → `fallback`. */
export function numArg(a: Arg | undefined, fallback = 0): number | FormulaError {
  if (a === undefined) return fallback
  return toNumber(scalarOf(a))
}

/** Argument entier (tronqué vers zéro, comme Excel). */
export function intArg(a: Arg | undefined, fallback = 0): number | FormulaError {
  const n = numArg(a, fallback)
  return isError(n) ? n : Math.trunc(n)
}

export function textArg(a: Arg | undefined, fallback = ''): string | FormulaError {
  if (a === undefined) return fallback
  return toText(scalarOf(a))
}

export function boolArg(a: Arg | undefined, fallback: boolean): boolean | FormulaError {
  if (a === undefined) return fallback
  return toBoolean(scalarOf(a))
}

/** Plages de même forme ? (lignes × colonnes) */
export function sameShape(a: RangeValue, b: RangeValue): boolean {
  return a.rows.length === b.rows.length && (a.rows[0]?.length ?? 0) === (b.rows[0]?.length ?? 0)
}
