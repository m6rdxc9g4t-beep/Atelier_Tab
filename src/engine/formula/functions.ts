/**
 * Bibliothèque de fonctions. Chaque fonction reçoit des arguments déjà évalués :
 * une valeur scalaire, ou une plage (`RangeValue`) quand l'argument est une
 * référence ou une plage de cellules.
 *
 * Règles Excel reproduites pour les agrégats (SUM, AVERAGE, MIN, MAX) :
 * - dans une plage ou une référence, seuls les nombres comptent (texte, booléens et
 *   cellules vides sont ignorés) ;
 * - un argument littéral est converti (`SUM("3", TRUE)` vaut 4) ;
 * - une erreur rencontrée est propagée.
 *
 * IF et IFERROR sont évalués paresseusement par l'évaluateur, pas ici.
 */
import { normalizeNumber, toBoolean, toNumber, toText } from './coerce'
import { err, isError, isRange, type Arg, type CellValue, type FormulaError } from './values'

export interface FunctionSpec {
  minArgs: number
  maxArgs: number // Infinity = variadique
  impl: (args: Arg[]) => CellValue
}

/** Nombres d'une liste d'arguments, ou la première erreur rencontrée. */
function numbersOf(args: Arg[]): number[] | FormulaError {
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
function flatten(args: Arg[]): CellValue[] {
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

const sum: FunctionSpec['impl'] = (args) => {
  const nums = numbersOf(args)
  if (isError(nums)) return nums
  return normalizeNumber(nums.reduce((acc, n) => acc + n, 0))
}

const average: FunctionSpec['impl'] = (args) => {
  const nums = numbersOf(args)
  if (isError(nums)) return nums
  if (nums.length === 0) return err('#DIV/0!', 'Moyenne d’une plage sans nombre')
  return normalizeNumber(nums.reduce((acc, n) => acc + n, 0) / nums.length)
}

const min: FunctionSpec['impl'] = (args) => {
  const nums = numbersOf(args)
  if (isError(nums)) return nums
  return nums.length === 0 ? 0 : Math.min(...nums)
}

const max: FunctionSpec['impl'] = (args) => {
  const nums = numbersOf(args)
  if (isError(nums)) return nums
  return nums.length === 0 ? 0 : Math.max(...nums)
}

const count: FunctionSpec['impl'] = (args) => {
  let n = 0
  for (const a of args) {
    if (isRange(a)) {
      for (const row of a.rows) for (const v of row) if (typeof v === 'number') n++
    } else if (!isError(a) && !isError(toNumber(a)) && a !== null) {
      n++
    }
  }
  return n
}

const counta: FunctionSpec['impl'] = (args) =>
  flatten(args).filter((v) => v !== null && v !== '').length

const round: FunctionSpec['impl'] = (args) => {
  const x = toNumber(scalarOf(args[0] ?? null))
  if (isError(x)) return x
  const d = toNumber(scalarOf(args[1] ?? 0))
  if (isError(d)) return d
  const digits = Math.trunc(d)
  const factor = 10 ** digits
  // Arrondi « au plus loin de zéro » (Excel), robuste aux erreurs binaires (1.005 → 1.01).
  const shifted = Number((Math.abs(x) * factor).toPrecision(15))
  return normalizeNumber((Math.sign(x) * Math.round(shifted)) / factor)
}

const abs: FunctionSpec['impl'] = (args) => {
  const x = toNumber(scalarOf(args[0] ?? null))
  return isError(x) ? x : Math.abs(x)
}

function logical(args: Arg[], mode: 'and' | 'or'): CellValue {
  let seen = false
  let acc = mode === 'and'
  for (const v of flatten(args)) {
    if (isError(v)) return v
    if (v === null || typeof v === 'string') continue // ignorés, comme dans Excel
    const b = toBoolean(v)
    if (isError(b)) return b
    seen = true
    acc = mode === 'and' ? acc && b : acc || b
  }
  return seen ? acc : err('#VALUE!', 'Aucune valeur logique')
}

const not: FunctionSpec['impl'] = (args) => {
  const b = toBoolean(scalarOf(args[0] ?? null))
  return isError(b) ? b : !b
}

const concat: FunctionSpec['impl'] = (args) => {
  let s = ''
  for (const v of flatten(args)) {
    const t = toText(v)
    if (isError(t)) return t
    s += t
  }
  return s
}

const BASE: Record<string, FunctionSpec> = {
  SUM: { minArgs: 1, maxArgs: Infinity, impl: sum },
  AVERAGE: { minArgs: 1, maxArgs: Infinity, impl: average },
  MIN: { minArgs: 1, maxArgs: Infinity, impl: min },
  MAX: { minArgs: 1, maxArgs: Infinity, impl: max },
  COUNT: { minArgs: 1, maxArgs: Infinity, impl: count },
  COUNTA: { minArgs: 1, maxArgs: Infinity, impl: counta },
  ROUND: { minArgs: 1, maxArgs: 2, impl: round },
  ABS: { minArgs: 1, maxArgs: 1, impl: abs },
  AND: { minArgs: 1, maxArgs: Infinity, impl: (a) => logical(a, 'and') },
  OR: { minArgs: 1, maxArgs: Infinity, impl: (a) => logical(a, 'or') },
  NOT: { minArgs: 1, maxArgs: 1, impl: not },
  CONCAT: { minArgs: 1, maxArgs: Infinity, impl: concat },
}

/** Alias : noms courts de la spec (AVG) et noms Excel français. */
const ALIASES: Record<string, string> = {
  AVG: 'AVERAGE',
  CONCATENATE: 'CONCAT',
  SOMME: 'SUM',
  MOYENNE: 'AVERAGE',
  NB: 'COUNT',
  NBVAL: 'COUNTA',
  ARRONDI: 'ROUND',
  ET: 'AND',
  OU: 'OR',
  NON: 'NOT',
  CONCATENER: 'CONCAT',
}

/** Fonctions à évaluation paresseuse, traitées par l'évaluateur. */
export const LAZY_FUNCTIONS: Record<string, 'IF' | 'IFERROR'> = {
  IF: 'IF',
  SI: 'IF',
  IFERROR: 'IFERROR',
  SIERREUR: 'IFERROR',
}

export function resolveFunction(name: string): FunctionSpec | undefined {
  return BASE[ALIASES[name] ?? name]
}

/** Noms reconnus (pour l'autocomplétion de la barre de formules). */
export function listFunctionNames(): string[] {
  return [...Object.keys(BASE), ...Object.keys(LAZY_FUNCTIONS), ...Object.keys(ALIASES)].sort()
}
