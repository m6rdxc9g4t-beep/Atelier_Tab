/**
 * Découpe le corps d'une formule (sans le `=` initial) en jetons.
 * Chaque jeton garde sa position (`start`/`end`) pour permettre la réécriture
 * des références sans perdre la mise en forme saisie par l'utilisateur.
 */
import { ERROR_CODES, type ErrorCode } from './values'

export type Operator =
  '+' | '-' | '*' | '/' | '^' | '&' | '%' | ':' | '=' | '<>' | '<' | '>' | '<=' | '>='

interface Span {
  start: number
  end: number
}

export type Token = Span &
  (
    | { type: 'number'; value: number }
    | { type: 'string'; value: string }
    | { type: 'bool'; value: boolean }
    | { type: 'error'; value: ErrorCode }
    | { type: 'ref'; col: number; row: number; absCol: boolean; absRow: boolean }
    | { type: 'ident'; value: string }
    | { type: 'op'; value: Operator }
    | { type: 'lparen' }
    | { type: 'rparen' }
    | { type: 'sep' }
    | { type: 'eof' }
  )

export class FormulaSyntaxError extends Error {
  readonly position: number
  constructor(message: string, position: number) {
    super(message)
    this.name = 'FormulaSyntaxError'
    this.position = position
  }
}

const MAX_COLS = 16_384
const MAX_ROWS = 1_048_576

const NUMBER_RE = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/
const REF_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)/
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.]*/
// Les codes d'erreur triés du plus long au plus court pour un appariement glouton.
const ERRORS_BY_LENGTH = [...ERROR_CODES].sort((a, b) => b.length - a.length)

function lettersToColumn(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i] as string
    const rest = input.slice(i)

    if (/\s/.test(ch)) {
      i++
      continue
    }

    // Nombre
    const num = NUMBER_RE.exec(rest)
    if (num && /[\d.]/.test(ch)) {
      const text = num[0]
      tokens.push({ type: 'number', value: Number(text), start: i, end: i + text.length })
      i += text.length
      continue
    }

    // Chaîne entre guillemets, "" pour un guillemet littéral
    if (ch === '"') {
      let j = i + 1
      let value = ''
      for (;;) {
        if (j >= input.length) throw new FormulaSyntaxError('Guillemet fermant manquant', i)
        const c = input[j] as string
        if (c === '"') {
          if (input[j + 1] === '"') {
            value += '"'
            j += 2
            continue
          }
          break
        }
        value += c
        j++
      }
      tokens.push({ type: 'string', value, start: i, end: j + 1 })
      i = j + 1
      continue
    }

    // Littéral d'erreur (#REF!, #DIV/0!…), produit notamment par la réécriture des références
    if (ch === '#') {
      const code = ERRORS_BY_LENGTH.find((c) => rest.toUpperCase().startsWith(c))
      if (!code) throw new FormulaSyntaxError(`Code d'erreur inconnu`, i)
      tokens.push({ type: 'error', value: code, start: i, end: i + code.length })
      i += code.length
      continue
    }

    // Référence de cellule (A1, $B$2…) — sauf si suivie de lettres, d'un point ou d'une
    // parenthèse, auquel cas c'est un nom de fonction (ex. LOG10).
    const ref = REF_RE.exec(rest)
    if (ref) {
      const after = rest[ref[0].length]
      const looksLikeName = after !== undefined && /[A-Za-z_.(]/.test(after)
      if (!looksLikeName) {
        const [text, absCol, letters, absRow, digits] = ref
        const col = lettersToColumn(letters ?? '')
        const row = Number(digits) - 1
        if (row < 0 || row >= MAX_ROWS || col >= MAX_COLS) {
          throw new FormulaSyntaxError(`Référence hors limites : ${text}`, i)
        }
        tokens.push({
          type: 'ref',
          col,
          row,
          absCol: absCol === '$',
          absRow: absRow === '$',
          start: i,
          end: i + text.length,
        })
        i += text.length
        continue
      }
    }

    // Identifiant : nom de fonction, TRUE / FALSE
    const ident = IDENT_RE.exec(rest)
    if (ident) {
      const text = ident[0]
      const upper = text.toUpperCase()
      const next = input.slice(i + text.length).trimStart()[0]
      const isCall = next === '('
      if (!isCall && (upper === 'TRUE' || upper === 'VRAI')) {
        tokens.push({ type: 'bool', value: true, start: i, end: i + text.length })
      } else if (!isCall && (upper === 'FALSE' || upper === 'FAUX')) {
        tokens.push({ type: 'bool', value: false, start: i, end: i + text.length })
      } else {
        tokens.push({ type: 'ident', value: upper, start: i, end: i + text.length })
      }
      i += text.length
      continue
    }

    // Opérateurs à deux caractères
    const two = input.slice(i, i + 2)
    if (two === '<>' || two === '<=' || two === '>=') {
      tokens.push({ type: 'op', value: two, start: i, end: i + 2 })
      i += 2
      continue
    }

    switch (ch) {
      case '+':
      case '-':
      case '*':
      case '/':
      case '^':
      case '&':
      case '%':
      case ':':
      case '=':
      case '<':
      case '>':
        tokens.push({ type: 'op', value: ch, start: i, end: i + 1 })
        i++
        continue
      case '(':
        tokens.push({ type: 'lparen', start: i, end: i + 1 })
        i++
        continue
      case ')':
        tokens.push({ type: 'rparen', start: i, end: i + 1 })
        i++
        continue
      // `,` (notation anglaise) et `;` (Excel français) séparent les arguments
      case ',':
      case ';':
        tokens.push({ type: 'sep', start: i, end: i + 1 })
        i++
        continue
    }

    throw new FormulaSyntaxError(`Caractère inattendu « ${ch} »`, i)
  }

  tokens.push({ type: 'eof', start: input.length, end: input.length })
  return tokens
}
