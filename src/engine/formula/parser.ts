/**
 * Parser de Pratt : jetons → arbre syntaxique (AST).
 *
 * Priorités (de la plus faible à la plus forte), alignées sur Excel :
 *   comparaisons (= <> < > <= >=)  <  &  <  + -  <  * /  <  ^  <  %  <  - unaire  <  :
 *
 * Particularités Excel conservées :
 * - le moins unaire lie plus fort que `^` : `-2^2` vaut 4 ;
 * - `^` est associatif à gauche : `2^3^2` vaut 64.
 */
import type { CellRef } from './references'
import { referenceTokens } from './display'
import { FormulaSyntaxError, tokenize, type Operator, type Token } from './tokenizer'
import type { ErrorCode } from './values'

export type BinaryOperator = Exclude<Operator, '%' | ':'>

export type Node =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'error'; code: ErrorCode }
  | { type: 'ref'; ref: CellRef }
  | { type: 'range'; start: CellRef; end: CellRef }
  | { type: 'unary'; op: '+' | '-'; operand: Node }
  | { type: 'percent'; operand: Node }
  | { type: 'binary'; op: BinaryOperator; left: Node; right: Node }
  | { type: 'call'; name: string; args: Node[] }

const BINARY_POWER: Record<BinaryOperator, number> = {
  '=': 10,
  '<>': 10,
  '<': 10,
  '>': 10,
  '<=': 10,
  '>=': 10,
  '&': 20,
  '+': 30,
  '-': 30,
  '*': 40,
  '/': 40,
  '^': 50,
}
const PERCENT_POWER = 60
const PREFIX_POWER = 70

class Parser {
  private pos = 0
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token {
    return this.tokens[this.pos] ?? (this.tokens[this.tokens.length - 1] as Token)
  }

  private next(): Token {
    const t = this.peek()
    if (t.type !== 'eof') this.pos++
    return t
  }

  parse(): Node {
    if (this.peek().type === 'eof') throw new FormulaSyntaxError('Formule vide', 0)
    const node = this.expression(0)
    const t = this.peek()
    if (t.type !== 'eof')
      throw new FormulaSyntaxError('Élément inattendu après la formule', t.start)
    return node
  }

  private expression(minPower: number): Node {
    let left = this.prefix()

    for (;;) {
      const t = this.peek()
      if (t.type !== 'op') break

      if (t.value === '%') {
        if (PERCENT_POWER < minPower) break
        this.next()
        left = { type: 'percent', operand: left }
        continue
      }
      if (t.value === ':') throw new FormulaSyntaxError('Plage invalide', t.start)

      const power = BINARY_POWER[t.value]
      // Associativité à gauche : on ne continue que si la priorité est strictement supérieure.
      if (power <= minPower) break
      this.next()
      const right = this.expression(power)
      left = { type: 'binary', op: t.value, left, right }
    }
    return left
  }

  private prefix(): Node {
    const t = this.next()
    switch (t.type) {
      case 'number':
        return { type: 'number', value: t.value }
      case 'string':
        return { type: 'string', value: t.value }
      case 'bool':
        return { type: 'bool', value: t.value }
      case 'error':
        return { type: 'error', code: t.value }
      case 'ref':
        return this.refOrRange(t)
      case 'ident':
        return this.call(t)
      case 'lparen': {
        const inner = this.expression(0)
        const close = this.next()
        if (close.type !== 'rparen') {
          throw new FormulaSyntaxError('Parenthèse fermante manquante', close.start)
        }
        return inner
      }
      case 'op':
        if (t.value === '-' || t.value === '+') {
          return { type: 'unary', op: t.value, operand: this.expression(PREFIX_POWER) }
        }
        throw new FormulaSyntaxError(`Opérateur « ${t.value} » inattendu`, t.start)
      case 'eof':
        throw new FormulaSyntaxError('Formule incomplète', t.start)
      default:
        throw new FormulaSyntaxError('Élément inattendu', t.start)
    }
  }

  private refOrRange(t: Extract<Token, { type: 'ref' }>): Node {
    const start: CellRef = { col: t.col, row: t.row, absCol: t.absCol, absRow: t.absRow }
    const colon = this.peek()
    if (colon.type === 'op' && colon.value === ':') {
      this.next()
      const e = this.next()
      if (e.type !== 'ref') throw new FormulaSyntaxError('Fin de plage attendue', e.start)
      return {
        type: 'range',
        start,
        end: { col: e.col, row: e.row, absCol: e.absCol, absRow: e.absRow },
      }
    }
    return { type: 'ref', ref: start }
  }

  private call(t: Extract<Token, { type: 'ident' }>): Node {
    const open = this.next()
    if (open.type !== 'lparen') {
      throw new FormulaSyntaxError(`Nom inconnu « ${t.value} »`, t.start)
    }
    const args: Node[] = []
    if (this.peek().type === 'rparen') {
      this.next()
      return { type: 'call', name: t.value, args }
    }
    for (;;) {
      args.push(this.expression(0))
      const sep = this.next()
      if (sep.type === 'rparen') break
      if (sep.type !== 'sep') {
        throw new FormulaSyntaxError(`« , » ou « ) » attendu dans ${t.value}()`, sep.start)
      }
    }
    return { type: 'call', name: t.value, args }
  }
}

/** Parse le corps d'une formule. Le `=` initial est accepté et ignoré. */
export function parseFormula(formula: string): Node {
  const body = formula.startsWith('=') ? formula.slice(1) : formula
  return new Parser(tokenize(body)).parse()
}

/** Références directes et plages lues par une formule (analyse statique). */
export function collectReferences(node: Node): {
  cells: CellRef[]
  ranges: { start: CellRef; end: CellRef }[]
} {
  const cells: CellRef[] = []
  const ranges: { start: CellRef; end: CellRef }[] = []
  const visit = (n: Node): void => {
    switch (n.type) {
      case 'ref':
        cells.push(n.ref)
        return
      case 'range':
        ranges.push({ start: n.start, end: n.end })
        return
      case 'unary':
      case 'percent':
        visit(n.operand)
        return
      case 'binary':
        visit(n.left)
        visit(n.right)
        return
      case 'call':
        n.args.forEach(visit)
        return
      default:
        return
    }
  }
  visit(node)
  return { cells, ranges }
}

/** Zone lue par une formule, en index 0-based (bornes incluses). */
export interface ReferencedArea {
  c0: number
  c1: number
  r0: number
  r1: number
}

/**
 * Zones lues par une formule, dans l'ordre d'apparition — pour colorer les
 * références dans la grille pendant la saisie. Une formule incomplète ou invalide
 * renvoie une liste vide (jamais d'exception).
 */
export function formulaReferences(formula: string): ReferencedArea[] {
  let ast: Node
  try {
    ast = parseFormula(formula)
  } catch {
    // Formule en cours de frappe : on se rabat sur les jetons de référence déjà saisis.
    try {
      const body = formula.startsWith('=') ? formula.slice(1) : formula
      return referenceTokens(tokenize(body)).map(({ cells }) => {
        const cols = cells.map((c) => c.col)
        const rows = cells.map((c) => c.row)
        return {
          c0: Math.min(...cols),
          c1: Math.max(...cols),
          r0: Math.min(...rows),
          r1: Math.max(...rows),
        }
      })
    } catch {
      return []
    }
  }
  const areas: ReferencedArea[] = []
  const visit = (n: Node): void => {
    switch (n.type) {
      case 'ref':
        areas.push({ c0: n.ref.col, c1: n.ref.col, r0: n.ref.row, r1: n.ref.row })
        return
      case 'range':
        areas.push({
          c0: Math.min(n.start.col, n.end.col),
          c1: Math.max(n.start.col, n.end.col),
          r0: Math.min(n.start.row, n.end.row),
          r1: Math.max(n.start.row, n.end.row),
        })
        return
      case 'unary':
      case 'percent':
        visit(n.operand)
        return
      case 'binary':
        visit(n.left)
        visit(n.right)
        return
      case 'call':
        n.args.forEach(visit)
        return
      default:
        return
    }
  }
  visit(ast)
  return areas
}
