/**
 * Poignée de recopie et Ctrl+D, comme Excel :
 * - formules : recopiées en décalant les références relatives ;
 * - deux nombres ou plus : série linéaire (1, 2 → 3, 4 ; 10, 20 → 30) ;
 * - une date : un jour de plus à chaque cellule ; plusieurs dates : même écart ;
 * - un texte terminé par un nombre (« Lot 1 ») : le nombre augmente ;
 * - le reste (texte, statut, case…) : le motif est répété.
 *
 * Module pur : travaille sur les valeurs stockées d'une ligne ou d'une colonne de cellules.
 */
import {
  dateTextToSerial,
  isFormula,
  serialToIso,
  translateFormula,
  type CellInput,
} from '@/engine/formula'
import type { FieldType } from '@/types/domain'

export interface FillOptions {
  /** `row` : recopie verticale (les lignes changent) ; `col` : horizontale. */
  axis: 'row' | 'col'
  /** Vers le haut ou la gauche. */
  backward?: boolean
  /** Type de la colonne de destination (les dates ne sont reconnues que dans une colonne Date). */
  fieldType: FieldType
}

const TRAILING_NUMBER = /^(.*?)(\d+)(\D*)$/

/** Valeurs des `count` cellules qui suivent (ou précèdent) la série `source`. */
export function fillValues(
  source: readonly CellInput[],
  count: number,
  options: FillOptions,
): CellInput[] {
  const n = source.length
  if (n === 0 || count <= 0) return []
  // Position de chaque cellule cible par rapport à la première cellule source.
  const positions = Array.from({ length: count }, (_, i) => (options.backward ? -1 - i : n + i))
  const series = seriesOf(source, options.fieldType)

  return positions.map((p) => {
    if (series) return series(p)
    const s = ((p % n) + n) % n
    const input = source[s] ?? null
    if (!isFormula(input)) return input
    const delta = p - s
    return options.axis === 'row' ? translateFormula(input, delta, 0) : translateFormula(input, 0, delta)
  })
}

/** Fonction position → valeur pour une série reconnue, sinon null (motif répété). */
function seriesOf(source: readonly CellInput[], fieldType: FieldType): ((p: number) => CellInput) | null {
  if (source.some((v) => v === null || isFormula(v))) return null

  if (source.every((v) => typeof v === 'number')) {
    if (source.length === 1) return null
    const line = regression(source as number[])
    return (p) => Number((line.a + line.b * p).toPrecision(15))
  }

  if (fieldType === 'date' && source.every((v) => typeof v === 'string')) {
    const serials = source.map((v) => dateTextToSerial(v as string))
    if (serials.some((s) => s === null)) return null
    const nums = serials as number[]
    if (nums.length === 1) return (p) => serialToIso((nums[0] as number) + p)
    const line = regression(nums)
    return (p) => serialToIso(Math.round(line.a + line.b * p))
  }

  if (source.every((v) => typeof v === 'string')) {
    const parts = source.map((v) => TRAILING_NUMBER.exec(v as string))
    const first = parts[0]
    if (!first || parts.some((m) => !m || m[1] !== first[1] || m[3] !== first[3])) return null
    const nums = parts.map((m) => Number(m?.[2]))
    const width = (first[2] ?? '').length
    const line = nums.length === 1 ? { a: nums[0] as number, b: 1 } : regression(nums)
    return (p) => {
      const k = Math.round(line.a + line.b * p)
      const digits = k < 0 ? `-${String(-k).padStart(width, '0')}` : String(k).padStart(width, '0')
      return `${first[1]}${digits}${first[3]}`
    }
  }
  return null
}

/** Droite des moindres carrés y = a + b·x pour x = 0, 1, 2… (exacte pour une suite arithmétique). */
function regression(ys: readonly number[]): { a: number; b: number } {
  const n = ys.length
  const meanX = (n - 1) / 2
  const meanY = ys.reduce((s, y) => s + y, 0) / n
  let num = 0
  let den = 0
  ys.forEach((y, x) => {
    num += (x - meanX) * (y - meanY)
    den += (x - meanX) ** 2
  })
  const b = den === 0 ? 0 : num / den
  return { a: meanY - b * meanX, b }
}
