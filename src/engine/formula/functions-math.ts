/**
 * Fonctions mathématiques et statistiques (ENT, MOD, ARRONDI.SUP, PRODUIT, MEDIANE,
 * SOMMEPROD…). Mêmes règles que les agrégats de base : dans une plage, seuls les nombres
 * comptent ; un argument littéral est converti.
 */
import { normalizeNumber } from './coerce'
import { asRange, intArg, numArg, numbersOf, sameShape, type FunctionSpec } from './function-args'
import { err, isError, type CellValue } from './values'

type Impl = FunctionSpec['impl']

/** Décale la virgule de `digits` chiffres, en évitant les erreurs binaires (1.005 × 100). */
function shifted(x: number, digits: number): number {
  return Number((Math.abs(x) * 10 ** digits).toPrecision(15))
}

/** Arrondi « vers l'extérieur » (sup) ou « vers zéro » (inf) à `digits` chiffres. */
function roundWith(mode: 'up' | 'down'): Impl {
  return (args) => {
    const x = numArg(args[0])
    if (isError(x)) return x
    const d = intArg(args[1], 0)
    if (isError(d)) return d
    const s = shifted(x, d)
    const r = mode === 'up' ? Math.ceil(s) : Math.floor(s)
    return normalizeNumber((Math.sign(x) * r) / 10 ** d)
  }
}

/** Fonction d'une seule variable numérique. */
function unary(fn: (x: number) => number | CellValue): Impl {
  return (args) => {
    const x = numArg(args[0])
    if (isError(x)) return x
    const r = fn(x)
    return typeof r === 'number' ? normalizeNumber(r) : r
  }
}

/** Multiple le plus proche dans le sens donné (PLAFOND vers +∞, PLANCHER vers −∞). */
function toMultiple(dir: 'ceil' | 'floor'): Impl {
  return (args) => {
    const x = numArg(args[0])
    if (isError(x)) return x
    const sig = numArg(args[1], 1)
    if (isError(sig)) return sig
    if (sig === 0) return 0
    const step = Math.abs(sig)
    const q = Number((x / step).toPrecision(15))
    return normalizeNumber((dir === 'ceil' ? Math.ceil(q) : Math.floor(q)) * step)
  }
}

const mod: Impl = (args) => {
  const n = numArg(args[0])
  if (isError(n)) return n
  const d = numArg(args[1])
  if (isError(d)) return d
  if (d === 0) return err('#DIV/0!')
  // Le résultat a le signe du diviseur, comme dans Excel : MOD(-3; 2) = 1.
  return normalizeNumber(n - d * Math.floor(n / d))
}

const power: Impl = (args) => {
  const b = numArg(args[0])
  if (isError(b)) return b
  const e = numArg(args[1])
  if (isError(e)) return e
  if (b === 0 && e < 0) return err('#DIV/0!')
  const r = b ** e
  return Number.isNaN(r) ? err('#NUM!') : normalizeNumber(r)
}

const trunc: Impl = (args) => {
  const x = numArg(args[0])
  if (isError(x)) return x
  const d = intArg(args[1], 0)
  if (isError(d)) return d
  return normalizeNumber((Math.sign(x) * Math.floor(shifted(x, d))) / 10 ** d)
}

const product: Impl = (args) => {
  const nums = numbersOf(args)
  if (isError(nums)) return nums
  if (nums.length === 0) return 0
  return normalizeNumber(nums.reduce((acc, n) => acc * n, 1))
}

const median: Impl = (args) => {
  const nums = numbersOf(args)
  if (isError(nums)) return nums
  if (nums.length === 0) return err('#NUM!', 'Aucun nombre')
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
  return normalizeNumber(value)
}

/** k-ième plus grande (GRANDE.VALEUR) ou plus petite (PETITE.VALEUR) valeur. */
function kth(order: 'large' | 'small'): Impl {
  return (args) => {
    const nums = numbersOf([args[0] ?? null])
    if (isError(nums)) return nums
    const k = intArg(args[1])
    if (isError(k)) return k
    if (k < 1 || k > nums.length) return err('#NUM!', 'Rang hors de la plage')
    const sorted = [...nums].sort((a, b) => (order === 'large' ? b - a : a - b))
    return sorted[k - 1] as number
  }
}

/** SOMMEPROD : somme des produits terme à terme ; le texte et les vides comptent pour 0. */
const sumproduct: Impl = (args) => {
  const ranges = args.map(asRange)
  const first = ranges[0]
  if (!first) return err('#VALUE!')
  if (!ranges.every((r) => sameShape(r, first))) {
    return err('#VALUE!', 'Les plages de SOMMEPROD doivent avoir la même taille')
  }
  let total = 0
  for (let i = 0; i < first.rows.length; i++) {
    const width = first.rows[i]?.length ?? 0
    for (let j = 0; j < width; j++) {
      let p = 1
      for (const r of ranges) {
        const v = r.rows[i]?.[j] ?? null
        if (isError(v)) return v
        p *= typeof v === 'number' ? v : 0
      }
      total += p
    }
  }
  return normalizeNumber(total)
}

const countblank: Impl = (args) => {
  let n = 0
  for (const row of asRange(args[0] ?? null).rows) {
    for (const v of row) if (v === null || v === '') n++
  }
  return n
}

const log: Impl = (args) => {
  const x = numArg(args[0])
  if (isError(x)) return x
  const base = numArg(args[1], 10)
  if (isError(base)) return base
  if (x <= 0 || base <= 0 || base === 1) return err('#NUM!')
  return normalizeNumber(Math.log(x) / Math.log(base))
}

const positive = (fn: (x: number) => number) => (x: number) => (x > 0 ? fn(x) : err('#NUM!'))

export const MATH_FUNCTIONS: Record<string, FunctionSpec> = {
  INT: { minArgs: 1, maxArgs: 1, impl: unary(Math.floor) },
  TRUNC: { minArgs: 1, maxArgs: 2, impl: trunc },
  MOD: { minArgs: 2, maxArgs: 2, impl: mod },
  POWER: { minArgs: 2, maxArgs: 2, impl: power },
  SQRT: {
    minArgs: 1,
    maxArgs: 1,
    impl: unary((x) => (x < 0 ? err('#NUM!', 'Racine d’un nombre négatif') : Math.sqrt(x))),
  },
  ROUNDUP: { minArgs: 1, maxArgs: 2, impl: roundWith('up') },
  ROUNDDOWN: { minArgs: 1, maxArgs: 2, impl: roundWith('down') },
  CEILING: { minArgs: 1, maxArgs: 2, impl: toMultiple('ceil') },
  FLOOR: { minArgs: 1, maxArgs: 2, impl: toMultiple('floor') },
  SIGN: { minArgs: 1, maxArgs: 1, impl: unary(Math.sign) },
  PRODUCT: { minArgs: 1, maxArgs: Infinity, impl: product },
  MEDIAN: { minArgs: 1, maxArgs: Infinity, impl: median },
  LARGE: { minArgs: 2, maxArgs: 2, impl: kth('large') },
  SMALL: { minArgs: 2, maxArgs: 2, impl: kth('small') },
  SUMPRODUCT: { minArgs: 1, maxArgs: Infinity, impl: sumproduct },
  COUNTBLANK: { minArgs: 1, maxArgs: 1, impl: countblank },
  PI: { minArgs: 0, maxArgs: 0, impl: () => Math.PI },
  EXP: { minArgs: 1, maxArgs: 1, impl: unary(Math.exp) },
  LN: { minArgs: 1, maxArgs: 1, impl: unary(positive(Math.log)) },
  LOG: { minArgs: 1, maxArgs: 2, impl: log },
  LOG10: { minArgs: 1, maxArgs: 1, impl: unary(positive(Math.log10)) },
}
