/**
 * Évaluation d'un AST dans un contexte qui sait lire les cellules.
 * Aucune exécution de code arbitraire : seuls les nœuds de l'AST et les fonctions
 * de la liste blanche (`functions.ts`) sont interprétés.
 */
import { compareValues, normalizeNumber, toBoolean, toNumber, toText } from './coerce'
import { LAZY_FUNCTIONS, resolveFunction, scalarOf } from './functions'
import type { Node } from './parser'
import { normalizeRange, rangeSize, type CellRef } from './references'
import { err, isError, type Arg, type CellValue, type RangeValue } from './values'

export interface EvalContext {
  /** Valeur courante d'une cellule (null si vide). */
  getCell(col: number, row: number): CellValue
}

/** Garde-fou contre les plages démesurées (ex. A1:XFD1048576). */
export const MAX_RANGE_CELLS = 1_000_000

function readRange(start: CellRef, end: CellRef, ctx: EvalContext): RangeValue | CellValue {
  const range = { start, end }
  if (rangeSize(range) > MAX_RANGE_CELLS) return err('#NUM!', 'Plage trop grande')
  const { c0, c1, r0, r1 } = normalizeRange(range)
  const rows: CellValue[][] = []
  for (let r = r0; r <= r1; r++) {
    const line: CellValue[] = []
    for (let c = c0; c <= c1; c++) line.push(ctx.getCell(c, r))
    rows.push(line)
  }
  return { kind: 'range', rows }
}

/** Évalue un argument de fonction : références et plages restent des plages. */
function evaluateArg(node: Node, ctx: EvalContext): Arg {
  if (node.type === 'range') return readRange(node.start, node.end, ctx)
  if (node.type === 'ref')
    return { kind: 'range', rows: [[ctx.getCell(node.ref.col, node.ref.row)]] }
  return evaluate(node, ctx)
}

export function evaluate(node: Node, ctx: EvalContext): CellValue {
  switch (node.type) {
    case 'number':
      return node.value
    case 'string':
      return node.value
    case 'bool':
      return node.value
    case 'error':
      return err(node.code)
    case 'ref':
      return ctx.getCell(node.ref.col, node.ref.row)
    case 'range':
      // Une plage seule (`=A1:A3`) n'a pas de valeur unique.
      return err('#VALUE!', 'Une plage doit être utilisée dans une fonction, ex. SUM(A1:A3)')

    case 'unary': {
      const v = toNumber(evaluate(node.operand, ctx))
      if (isError(v)) return v
      return node.op === '-' ? -v || 0 : v
    }

    case 'percent': {
      const v = toNumber(evaluate(node.operand, ctx))
      return isError(v) ? v : normalizeNumber(v / 100)
    }

    case 'binary':
      return evaluateBinary(node, ctx)

    case 'call':
      return evaluateCall(node, ctx)
  }
}

function evaluateBinary(node: Extract<Node, { type: 'binary' }>, ctx: EvalContext): CellValue {
  const left = evaluate(node.left, ctx)
  if (isError(left)) return left
  const right = evaluate(node.right, ctx)
  if (isError(right)) return right

  switch (node.op) {
    case '&': {
      const a = toText(left)
      if (isError(a)) return a
      const b = toText(right)
      return isError(b) ? b : a + b
    }
    case '=':
      return compareValues(left, right) === 0
    case '<>':
      return compareValues(left, right) !== 0
    case '<':
      return compareValues(left, right) < 0
    case '>':
      return compareValues(left, right) > 0
    case '<=':
      return compareValues(left, right) <= 0
    case '>=':
      return compareValues(left, right) >= 0
  }

  const a = toNumber(left)
  if (isError(a)) return a
  const b = toNumber(right)
  if (isError(b)) return b

  switch (node.op) {
    case '+':
      return normalizeNumber(a + b)
    case '-':
      return normalizeNumber(a - b)
    case '*':
      return normalizeNumber(a * b)
    case '/':
      return b === 0 ? err('#DIV/0!') : normalizeNumber(a / b)
    case '^':
      if (a === 0 && b < 0) return err('#DIV/0!')
      return normalizeNumber(a ** b)
  }
}

function evaluateCall(node: Extract<Node, { type: 'call' }>, ctx: EvalContext): CellValue {
  const lazy = LAZY_FUNCTIONS[node.name]

  if (lazy === 'IF') {
    if (node.args.length < 2 || node.args.length > 3) {
      return err('#VALUE!', 'IF attend 2 ou 3 arguments : IF(condition; si_vrai; si_faux)')
    }
    const [condNode, thenNode, elseNode] = node.args as [Node, Node, Node | undefined]
    const cond = toBoolean(scalarOf(evaluateArg(condNode, ctx)))
    if (isError(cond)) return cond
    if (cond) return scalarOf(evaluateArg(thenNode, ctx))
    return elseNode ? scalarOf(evaluateArg(elseNode, ctx)) : false
  }

  if (lazy === 'IFERROR') {
    if (node.args.length !== 2) return err('#VALUE!', 'IFERROR attend 2 arguments')
    const [valueNode, fallbackNode] = node.args as [Node, Node]
    const v = scalarOf(evaluateArg(valueNode, ctx))
    return isError(v) ? scalarOf(evaluateArg(fallbackNode, ctx)) : v
  }

  const spec = resolveFunction(node.name)
  if (!spec) return err('#NAME?', `Fonction inconnue : ${node.name}`)
  if (node.args.length < spec.minArgs || node.args.length > spec.maxArgs) {
    return err('#VALUE!', `Nombre d'arguments incorrect pour ${node.name}`)
  }

  const args: Arg[] = []
  for (const a of node.args) {
    const v = evaluateArg(a, ctx)
    args.push(v)
  }
  // Filet de sécurité : une exception d'une fonction (ex. Intl) ne doit pas interrompre le
  // recalcul ni l'aperçu de la barre de formules ; elle devient une erreur de la cellule.
  try {
    return spec.impl(args)
  } catch {
    return err('#VALUE!', `Calcul impossible pour ${node.name}`)
  }
}
