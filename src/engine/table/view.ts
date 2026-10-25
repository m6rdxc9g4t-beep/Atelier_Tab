/**
 * Vue d'une table : filtres, tri et recherche rapide, comme une vue Airtable.
 *
 * Une vue ne change jamais l'ordre des lignes de la table (`rowOrder`) : les formules
 * lisent des adresses A1 qui en dépendent. Elle calcule seulement l'ordre d'affichage.
 * Les lignes de synthèse (totaux) ne sont ni filtrées ni triées : quand un filtre ou un tri
 * est actif, elles restent visibles, à la fin.
 *
 * Valeur d'un filtre : au format stocké de la colonne (nombre, fraction pour un
 * pourcentage, « AAAA-MM-JJ », id du choix ou du collaborateur, booléen).
 *
 * Module pur : les valeurs calculées sont lues par la fonction `value` reçue.
 */
import {
  compareValues,
  dateTextToSerial,
  isError,
  type CellValue,
  type FormulaError,
} from '@/engine/formula'
import { formatValue, type LookupContext } from '@/engine/field-types'
import type { Field, Filter, FilterOperator, Sort, Table, View } from '@/types/domain'

export type ValueOf = (recordId: string, fieldId: string) => CellValue

export interface ViewOptions {
  /** Recherche rapide (non enregistrée) dans les colonnes `searchFieldIds`. */
  search?: string
  searchFieldIds?: readonly string[]
  /** Lignes gardées visibles malgré les filtres et la recherche (ligne tout juste ajoutée). */
  pinned?: ReadonlySet<string>
}

/** Opérateurs proposés selon le type de colonne, dans l'ordre d'affichage. */
export function operatorsFor(field: Field): FilterOperator[] {
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent':
    case 'date':
    case 'formula':
      return ['equals', 'not_equals', 'gt', 'lt', 'is_empty', 'is_not_empty']
    case 'select':
    case 'owner':
      return ['equals', 'not_equals', 'is_empty', 'is_not_empty']
    case 'checkbox':
      return ['equals']
    default:
      return ['contains', 'equals', 'not_equals', 'is_empty', 'is_not_empty']
  }
}

/** L'opérateur a-t-il besoin d'une valeur ? */
export function operatorNeedsValue(op: FilterOperator): boolean {
  return op !== 'is_empty' && op !== 'is_not_empty'
}

/** Texte comparable : minuscules, sans accents ni ligatures (« Œuvre » = « oeuvre »). */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('fr')
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
}

const isBlank = (v: CellValue) => v === null || v === '' || (typeof v === 'string' && !v.trim())

/** Libellé attendu par un filtre sur un statut ou un responsable (id → libellé). */
function expectedLabel(field: Field, value: Filter['value'], ctx: LookupContext): string | null {
  if (value === undefined || value === null) return null
  const raw = String(value)
  if (field.type === 'select') {
    const choice = field.options?.choices?.find((c) => c.id === raw || c.label === raw)
    return choice ? choice.label : raw
  }
  if (field.type === 'owner') return ctx.collaborators[raw]?.name ?? raw
  return raw
}

/** Valeur numérique comparable d'une cellule ou d'un filtre (dates : numéro de série). */
function numeric(v: CellValue | Filter['value']): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const t = v.trim()
    if (t === '') return null
    const n = Number(t.replace(',', '.'))
    if (Number.isFinite(n)) return n
    return dateTextToSerial(t)
  }
  return null
}

/** La cellule satisfait-elle le filtre ? */
export function matchesFilter(
  field: Field,
  filter: Filter,
  value: CellValue,
  ctx: LookupContext,
): boolean {
  const op = filter.operator
  if (field.type === 'checkbox') {
    const checked = value === true
    if (op === 'is_empty') return !checked
    if (op === 'is_not_empty') return checked
    const want = filter.value === true || filter.value === 'true'
    return op === 'not_equals' ? checked !== want : checked === want
  }
  if (op === 'is_empty') return isBlank(value) || isError(value)
  if (op === 'is_not_empty') return !isBlank(value) && !isError(value)
  if (isError(value)) return op === 'not_equals'
  if (filter.value === undefined || filter.value === '') return true

  if (field.type === 'select' || field.type === 'owner') {
    const label = expectedLabel(field, filter.value, ctx)
    const same = !isBlank(value) && label !== null && foldText(String(value)) === foldText(label)
    return op === 'not_equals' ? !same : same
  }

  const text = isBlank(value) ? '' : String(value)
  if (op === 'contains') return foldText(text).includes(foldText(String(filter.value)))

  const a = numeric(value)
  const b = numeric(filter.value)
  const comparable = a !== null && b !== null
  switch (op) {
    case 'equals':
      return comparable ? a === b : foldText(text) === foldText(String(filter.value))
    case 'not_equals':
      return comparable ? a !== b : foldText(text) !== foldText(String(filter.value))
    case 'gt':
    case 'lt': {
      if (isBlank(value)) return false
      const diff = comparable
        ? a - b
        : compareValues(text, String(filter.value))
      return op === 'gt' ? diff > 0 : diff < 0
    }
    default:
      return true
  }
}

/** Comparaison de deux valeurs pour un tri croissant ; les cellules vides et les erreurs à la fin. */
export function compareForSort(field: Field, a: CellValue, b: CellValue): number {
  const rank = (v: CellValue) => (isBlank(v) ? 2 : isError(v) ? 1 : 0)
  const ra = rank(a)
  const rb = rank(b)
  if (ra || rb) return ra - rb
  if (field.type === 'select') {
    // Comme Airtable : l'ordre des choix, pas l'ordre alphabétique.
    const order = (v: CellValue) => {
      const i = field.options?.choices?.findIndex((c) => c.label === v) ?? -1
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    const d = order(a) - order(b)
    if (d !== 0) return d
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b, 'fr', { numeric: true, sensitivity: 'base' })
  }
  return compareValues(a as Exclude<CellValue, FormulaError>, b as Exclude<CellValue, FormulaError>)
}

/** Filtres utilisables : colonne existante et valeur renseignée si l'opérateur en demande une. */
export function activeFilters(table: Table, view: View | undefined): Filter[] {
  return (view?.filters ?? []).filter(
    (f) =>
      table.fields[f.fieldId] !== undefined &&
      (!operatorNeedsValue(f.operator) ||
        table.fields[f.fieldId]?.type === 'checkbox' ||
        (f.value !== undefined && f.value !== '')),
  )
}

export function activeSorts(table: Table, view: View | undefined): Sort[] {
  return (view?.sorts ?? []).filter((s) => table.fields[s.fieldId] !== undefined)
}

/**
 * Lignes visibles de la vue, dans l'ordre d'affichage. Sans filtre, tri ni recherche :
 * `table.rowOrder` lui-même (même référence).
 */
export function viewRecordIds(
  table: Table,
  view: View | undefined,
  value: ValueOf,
  ctx: LookupContext,
  options: ViewOptions = {},
): string[] {
  const filters = activeFilters(table, view)
  const sorts = activeSorts(table, view)
  const search = foldText(options.search?.trim() ?? '')
  if (filters.length === 0 && sorts.length === 0 && search === '') return table.rowOrder

  const searchFields = (options.searchFieldIds ?? table.fieldOrder)
    .map((id) => table.fields[id])
    .filter((f): f is Field => f !== undefined)
  const pinned = options.pinned

  const data: string[] = []
  const summaries: string[] = []
  for (const recordId of table.rowOrder) {
    const record = table.records[recordId]
    if (!record) continue
    if (record.kind === 'summary') {
      summaries.push(recordId)
      continue
    }
    if (pinned?.has(recordId)) {
      data.push(recordId)
      continue
    }
    const kept = filters.every((f) =>
      matchesFilter(table.fields[f.fieldId] as Field, f, value(recordId, f.fieldId), ctx),
    )
    if (!kept) continue
    if (
      search &&
      !searchFields.some((field) => {
        const v = value(recordId, field.id)
        return v !== null && foldText(formatValue(field, v)).includes(search)
      })
    ) {
      continue
    }
    data.push(recordId)
  }

  if (sorts.length > 0) {
    const position = new Map(table.rowOrder.map((id, i) => [id, i]))
    data.sort((x, y) => {
      for (const s of sorts) {
        const field = table.fields[s.fieldId] as Field
        const a = value(x, s.fieldId)
        const b = value(y, s.fieldId)
        let d = compareForSort(field, a, b)
        // Les cellules vides restent à la fin, même en tri décroissant.
        if (s.direction === 'desc' && !isBlank(a) && !isBlank(b) && !isError(a) && !isError(b)) {
          d = -d
        }
        if (d !== 0) return d
      }
      return (position.get(x) ?? 0) - (position.get(y) ?? 0)
    })
  }
  return [...data, ...summaries]
}

/** Valeurs de regroupement d'une vue Kanban : une colonne par choix, puis « Sans statut ». */
export interface KanbanColumn {
  /** Id du choix, ou `null` pour les lignes sans valeur (ou valeur hors des choix). */
  choiceId: string | null
  recordIds: string[]
}

export function kanbanColumns(
  table: Table,
  field: Field,
  recordIds: readonly string[],
): KanbanColumn[] {
  const choices = field.options?.choices ?? []
  const columns: KanbanColumn[] = [
    ...choices.map((c) => ({ choiceId: c.id as string | null, recordIds: [] as string[] })),
    { choiceId: null, recordIds: [] },
  ]
  const byId = new Map(columns.map((c) => [c.choiceId, c]))
  for (const recordId of recordIds) {
    const record = table.records[recordId]
    if (!record || record.kind !== 'data') continue
    const stored = record.cells[field.id]
    const column = (typeof stored === 'string' ? byId.get(stored) : undefined) ?? byId.get(null)
    column?.recordIds.push(recordId)
  }
  return columns
}
