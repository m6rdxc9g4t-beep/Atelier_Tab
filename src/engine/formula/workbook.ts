/**
 * Workbook : stocke les saisies d'une feuille, maintient le graphe de dépendances
 * et recalcule de façon incrémentale.
 *
 * - `setCell` ne recalcule que la cellule modifiée et ce qui en dépend, dans l'ordre
 *   topologique (chaque formule est évaluée une seule fois, après ses antécédents).
 * - Les cellules prises dans un cycle reçoivent `#CYCLE!` ; ce qui dépend d'un cycle
 *   est évalué normalement (et voit donc `#CYCLE!`, sauf IFERROR).
 * - Les clés internes sont des adresses A1 canoniques, sans `$` ("C12").
 */
import { evaluate, type EvalContext } from './evaluator'
import { collectReferences, parseFormula, type Node } from './parser'
import { parseA1, rangeContains, toA1, type RangeRef } from './references'
import { FormulaSyntaxError } from './tokenizer'
import { err, sameValue, type CellValue } from './values'

/** Ce que l'on peut saisir dans une cellule. Une chaîne commençant par `=` est une formule. */
export type CellInput = string | number | boolean | null

interface CellEntry {
  input: CellInput
  ast: Node | null
  parseError: string | null
  deps: Set<string>
  ranges: RangeRef[]
  value: CellValue
}

export function isFormula(input: CellInput): input is string {
  return typeof input === 'string' && input.startsWith('=') && input.length > 1
}

function keyOf(address: string): string {
  const ref = parseA1(address)
  if (!ref) throw new RangeError(`Adresse de cellule invalide : ${address}`)
  return toA1(ref.col, ref.row)
}

function coords(key: string): { col: number; row: number } {
  const ref = parseA1(key)
  if (!ref) throw new RangeError(`Clé invalide : ${key}`)
  return { col: ref.col, row: ref.row }
}

export class Workbook {
  private readonly cells = new Map<string, CellEntry>()
  /** Antécédent (clé) → formules qui le lisent directement. */
  private readonly dependents = new Map<string, Set<string>>()
  /** Formules contenant au moins une plage. */
  private readonly rangeReaders = new Map<string, RangeRef[]>()

  private readonly ctx: EvalContext = {
    getCell: (col, row) => this.cells.get(toA1(col, row))?.value ?? null,
  }

  // ---------------------------------------------------------------- lecture

  getValue(address: string): CellValue {
    return this.cells.get(keyOf(address))?.value ?? null
  }

  getInput(address: string): CellInput {
    return this.cells.get(keyOf(address))?.input ?? null
  }

  /** Message de l'erreur de syntaxe éventuelle (pour l'infobulle de la barre de formules). */
  getParseError(address: string): string | null {
    return this.cells.get(keyOf(address))?.parseError ?? null
  }

  /** Cellules lues directement par la formule de `address` (plages déroulées non incluses). */
  getPrecedents(address: string): { cells: string[]; ranges: RangeRef[] } {
    const entry = this.cells.get(keyOf(address))
    return { cells: [...(entry?.deps ?? [])], ranges: [...(entry?.ranges ?? [])] }
  }

  /** Formules qui lisent `address`, directement ou via une plage. */
  getDependents(address: string): string[] {
    return [...this.directDependents(keyOf(address))]
  }

  /** Toutes les cellules non vides. */
  addresses(): string[] {
    return [...this.cells.keys()]
  }

  // ---------------------------------------------------------------- écriture

  /** Modifie une cellule et renvoie les adresses dont la valeur a changé. */
  setCell(address: string, input: CellInput): Set<string> {
    return this.setCells([[address, input]])
  }

  /** Modifie plusieurs cellules en un seul recalcul (collage, chargement d'une table). */
  setCells(entries: Iterable<readonly [string, CellInput]>): Set<string> {
    const before = new Map<string, CellValue>()
    const seeds: string[] = []

    for (const [address, input] of entries) {
      const key = keyOf(address)
      if (!before.has(key)) before.set(key, this.cells.get(key)?.value ?? null)
      this.write(key, input)
      seeds.push(key)
    }

    const touched = this.recalculate(seeds, before)
    const changed = new Set<string>()
    for (const key of touched) {
      if (!sameValue(before.get(key) ?? null, this.cells.get(key)?.value ?? null)) changed.add(key)
    }
    return changed
  }

  /** Vide entièrement la feuille. */
  clear(): void {
    this.cells.clear()
    this.dependents.clear()
    this.rangeReaders.clear()
  }

  /**
   * Évalue une formule sans l'enregistrer : aperçu en direct dans la barre de formules.
   * Si `at` est fourni, une formule qui se lirait elle-même renvoie `#CYCLE!`.
   */
  preview(formula: string, at?: string): CellValue {
    let ast: Node
    try {
      ast = parseFormula(formula)
    } catch (e) {
      return err('#ERROR!', e instanceof Error ? e.message : undefined)
    }
    if (at) {
      const self = keyOf(at)
      const { cells, ranges } = collectReferences(ast)
      const { col, row } = coords(self)
      const readsSelf =
        cells.some((r) => toA1(r.col, r.row) === self) ||
        ranges.some((r) => rangeContains(r, col, row)) ||
        this.reaches(
          cells.map((r) => toA1(r.col, r.row)),
          ranges,
          self,
        )
      if (readsSelf) return err('#CYCLE!')
    }
    return evaluate(ast, this.ctx)
  }

  // ---------------------------------------------------------------- interne

  private write(key: string, input: CellInput): void {
    this.unlink(key)

    if (input === null || input === '') {
      this.cells.delete(key)
      return
    }

    if (!isFormula(input)) {
      this.cells.set(key, {
        input,
        ast: null,
        parseError: null,
        deps: new Set(),
        ranges: [],
        value: input,
      })
      return
    }

    let ast: Node | null = null
    let parseError: string | null = null
    try {
      ast = parseFormula(input)
    } catch (e) {
      parseError = e instanceof FormulaSyntaxError ? e.message : 'Formule invalide'
    }

    const deps = new Set<string>()
    const ranges: RangeRef[] = []
    if (ast) {
      const refs = collectReferences(ast)
      for (const r of refs.cells) deps.add(toA1(r.col, r.row))
      ranges.push(...refs.ranges)
    }

    this.cells.set(key, {
      input,
      ast,
      parseError,
      deps,
      ranges,
      value: parseError ? err('#ERROR!', parseError) : null,
    })
    for (const d of deps) {
      let set = this.dependents.get(d)
      if (!set) this.dependents.set(d, (set = new Set()))
      set.add(key)
    }
    if (ranges.length > 0) this.rangeReaders.set(key, ranges)
  }

  private unlink(key: string): void {
    const entry = this.cells.get(key)
    if (!entry) return
    for (const d of entry.deps) {
      const set = this.dependents.get(d)
      set?.delete(key)
      if (set && set.size === 0) this.dependents.delete(d)
    }
    this.rangeReaders.delete(key)
  }

  private directDependents(key: string): Set<string> {
    const out = new Set(this.dependents.get(key) ?? [])
    if (this.rangeReaders.size > 0) {
      const { col, row } = coords(key)
      for (const [reader, ranges] of this.rangeReaders) {
        if (ranges.some((r) => rangeContains(r, col, row))) out.add(reader)
      }
    }
    return out
  }

  /** Vrai si, depuis ces antécédents, on remonte jusqu'à `target` (détection de cycle). */
  private reaches(startCells: string[], startRanges: RangeRef[], target: string): boolean {
    const seen = new Set<string>()
    const stack = [...startCells]
    for (const range of startRanges) {
      for (const key of this.cells.keys()) {
        const { col, row } = coords(key)
        if (rangeContains(range, col, row)) stack.push(key)
      }
    }
    while (stack.length > 0) {
      const key = stack.pop() as string
      if (key === target) return true
      if (seen.has(key)) continue
      seen.add(key)
      const entry = this.cells.get(key)
      if (!entry) continue
      stack.push(...entry.deps)
      for (const range of entry.ranges) {
        for (const k of this.cells.keys()) {
          const { col, row } = coords(k)
          if (rangeContains(range, col, row)) stack.push(k)
        }
      }
    }
    return false
  }

  /**
   * Recalcule les `seeds` et tout ce qui en dépend. Complète `previous` avec les valeurs
   * d'avant recalcul et renvoie l'ensemble des cellules réévaluées.
   */
  private recalculate(seeds: string[], previous: Map<string, CellValue>): Set<string> {
    // 1. Ensemble affecté : fermeture transitive des dépendants.
    const affected = new Set<string>()
    const queue = [...seeds]
    while (queue.length > 0) {
      const key = queue.pop() as string
      if (affected.has(key)) continue
      affected.add(key)
      for (const d of this.directDependents(key)) if (!affected.has(d)) queue.push(d)
    }

    // Valeurs avant recalcul, pour signaler uniquement ce qui change.
    for (const key of affected) {
      if (!previous.has(key)) previous.set(key, this.cells.get(key)?.value ?? null)
    }

    // 2. Arêtes antécédent → dépendant, restreintes à l'ensemble affecté.
    const edges = new Map<string, string[]>()
    for (const key of affected) {
      const targets = [...this.directDependents(key)].filter((d) => affected.has(d))
      edges.set(key, targets)
    }

    // 3. Tri topologique (Kahn). Les nœuds ordonnés ne dépendent d'aucun cycle.
    const order = topologicalOrder(affected, edges)
    for (const key of order) this.evaluateCell(key)

    // 4. Les nœuds restants contiennent au moins un cycle : on marque les vrais membres
    //    de cycles (composantes fortement connexes), puis on évalue normalement ce qui
    //    se trouve seulement en aval.
    const ordered = new Set(order)
    const remaining = new Set([...affected].filter((k) => !ordered.has(k)))
    if (remaining.size > 0) {
      const cyclic = cyclicNodes(remaining, edges)
      const rest = new Set([...remaining].filter((k) => !cyclic.has(k)))
      const restEdges = new Map<string, string[]>()
      for (const k of rest)
        restEdges.set(
          k,
          (edges.get(k) ?? []).filter((t) => rest.has(t)),
        )
      const restOrder = topologicalOrder(rest, restEdges)
      const restOrdered = new Set(restOrder)
      for (const k of rest) if (!restOrdered.has(k)) cyclic.add(k) // garde-fou

      for (const key of cyclic) {
        const entry = this.cells.get(key)
        if (entry) entry.value = err('#CYCLE!')
      }
      for (const key of restOrder) this.evaluateCell(key)
    }

    return affected
  }

  private evaluateCell(key: string): void {
    const entry = this.cells.get(key)
    if (!entry || !entry.ast) return
    entry.value = evaluate(entry.ast, this.ctx)
  }
}

function topologicalOrder(nodes: Set<string>, edges: Map<string, string[]>): string[] {
  const indegree = new Map<string, number>()
  for (const n of nodes) indegree.set(n, 0)
  for (const n of nodes) {
    for (const t of edges.get(n) ?? []) indegree.set(t, (indegree.get(t) ?? 0) + 1)
  }
  const ready = [...nodes].filter((n) => indegree.get(n) === 0)
  const order: string[] = []
  while (ready.length > 0) {
    const n = ready.pop() as string
    order.push(n)
    for (const t of edges.get(n) ?? []) {
      const d = (indegree.get(t) ?? 0) - 1
      indegree.set(t, d)
      if (d === 0) ready.push(t)
    }
  }
  return order
}

/** Membres de cycles (Tarjan) : composantes de taille > 1, ou boucle sur soi-même. */
function cyclicNodes(nodes: Set<string>, edges: Map<string, string[]>): Set<string> {
  let index = 0
  const indices = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const result = new Set<string>()

  const strongConnect = (v: string): void => {
    indices.set(v, index)
    low.set(v, index)
    index++
    stack.push(v)
    onStack.add(v)

    for (const w of edges.get(v) ?? []) {
      if (!nodes.has(w)) continue
      if (!indices.has(w)) {
        strongConnect(w)
        low.set(v, Math.min(low.get(v) as number, low.get(w) as number))
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) as number, indices.get(w) as number))
      }
    }

    if (low.get(v) === indices.get(v)) {
      const component: string[] = []
      let w: string
      do {
        w = stack.pop() as string
        onStack.delete(w)
        component.push(w)
      } while (w !== v)
      const selfLoop = (edges.get(v) ?? []).includes(v)
      if (component.length > 1 || selfLoop) for (const c of component) result.add(c)
    }
  }

  for (const n of nodes) if (!indices.has(n)) strongConnect(n)
  return result
}
