/**
 * Fonctions de texte (GAUCHE, STXT, NBCAR, SUBSTITUE, CHERCHE, TEXTE, CNUM…).
 * Les positions sont comptées à partir de 1, comme dans Excel.
 */
import { dateTextToSerial, parseNumberText, serialToIso, toText } from './coerce'
import {
  boolArg,
  flatten,
  intArg,
  numArg,
  scalarOf,
  textArg,
  type FunctionSpec,
} from './function-args'
import { err, isError, type CellValue } from './values'

type Impl = FunctionSpec['impl']

/** Longueur maximale d'un texte produit (limite d'une cellule Excel). */
const MAX_TEXT = 32_767

const left: Impl = (args) => {
  const t = textArg(args[0])
  if (isError(t)) return t
  const n = intArg(args[1], 1)
  if (isError(n)) return n
  return n < 0 ? err('#VALUE!') : t.slice(0, n)
}

const right: Impl = (args) => {
  const t = textArg(args[0])
  if (isError(t)) return t
  const n = intArg(args[1], 1)
  if (isError(n)) return n
  if (n < 0) return err('#VALUE!')
  return n === 0 ? '' : t.slice(-n)
}

const mid: Impl = (args) => {
  const t = textArg(args[0])
  if (isError(t)) return t
  const start = intArg(args[1])
  if (isError(start)) return start
  const n = intArg(args[2])
  if (isError(n)) return n
  if (start < 1 || n < 0) return err('#VALUE!')
  return t.slice(start - 1, start - 1 + n)
}

function textMap(fn: (t: string) => CellValue): Impl {
  return (args) => {
    const t = textArg(args[0])
    return isError(t) ? t : fn(t)
  }
}

const proper = (t: string) =>
  t
    .toLocaleLowerCase('fr')
    .replace(
      /(^|[^\p{L}\p{N}'’])(\p{L})/gu,
      (_, sep: string, c: string) => sep + c.toLocaleUpperCase('fr'),
    )

const substitute: Impl = (args) => {
  const t = textArg(args[0])
  if (isError(t)) return t
  const from = textArg(args[1])
  if (isError(from)) return from
  const to = textArg(args[2])
  if (isError(to)) return to
  if (from === '') return t
  if (args[3] === undefined) return t.split(from).join(to)
  const nth = intArg(args[3])
  if (isError(nth)) return nth
  if (nth < 1) return err('#VALUE!')
  let pos = -1
  for (let i = 0; i < nth; i++) {
    pos = t.indexOf(from, pos + 1)
    if (pos === -1) return t
  }
  return t.slice(0, pos) + to + t.slice(pos + from.length)
}

const replace: Impl = (args) => {
  const t = textArg(args[0])
  if (isError(t)) return t
  const start = intArg(args[1])
  if (isError(start)) return start
  const n = intArg(args[2])
  if (isError(n)) return n
  const by = textArg(args[3])
  if (isError(by)) return by
  if (start < 1 || n < 0) return err('#VALUE!')
  return t.slice(0, start - 1) + by + t.slice(start - 1 + n)
}

/** Motif à jokers d'Excel (`*`, `?`, `~` pour échapper) → expression régulière. */
export function wildcardToRegExp(pattern: string, whole: boolean): RegExp {
  let src = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string
    if (c === '~' && i + 1 < pattern.length) {
      src += escapeRe(pattern[++i] as string)
    } else if (c === '*') src += '[\\s\\S]*'
    else if (c === '?') src += '[\\s\\S]'
    else src += escapeRe(c)
  }
  return new RegExp(whole ? `^${src}$` : src, 'iu')
}

function escapeRe(c: string): string {
  return c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/** TROUVE (sensible à la casse) ou CHERCHE (insensible, avec jokers). */
function findWith(mode: 'find' | 'search'): Impl {
  return (args) => {
    const needle = textArg(args[0])
    if (isError(needle)) return needle
    const hay = textArg(args[1])
    if (isError(hay)) return hay
    const start = intArg(args[2], 1)
    if (isError(start)) return start
    if (start < 1 || start > hay.length + 1) return err('#VALUE!')
    const from = start - 1
    let pos: number
    if (mode === 'find') {
      pos = hay.indexOf(needle, from)
    } else {
      const m = wildcardToRegExp(needle, false).exec(hay.slice(from))
      pos = m ? m.index + from : -1
    }
    return pos === -1 ? err('#VALUE!', `« ${needle} » est introuvable`) : pos + 1
  }
}

const rept: Impl = (args) => {
  const t = textArg(args[0])
  if (isError(t)) return t
  const n = intArg(args[1])
  if (isError(n)) return n
  if (n < 0 || t.length * n > MAX_TEXT) return err('#VALUE!')
  return t.repeat(n)
}

const exact: Impl = (args) => {
  const a = textArg(args[0])
  if (isError(a)) return a
  const b = textArg(args[1])
  return isError(b) ? b : a === b
}

const textjoin: Impl = (args) => {
  const sep = textArg(args[0])
  if (isError(sep)) return sep
  const skipEmpty = boolArg(args[1], true)
  if (isError(skipEmpty)) return skipEmpty
  const parts: string[] = []
  for (const v of flatten(args.slice(2))) {
    const t = toText(v)
    if (isError(t)) return t
    if (skipEmpty && t === '') continue
    parts.push(t)
  }
  const out = parts.join(sep)
  return out.length > MAX_TEXT ? err('#VALUE!') : out
}

const value: Impl = (args) => {
  const v = scalarOf(args[0] ?? null)
  if (isError(v)) return v
  if (typeof v === 'number') return v
  if (v === null) return 0
  if (typeof v === 'boolean') return err('#VALUE!')
  const t = v.trim()
  const n = parseNumberText(t) ?? dateTextToSerial(t)
  return n === null ? err('#VALUE!', `« ${v} » n'est pas un nombre`) : n
}

// ---------------------------------------------------------------------------
// TEXTE(valeur; format) : sous-ensemble courant des formats Excel.
// ---------------------------------------------------------------------------

const MONTHS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]
const MONTHS_SHORT = [
  'janv.',
  'févr.',
  'mars',
  'avr.',
  'mai',
  'juin',
  'juil.',
  'août',
  'sept.',
  'oct.',
  'nov.',
  'déc.',
]
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

/** Format de date : jj/mm/aaaa, dd/mm/yyyy, mmmm aaaa, jjjj… (jamais d'heures). */
const DATE_FORMAT = /^[\s\S]*(a|y|j|d|m)[\s\S]*$/i
const DATE_TOKEN = /aaaa|yyyy|aa|yy|mmmm|mmm|mm|m|jjjj|dddd|jjj|ddd|jj|dd|j|d|"[^"]*"/gi

function formatDatePattern(serial: number, pattern: string): string {
  const [y, mo, d] = serialToIso(serial).split('-').map(Number) as [number, number, number]
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
  return pattern.replace(DATE_TOKEN, (tok) => {
    if (tok.startsWith('"')) return tok.slice(1, -1)
    switch (tok.toLowerCase()) {
      case 'aaaa':
      case 'yyyy':
        return String(y).padStart(4, '0')
      case 'aa':
      case 'yy':
        return String(y % 100).padStart(2, '0')
      case 'mmmm':
        return MONTHS[mo - 1] as string
      case 'mmm':
        return MONTHS_SHORT[mo - 1] as string
      case 'mm':
        return String(mo).padStart(2, '0')
      case 'm':
        return String(mo)
      case 'jjjj':
      case 'dddd':
        return WEEKDAYS[weekday] as string
      case 'jjj':
      case 'ddd':
        return (WEEKDAYS[weekday] as string).slice(0, 3) + '.'
      case 'jj':
      case 'dd':
        return String(d).padStart(2, '0')
      default:
        return String(d)
    }
  })
}

/** Format numérique : 0 / # / séparateurs / %, avec texte avant et après (« 0,00 € »). */
function formatNumberPattern(n: number, pattern: string): string | null {
  const m = /^([^0#]*)([0#][0#\s.,\u00a0\u202f]*)([^0#]*)$/.exec(pattern)
  if (!m) return null
  const [, prefixRaw = '', body = '', suffixRaw = ''] = m
  const literal = (s: string) => s.replace(/"([^"]*)"/g, '$1')
  const prefix = literal(prefixRaw)
  const suffix = literal(suffixRaw)
  const percent = suffix.includes('%') || prefix.includes('%')
  const core = body.trimEnd()
  // Virgule décimale à la française (« 0,00 », « 0,000 kg »), sauf groupement à l'anglaise :
  // virgule précédée d'un # et suivie de trois chiffres (« #,##0 »), ou plusieurs virgules.
  let decimalSep: string | null = null
  if (core.includes('.')) decimalSep = '.'
  else if (
    core.includes(',') &&
    !/#,[#0]{3}(?![#0])/.test(core) &&
    (core.match(/,/g) ?? []).length === 1
  ) {
    decimalSep = ','
  }
  const [intPart = '', decPart = ''] = decimalSep ? core.split(decimalSep) : [core, '']
  const decimals = (decPart.match(/[0#]/g) ?? []).length
  const minDecimals = (decPart.match(/0/g) ?? []).length
  const grouping = /[#0][\s,\u00a0\u202f][#0]/.test(intPart)
  const minInt = (intPart.match(/0/g) ?? []).length
  // Au-delà, Intl.NumberFormat lève une exception : format refusé (#VALUE!).
  if (minInt > 21 || decimals > 100) return null
  const out = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: decimals,
    minimumIntegerDigits: Math.max(1, minInt),
    useGrouping: grouping,
  }).format(percent ? n * 100 : n)
  // Un format sans 0 avant la virgule (#,00) n'affiche pas le zéro des unités.
  const trimmed = minInt === 0 && Math.abs(n) < 1 ? out.replace(/^(-?)0(?=,)/, '$1') : out
  return prefix + trimmed + body.slice(core.length) + suffix
}

const text: Impl = (args) => {
  const v = scalarOf(args[0] ?? null)
  if (isError(v)) return v
  const pattern = textArg(args[1])
  if (isError(pattern)) return pattern
  if (v === null || typeof v === 'boolean') return toText(v)
  const isDate =
    DATE_FORMAT.test(pattern.replace(/"[^"]*"/g, '')) &&
    !/[0#]/.test(pattern.replace(/"[^"]*"/g, ''))
  if (isDate) {
    const serial = typeof v === 'number' ? v : dateTextToSerial(v.trim())
    if (serial === null) return v
    return formatDatePattern(serial, pattern)
  }
  const n = typeof v === 'number' ? v : (parseNumberText(v) ?? dateTextToSerial(v.trim()))
  if (n === null) return v
  return formatNumberPattern(n, pattern) ?? err('#VALUE!', `Format non reconnu : « ${pattern} »`)
}

/** NBCAR compte les unités UTF-16, comme Excel et les fonctions de position (😀 = 2). */
const len: Impl = (args) => {
  const t = textArg(args[0])
  return isError(t) ? t : t.length
}

const char: Impl = (args) => {
  const n = numArg(args[0])
  if (isError(n)) return n
  return n < 1 || n > 0x10ffff ? err('#VALUE!') : String.fromCodePoint(Math.trunc(n))
}

export const TEXT_FUNCTIONS: Record<string, FunctionSpec> = {
  LEFT: { minArgs: 1, maxArgs: 2, impl: left },
  RIGHT: { minArgs: 1, maxArgs: 2, impl: right },
  MID: { minArgs: 3, maxArgs: 3, impl: mid },
  LEN: { minArgs: 1, maxArgs: 1, impl: len },
  UPPER: { minArgs: 1, maxArgs: 1, impl: textMap((t) => t.toLocaleUpperCase('fr')) },
  LOWER: { minArgs: 1, maxArgs: 1, impl: textMap((t) => t.toLocaleLowerCase('fr')) },
  PROPER: { minArgs: 1, maxArgs: 1, impl: textMap(proper) },
  TRIM: { minArgs: 1, maxArgs: 1, impl: textMap((t) => t.trim().replace(/ {2,}/g, ' ')) },
  SUBSTITUTE: { minArgs: 3, maxArgs: 4, impl: substitute },
  REPLACE: { minArgs: 4, maxArgs: 4, impl: replace },
  FIND: { minArgs: 2, maxArgs: 3, impl: findWith('find') },
  SEARCH: { minArgs: 2, maxArgs: 3, impl: findWith('search') },
  REPT: { minArgs: 2, maxArgs: 2, impl: rept },
  EXACT: { minArgs: 2, maxArgs: 2, impl: exact },
  TEXTJOIN: { minArgs: 3, maxArgs: Infinity, impl: textjoin },
  TEXT: { minArgs: 2, maxArgs: 2, impl: text },
  VALUE: { minArgs: 1, maxArgs: 1, impl: value },
  CHAR: { minArgs: 1, maxArgs: 1, impl: char },
}
