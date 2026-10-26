/**
 * Bibliothèque de fonctions. Chaque fonction reçoit des arguments déjà évalués :
 * une valeur scalaire, ou une plage (`RangeValue`) quand l'argument est une
 * référence ou une plage de cellules.
 *
 * Règles Excel reproduites pour les agrégats (SUM, AVERAGE, MIN, MAX) :
 * - dans une plage ou une référence, seuls les nombres comptent (texte, booléens et
 *   cellules vides sont ignorés) ; une date « AAAA-MM-JJ » compte pour son numéro de série ;
 * - un argument littéral est converti (`SUM("3", TRUE)` vaut 4) ;
 * - une erreur rencontrée est propagée.
 *
 * IF et IFERROR sont évalués paresseusement par l'évaluateur, pas ici.
 */
import { normalizeNumber, toBoolean, toNumber, toText } from './coerce'
import { flatten, numberInRange, numbersOf, scalarOf, type FunctionSpec } from './function-args'
import { DATE_FUNCTIONS } from './functions-date'
import { INFO_FUNCTIONS } from './functions-info'
import { LOOKUP_FUNCTIONS } from './functions-lookup'
import { MATH_FUNCTIONS } from './functions-math'
import { TEXT_FUNCTIONS } from './functions-text'
import { err, isError, isRange, type Arg, type CellValue } from './values'

export { scalarOf, type FunctionSpec }

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
      for (const row of a.rows) for (const v of row) if (numberInRange(v) !== null) n++
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
  ...MATH_FUNCTIONS,
  ...TEXT_FUNCTIONS,
  ...DATE_FUNCTIONS,
  ...LOOKUP_FUNCTIONS,
  ...INFO_FUNCTIONS,
}

/** Alias : noms courts de la spec (AVG) et noms Excel français. */
export const ALIASES: Record<string, string> = {
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
  // Mathématiques et statistiques
  ENT: 'INT',
  TRONQUE: 'TRUNC',
  PUISSANCE: 'POWER',
  RACINE: 'SQRT',
  'ARRONDI.SUP': 'ROUNDUP',
  'ARRONDI.INF': 'ROUNDDOWN',
  PLAFOND: 'CEILING',
  'PLAFOND.MATH': 'CEILING.MATH',
  PLANCHER: 'FLOOR',
  'PLANCHER.MATH': 'FLOOR.MATH',
  SIGNE: 'SIGN',
  PRODUIT: 'PRODUCT',
  MEDIANE: 'MEDIAN',
  'GRANDE.VALEUR': 'LARGE',
  'PETITE.VALEUR': 'SMALL',
  SOMMEPROD: 'SUMPRODUCT',
  'NB.VIDE': 'COUNTBLANK',
  // Texte
  GAUCHE: 'LEFT',
  DROITE: 'RIGHT',
  STXT: 'MID',
  NBCAR: 'LEN',
  MAJUSCULE: 'UPPER',
  MINUSCULE: 'LOWER',
  NOMPROPRE: 'PROPER',
  SUPPRESPACE: 'TRIM',
  SUBSTITUE: 'SUBSTITUTE',
  REMPLACER: 'REPLACE',
  TROUVE: 'FIND',
  CHERCHE: 'SEARCH',
  'JOINDRE.TEXTE': 'TEXTJOIN',
  TEXTE: 'TEXT',
  CNUM: 'VALUE',
  CAR: 'CHAR',
  // Dates
  AUJOURDHUI: 'TODAY',
  ANNEE: 'YEAR',
  MOIS: 'MONTH',
  JOUR: 'DAY',
  JOURSEM: 'WEEKDAY',
  'MOIS.DECALER': 'EDATE',
  'FIN.MOIS': 'EOMONTH',
  JOURS: 'DAYS',
  'NB.JOURS.OUVRES': 'NETWORKDAYS',
  'SERIE.JOUR.OUVRE': 'WORKDAY',
  'NO.SEMAINE.ISO': 'ISOWEEKNUM',
  // Recherche et agrégats conditionnels
  'SOMME.SI': 'SUMIF',
  'SOMME.SI.ENS': 'SUMIFS',
  'NB.SI': 'COUNTIF',
  'NB.SI.ENS': 'COUNTIFS',
  'MOYENNE.SI': 'AVERAGEIF',
  'MOYENNE.SI.ENS': 'AVERAGEIFS',
  'MAX.SI.ENS': 'MAXIFS',
  'MIN.SI.ENS': 'MINIFS',
  RECHERCHEV: 'VLOOKUP',
  RECHERCHEH: 'HLOOKUP',
  RECHERCHEX: 'XLOOKUP',
  EQUIV: 'MATCH',
  CHOISIR: 'CHOOSE',
  // Information et logique
  ESTVIDE: 'ISBLANK',
  ESTNUM: 'ISNUMBER',
  ESTTEXTE: 'ISTEXT',
  ESTLOGIQUE: 'ISLOGICAL',
  ESTERREUR: 'ISERROR',
  ESTNA: 'ISNA',
  'SI.NON.DISP': 'IFNA',
  'SI.CONDITIONS': 'IFS',
  'SI.MULTIPLE': 'SWITCH',
  OUX: 'XOR',
  VRAI: 'TRUE',
  FAUX: 'FALSE',
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
