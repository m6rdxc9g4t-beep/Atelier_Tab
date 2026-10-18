/**
 * Adressage A1 : conversions, plages, et réécriture des références lors d'une
 * recopie (`translateFormula`) ou d'une insertion/suppression (`shiftReferences`).
 *
 * Convention : `col` et `row` sont des index 0-based. `A1` ↔ { col: 0, row: 0 }.
 */
import { tokenize, type Token } from './tokenizer'

export const MAX_COLS = 16_384 // XFD
export const MAX_ROWS = 1_048_576

export interface CellRef {
  col: number
  row: number
  absCol?: boolean
  absRow?: boolean
}

export interface RangeRef {
  start: CellRef
  end: CellRef
}

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function columnToLetters(col: number): string {
  if (!Number.isInteger(col) || col < 0) throw new RangeError(`Index de colonne invalide : ${col}`)
  let n = col + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** "A" → 0, "AA" → 26. */
export function lettersToColumn(letters: string): number {
  const up = letters.toUpperCase()
  if (!/^[A-Z]+$/.test(up)) throw new RangeError(`Lettres de colonne invalides : ${letters}`)
  let n = 0
  for (const ch of up) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** Adresse canonique, sans `$` : { col: 2, row: 0 } → "C1". Sert de clé interne. */
export function toA1(col: number, row: number): string {
  return `${columnToLetters(col)}${row + 1}`
}

export function refToString(ref: CellRef): string {
  return `${ref.absCol ? '$' : ''}${columnToLetters(ref.col)}${ref.absRow ? '$' : ''}${ref.row + 1}`
}

const A1_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/

/** "C12" / "$C$12" → CellRef, ou `null` si la chaîne n'est pas une adresse valide. */
export function parseA1(text: string): CellRef | null {
  const m = A1_PATTERN.exec(text.trim())
  if (!m) return null
  const [, absCol, letters, absRow, digits] = m
  const col = lettersToColumn(letters ?? '')
  const row = Number(digits) - 1
  if (row < 0 || row >= MAX_ROWS || col >= MAX_COLS) return null
  return { col, row, absCol: absCol === '$', absRow: absRow === '$' }
}

/** Normalise une plage (coins inversés acceptés : "C3:A1" ≡ "A1:C3"). */
export function normalizeRange(range: RangeRef): {
  c0: number
  c1: number
  r0: number
  r1: number
} {
  return {
    c0: Math.min(range.start.col, range.end.col),
    c1: Math.max(range.start.col, range.end.col),
    r0: Math.min(range.start.row, range.end.row),
    r1: Math.max(range.start.row, range.end.row),
  }
}

export function rangeContains(range: RangeRef, col: number, row: number): boolean {
  const { c0, c1, r0, r1 } = normalizeRange(range)
  return col >= c0 && col <= c1 && row >= r0 && row <= r1
}

export function rangeSize(range: RangeRef): number {
  const { c0, c1, r0, r1 } = normalizeRange(range)
  return (c1 - c0 + 1) * (r1 - r0 + 1)
}

function inBounds(col: number, row: number): boolean {
  return col >= 0 && row >= 0 && col < MAX_COLS && row < MAX_ROWS
}

// ---------------------------------------------------------------------------
// Réécriture de formules
// ---------------------------------------------------------------------------

type RefToken = Extract<Token, { type: 'ref' }>

/**
 * Parcourt les références d'une formule (seules ou en plage) et remplace leur texte
 * par ce que renvoie `rewrite`. Le reste de la formule (espaces, casse) est préservé.
 */
function rewriteReferences(
  formula: string,
  rewrite: (
    target: { kind: 'cell'; ref: CellRef } | { kind: 'range'; start: CellRef; end: CellRef },
  ) => string | null,
): string {
  const body = formula.startsWith('=') ? formula.slice(1) : formula
  const offset = formula.length - body.length
  let tokens: Token[]
  try {
    tokens = tokenize(body)
  } catch {
    return formula // formule invalide : on ne touche à rien
  }

  const edits: { start: number; end: number; text: string }[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t || t.type !== 'ref') continue
    const colon = tokens[i + 1]
    const second = tokens[i + 2]
    if (colon?.type === 'op' && colon.value === ':' && second?.type === 'ref') {
      const text = rewrite({ kind: 'range', start: toRef(t), end: toRef(second) })
      if (text !== null) edits.push({ start: t.start, end: second.end, text })
      i += 2
    } else {
      const text = rewrite({ kind: 'cell', ref: toRef(t) })
      if (text !== null) edits.push({ start: t.start, end: t.end, text })
    }
  }

  let out = body
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  return formula.slice(0, offset) + out
}

function toRef(t: RefToken): CellRef {
  return { col: t.col, row: t.row, absCol: t.absCol, absRow: t.absRow }
}

/**
 * Recopie d'une formule décalée de (dRow, dCol), comme une poignée de recopie Excel :
 * les références relatives bougent, les références `$` restent fixes.
 * Une référence qui sort de la grille devient `#REF!`.
 *
 * C'est aussi le mécanisme des colonnes-formules : le modèle `=C1*1.2` (ligne 1)
 * devient `=C2*1.2` sur la ligne 2, etc.
 */
export function translateFormula(formula: string, dRow: number, dCol: number): string {
  if (dRow === 0 && dCol === 0) return formula
  const move = (r: CellRef): CellRef => ({
    ...r,
    col: r.absCol ? r.col : r.col + dCol,
    row: r.absRow ? r.row : r.row + dRow,
  })
  return rewriteReferences(formula, (target) => {
    if (target.kind === 'cell') {
      const m = move(target.ref)
      return inBounds(m.col, m.row) ? refToString(m) : '#REF!'
    }
    const s = move(target.start)
    const e = move(target.end)
    return inBounds(s.col, s.row) && inBounds(e.col, e.row)
      ? `${refToString(s)}:${refToString(e)}`
      : '#REF!'
  })
}

export interface StructuralChange {
  axis: 'row' | 'col'
  /** Index (0-based) de la première ligne/colonne insérée ou supprimée. */
  index: number
  /** > 0 : insertion de `count` éléments avant `index`. < 0 : suppression de `|count|` éléments. */
  count: number
}

/**
 * Met à jour les références après insertion ou suppression de lignes/colonnes.
 * Contrairement à la recopie, les références absolues bougent aussi (comportement Excel).
 * - Référence vers un élément supprimé → `#REF!`
 * - Plage partiellement supprimée → plage réduite
 * - Insertion au milieu d'une plage → plage agrandie
 */
export function shiftReferences(formula: string, change: StructuralChange): string {
  if (change.count === 0) return formula
  const key = change.axis === 'row' ? 'row' : 'col'
  const { index, count } = change
  const deletedEnd = index - count // exclusif, utilisé seulement si count < 0

  const shiftOne = (pos: number): number | null => {
    if (count > 0) return pos >= index ? pos + count : pos
    if (pos < index) return pos
    if (pos < deletedEnd) return null
    return pos + count
  }

  return rewriteReferences(formula, (target) => {
    if (target.kind === 'cell') {
      const p = shiftOne(target.ref[key])
      if (p === null) return '#REF!'
      if (p === target.ref[key]) return null
      return refToString({ ...target.ref, [key]: p })
    }

    // Plage : on travaille sur les bornes ordonnées.
    const loIsStart = target.start[key] <= target.end[key]
    const lo = loIsStart ? target.start : target.end
    const hi = loIsStart ? target.end : target.start
    let newLo: number
    let newHi: number

    if (count > 0) {
      newLo = lo[key] >= index ? lo[key] + count : lo[key]
      newHi = hi[key] >= index ? hi[key] + count : hi[key]
    } else {
      const loDeleted = lo[key] >= index && lo[key] < deletedEnd
      const hiDeleted = hi[key] >= index && hi[key] < deletedEnd
      if (loDeleted && hiDeleted) return '#REF!'
      newLo = loDeleted ? index : (shiftOne(lo[key]) ?? index)
      newHi = hiDeleted ? index - 1 : (shiftOne(hi[key]) ?? index - 1)
    }

    if (newLo === lo[key] && newHi === hi[key]) return null
    const a = refToString({ ...lo, [key]: newLo })
    const b = refToString({ ...hi, [key]: newHi })
    return loIsStart ? `${a}:${b}` : `${b}:${a}`
  })
}
