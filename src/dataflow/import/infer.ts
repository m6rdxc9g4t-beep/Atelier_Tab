/**
 * Inférence du type d'une colonne importée et de son rôle pour Atelier Projets.
 *
 * Les formats français sont reconnus : « 45 000,50 € », « 12,5 % », « 18/10/2026 »,
 * « Oui / Non ». Une colonne de texte qui répète peu de valeurs devient un statut
 * (`select`), avec des badges aux couleurs officielles pour les statuts de workflow.
 */
import {
  parseDate,
  parseLocaleNumber,
  workflowStatusCode,
  type LookupContext,
} from '@/engine/field-types'
import type { AtelierMapping, CurrencyCode, FieldType } from '@/types/domain'

export interface InferredType {
  type: FieldType
  /** Champ `currency` : devise reconnue. */
  currency?: CurrencyCode
}

const TRUE_WORDS = ['oui', 'vrai', 'true', 'yes', 'x', '✓']
const FALSE_WORDS = ['non', 'faux', 'false', 'no']
const BOOL_WORDS = new Set([...TRUE_WORDS, ...FALSE_WORDS, '0', '1'])

const CURRENCY_HEADER =
  /(€|\beur\b|prix|co[uû]t|montant|budget|tarif|\bht\b|\bttc\b|d[ée]pense|recette)/i

/** Part de valeurs reconnues suffisante pour un nombre ou une date, à partir de 10 valeurs. */
const TOLERANCE = 0.9
const TOLERANCE_MIN_VALUES = 10

/** Libellé de statut court : au-delà, c'est probablement du texte libre. */
const MAX_CHOICE_LENGTH = 40
const MAX_CHOICES = 24

function currencyOf(value: string): CurrencyCode | null {
  if (value.includes('€')) return 'EUR'
  if (value.includes('$')) return 'USD'
  if (value.includes('£')) return 'GBP'
  if (/chf/i.test(value)) return 'CHF'
  return null
}

/** Type le plus précis compatible avec toutes les valeurs non vides de la colonne. */
export function inferFieldType(
  header: string,
  values: readonly string[],
  ctx: LookupContext,
): InferredType {
  if (values.length === 0) return { type: 'text' }

  // Sur un échantillon suffisant, quelques valeurs mal saisies (« dix mille », « à voir »)
  // n'empêchent pas une colonne d'être reconnue : elles seront signalées à l'import.
  const n = values.length
  const mostly = (k: number) => k === n || (n >= TOLERANCE_MIN_VALUES && k / n >= TOLERANCE)

  if (mostly(values.filter((v) => parseDate(v) !== null).length)) return { type: 'date' }

  const lower = values.map((v) => v.toLowerCase())
  if (
    lower.every((v) => BOOL_WORDS.has(v)) &&
    lower.some((v) => TRUE_WORDS.includes(v) || FALSE_WORDS.includes(v))
  ) {
    return { type: 'checkbox' }
  }

  const numeric = values.filter((v) => parseLocaleNumber(v) !== null)
  if (mostly(numeric.length)) {
    const percents = numeric.filter((v) => v.includes('%')).length
    if (percents > numeric.length / 2) return { type: 'percent' }
    for (const v of numeric) {
      const currency = currencyOf(v)
      if (currency) return { type: 'currency', currency }
    }
    if (CURRENCY_HEADER.test(header)) return { type: 'currency', currency: 'EUR' }
    return { type: 'number' }
  }

  const collaborators = Object.values(ctx.collaborators)
  if (
    collaborators.length > 0 &&
    values.every((v) =>
      collaborators.some(
        (c) =>
          c.name.localeCompare(v, 'fr', { sensitivity: 'base' }) === 0 ||
          c.initials.localeCompare(v, 'fr', { sensitivity: 'base' }) === 0,
      ),
    )
  ) {
    return { type: 'owner' }
  }

  const distinct = distinctLabels(values)
  const allStatuses = distinct.every((v) => workflowStatusCode(v) !== null)
  const repetitive = values.length >= 4 && distinct.length <= values.length / 2
  if (
    distinct.length <= MAX_CHOICES &&
    distinct.every((v) => v.length <= MAX_CHOICE_LENGTH) &&
    (allStatuses || repetitive)
  ) {
    return { type: 'select' }
  }
  return { type: 'text' }
}

/** Libellés distincts (sans tenir compte de la casse ni des accents), dans l'ordre d'apparition. */
export function distinctLabels(values: readonly string[]): string[] {
  const out: string[] = []
  for (const v of values) {
    if (v === '') continue
    if (!out.some((o) => o.localeCompare(v, 'fr', { sensitivity: 'base' }) === 0)) out.push(v)
  }
  return out
}

const HINTS: { mapping: AtelierMapping; types: FieldType[]; header?: RegExp }[] = [
  {
    mapping: 'workflow_state',
    types: ['select'],
    header: /(statut|[ée]tat|status|avancement|[ée]tape)/i,
  },
  {
    mapping: 'entity_title',
    types: ['text'],
    header: /(nom|titre|t[aâ]che|lot|libell|intitul|name|title|sujet|objet)/i,
  },
  { mapping: 'assignee', types: ['owner'] },
  {
    mapping: 'due_date',
    types: ['date'],
    header: /([ée]ch[ée]ance|fin|due|deadline|livraison|limite)/i,
  },
  { mapping: 'start_date', types: ['date'], header: /(d[ée]but|start|d[ée]marrage)/i },
  { mapping: 'financial_ttc', types: ['currency', 'number'], header: /\bttc\b/i },
  {
    mapping: 'financial_ht',
    types: ['currency'],
    header: /(\bht\b|co[uû]t|montant|prix|budget)/i,
  },
  {
    mapping: 'description',
    types: ['text'],
    header: /(description|notes?|commentaires?|d[ée]tails?|remarques?)/i,
  },
  { mapping: 'quantity', types: ['number'], header: /(qt[ée]|quantit|nombre|\bnb\b)/i },
  { mapping: 'flag', types: ['checkbox'] },
]

/**
 * Rôle proposé pour chaque colonne (un rôle au plus une fois, rôles déjà pris exclus).
 * Repli : premier texte → titre, premier statut → état du workflow, première devise → HT.
 */
export function suggestMappings(
  columns: readonly { header: string; type: FieldType }[],
  taken: ReadonlySet<AtelierMapping> = new Set(),
): (AtelierMapping | undefined)[] {
  const used = new Set(taken)
  const out: (AtelierMapping | undefined)[] = columns.map(() => undefined)
  const assign = (i: number, m: AtelierMapping) => {
    out[i] = m
    used.add(m)
  }
  for (const hint of HINTS) {
    if (used.has(hint.mapping)) continue
    const i = columns.findIndex(
      (c, k) =>
        out[k] === undefined &&
        hint.types.includes(c.type) &&
        (hint.header ? hint.header.test(c.header) : true),
    )
    if (i !== -1) assign(i, hint.mapping)
  }
  const fallbacks: [AtelierMapping, FieldType][] = [
    ['entity_title', 'text'],
    ['workflow_state', 'select'],
    ['financial_ht', 'currency'],
  ]
  for (const [mapping, type] of fallbacks) {
    if (used.has(mapping)) continue
    const i = columns.findIndex((c, k) => out[k] === undefined && c.type === type)
    if (i !== -1) assign(i, mapping)
  }
  return out
}
