/**
 * Conversions entre trois représentations d'une cellule :
 * - la **saisie** de l'utilisateur (texte tapé dans la grille) ;
 * - la **valeur stockée** (`CellInput`, typée selon le champ, persistée) ;
 * - l'**entrée moteur** (ce que voit le moteur de formules).
 */
import { isFormula, type CellInput } from '@/engine/formula'
import type { Collaborator, Field } from '@/types/domain'

export interface LookupContext {
  collaborators: Record<string, Collaborator>
}

export type ParseResult = { ok: true; input: CellInput } | { ok: false; reason: string }

/**
 * Nombre saisi « à la française » ou « à l'anglaise » :
 * "45 000", "45 000,50 €", "1.234,56", "1,234.56", "-12,5 %".
 */
export function parseLocaleNumber(text: string): number | null {
  let t = text
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/[€$£%]|CHF/gi, '')
    .trim()
  if (t === '' || t === '-' || t === '+') return null

  const lastComma = t.lastIndexOf(',')
  const lastDot = t.lastIndexOf('.')
  if (lastComma !== -1 && lastDot !== -1) {
    // Le dernier séparateur rencontré est le séparateur décimal.
    t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  } else if (lastComma !== -1) {
    t = t.replace(',', '.')
  }
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return null
  return Number(t)
}

/** Date "JJ/MM/AAAA", "JJ/MM/AA", "JJ-MM-AAAA" ou "AAAA-MM-JJ" → "AAAA-MM-JJ". */
export function parseDate(text: string): string | null {
  const t = text.trim()
  let y: number, m: number, d: number
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)
  const fr = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t)
  if (iso) {
    y = Number(iso[1])
    m = Number(iso[2])
    d = Number(iso[3])
  } else if (fr) {
    d = Number(fr[1])
    m = Number(fr[2])
    y = Number(fr[3])
    if (y < 100) y += 2000
  } else {
    return null
  }
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null
  }
  return `${y.toString().padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const TRUE_WORDS = new Set(['true', 'vrai', 'oui', 'yes', 'x', '1', '✓'])
const FALSE_WORDS = new Set(['false', 'faux', 'non', 'no', '0', ''])

/** Convertit le texte tapé par l'utilisateur en valeur stockée pour ce champ. */
export function parseUserInput(field: Field, text: string, ctx: LookupContext): ParseResult {
  const raw = text.trim()
  if (raw === '') return { ok: true, input: null }
  if (isFormula(raw)) return { ok: true, input: raw }

  switch (field.type) {
    case 'text':
      return { ok: true, input: text }

    case 'number':
    case 'currency': {
      const n = parseLocaleNumber(raw)
      return n === null
        ? { ok: false, reason: `« ${raw} » n'est pas un nombre` }
        : { ok: true, input: n }
    }

    case 'percent': {
      const n = parseLocaleNumber(raw)
      // On tape « 20 » ou « 20 % » pour 20 % ; la valeur stockée est la fraction 0,2.
      return n === null
        ? { ok: false, reason: `« ${raw} » n'est pas un pourcentage` }
        : { ok: true, input: Number((n / 100).toPrecision(15)) }
    }

    case 'checkbox': {
      const w = raw.toLowerCase()
      if (TRUE_WORDS.has(w)) return { ok: true, input: true }
      if (FALSE_WORDS.has(w)) return { ok: true, input: false }
      return { ok: false, reason: 'Valeur attendue : oui / non' }
    }

    case 'select': {
      const choice = field.options?.choices?.find(
        (c) => c.label.localeCompare(raw, 'fr', { sensitivity: 'base' }) === 0 || c.id === raw,
      )
      return choice
        ? { ok: true, input: choice.id }
        : { ok: false, reason: `« ${raw} » ne fait pas partie des choix` }
    }

    case 'owner': {
      const person = Object.values(ctx.collaborators).find(
        (c) =>
          c.id === raw ||
          c.name.localeCompare(raw, 'fr', { sensitivity: 'base' }) === 0 ||
          c.initials.localeCompare(raw, 'fr', { sensitivity: 'base' }) === 0,
      )
      return person
        ? { ok: true, input: person.id }
        : { ok: false, reason: `Collaborateur inconnu : ${raw}` }
    }

    case 'date': {
      const iso = parseDate(raw)
      return iso ? { ok: true, input: iso } : { ok: false, reason: 'Date attendue : JJ/MM/AAAA' }
    }

    case 'formula':
      // Une colonne-formule reçoit soit une formule, soit une valeur forcée.
      return { ok: true, input: parseLocaleNumber(raw) ?? text }
  }
}

/**
 * Valeur vue par le moteur de formules. Les identifiants sont remplacés par des
 * libellés, pour que `=IF(B1="Validé", …)` fonctionne.
 */
export function toEngineInput(field: Field, stored: CellInput, ctx: LookupContext): CellInput {
  if (stored === null || isFormula(stored)) return stored
  switch (field.type) {
    case 'select':
      return field.options?.choices?.find((c) => c.id === stored)?.label ?? null
    case 'owner':
      return typeof stored === 'string' ? (ctx.collaborators[stored]?.name ?? null) : null
    default:
      return stored
  }
}

/** Texte à placer dans l'éditeur quand on commence à modifier une cellule. */
export function toEditText(field: Field, stored: CellInput, ctx: LookupContext): string {
  if (stored === null) return ''
  if (isFormula(stored)) return stored
  switch (field.type) {
    case 'percent':
      return typeof stored === 'number'
        ? String(Number((stored * 100).toPrecision(15))).replace('.', ',')
        : String(stored)
    case 'number':
    case 'currency':
      return typeof stored === 'number' ? String(stored).replace('.', ',') : String(stored)
    case 'checkbox':
      return stored === true ? 'oui' : 'non'
    case 'date':
      return typeof stored === 'string' ? stored.split('-').reverse().join('/') : String(stored)
    case 'select':
    case 'owner': {
      const v = toEngineInput(field, stored, ctx)
      return v === null ? '' : String(v)
    }
    default:
      return String(stored)
  }
}
