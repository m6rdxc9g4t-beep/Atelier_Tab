/**
 * Format des données sur disque : un dossier lisible par les humains et les IA.
 *
 *   ~/Atelier_Tab/
 *   ├── atelier.json            espaces, projets, collaborateurs, réglages d'export
 *   └── tables/<id>.json        une table : colonnes, lignes, vues
 *
 * Ce module est pur (aucun accès disque) : il transforme `AppData` en fichiers et
 * inversement, avec validation. Il est tolérant aux modifications faites à la main
 * ou par une IA : une table ajoutée sans être déclarée dans son projet est rattachée,
 * une ligne absente de `rowOrder` est ajoutée à la fin, une référence orpheline est ignorée.
 */
import { z } from 'zod'
import type { AppData, AppPreferences, Table } from '@/types/domain'

export const DATA_FORMAT = 'atelier_tab'
export const DATA_FORMAT_VERSION = 1
export const INDEX_FILE = 'atelier.json'
export const TABLES_DIR = 'tables'

/**
 * Identifiant utilisable comme nom de fichier (tables, instantanés) : lettres ASCII,
 * chiffres, `_` et `-`. Exclut `/`, `\`, `.` et donc toute traversée de répertoire.
 */
export const SAFE_ID = /^[A-Za-z0-9_-]+$/

export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value)
}

/** Chemin relatif du fichier d'une table. Refuse un id qui ne serait pas un nom de fichier sûr. */
export function tableFile(tableId: string): string {
  if (!isSafeId(tableId)) throw new DataFileError(TABLES_DIR, `id de table refusé : "${tableId}"`)
  return `${TABLES_DIR}/${tableId}.json`
}

/** Id de table à partir d'un chemin relatif `tables/<id>.json`, sinon null. */
export function tableIdFromPath(relativePath: string): string | null {
  const m = /^tables[/\\]([A-Za-z0-9_-]+)\.json$/.exec(relativePath)
  return m ? (m[1] ?? null) : null
}

// ---------------------------------------------------------------------------
// Schémas
// ---------------------------------------------------------------------------

const id = z.string().min(1)
const badgeColor = z.enum(['gray', 'blue', 'green', 'amber', 'red', 'violet', 'pink', 'teal'])
const cellInput = z.union([z.string(), z.number(), z.boolean(), z.null()])

export const fieldTypeSchema = z.enum([
  'text',
  'number',
  'currency',
  'percent',
  'select',
  'date',
  'checkbox',
  'owner',
  'formula',
])

export const atelierMappingSchema = z.enum([
  'entity_title',
  'workflow_state',
  'financial_ht',
  'financial_ttc',
  'assignee',
  'due_date',
  'start_date',
  'quantity',
  'description',
  'flag',
  'custom',
  'item_type',
  'time_spent',
])

const fieldSchema = z.object({
  id,
  label: z.string(),
  type: fieldTypeSchema,
  options: z
    .object({
      choices: z.array(z.object({ id, label: z.string(), color: badgeColor })).optional(),
      currency: z.enum(['EUR', 'USD', 'GBP', 'CHF']).optional(),
      decimals: z.number().int().min(0).max(10).optional(),
      resultFormat: z.enum(['number', 'currency', 'percent', 'text', 'date']).optional(),
    })
    .optional(),
  columnFormula: z.string().optional(),
  atelierMapping: atelierMappingSchema.optional(),
  width: z.number().positive().optional(),
})

const recordSchema = z.object({
  id: id.optional(),
  kind: z.enum(['data', 'summary']).default('data'),
  cells: z.record(z.string(), cellInput).default({}),
})

const viewSchema = z.object({
  id,
  name: z.string(),
  mode: z.enum(['hybrid', 'sheet', 'kanban']),
  filters: z
    .array(
      z.object({
        id,
        fieldId: id,
        operator: z.enum([
          'contains',
          'equals',
          'not_equals',
          'is_empty',
          'is_not_empty',
          'gt',
          'lt',
        ]),
        value: z.union([z.string(), z.number(), z.boolean()]).optional(),
      }),
    )
    .default([]),
  sorts: z.array(z.object({ fieldId: id, direction: z.enum(['asc', 'desc']) })).default([]),
  groupByFieldId: z.string().optional(),
  hiddenFieldIds: z.array(z.string()).default([]),
  // Réglages d'affichage : une valeur inconnue (fichier édité à la main) est ignorée.
  rowHeight: z.enum(['compact', 'standard', 'tall']).optional().catch(undefined),
  summaries: z
    .record(
      z.string(),
      z.enum(['sum', 'average', 'min', 'max', 'count', 'filled', 'empty', 'none']),
    )
    .optional()
    .catch(undefined),
})

export const tableFileSchema = z.object({
  id,
  projectId: id,
  name: z.string(),
  fieldOrder: z.array(z.string()).default([]),
  rowOrder: z.array(z.string()).default([]),
  fields: z.record(z.string(), fieldSchema),
  records: z.record(z.string(), recordSchema).default({}),
  views: z.array(viewSchema).default([]),
  activeViewId: z.string().optional(),
})

const exportLogSchema = z.object({
  at: z.string(),
  tableId: z.string(),
  method: z.enum(['json', 'csv', 'webhook']),
  rows: z.number(),
  ok: z.boolean(),
  message: z.string(),
})

const atelierProjetsSchema = z.object({
  webhookUrl: z.string().optional(),
  // Ancien fichier : absent. Édité à la main : un nombre est accepté et converti.
  projectId: z.preprocess(
    (v) => (typeof v === 'number' ? String(v) : typeof v === 'string' && v ? v : undefined),
    z.string().optional(),
  ),
  // Un journal d'export abîmé ne doit pas empêcher de charger les données.
  lastExport: exportLogSchema.optional().catch(undefined),
})

/** Réglages par défaut : hors ligne (docs/SUITE.md §5.1). */
export const DEFAULT_PREFERENCES = { onlineMode: false } as const

/**
 * Fichier des préférences de l'utilisateur (mode « En ligne »), rangé **hors du dossier de
 * données**, à côté du fichier de secrets (docs/SUITE.md §5.1) : le dossier ~/Atelier_Tab est
 * modifiable par les IA, le mode en ligne ne doit pas l'être.
 */
export const PREFERENCES_FILE = 'preferences.json'

/**
 * Lit le fichier de préférences. Lecture prudente : fichier absent, JSON cassé ou valeur qui
 * n'est pas exactement `true` → hors ligne.
 */
export function parsePreferencesFile(text: string | null): AppPreferences {
  if (text === null) return { ...DEFAULT_PREFERENCES }
  try {
    const raw = JSON.parse(text) as unknown
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PREFERENCES }
    return { onlineMode: (raw as { onlineMode?: unknown }).onlineMode === true }
  } catch {
    return { ...DEFAULT_PREFERENCES }
  }
}

/** Contenu du fichier de préférences. */
export function serializePreferences(prefs: AppPreferences): string {
  return JSON.stringify({ onlineMode: prefs.onlineMode === true }, null, 2) + '\n'
}

export const indexFileSchema = z.object({
  format: z.literal(DATA_FORMAT).optional(),
  version: z.literal(DATA_FORMAT_VERSION).optional(),
  workspaceOrder: z.array(z.string()).default([]),
  workspaces: z.record(
    z.string(),
    z.object({ id, name: z.string(), projectIds: z.array(z.string()).default([]) }),
  ),
  projects: z.record(
    z.string(),
    z.object({ id, workspaceId: id, name: z.string(), tableIds: z.array(z.string()).default([]) }),
  ),
  collaborators: z
    .record(z.string(), z.object({ id, name: z.string(), initials: z.string(), color: badgeColor }))
    .default({}),
  integrations: z
    .object({ atelierProjets: atelierProjetsSchema.default({}) })
    .default({ atelierProjets: {} }),
  // Ancien emplacement du mode « En ligne » (avant docs/SUITE.md §5.1 durci) : accepté à la
  // lecture mais **ignoré** — l'app repart hors ligne ; le réglage vit dans `PREFERENCES_FILE`.
  preferences: z.unknown().optional(),
})

/**
 * État complet envoyé par l'interface au processus principal (`data:save`). Mêmes règles
 * que les fichiers, plus le jeton (rangé à part par le FileStore) et les tables.
 */
const appStateSchema = indexFileSchema.omit({ format: true, version: true }).extend({
  schemaVersion: z.literal(1).optional(),
  tables: z.record(z.string(), tableFileSchema),
  integrations: z
    .object({
      atelierProjets: atelierProjetsSchema.extend({ token: z.string().optional() }).default({}),
    })
    .default({ atelierProjets: {} }),
})

export type IndexFile = z.infer<typeof indexFileSchema>
export type TableFile = z.infer<typeof tableFileSchema>

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

/**
 * Fichiers à écrire pour un état donné (chemin relatif → contenu).
 * Le jeton d'accès au webhook n'est jamais écrit dans le dossier partagé.
 */
export function serializeData(data: AppData): Map<string, string> {
  const files = new Map<string, string>()
  const { token: _token, ...integration } = data.integrations?.atelierProjets ?? {}
  void _token
  files.set(
    INDEX_FILE,
    stringify({
      format: DATA_FORMAT,
      version: DATA_FORMAT_VERSION,
      workspaceOrder: data.workspaceOrder,
      workspaces: data.workspaces,
      projects: data.projects,
      collaborators: data.collaborators,
      integrations: { atelierProjets: integration },
      // Le mode « En ligne » n'est jamais écrit ici (fichier de préférences, hors du dossier).
    }),
  )
  for (const table of Object.values(data.tables)) files.set(tableFile(table.id), stringify(table))
  return files
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export class DataFileError extends Error {
  readonly file: string
  constructor(file: string, message: string) {
    super(`${file} : ${message}`)
    this.name = 'DataFileError'
    this.file = file
  }
}

function parseJson(file: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new DataFileError(file, `JSON invalide (${e instanceof Error ? e.message : 'erreur'})`)
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`)
    .join(' ; ')
}

export function parseIndexFile(text: string): IndexFile {
  const parsed = indexFileSchema.safeParse(parseJson(INDEX_FILE, text))
  if (!parsed.success) throw new DataFileError(INDEX_FILE, describeIssues(parsed.error))
  return parsed.data
}

/** Nom donné à l'état reçu de l'interface dans les messages d'erreur. */
export const APP_STATE_SOURCE = 'état reçu de l’interface'

/**
 * Valide l'état complet reçu d'un processus moins fiable (interface de l'app de bureau)
 * avant toute écriture : schémas des fichiers, clé de table = id de la table, id utilisable
 * comme nom de fichier. Lève `DataFileError` sinon. Renvoie l'état normalisé, tel que le
 * FileStore le relirait.
 */
export function parseAppState(value: unknown): AppData {
  const parsed = appStateSchema.safeParse(value)
  if (!parsed.success) throw new DataFileError(APP_STATE_SOURCE, describeIssues(parsed.error))
  const { tables: rawTables, integrations, schemaVersion: _v, ...rest } = parsed.data
  void _v
  const tables: Record<string, Table> = {}
  for (const [key, t] of Object.entries(rawTables)) {
    if (!isSafeId(key) || t.id !== key) {
      throw new DataFileError(APP_STATE_SOURCE, `id de table refusé : "${key}"`)
    }
    tables[key] = normalizeTable(t)
  }
  const { token, ...atelierProjets } = integrations.atelierProjets
  const data = assembleData({ ...rest, integrations: { atelierProjets } }, tables)
  if (token) data.integrations.atelierProjets.token = token
  return data
}

/** Lit et normalise une table : ordres réparés, vue par défaut créée au besoin. */
export function parseTableFile(file: string, text: string): Table {
  const parsed = tableFileSchema.safeParse(parseJson(file, text))
  if (!parsed.success) throw new DataFileError(file, describeIssues(parsed.error))
  return normalizeTable(parsed.data)
}

export function normalizeTable(t: TableFile): Table {
  const fields: Table['fields'] = {}
  for (const [key, f] of Object.entries(t.fields)) fields[key] = { ...f, id: key }
  const records: Table['records'] = {}
  for (const [key, r] of Object.entries(t.records)) {
    records[key] = { id: key, kind: r.kind, cells: r.cells }
  }

  const reconcile = (order: string[], keys: string[]) => {
    const known = new Set(keys)
    const kept = [...new Set(order)].filter((k) => known.has(k))
    const listed = new Set(kept)
    return [...kept, ...keys.filter((k) => !listed.has(k))]
  }

  const views = t.views.length
    ? t.views
    : [
        {
          id: 'view_grid',
          name: 'Grille',
          mode: 'hybrid' as const,
          filters: [],
          sorts: [],
          hiddenFieldIds: [],
        },
      ]
  const activeViewId = views.some((v) => v.id === t.activeViewId)
    ? (t.activeViewId as string)
    : (views[0]?.id as string)

  return {
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    fieldOrder: reconcile(t.fieldOrder, Object.keys(fields)),
    rowOrder: reconcile(t.rowOrder, Object.keys(records)),
    fields,
    records,
    views,
    activeViewId,
  }
}

/**
 * Assemble l'état complet. Les tables sont rattachées à leur projet (`projectId`) même
 * si l'index ne les déclare pas ; les références vers des éléments absents sont ignorées.
 */
export function assembleData(index: IndexFile, tables: Record<string, Table>): AppData {
  const projects: AppData['projects'] = {}
  for (const [key, p] of Object.entries(index.projects)) {
    projects[key] = { ...p, id: key, tableIds: p.tableIds.filter((tid) => tables[tid]) }
  }
  for (const table of Object.values(tables)) {
    const project = projects[table.projectId]
    if (project && !project.tableIds.includes(table.id)) project.tableIds.push(table.id)
  }
  // Une table dont le projet n'existe plus n'est pas chargée.
  const kept: AppData['tables'] = {}
  for (const [tid, t] of Object.entries(tables)) if (projects[t.projectId]) kept[tid] = t

  const workspaces: AppData['workspaces'] = {}
  for (const [key, w] of Object.entries(index.workspaces)) {
    workspaces[key] = { ...w, id: key, projectIds: w.projectIds.filter((pid) => projects[pid]) }
  }
  for (const project of Object.values(projects)) {
    const ws = workspaces[project.workspaceId]
    if (ws && !ws.projectIds.includes(project.id)) ws.projectIds.push(project.id)
  }

  const order = [...new Set(index.workspaceOrder)].filter((w) => workspaces[w])
  for (const w of Object.keys(workspaces)) if (!order.includes(w)) order.push(w)

  return {
    schemaVersion: 1,
    workspaceOrder: order,
    workspaces,
    projects,
    tables: kept,
    collaborators: index.collaborators,
    // Clés absentes plutôt que `undefined` (lecture tolérante ci-dessus).
    integrations: {
      atelierProjets: Object.fromEntries(
        Object.entries(index.integrations.atelierProjets).filter(([, v]) => v !== undefined),
      ),
    },
    // Hors ligne ici ; le FileStore y reporte le fichier de préférences (hors du dossier).
    preferences: { ...DEFAULT_PREFERENCES },
  }
}
