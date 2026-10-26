/**
 * Agrégats conditionnels (SOMME.SI, NB.SI.ENS, MOYENNE.SI…) et fonctions de recherche
 * (RECHERCHEV, RECHERCHEX, INDEX, EQUIV, CHOISIR).
 *
 * Critères à la manière d'Excel : `5`, `">100"`, `"<>Terminée"`, `"En*"` (jokers `*` et `?`,
 * `~` pour échapper), `""` (cellule vide), `"<>"` (non vide), `"<2026-12-01"` (date). Une date
 * « AAAA-MM-JJ » vaut son numéro de série, face à un critère numérique (`">="&AUJOURDHUI()-30`)
 * comme dans les agrégats (MAX.SI.ENS renvoie la date la plus récente).
 */
import { compareValues, dateTextToSerial, normalizeNumber, parseNumberText } from './coerce'
import {
  asRange,
  boolArg,
  intArg,
  numArg,
  numberInRange,
  scalarOf,
  sameShape,
  vectorOf,
  type FunctionSpec,
} from './function-args'
import { wildcardToRegExp } from './functions-text'
import {
  err,
  isError,
  type Arg,
  type CellValue,
  type FormulaError,
  type RangeValue,
} from './values'

type Impl = FunctionSpec['impl']
type Test = (v: CellValue) => boolean

const OPERATOR = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/

/**
 * Valeur d'une cellule pour l'égalité avec un critère numérique : nombre, texte numérique, ou
 * date « AAAA-MM-JJ » par son numéro de série.
 */
function numericOf(v: CellValue): number | null {
  if (typeof v === 'number') return v
  if (typeof v !== 'string') return null
  const t = v.trim()
  return parseNumberText(t) ?? dateTextToSerial(t)
}

const isEmpty = (v: CellValue) => v === null || v === ''

function compareWith(op: string, diff: number): boolean {
  switch (op) {
    case '<':
      return diff < 0
    case '>':
      return diff > 0
    case '<=':
      return diff <= 0
    case '>=':
      return diff >= 0
    case '<>':
      return diff !== 0
    default:
      return diff === 0
  }
}

/** Critère d'Excel → fonction de test d'une cellule. */
export function criterionTest(criterion: CellValue): Test | FormulaError {
  if (isError(criterion)) return criterion
  if (criterion === null) return isEmpty
  if (typeof criterion === 'number') return (v) => numericOf(v) === criterion
  if (typeof criterion === 'boolean') return (v) => v === criterion

  const [, op = '', rest = ''] = OPERATOR.exec(criterion) as RegExpExecArray
  const upper = rest.trim().toUpperCase()

  if (rest === '') {
    if (op === '<>') return (v) => !isEmpty(v)
    if (op === '' || op === '=') return isEmpty
  }

  const n = parseNumberText(rest.trim())
  if (n !== null) {
    if (op === '' || op === '=' || op === '<>') {
      return (v) => (numericOf(v) === n) === (op !== '<>')
    }
    // <, >, <=, >= : nombres et dates seulement, pas le texte numérique. Un critère calculé
    // à partir d'une date (`">="&AUJOURDHUI()-30` donne `">=46290"`) vise donc les dates.
    return (v) => {
      const x = numberInRange(v)
      return x !== null && compareWith(op, x - n)
    }
  }

  const date = dateTextToSerial(rest.trim())
  if (date !== null) {
    // Critère de date : une cellule saisie « JJ/MM/AAAA » compte aussi.
    return (v) => {
      const s =
        typeof v === 'number' ? v : typeof v === 'string' ? dateTextToSerial(v.trim()) : null
      if (s === null) return op === '<>'
      return compareWith(op, Math.floor(s) - date)
    }
  }

  if (upper === 'TRUE' || upper === 'VRAI' || upper === 'FALSE' || upper === 'FAUX') {
    const b = upper === 'TRUE' || upper === 'VRAI'
    return (v) => (v === b) === (op !== '<>')
  }

  if (op === '' || op === '=' || op === '<>') {
    const re = wildcardToRegExp(rest, true)
    const want = op !== '<>'
    return (v) => (typeof v === 'string' && re.test(v)) === want
  }
  return (v) => typeof v === 'string' && compareWith(op, compareValues(v, rest))
}

/** Paires (plage, critère) de NB.SI.ENS / SOMME.SI.ENS, toutes de même forme que `shape`. */
function criteriaPairs(
  args: Arg[],
  shape: RangeValue,
): { range: RangeValue; test: Test }[] | FormulaError {
  if (args.length === 0 || args.length % 2 !== 0) {
    return err('#VALUE!', 'Les plages et les critères vont par paires')
  }
  const out: { range: RangeValue; test: Test }[] = []
  for (let i = 0; i < args.length; i += 2) {
    const range = asRange(args[i] ?? null)
    if (!sameShape(range, shape)) {
      return err('#VALUE!', 'Toutes les plages de critères doivent avoir la même taille')
    }
    const test = criterionTest(scalarOf(args[i + 1] ?? null))
    if (isError(test)) return test
    out.push({ range, test })
  }
  return out
}

/** Valeurs de `target` dont la position satisfait tous les critères. */
function selected(target: RangeValue, pairs: { range: RangeValue; test: Test }[]): CellValue[] {
  const out: CellValue[] = []
  pairs[0]?.range.rows.forEach((row, i) =>
    row.forEach((_, j) => {
      if (pairs.every((p) => p.test(p.range.rows[i]?.[j] ?? null))) {
        out.push(target.rows[i]?.[j] ?? null)
      }
    }),
  )
  return out
}

type Reducer = 'sum' | 'average' | 'max' | 'min'

function reduce(values: CellValue[], how: Reducer): CellValue {
  const nums: number[] = []
  for (const v of values) {
    if (isError(v)) return v
    const n = numberInRange(v)
    if (n !== null) nums.push(n)
  }
  switch (how) {
    case 'sum':
      return normalizeNumber(nums.reduce((a, n) => a + n, 0))
    case 'average':
      return nums.length === 0
        ? err('#DIV/0!', 'Aucune valeur ne remplit le critère')
        : normalizeNumber(nums.reduce((a, n) => a + n, 0) / nums.length)
    case 'max':
      return nums.length === 0 ? 0 : Math.max(...nums)
    case 'min':
      return nums.length === 0 ? 0 : Math.min(...nums)
  }
}

/** SOMME.SI / MOYENNE.SI : (plage; critère; [plage_calcul]). */
function ifOne(how: Reducer): Impl {
  return (args) => {
    const range = asRange(args[0] ?? null)
    const target = args[2] === undefined ? range : asRange(args[2])
    const test = criterionTest(scalarOf(args[1] ?? null))
    if (isError(test)) return test
    return reduce(selected(target, [{ range, test }]), how)
  }
}

/** SOMME.SI.ENS, MOYENNE.SI.ENS, MAX.SI.ENS, MIN.SI.ENS : (plage_calcul; plage1; critère1; …). */
function ifMany(how: Reducer): Impl {
  return (args) => {
    const target = asRange(args[0] ?? null)
    const pairs = criteriaPairs(args.slice(1), target)
    if (isError(pairs)) return pairs
    return reduce(selected(target, pairs), how)
  }
}

const countif: Impl = (args) => {
  const range = asRange(args[0] ?? null)
  const test = criterionTest(scalarOf(args[1] ?? null))
  if (isError(test)) return test
  return selected(range, [{ range, test }]).length
}

const countifs: Impl = (args) => {
  const shape = asRange(args[0] ?? null)
  const pairs = criteriaPairs(args, shape)
  if (isError(pairs)) return pairs
  return selected(shape, pairs).length
}

// ---------------------------------------------------------------------------
// Recherche
// ---------------------------------------------------------------------------

const hasWildcard = (v: CellValue) => typeof v === 'string' && /[*?~]/.test(v)

/** Égalité de recherche : jokers pour un texte qui en contient, sinon comparaison Excel. */
function exactTest(lookup: CellValue, wildcards: boolean): Test {
  if (wildcards && typeof lookup === 'string' && hasWildcard(lookup)) {
    const re = wildcardToRegExp(lookup, true)
    return (v) => typeof v === 'string' && re.test(v)
  }
  return (v) =>
    !isError(v) && !isError(lookup) && sameKind(v, lookup) && compareValues(v, lookup) === 0
}

/** Même famille de valeur (nombre, texte, booléen) ; une date ISO compte comme un nombre. */
function sameKind(a: CellValue, b: CellValue): boolean {
  if (a === null || b === null) return a === b
  const kind = (v: CellValue) =>
    typeof v === 'string' && dateTextToSerial(v.trim()) !== null ? 'number' : typeof v
  return kind(a) === kind(b)
}

/**
 * Position dans un vecteur : exacte (0), la plus grande valeur ≤ (1, vecteur trié croissant)
 * ou la plus petite valeur ≥ (-1, vecteur trié décroissant), comme EQUIV.
 */
function findIndex(vector: CellValue[], lookup: CellValue, mode: 0 | 1 | -1): number {
  if (mode === 0) return vector.findIndex(exactTest(lookup, true))
  let found = -1
  for (let i = 0; i < vector.length; i++) {
    const v = vector[i] ?? null
    if (isError(v) || isError(lookup) || v === null || !sameKind(v, lookup)) continue
    const diff = compareValues(v, lookup)
    if (mode === 1 ? diff <= 0 : diff >= 0) found = i
    else break
  }
  return found
}

const notFound = () => err('#N/A', 'Valeur introuvable')

/** RECHERCHEV / RECHERCHEH. */
function lookupIn(axis: 'v' | 'h'): Impl {
  return (args) => {
    const lookup = scalarOf(args[0] ?? null)
    if (isError(lookup)) return lookup
    const table = asRange(args[1] ?? null)
    const index = intArg(args[2])
    if (isError(index)) return index
    // Quatrième argument lu comme une valeur logique : FAUX, 0 ou une cellule vide → exacte.
    const approx = boolArg(args[3], true)
    if (isError(approx)) return approx
    const width = axis === 'v' ? (table.rows[0]?.length ?? 0) : table.rows.length
    if (index < 1) return err('#VALUE!', 'Le numéro de colonne commence à 1')
    if (index > width) return err('#REF!', 'Numéro de colonne au-delà de la plage')
    const keys = axis === 'v' ? table.rows.map((r) => r[0] ?? null) : [...(table.rows[0] ?? [])]
    const i = findIndex(keys, lookup, approx ? 1 : 0)
    if (i === -1) return notFound()
    return (axis === 'v' ? table.rows[i]?.[index - 1] : table.rows[index - 1]?.[i]) ?? null
  }
}

const match: Impl = (args) => {
  const lookup = scalarOf(args[0] ?? null)
  if (isError(lookup)) return lookup
  const vector = vectorOf(args[1] ?? null)
  if (!vector) return err('#N/A', 'EQUIV cherche dans une seule ligne ou une seule colonne')
  const type = intArg(args[2], 1)
  if (isError(type)) return type
  const mode = type > 0 ? 1 : type < 0 ? -1 : 0
  const i = findIndex(vector, lookup, mode)
  return i === -1 ? notFound() : i + 1
}

const index: Impl = (args) => {
  const range = asRange(args[0] ?? null)
  const a = intArg(args[1], 1)
  if (isError(a)) return a
  const b = args[2] === undefined ? null : intArg(args[2])
  if (b !== null && isError(b)) return b
  const height = range.rows.length
  const width = range.rows[0]?.length ?? 0
  let row: number
  let col: number
  if (b === null) {
    // INDEX(ligne_ou_colonne; n) : position dans le vecteur.
    if (height === 1) [row, col] = [1, a]
    else if (width === 1) [row, col] = [a, 1]
    else return err('#VALUE!', 'Précisez la ligne et la colonne')
  } else {
    row = height === 1 && a === 0 ? 1 : a
    col = width === 1 && b === 0 ? 1 : b
  }
  if (row < 1 || col < 1) return err('#VALUE!', 'Ligne et colonne commencent à 1')
  if (row > height || col > width) return err('#REF!', 'Position hors de la plage')
  return range.rows[row - 1]?.[col - 1] ?? null
}

const xlookup: Impl = (args) => {
  const lookup = scalarOf(args[0] ?? null)
  if (isError(lookup)) return lookup
  const keys = vectorOf(args[1] ?? null)
  if (!keys) return err('#VALUE!', 'La plage de recherche doit être une ligne ou une colonne')
  const result = asRange(args[2] ?? null)
  const byRow = asRange(args[1] ?? null).rows.length > 1
  const resultLength = byRow ? result.rows.length : (result.rows[0]?.length ?? 0)
  if (resultLength !== keys.length) {
    return err('#VALUE!', 'Les plages de recherche et de résultat doivent avoir la même taille')
  }
  const mode = intArg(args[4], 0)
  if (isError(mode)) return mode
  const search = intArg(args[5], 1)
  if (isError(search)) return search

  const order = keys.map((_, i) => i)
  if (search < 0) order.reverse()
  const exact = exactTest(lookup, mode === 2)
  let best = -1
  for (const i of order) {
    const v = keys[i] ?? null
    if (exact(v)) {
      best = i
      break
    }
    // -1 : valeur exacte ou la plus grande inférieure ; 1 : exacte ou la plus petite supérieure.
    if (mode !== -1 && mode !== 1) continue
    if (v === null || isError(v) || !sameKind(v, lookup)) continue
    const diff = compareValues(v, lookup as Exclude<CellValue, FormulaError>)
    if (mode === -1 ? diff > 0 : diff < 0) continue
    const current = best === -1 ? null : (keys[best] as Exclude<CellValue, FormulaError>)
    if (
      current === null ||
      (mode === -1 ? compareValues(v, current) > 0 : compareValues(v, current) < 0)
    ) {
      best = i
    }
  }
  if (best === -1) return args[3] === undefined ? notFound() : scalarOf(args[3])
  return (byRow ? result.rows[best]?.[0] : result.rows[0]?.[best]) ?? null
}

const choose: Impl = (args) => {
  const i = numArg(args[0])
  if (isError(i)) return i
  const n = Math.trunc(i)
  if (n < 1 || n >= args.length) return err('#VALUE!', 'Index hors de la liste')
  return scalarOf(args[n] ?? null)
}

export const LOOKUP_FUNCTIONS: Record<string, FunctionSpec> = {
  SUMIF: { minArgs: 2, maxArgs: 3, impl: ifOne('sum') },
  AVERAGEIF: { minArgs: 2, maxArgs: 3, impl: ifOne('average') },
  COUNTIF: { minArgs: 2, maxArgs: 2, impl: countif },
  SUMIFS: { minArgs: 3, maxArgs: Infinity, impl: ifMany('sum') },
  AVERAGEIFS: { minArgs: 3, maxArgs: Infinity, impl: ifMany('average') },
  MAXIFS: { minArgs: 3, maxArgs: Infinity, impl: ifMany('max') },
  MINIFS: { minArgs: 3, maxArgs: Infinity, impl: ifMany('min') },
  COUNTIFS: { minArgs: 2, maxArgs: Infinity, impl: countifs },
  VLOOKUP: { minArgs: 3, maxArgs: 4, impl: lookupIn('v') },
  HLOOKUP: { minArgs: 3, maxArgs: 4, impl: lookupIn('h') },
  MATCH: { minArgs: 2, maxArgs: 3, impl: match },
  INDEX: { minArgs: 2, maxArgs: 3, impl: index },
  XLOOKUP: { minArgs: 3, maxArgs: 6, impl: xlookup },
  CHOOSE: { minArgs: 2, maxArgs: Infinity, impl: choose },
}
