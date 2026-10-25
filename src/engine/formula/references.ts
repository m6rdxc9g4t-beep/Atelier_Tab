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
  /**
   * Insertion uniquement : agrandit aussi les plages qui se terminent juste avant
   * `index`. Utile pour ajouter une ligne au-dessus d'une ligne de total : `SUM(C1:C3)`
   * devient `SUM(C1:C4)` au lieu de rester inchangée.
   */
  expandAdjacent?: boolean
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
      const touchesEnd = change.expandAdjacent === true && hi[key] === index - 1
      newHi = hi[key] >= index || touchesEnd ? hi[key] + count : hi[key]
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

export interface MoveChange {
  axis: 'row' | 'col'
  /** Premier élément (0-based) du bloc déplacé. */
  from: number
  /** Nombre d'éléments du bloc. */
  count: number
  /** Index, dans l'ordre d'origine, avant lequel le bloc est inséré (0 … longueur). */
  to: number
}

type Interval = [number, number]

/**
 * Nouvelle position de chaque élément après le déplacement, par morceaux :
 * le bloc, les éléments qu'il enjambe (décalés de `count`) et le reste (inchangé).
 */
function moveSegments({
  from,
  count,
  to,
}: MoveChange): { lo: number; hi: number; shift: number; block: boolean }[] {
  const end = from + count // exclusif
  if (to > end) {
    return [
      { lo: from, hi: end - 1, shift: to - end, block: true },
      { lo: end, hi: to - 1, shift: -count, block: false },
    ]
  }
  if (to < from) {
    return [
      { lo: from, hi: end - 1, shift: to - from, block: true },
      { lo: to, hi: from - 1, shift: count, block: false },
    ]
  }
  return []
}

/** Image d'un intervalle par le déplacement : morceaux [début, fin], et lesquels viennent du bloc. */
function mapInterval(
  lo: number,
  hi: number,
  change: MoveChange,
): { all: Interval[]; rest: Interval[] } {
  const all: Interval[] = []
  const rest: Interval[] = []
  let covered: Interval[] = []
  for (const seg of moveSegments(change)) {
    const a = Math.max(lo, seg.lo)
    const b = Math.min(hi, seg.hi)
    if (a > b) continue
    covered.push([a, b])
    const piece: Interval = [a + seg.shift, b + seg.shift]
    all.push(piece)
    if (!seg.block) rest.push(piece)
  }
  // Parties de l'intervalle hors des morceaux déplacés : inchangées.
  covered = covered.sort((x, y) => x[0] - y[0])
  let cursor = lo
  for (const [a, b] of covered) {
    if (a > cursor) {
      all.push([cursor, a - 1])
      rest.push([cursor, a - 1])
    }
    cursor = b + 1
  }
  if (cursor <= hi) {
    all.push([cursor, hi])
    rest.push([cursor, hi])
  }
  return { all, rest }
}

/** Un seul intervalle si les morceaux se touchent, sinon null. */
function merged(pieces: Interval[]): Interval | null {
  if (pieces.length === 0) return null
  const sorted = [...pieces].sort((x, y) => x[0] - y[0])
  let [lo, hi] = sorted[0] as Interval
  for (const [a, b] of sorted.slice(1)) {
    if (a > hi + 1) return null
    hi = Math.max(hi, b)
  }
  return [lo, hi]
}

/**
 * Met à jour les références après le déplacement d'un bloc de lignes ou de colonnes
 * (glisser-déposer) : chaque référence suit la cellule qu'elle désignait, comme dans Excel.
 * Une plage dont les éléments restent contigus suit ses éléments (réordonner les lignes d'un
 * total ne change pas `SUM(C1:C3)`) ; un élément qui sort d'une plage la réduit ; un élément
 * déposé au milieu d'une plage l'agrandit.
 */
export function moveReferences(formula: string, change: MoveChange): string {
  if (moveSegments(change).length === 0 || change.count <= 0) return formula
  const key = change.axis === 'row' ? 'row' : 'col'
  const mapOne = (pos: number): number => {
    for (const seg of moveSegments(change))
      if (pos >= seg.lo && pos <= seg.hi) return pos + seg.shift
    return pos
  }
  return rewriteReferences(formula, (target) => {
    if (target.kind === 'cell') {
      const p = mapOne(target.ref[key])
      return p === target.ref[key] ? null : refToString({ ...target.ref, [key]: p })
    }
    const loIsStart = target.start[key] <= target.end[key]
    const lo = loIsStart ? target.start : target.end
    const hi = loIsStart ? target.end : target.start
    const { all, rest } = mapInterval(lo[key], hi[key], change)
    const box = (pieces: Interval[]): Interval => [
      Math.min(...pieces.map((p) => p[0])),
      Math.max(...pieces.map((p) => p[1])),
    ]
    const next = merged(all) ?? merged(rest) ?? box(all)
    const [newLo, newHi] = next
    if (newLo === lo[key] && newHi === hi[key]) return null
    const a = refToString({ ...lo, [key]: newLo })
    const b = refToString({ ...hi, [key]: newHi })
    return loIsStart ? `${a}:${b}` : `${b}:${a}`
  })
}
