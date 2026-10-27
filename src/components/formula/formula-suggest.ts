/**
 * Aide à la saisie des formules (pur) : nom de fonction en cours de frappe, suggestions,
 * fonction dont le curseur est entre les parenthèses et numéro de l'argument courant.
 */
import {
  functionDoc,
  suggestFunctions,
  type FunctionDoc,
  type FunctionSuggestion,
} from '@/engine/formula'

export interface FormulaContext {
  /** Nom partiel tapé juste avant le curseur, et sa position. */
  prefix: string
  start: number
  suggestions: FunctionSuggestion[]
  /** Fonction englobante (`SOMME.SI(…|…)`) et index de l'argument où se trouve le curseur. */
  call: { doc: FunctionDoc; arg: number } | null
}

const EMPTY: FormulaContext = { prefix: '', start: 0, suggestions: [], call: null }
const NAME_BEFORE = /[A-Za-z_][A-Za-z0-9_.]*$/

export function formulaContext(text: string, caret: number): FormulaContext {
  if (!text.startsWith('=')) return EMPTY
  const before = text.slice(0, caret)

  // Fonction englobante : on remonte les parenthèses en ignorant les textes entre guillemets.
  const stack: { name: string; arg: number }[] = []
  let inString = false
  let token = ''
  for (let i = 1; i < before.length; i++) {
    const ch = before[i] as string
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (/[A-Za-z0-9_.]/.test(ch)) {
      token += ch
      continue
    }
    if (ch === '(') stack.push({ name: token.toUpperCase(), arg: 0 })
    else if (ch === ')') stack.pop()
    else if ((ch === ';' || ch === ',') && stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top) top.arg++
    }
    token = ''
  }
  const top = stack.at(-1)
  const doc = top ? functionDoc(top.name) : undefined
  const call = top && doc ? { doc, arg: top.arg } : null

  if (inString) return { ...EMPTY, call }
  const m = NAME_BEFORE.exec(before)
  const prefix = m?.[0] ?? ''
  // Une référence complète (C1, AB12) n'appelle pas de suggestion.
  const isRef = /^\$?[A-Za-z]{1,3}\$?\d+$/.test(prefix)
  const suggestions = prefix && !isRef ? suggestFunctions(prefix) : []
  return { prefix, start: caret - prefix.length, suggestions, call }
}

/** Remplace le nom partiel par `NOM(` ; renvoie le texte et la position du curseur. */
export function applySuggestion(
  text: string,
  ctx: Pick<FormulaContext, 'prefix' | 'start'>,
  name: string,
): { text: string; caret: number } {
  let end = ctx.start + ctx.prefix.length
  // Curseur au milieu d'un nom (« =SO|MME(A1) ») : la fin du nom est remplacée aussi, sauf si
  // c'est une référence collée au nom tapé (« =SOM|A1 »).
  const tail = /^[A-Za-z0-9_.]*/.exec(text.slice(end))?.[0] ?? ''
  const isRef = /^[A-Za-z]{1,3}\d+$/.test(tail) && text[end + tail.length] !== '('
  if (!isRef) end += tail.length
  const hasParen = text[end] === '('
  const insert = hasParen ? name : `${name}(`
  return {
    text: text.slice(0, ctx.start) + insert + text.slice(end),
    caret: ctx.start + insert.length + (hasParen ? 1 : 0),
  }
}

/** Arguments de la syntaxe (« plage; critère; [plage_somme] ») pour surligner le courant. */
export function syntaxParts(doc: FunctionDoc): { name: string; args: string[] } {
  const open = doc.syntax.indexOf('(')
  const name = doc.syntax.slice(0, open)
  const inner = doc.syntax.slice(open + 1, -1)
  return { name, args: inner ? inner.split(';').map((a) => a.trim()) : [] }
}
