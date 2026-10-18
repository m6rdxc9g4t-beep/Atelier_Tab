/**
 * Découpage d'une formule pour l'affichage coloré (barre de formules).
 * Tolérant : une formule en cours de frappe, même invalide, reste affichable.
 */
import { tokenize, type Token } from './tokenizer'

export interface FormulaSegment {
  kind: 'ref' | 'function' | 'text'
  text: string
}

/** Jetons de référence regroupés en zones (A1 seul, ou A1:B3), dans l'ordre du texte. */
export function referenceTokens(
  tokens: Token[],
): { start: number; end: number; cells: Extract<Token, { type: 'ref' }>[] }[] {
  const out: { start: number; end: number; cells: Extract<Token, { type: 'ref' }>[] }[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!t || t.type !== 'ref') continue
    const colon = tokens[i + 1]
    const second = tokens[i + 2]
    if (colon?.type === 'op' && colon.value === ':' && second?.type === 'ref') {
      out.push({ start: t.start, end: second.end, cells: [t, second] })
      i += 2
    } else {
      out.push({ start: t.start, end: t.end, cells: [t] })
    }
  }
  return out
}

export function tokenizeForDisplay(formula: string): FormulaSegment[] {
  const offset = formula.startsWith('=') ? 1 : 0
  let tokens: Token[]
  try {
    tokens = tokenize(formula.slice(offset))
  } catch {
    return [{ kind: 'text', text: formula }]
  }

  const marks: { start: number; end: number; kind: FormulaSegment['kind'] }[] = [
    ...referenceTokens(tokens).map((r) => ({ start: r.start, end: r.end, kind: 'ref' as const })),
    ...tokens
      .filter((t) => t.type === 'ident')
      .map((t) => ({ start: t.start, end: t.end, kind: 'function' as const })),
  ].sort((a, b) => a.start - b.start)

  const segments: FormulaSegment[] = []
  let cursor = 0
  const body = formula.slice(offset)
  if (offset) segments.push({ kind: 'text', text: '=' })
  for (const m of marks) {
    if (m.start > cursor) segments.push({ kind: 'text', text: body.slice(cursor, m.start) })
    segments.push({ kind: m.kind, text: body.slice(m.start, m.end) })
    cursor = m.end
  }
  if (cursor < body.length) segments.push({ kind: 'text', text: body.slice(cursor) })
  return segments
}
