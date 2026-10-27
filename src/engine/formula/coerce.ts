import { err, isError, type CellValue, type FormulaError } from './values'

const NUMERIC_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/** Arrondit à 15 chiffres significatifs, comme Excel (0.1 + 0.2 → 0.3). */
export function normalizeNumber(n: number): number | FormulaError {
  if (!Number.isFinite(n)) return err('#NUM!')
  if (n === 0) return 0
  return Number(n.toPrecision(15))
}

/**
 * Conversion en nombre pour l'arithmétique (vide → 0, booléen → 1/0, texte numérique accepté).
 * Une date « AAAA-MM-JJ » (valeur d'une colonne Date) devient son numéro de série, comme
 * dans Excel : `=Échéance - AUJOURDHUI()` donne un nombre de jours.
 */
export function toNumber(v: CellValue): number | FormulaError {
  if (isError(v)) return v
  if (v === null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const t = v.trim()
  if (NUMERIC_TEXT.test(t)) return Number(t)
  const serial = dateTextToSerial(t)
  if (serial !== null) return serial
  return err('#VALUE!', `« ${v} » n'est pas un nombre`)
}

// ---------------------------------------------------------------------------
// Dates : les colonnes Date stockent « AAAA-MM-JJ » ; le calcul passe par le numéro de
// série d'Excel (jours depuis le 30/12/1899), sans fuseau horaire (UTC).
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
const FR_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
const DAY_MS = 86_400_000
const EPOCH = Date.UTC(1899, 11, 30)

/** Numéro de série d'une date du calendrier (mois et jours qui débordent sont reportés). */
export function serialOf(year: number, month: number, day: number): number {
  return Math.round((Date.UTC(year, month - 1, day) - EPOCH) / DAY_MS)
}

/** Date « AAAA-MM-JJ » (ou « JJ/MM/AAAA ») → numéro de série ; null si ce n'est pas une date valide. */
export function dateTextToSerial(text: string): number | null {
  const iso = ISO_DATE.exec(text)
  const fr = iso ? null : FR_DATE.exec(text)
  const m = iso ?? fr
  if (!m) return null
  const [y, mo, d] = iso
    ? [Number(m[1]), Number(m[2]), Number(m[3])]
    : [Number(m[3]), Number(m[2]), Number(m[1])]
  const date = new Date(Date.UTC(y, mo - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null
  }
  const time = iso && m[4] !== undefined ? (Number(m[4]) * 60 + Number(m[5])) / 1440 : 0
  return serialOf(y, mo, d) + time
}

/** Numéro de série → « AAAA-MM-JJ » (la partie horaire est ignorée). */
export function serialToIso(serial: number): string {
  const date = new Date(EPOCH + Math.floor(serial) * DAY_MS)
  const y = date.getUTCFullYear().toString().padStart(4, '0')
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Texte numérique « à la française » ou « à l'anglaise » pour CNUM / VALUE :
 * « 1 234,5 », « 1,234.5 », « 12 % », « 45 000 € ». Null si illisible.
 */
export function parseNumberText(text: string): number | null {
  let t = text.replace(/[\s\u00a0\u202f]/g, '').replace(/[€$£]/g, '')
  const percent = t.endsWith('%')
  if (percent) t = t.slice(0, -1)
  if (t === '') return null
  const lastComma = t.lastIndexOf(',')
  const lastDot = t.lastIndexOf('.')
  if (lastComma !== -1 && lastDot !== -1) {
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (lastComma !== -1) {
    t = t.replace(',', '.')
  }
  if (!NUMERIC_TEXT.test(t)) return null
  const n = Number(t)
  return percent ? n / 100 : n
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

  // Date « AAAA-MM-JJ » comparée à un nombre (résultat de `=Date + 7`) : par numéro de série.
  if (typeof a === 'string' && typeof b === 'number') {
    const serial = dateTextToSerial(a.trim())
    if (serial !== null) return serial < b ? -1 : serial > b ? 1 : 0
  }
  if (typeof a === 'number' && typeof b === 'string') return -compareValues(b, a)

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
