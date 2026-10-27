/** Résumés du pied de grille (somme, moyenne, remplies…), calculés sur les lignes de la vue. */
import { FIELD_TYPES, formatValue } from '@/engine/field-types'
import { isError, type CellValue } from '@/engine/formula'
import type { Field, SummaryKind } from '@/types/domain'

export const SUMMARY_LABELS: Record<SummaryKind, string> = {
  none: 'Aucun',
  sum: 'Somme',
  average: 'Moyenne',
  min: 'Min',
  max: 'Max',
  count: 'Nombres',
  filled: 'Remplies',
  empty: 'Vides',
}

function isNumeric(field: Field): boolean {
  if (field.type === 'formula') {
    const f = field.options?.resultFormat ?? 'number'
    return f === 'number' || f === 'currency' || f === 'percent'
  }
  return FIELD_TYPES[field.type].numeric
}

export function summaryKinds(field: Field): SummaryKind[] {
  return isNumeric(field)
    ? ['none', 'sum', 'average', 'min', 'max', 'count', 'filled', 'empty']
    : ['none', 'filled', 'empty']
}

/** Agrégat par défaut : la somme des colonnes numériques, rien ailleurs. */
export function defaultSummary(field: Field): SummaryKind {
  return isNumeric(field) ? 'sum' : 'none'
}

/**
 * Agrégat affiché : celui choisi dans la vue s'il convient encore au type de la colonne
 * (une « Moyenne » choisie avant un passage en texte est oubliée), sinon celui par défaut.
 */
export function summaryFor(field: Field, stored: SummaryKind | undefined): SummaryKind {
  return stored && summaryKinds(field).includes(stored) ? stored : defaultSummary(field)
}

/** Valeur d'un agrégat sur des valeurs calculées (lignes de total exclues par l'appelant). */
export function summarize(field: Field, values: CellValue[], kind: SummaryKind): string | null {
  const blank = (v: CellValue) =>
    v === null || v === '' || (field.type === 'checkbox' && v !== true)
  if (kind === 'none') return null
  if (kind === 'filled') return String(values.filter((v) => !blank(v)).length)
  if (kind === 'empty') return String(values.filter(blank).length)
  const nums = values.filter((v): v is number => typeof v === 'number' && !isError(v))
  if (kind === 'count') return String(nums.length)
  if (nums.length === 0) return '—'
  const total = nums.reduce((a, b) => a + b, 0)
  const value =
    kind === 'sum'
      ? total
      : kind === 'average'
        ? total / nums.length
        : kind === 'min'
          ? Math.min(...nums)
          : Math.max(...nums)
  return formatValue(field, Number(value.toPrecision(15)))
}
