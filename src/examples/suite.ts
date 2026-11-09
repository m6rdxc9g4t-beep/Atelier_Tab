/**
 * Exemples de la suite (`exemples-suite/`, format `atelier-exemples/1`) : histoires fictives communes à toutes les
 * apps, générées par Atelier_Deploy (`exemples/generer.py`) et copiées telles quelles dans chaque dépôt.
 *
 * Pour Tab, une histoire apporte un espace, un projet et ses tables : les opérations des relevés (convertis par
 * Atelier Convert) avec leur catégorie, et les tables métier de l'histoire (planning, backlog, contrats…).
 * Module pur : il construit des `Table` à partir de la part de l'histoire ; l'écriture passe par le store.
 */
import { atelierStatusChoices, workflowStatusCode } from '@/engine/field-types/workflow-status'
import { buildTable, createField, createRecord, createView } from '@/store/factories'
import type {
  AtelierMapping,
  BadgeColor,
  CellInput,
  Field,
  FieldType,
  SelectChoice,
  Table,
  TableRecord,
} from '@/types/domain'

export const EXAMPLES_FORMAT = 'atelier-exemples/1'

export interface ExampleStep {
  app: string
  titre: string
  texte: string
}

export interface ExampleStory {
  id: string
  titre: string
  sous_titre: string
  secteur: string
  resume: string
  parcours: ExampleStep[]
}

export interface ExampleColumn {
  label: string
  type: 'text' | 'number' | 'currency' | 'percent' | 'date' | 'select' | 'checkbox' | 'formula'
  choices?: string[]
  mapping?: string
  formula?: string
  format?: 'currency' | 'number' | 'percent'
}

export interface ExamplePart {
  format: string
  histoire: Omit<ExampleStory, 'parcours'>
  espace: { id: string; nom: string }
  projet: { id: string; nom: string }
  tables: { nom: string; colonnes: ExampleColumn[]; lignes: Record<string, string | number | boolean | null>[] }[]
}

const COLORS: BadgeColor[] = ['blue', 'green', 'amber', 'violet', 'pink', 'teal', 'gray', 'red']
const MAPPINGS = new Set<string>([
  'entity_title', 'workflow_state', 'financial_ht', 'financial_ttc', 'assignee', 'due_date', 'start_date',
  'quantity', 'description', 'flag', 'custom', 'item_type', 'time_spent',
])
const SAFE = /[^A-Za-z0-9_-]/g
const isSafeId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id)

/** Identifiant de fichier sûr et stable (`tbl_ex_<histoire>_<n>`) : un rechargement retrouve les mêmes tables. */
function stableId(prefix: string, ...parts: (string | number)[]): string {
  return [prefix, ...parts].join('_').replace(SAFE, '_')
}

function choicesFor(col: ExampleColumn): SelectChoice[] {
  const labels = col.choices ?? []
  // Statuts de la suite : couleurs et identifiants officiels (reconnus tels quels par Atelier Projets).
  if (col.mapping === 'workflow_state' && labels.every((l) => workflowStatusCode(l) !== null)) {
    const official = atelierStatusChoices()
    return labels.map((l) => official.find((c) => workflowStatusCode(c.label) === workflowStatusCode(l)) ?? official[0]!)
  }
  return labels.map((label, i) => ({ id: `opt_${i}`, label, color: COLORS[i % COLORS.length]! }))
}

function fieldFor(col: ExampleColumn, id: string): Field {
  const type: FieldType = col.type
  const mapping = col.mapping && MAPPINGS.has(col.mapping) ? (col.mapping as AtelierMapping) : undefined
  return createField({
    id,
    label: col.label,
    type,
    ...(mapping ? { atelierMapping: mapping } : {}),
    ...(col.type === 'select' ? { options: { choices: choicesFor(col) } } : {}),
    ...(col.type === 'currency' ? { options: { currency: 'EUR', decimals: 2 } } : {}),
    ...(col.type === 'formula' && col.formula
      ? { columnFormula: col.formula, options: { resultFormat: col.format ?? 'number', ...(col.format === 'currency' ? { currency: 'EUR' as const } : {}) } }
      : {}),
    ...(mapping === 'entity_title' ? { width: 280 } : {}),
  })
}

function cellFor(field: Field, value: string | number | boolean | null | undefined): CellInput | undefined {
  if (value === null || value === undefined || field.type === 'formula') return undefined
  if (field.type === 'select') {
    return field.options?.choices?.find((c) => c.label === value)?.id ?? null
  }
  return value
}

/** Tables Tab de l'histoire, avec des identifiants stables. */
export function buildExampleTables(part: ExamplePart): Table[] {
  const h = part.histoire.id
  return part.tables.map((t, ti) => {
    const fields = t.colonnes.map((c, ci) => fieldFor(c, stableId('fld_ex', h, ti, ci)))
    const records: TableRecord[] = t.lignes.map((row, ri) => {
      const cells: TableRecord['cells'] = {}
      for (const f of fields) {
        const v = cellFor(f, row[f.label])
        if (v !== undefined) cells[f.id] = v
      }
      return createRecord(cells, 'data', stableId('rec_ex', h, ti, ri))
    })
    const status = fields.find((f) => f.atelierMapping === 'workflow_state')
    const views = [
      createView('hybrid', { id: stableId('view_ex', h, ti, 'grille') }),
      ...(status ? [createView('kanban', { id: stableId('view_ex', h, ti, 'kanban'), groupByFieldId: status.id })] : []),
    ]
    return buildTable({ id: stableId('tbl_ex', h, ti), projectId: part.projet.id, name: t.nom, fields, records, views })
  })
}

/** Où trouver les histoires : fichiers livrés avec l'app (navigateur) ou dossier `exemples-suite/` (serveur MCP). */
export interface ExampleSource {
  /** Histoires disponibles (liste vide si l'installation n'en livre pas). */
  list(): Promise<ExampleStory[]>
  /** Part Tab d'une histoire ; rejette si elle est absente ou invalide. */
  load(id: string): Promise<ExamplePart>
}

/** Liste des histoires d'un `index.json` (format vérifié, identifiants sûrs). */
export function storiesFromIndex(index: unknown): ExampleStory[] {
  if (!index || typeof index !== 'object') return []
  const v = index as { format?: unknown; histoires?: unknown }
  if (v.format !== EXAMPLES_FORMAT || !Array.isArray(v.histoires)) return []
  return (v.histoires as ExampleStory[]).filter((h) => typeof h?.id === 'string' && isSafeId(h.id))
}

/** Part d'histoire valide (format, identifiants sûrs, tables). */
export function isExamplePart(value: unknown): value is ExamplePart {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<ExamplePart>
  return (
    v.format === EXAMPLES_FORMAT &&
    typeof v.histoire?.id === 'string' && isSafeId(v.histoire.id) &&
    typeof v.espace?.id === 'string' && isSafeId(v.espace.id) &&
    typeof v.projet?.id === 'string' && isSafeId(v.projet.id) &&
    Array.isArray(v.tables)
  )
}
