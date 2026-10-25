/**
 * Fonctions de date (AUJOURDHUI, DATE, ANNEE, DATEDIF, MOIS.DECALER, NB.JOURS.OUVRES…).
 *
 * Une colonne Date stocke « AAAA-MM-JJ » : les fonctions acceptent ce texte, une date
 * « JJ/MM/AAAA » ou un numéro de série Excel, et renvoient une date au format
 * « AAAA-MM-JJ » (affichée JJ/MM/AAAA dans une colonne Date ou une formule au format date).
 * Calculs en UTC : aucun décalage de fuseau horaire.
 */
import { dateTextToSerial, serialOf, serialToIso } from './coerce'
import { asRange, intArg, scalarOf, textArg, type FunctionSpec } from './function-args'
import { err, isError, type Arg, type FormulaError } from './values'

type Impl = FunctionSpec['impl']

/** Horloge utilisée par AUJOURDHUI() ; remplaçable dans les tests. */
export const clock = { now: (): Date => new Date() }

interface Ymd {
  y: number
  m: number
  d: number
}

/** Numéro de série d'un argument date (texte ISO, texte JJ/MM/AAAA ou nombre). */
export function serialArg(a: Arg | undefined): number | FormulaError {
  const v = scalarOf(a ?? null)
  if (isError(v)) return v
  if (typeof v === 'number') return Math.floor(v)
  if (typeof v === 'string') {
    const s = dateTextToSerial(v.trim())
    if (s !== null) return Math.floor(s)
  }
  return err('#VALUE!', `« ${String(v ?? '')} » n'est pas une date`)
}

function ymdOf(serial: number): Ymd {
  const [y, m, d] = serialToIso(serial).split('-').map(Number) as [number, number, number]
  return { y, m, d }
}

function dateArg(a: Arg | undefined): Ymd | FormulaError {
  const s = serialArg(a)
  return isError(s) ? s : ymdOf(s)
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Date décalée de `months` mois, jour ramené à la fin du mois si besoin (31/01 + 1 → 28/02). */
function addMonths({ y, m, d }: Ymd, months: number): Ymd {
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = total - ny * 12 + 1
  return { y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) }
}

const iso = ({ y, m, d }: Ymd) => serialToIso(serialOf(y, m, d))

const today: Impl = () => {
  const now = clock.now()
  return iso({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() })
}

const date: Impl = (args) => {
  let y = intArg(args[0])
  if (isError(y)) return y
  const m = intArg(args[1])
  if (isError(m)) return m
  const d = intArg(args[2])
  if (isError(d)) return d
  // Comme Excel : une année de 0 à 1899 est comptée à partir de 1900.
  if (y >= 0 && y < 1900) y += 1900
  if (y < 0 || y > 9999) return err('#NUM!', 'Année hors limites')
  return serialToIso(serialOf(y, m, d))
}

function part(key: keyof Ymd): Impl {
  return (args) => {
    const v = dateArg(args[0])
    return isError(v) ? v : v[key]
  }
}

const weekday: Impl = (args) => {
  const s = serialArg(args[0])
  if (isError(s)) return s
  const type = intArg(args[1], 1)
  if (isError(type)) return type
  const { y, m, d } = ymdOf(s)
  const sunday0 = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const monday0 = (sunday0 + 6) % 7
  if (type === 1) return sunday0 + 1
  if (type === 2) return monday0 + 1
  if (type === 3) return monday0
  return err('#NUM!', 'Type de JOURSEM : 1, 2 ou 3')
}

const datedif: Impl = (args) => {
  const s = serialArg(args[0])
  if (isError(s)) return s
  const e = serialArg(args[1])
  if (isError(e)) return e
  const unit = textArg(args[2])
  if (isError(unit)) return unit
  if (s > e) return err('#NUM!', 'La date de début doit précéder la date de fin')
  const a = ymdOf(s)
  const b = ymdOf(e)
  let months = (b.y - a.y) * 12 + (b.m - a.m)
  if (b.d < a.d) months--
  switch (unit.trim().toUpperCase()) {
    case 'Y':
      return Math.floor(months / 12)
    case 'M':
      return months
    case 'D':
      return e - s
    case 'YM':
      return months % 12
    case 'MD': {
      if (b.d >= a.d) return b.d - a.d
      const prev = b.m === 1 ? { y: b.y - 1, m: 12 } : { y: b.y, m: b.m - 1 }
      return daysInMonth(prev.y, prev.m) - a.d + b.d
    }
    case 'YD': {
      let start = serialOf(b.y, a.m, Math.min(a.d, daysInMonth(b.y, a.m)))
      if (start > e) start = serialOf(b.y - 1, a.m, Math.min(a.d, daysInMonth(b.y - 1, a.m)))
      return e - start
    }
    default:
      return err('#NUM!', 'Unité de DATEDIF : "Y", "M", "D", "YM", "MD" ou "YD"')
  }
}

const edate: Impl = (args) => {
  const v = dateArg(args[0])
  if (isError(v)) return v
  const n = intArg(args[1])
  return isError(n) ? n : iso(addMonths(v, n))
}

const eomonth: Impl = (args) => {
  const v = dateArg(args[0])
  if (isError(v)) return v
  const n = intArg(args[1])
  if (isError(n)) return n
  const t = addMonths({ ...v, d: 1 }, n)
  return iso({ ...t, d: daysInMonth(t.y, t.m) })
}

const days: Impl = (args) => {
  const e = serialArg(args[0])
  if (isError(e)) return e
  const s = serialArg(args[1])
  return isError(s) ? s : e - s
}

/** Jours fériés (plage ou liste) → ensemble de numéros de série. */
function holidaySet(a: Arg | undefined): Set<number> | FormulaError {
  const out = new Set<number>()
  if (a === undefined) return out
  for (const row of asRange(a).rows) {
    for (const v of row) {
      if (v === null || v === '') continue
      const s = serialArg(v)
      if (isError(s)) return s
      out.add(s)
    }
  }
  return out
}

const isWeekend = (serial: number) => {
  // Le 30/12/1899 (série 0) est un samedi.
  const dow = ((serial % 7) + 7) % 7
  return dow === 0 || dow === 1
}

const networkdays: Impl = (args) => {
  const s = serialArg(args[0])
  if (isError(s)) return s
  const e = serialArg(args[1])
  if (isError(e)) return e
  const holidays = holidaySet(args[2])
  if (isError(holidays)) return holidays
  const [lo, hi, sign] = s <= e ? [s, e, 1] : [e, s, -1]
  if (hi - lo > 365_000) return err('#NUM!')
  let n = 0
  for (let d = lo; d <= hi; d++) if (!isWeekend(d) && !holidays.has(d)) n++
  return n * sign
}

const workday: Impl = (args) => {
  const s = serialArg(args[0])
  if (isError(s)) return s
  const count = intArg(args[1])
  if (isError(count)) return count
  const holidays = holidaySet(args[2])
  if (isError(holidays)) return holidays
  if (Math.abs(count) > 100_000) return err('#NUM!')
  const step = count >= 0 ? 1 : -1
  let d = s
  for (let left = Math.abs(count); left > 0; ) {
    d += step
    if (!isWeekend(d) && !holidays.has(d)) left--
  }
  return serialToIso(d)
}

/** Numéro de semaine ISO 8601 (semaine du lundi, la semaine 1 contient le premier jeudi). */
const isoweeknum: Impl = (args) => {
  const s = serialArg(args[0])
  if (isError(s)) return s
  const { y, m, d } = ymdOf(s)
  // Jeudi de la semaine de la date, puis jeudi de la semaine du 4 janvier de son année.
  const thursday = new Date(Date.UTC(y, m - 1, d))
  thursday.setUTCDate(thursday.getUTCDate() - ((thursday.getUTCDay() + 6) % 7) + 3)
  const first = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4))
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7) + 3)
  return 1 + Math.round((thursday.getTime() - first.getTime()) / (7 * 86_400_000))
}

export const DATE_FUNCTIONS: Record<string, FunctionSpec> = {
  TODAY: { minArgs: 0, maxArgs: 0, impl: today },
  DATE: { minArgs: 3, maxArgs: 3, impl: date },
  YEAR: { minArgs: 1, maxArgs: 1, impl: part('y') },
  MONTH: { minArgs: 1, maxArgs: 1, impl: part('m') },
  DAY: { minArgs: 1, maxArgs: 1, impl: part('d') },
  WEEKDAY: { minArgs: 1, maxArgs: 2, impl: weekday },
  DATEDIF: { minArgs: 3, maxArgs: 3, impl: datedif },
  EDATE: { minArgs: 2, maxArgs: 2, impl: edate },
  EOMONTH: { minArgs: 2, maxArgs: 2, impl: eomonth },
  DAYS: { minArgs: 2, maxArgs: 2, impl: days },
  NETWORKDAYS: { minArgs: 2, maxArgs: 3, impl: networkdays },
  WORKDAY: { minArgs: 2, maxArgs: 3, impl: workday },
  ISOWEEKNUM: { minArgs: 1, maxArgs: 1, impl: isoweeknum },
}
