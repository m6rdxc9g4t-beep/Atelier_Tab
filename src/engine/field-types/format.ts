/** Formatage d'affichage (fr-FR) d'une valeur calculée selon le type de champ. */
import { formatNumberAsText, isError, serialToIso, type CellValue } from '@/engine/formula'
import type { Field } from '@/types/domain'

const LOCALE = 'fr-FR'
const cache = new Map<string, Intl.NumberFormat>()

function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options)
  let f = cache.get(key)
  if (!f) cache.set(key, (f = new Intl.NumberFormat(LOCALE, options)))
  return f
}

export function formatCurrency(n: number, currency = 'EUR', decimals?: number): string {
  const fraction = decimals ?? (Number.isInteger(n) ? 0 : 2)
  return numberFormat({
    style: 'currency',
    currency,
    minimumFractionDigits: fraction,
    maximumFractionDigits: fraction,
  }).format(n)
}

export function formatNumber(n: number, decimals?: number): string {
  return numberFormat(
    decimals === undefined
      ? { maximumFractionDigits: 10 }
      : { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
  ).format(n)
}

export function formatPercent(n: number, decimals?: number): string {
  return numberFormat({
    style: 'percent',
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 2,
  }).format(n)
}

/** Format compact pour le pied de grille : 194 700 → « 194,7 k ». */
export function formatCompact(n: number): string {
  return numberFormat({ notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Texte affiché dans une cellule. Les champs `select`, `owner` et `checkbox` ont un
 * rendu visuel dédié (badge, avatar, case) ; cette fonction en donne la version texte
 * (export CSV, mode tableur pur, lecteurs d'écran).
 */
export function formatValue(field: Field, value: CellValue): string {
  if (value === null) return ''
  if (isError(value)) return value.code

  if (typeof value === 'boolean') {
    if (field.type === 'checkbox') return value ? '✓' : ''
    return value ? 'VRAI' : 'FAUX'
  }

  if (typeof value === 'number') {
    const decimals = field.options?.decimals
    const kind = field.type === 'formula' ? (field.options?.resultFormat ?? 'number') : field.type
    // Un nombre calculé dans une colonne texte reste affiché à la française.
    if (field.type === 'text') return formatNumber(value, decimals)
    switch (kind) {
      case 'currency':
        return formatCurrency(value, field.options?.currency ?? 'EUR', decimals)
      case 'percent':
        return formatPercent(value, decimals)
      case 'text':
        return formatNumberAsText(value)
      case 'date':
        // Numéro de série (ex. `=Échéance + 7`) : affiché comme une date.
        return formatDate(serialToIso(value))
      default:
        return formatNumber(value, decimals)
    }
  }

  if (
    field.type === 'date' ||
    (field.type === 'formula' && field.options?.resultFormat === 'date')
  ) {
    return formatDate(value)
  }
  return value
}
