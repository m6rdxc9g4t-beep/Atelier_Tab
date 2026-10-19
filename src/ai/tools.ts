/**
 * Outils d'Atelier_Tab pour les IA : un seul jeu de définitions, utilisé par le serveur
 * MCP (Claude Code) et par l'assistant intégré (Ollama).
 *
 * Chaque outil agit sur un `DataStore` à travers ses actions, exactement comme
 * l'interface : mêmes conversions de saisie (« 45 000 € », « 30/11/2026 »), mêmes
 * réécritures de formules à l'insertion d'une ligne, même moteur de calcul.
 */
import { z } from 'zod'
import {
  buildAtelierPayload,
  isProjetsImportUrl,
  isValidWebhookUrl,
  PROJETS_LOCAL_IMPORT_URL,
  PROJETS_PRESET_LABEL,
  sendToWebhook,
  toEnrichedCsv,
  validatePayload,
  WEBHOOK_PRESETS,
  withProjetsParams,
  type ProjetsImportSummary,
  type WebhookFetch,
} from '@/dataflow'
import { exportFilename } from '@/dataflow/transports/download'
import {
  ATELIER_STATUS_PRESET_NAME,
  mergeAtelierStatuses,
  parseUserInput,
  WORKFLOW_STATUSES,
  workflowStatus,
  workflowStatusCode,
} from '@/engine/field-types'
import { isError, isFormula, parseFormula, serializeValue, type CellInput } from '@/engine/formula'
import type { TableSheet } from '@/engine/table'
import type { DataStore } from '@/store/data.store'
import { DEFAULT_STATUS_CHOICES } from '@/store/factories'
import type { AppData, BadgeColor, Field, FieldType, SelectChoice, Table } from '@/types/domain'
import {
  letterOf,
  resolveColumn,
  resolveProject,
  resolveRow,
  resolveTable,
  resolveWorkspace,
  rowNumberOf,
  ToolError,
} from './resolve'

export { ToolError }

/** Environnement d'exécution des outils. */
export interface ToolHost {
  store: DataStore
  getSheet(tableId: string): TableSheet | undefined
  /** Enregistre un fichier d'export ; renvoie où il se trouve. */
  saveExport(
    filename: string,
    content: string,
    mime: string,
    requestedPath?: string,
  ): Promise<string>
  /** Transport HTTP du webhook (l'app de bureau relaie les envois vers Atelier Projets local). */
  webhookFetch?: WebhookFetch
}

interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string
  description: string
  input: S
  run(args: z.infer<S>, host: ToolHost): unknown
}

function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def
}

// ---------------------------------------------------------------------------
// Aides
// ---------------------------------------------------------------------------

const tableRef = z.string().describe('Table : son id (ex. tbl_planning_lots) ou son nom exact')
const columnRef = z.string().describe('Colonne : sa lettre (C), son libellé (Coût HT) ou son id')
const rowRef = z
  .union([z.number().int().positive(), z.string()])
  .describe('Ligne : numéro affiché (1 = première ligne) ou id de ligne (rec_…)')
const cellValue = z
  .union([z.string(), z.number(), z.boolean(), z.null()])
  .describe(
    'Valeur comme on la taperait : "45 000", "=SUM(C1:C3)", "En cours", "30/11/2026", true. null vide la cellule.',
  )

const FIELD_TYPE_VALUES = [
  'text',
  'number',
  'currency',
  'percent',
  'select',
  'date',
  'checkbox',
  'owner',
  'formula',
] as const satisfies readonly FieldType[]

const MAPPING_VALUES = [
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
] as const

const CHOICE_COLORS: BadgeColor[] = [
  'gray',
  'blue',
  'green',
  'amber',
  'red',
  'violet',
  'pink',
  'teal',
]

const DEFAULT_CHOICE_LABELS = DEFAULT_STATUS_CHOICES.map((c) => c.label)

const statusPreset = z
  .enum(['atelier'])
  .optional()
  .describe(
    `Pour type=select : "atelier" applique le préréglage « ${ATELIER_STATUS_PRESET_NAME} », les 8 statuts communs de la Suite Atelier (${WORKFLOW_STATUSES.map((s) => s.label).join(', ')}), affichés avec leurs couleurs officielles. Remplace \`choices\`.`,
  )

function data(host: ToolHost): AppData {
  return host.store.getState()
}

function sheetOf(host: ToolHost, table: Table): TableSheet {
  const sheet = host.getSheet(table.id)
  if (!sheet) throw new ToolError(`Calculs indisponibles pour « ${table.name} »`)
  return sheet
}

function freshTable(host: ToolHost, tableId: string): Table {
  const t = data(host).tables[tableId]
  if (!t) throw new ToolError('La table a été supprimée pendant l’opération')
  return t
}

const NUMERIC: FieldType[] = ['number', 'currency', 'percent', 'formula']

/** Convertit une valeur fournie par l'IA en valeur stockée, avec les règles de saisie de l'interface. */
function toStored(field: Field, value: z.infer<typeof cellValue>, d: AppData): CellInput {
  if (value === null || value === '') return null
  if (typeof value === 'number' && NUMERIC.includes(field.type)) return value
  if (typeof value === 'boolean' && field.type === 'checkbox') return value
  const parsed = parseUserInput(field, String(value), { collaborators: d.collaborators })
  if (parsed.ok) return parsed.input
  let hint = ''
  if (field.type === 'select') {
    hint = ` Choix possibles : ${(field.options?.choices ?? []).map((c) => c.label).join(', ')}.`
  } else if (field.type === 'owner') {
    hint = ` Collaborateurs : ${Object.values(d.collaborators)
      .map((c) => c.name)
      .join(', ')}.`
  }
  throw new ToolError(`${field.label} : ${parsed.reason}.${hint}`)
}

function choicesFrom(labels: string[], existing: SelectChoice[] = []): SelectChoice[] {
  const used = new Set<string>()
  return labels.map((label, i) => {
    const keep = existing.find(
      (c) => c.label.localeCompare(label, 'fr', { sensitivity: 'base' }) === 0,
    )
    if (keep) {
      used.add(keep.id)
      return { ...keep, label }
    }
    const base =
      'opt_' +
      (label
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'choix')
    let idCandidate = base
    for (
      let n = 2;
      used.has(idCandidate) || existing.some((c) => c.id === idCandidate && c.label !== label);
      n++
    ) {
      idCandidate = `${base}_${n}`
    }
    used.add(idCandidate)
    // Un statut de workflow reconnu prend la teinte de sa couleur officielle.
    const code = workflowStatusCode(label)
    const color = code
      ? workflowStatus(code).color
      : (CHOICE_COLORS[i % CHOICE_COLORS.length] as BadgeColor)
    return { id: idCandidate, label, color }
  })
}

function checkFormula(formula: string): string {
  const f = formula.trim().startsWith('=') ? formula.trim() : `=${formula.trim()}`
  try {
    parseFormula(f)
  } catch (e) {
    throw new ToolError(
      `Formule invalide « ${formula} » : ${e instanceof Error ? e.message : 'erreur'}`,
    )
  }
  return f
}

function columnInfo(table: Table, field: Field) {
  return {
    letter: letterOf(table, field.id),
    id: field.id,
    label: field.label,
    type: field.type,
    ...(field.columnFormula ? { formula: field.columnFormula } : {}),
    ...(field.options?.choices ? { choices: field.options.choices.map((c) => c.label) } : {}),
    ...(field.type === 'formula' && field.options?.resultFormat
      ? { format: field.options.resultFormat }
      : {}),
    ...(field.atelierMapping && field.atelierMapping !== 'custom'
      ? { mapping: field.atelierMapping }
      : {}),
  }
}

/** Valeurs calculées d'une ligne, par lettre de colonne. */
function rowValues(table: Table, sheet: TableSheet, recordId: string) {
  const cells: Record<string, string | number | boolean | null> = {}
  const formulas: Record<string, string> = {}
  for (const fieldId of table.fieldOrder) {
    const letter = letterOf(table, fieldId)
    const v = serializeValue(sheet.value(recordId, fieldId))
    if (v !== null && v !== '') cells[letter] = v
    const stored = table.records[recordId]?.cells[fieldId] ?? null
    if (isFormula(stored)) formulas[letter] = stored
  }
  return { cells, formulas }
}

function describeRow(table: Table, sheet: TableSheet, recordId: string) {
  const { cells, formulas } = rowValues(table, sheet, recordId)
  const record = table.records[recordId]
  return {
    row: rowNumberOf(table, recordId),
    id: recordId,
    ...(record?.kind === 'summary' ? { total_row: true } : {}),
    cells,
    ...(Object.keys(formulas).length ? { formulas } : {}),
  }
}

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

export const TOOLS = [
  tool({
    name: 'list_tables',
    description:
      'Liste les espaces de travail, projets et tables d’Atelier_Tab avec leurs ids, ainsi que les collaborateurs. À appeler en premier pour savoir ce qui existe.',
    input: z.object({}),
    run(_, host) {
      const d = data(host)
      return {
        workspaces: d.workspaceOrder.flatMap((wid) => {
          const ws = d.workspaces[wid]
          if (!ws) return []
          return [
            {
              id: ws.id,
              name: ws.name,
              projects: ws.projectIds.flatMap((pid) => {
                const p = d.projects[pid]
                if (!p) return []
                return [
                  {
                    id: p.id,
                    name: p.name,
                    tables: p.tableIds.flatMap((tid) => {
                      const t = d.tables[tid]
                      return t
                        ? [
                            {
                              id: t.id,
                              name: t.name,
                              columns: t.fieldOrder.length,
                              rows: t.rowOrder.length,
                            },
                          ]
                        : []
                    }),
                  },
                ]
              }),
            },
          ]
        }),
        collaborators: Object.values(d.collaborators).map((c) => ({
          id: c.id,
          name: c.name,
          initials: c.initials,
        })),
      }
    },
  }),

  tool({
    name: 'read_table',
    description:
      'Lit une table : colonnes (lettre, libellé, type, formule de colonne, choix) et lignes avec leurs valeurs calculées par lettre de colonne. Les lignes de total sont marquées total_row. Les sommes de colonnes excluent les lignes de total.',
    input: z.object({
      table: tableRef,
      offset: z.number().int().min(0).optional().describe('Nombre de lignes à sauter (défaut 0)'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe('Nombre maximum de lignes (défaut 200)'),
    }),
    run({ table: ref, offset = 0, limit = 200 }, host) {
      const d = data(host)
      const table = resolveTable(d, ref)
      const sheet = sheetOf(host, table)
      const project = d.projects[table.projectId]
      const sums: Record<string, number> = {}
      for (const fieldId of table.fieldOrder) {
        const field = table.fields[fieldId]
        if (!field || !NUMERIC.includes(field.type)) continue
        const s = sheet.summarize(fieldId)
        if (s.count > 0) sums[letterOf(table, fieldId)] = s.sum
      }
      return {
        id: table.id,
        name: table.name,
        project: project?.name,
        columns: table.fieldOrder.flatMap((id) => {
          const f = table.fields[id]
          return f ? [columnInfo(table, f)] : []
        }),
        total_rows: table.rowOrder.length,
        rows: table.rowOrder
          .slice(offset, offset + limit)
          .map((rid) => describeRow(table, sheet, rid)),
        column_sums: sums,
      }
    },
  }),

  tool({
    name: 'set_cells',
    description:
      'Modifie une ou plusieurs cellules. Les valeurs sont interprétées comme une saisie dans la grille : nombres à la française, dates JJ/MM/AAAA, statut par son libellé, responsable par son nom, formule commençant par =. Renvoie les nouvelles valeurs calculées.',
    input: z.object({
      table: tableRef,
      cells: z.array(z.object({ row: rowRef, column: columnRef, value: cellValue })).min(1),
    }),
    run({ table: ref, cells }, host) {
      const table = resolveTable(data(host), ref)
      const planned = cells.map((c) => {
        const field = resolveColumn(table, c.column)
        const recordId = resolveRow(table, c.row)
        return { field, recordId, input: toStored(field, c.value, data(host)) }
      })
      const { setCell } = host.store.getState()
      for (const p of planned) setCell(table.id, p.recordId, p.field.id, p.input)
      const now = freshTable(host, table.id)
      const sheet = sheetOf(host, now)
      return {
        updated: planned.map((p) => {
          const v = sheet.value(p.recordId, p.field.id)
          return {
            cell: `${letterOf(now, p.field.id)}${rowNumberOf(now, p.recordId)}`,
            value: serializeValue(v),
            ...(isError(v) ? { error: v.message } : {}),
          }
        }),
      }
    },
  }),

  tool({
    name: 'add_rows',
    description:
      'Ajoute des lignes. Chaque ligne est un objet { colonne: valeur } (colonne = lettre, libellé ou id). Par défaut les lignes sont insérées juste au-dessus de la ligne de total, qui les inclut alors dans ses sommes.',
    input: z.object({
      table: tableRef,
      rows: z.array(z.record(z.string(), cellValue)).min(1),
      before_row: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Insérer avant cette ligne (numéro affiché). Par défaut : avant la ligne de total, sinon à la fin.',
        ),
    }),
    run({ table: ref, rows, before_row }, host) {
      const table = resolveTable(data(host), ref)
      const prepared = rows.map((row) => {
        const cells: Record<string, CellInput> = {}
        for (const [col, value] of Object.entries(row)) {
          const field = resolveColumn(table, col)
          const input = toStored(field, value, data(host))
          if (input !== null) cells[field.id] = input
        }
        return cells
      })
      const { addRecord } = host.store.getState()
      const ids: string[] = []
      prepared.forEach((cells, i) => {
        const index = before_row !== undefined ? before_row - 1 + i : undefined
        ids.push(addRecord(table.id, { cells, ...(index !== undefined ? { index } : {}) }))
      })
      const now = freshTable(host, table.id)
      const sheet = sheetOf(host, now)
      return { added: ids.map((rid) => describeRow(now, sheet, rid)) }
    },
  }),

  tool({
    name: 'delete_rows',
    description:
      'Supprime des lignes (numéros affichés ou ids). Les formules qui les lisaient sont ajustées comme dans Excel.',
    input: z.object({ table: tableRef, rows: z.array(rowRef).min(1) }),
    run({ table: ref, rows }, host) {
      const table = resolveTable(data(host), ref)
      const ids = [...new Set(rows.map((r) => resolveRow(table, r)))]
      host.store.getState().deleteRecords(table.id, ids)
      return { deleted: ids.length, remaining_rows: freshTable(host, table.id).rowOrder.length }
    },
  }),

  tool({
    name: 'add_column',
    description:
      'Ajoute une colonne typée. Pour une colonne de type formula, donnez la formule écrite pour la ligne 1 (ex. "=D1-C1") : elle est recopiée sur chaque ligne comme une poignée de recopie Excel.',
    input: z.object({
      table: tableRef,
      label: z.string().min(1),
      type: z.enum(FIELD_TYPE_VALUES),
      formula: z
        .string()
        .optional()
        .describe('Obligatoire pour type=formula : formule de la ligne 1'),
      format: z
        .enum(['number', 'currency', 'percent', 'text'])
        .optional()
        .describe('Affichage du résultat d’une formule (défaut number)'),
      choices: z
        .array(z.string())
        .optional()
        .describe('Pour type=select : libellés des statuts, dans l’ordre'),
      preset: statusPreset,
      position: columnRef
        .optional()
        .describe('Insérer avant cette colonne. Par défaut : à la fin.'),
      mapping: z
        .enum(MAPPING_VALUES)
        .optional()
        .describe('Rôle de la colonne dans atelier_projets'),
    }),
    run(args, host) {
      const table = resolveTable(data(host), args.table)
      if (args.type === 'formula' && !args.formula) {
        throw new ToolError(
          'Une colonne de type formula a besoin d’une formule pour la ligne 1, ex. "=C1*1.2"',
        )
      }
      if (args.preset && args.type !== 'select') {
        throw new ToolError('Le préréglage de statuts ne s’applique qu’aux colonnes de type select')
      }
      const index = args.position
        ? table.fieldOrder.indexOf(resolveColumn(table, args.position).id)
        : undefined
      const fieldId = host.store.getState().addField(
        table.id,
        {
          label: args.label,
          type: args.type,
          ...(args.formula ? { columnFormula: checkFormula(args.formula) } : {}),
          ...(args.mapping ? { atelierMapping: args.mapping } : {}),
          ...(args.type === 'select'
            ? {
                options: {
                  choices: args.preset
                    ? mergeAtelierStatuses()
                    : choicesFrom(args.choices ?? DEFAULT_CHOICE_LABELS),
                },
              }
            : {}),
          ...(args.type === 'formula'
            ? { options: { resultFormat: args.format ?? 'number' } }
            : {}),
          ...(args.type === 'currency' ? { options: { currency: 'EUR' } } : {}),
        },
        index,
      )
      const now = freshTable(host, table.id)
      const field = now.fields[fieldId] as Field
      return { added: columnInfo(now, field) }
    },
  }),

  tool({
    name: 'update_column',
    description:
      'Modifie une colonne : libellé, formule de colonne, liste des statuts (les lignes gardent leur statut si son libellé est conservé) ou préréglage « Statuts Atelier » (les statuts reconnus, ex. « Bloqué », sont convertis ; les autres sont gardés à la fin), format du résultat ou rôle d’export.',
    input: z.object({
      table: tableRef,
      column: columnRef,
      label: z.string().min(1).optional(),
      formula: z.string().optional(),
      choices: z.array(z.string()).optional(),
      preset: statusPreset,
      format: z.enum(['number', 'currency', 'percent', 'text']).optional(),
      mapping: z.enum(MAPPING_VALUES).optional(),
    }),
    run(args, host) {
      const table = resolveTable(data(host), args.table)
      const field = resolveColumn(table, args.column)
      if (args.formula !== undefined && field.type !== 'formula') {
        throw new ToolError(`« ${field.label} » n’est pas une colonne de type formula`)
      }
      if ((args.choices || args.preset) && field.type !== 'select') {
        throw new ToolError(`« ${field.label} » n’est pas une colonne de statut`)
      }
      if (args.format && field.type !== 'formula') {
        throw new ToolError('Le format ne s’applique qu’aux colonnes de type formula')
      }
      const options = { ...(field.options ?? {}) }
      if (args.preset) options.choices = mergeAtelierStatuses(field.options?.choices)
      else if (args.choices) options.choices = choicesFrom(args.choices, field.options?.choices)
      if (args.format) options.resultFormat = args.format
      host.store.getState().updateField(table.id, field.id, {
        ...(args.label ? { label: args.label } : {}),
        ...(args.formula !== undefined ? { columnFormula: checkFormula(args.formula) } : {}),
        ...(args.mapping ? { atelierMapping: args.mapping } : {}),
        ...(args.choices || args.preset || args.format ? { options } : {}),
      })
      const now = freshTable(host, table.id)
      return { updated: columnInfo(now, now.fields[field.id] as Field) }
    },
  }),

  tool({
    name: 'delete_column',
    description:
      'Supprime une colonne et ses valeurs. Les formules qui la lisaient affichent #REF!.',
    input: z.object({ table: tableRef, column: columnRef }),
    run({ table: ref, column }, host) {
      const table = resolveTable(data(host), ref)
      const field = resolveColumn(table, column)
      host.store.getState().deleteField(table.id, field.id)
      return { deleted: field.label }
    },
  }),

  tool({
    name: 'create_project',
    description: 'Crée un projet dans un espace de travail, avec une première table vide.',
    input: z.object({
      workspace: z.string().describe('Espace : id ou nom'),
      name: z.string().min(1),
    }),
    run({ workspace, name }, host) {
      const ws = resolveWorkspace(data(host), workspace)
      const { projectId, tableId } = host.store.getState().createProject(ws.id, name)
      return { project_id: projectId, first_table_id: tableId }
    },
  }),

  tool({
    name: 'create_table',
    description:
      'Crée une table dans un projet. Avec `columns`, la table est créée vide avec ces colonnes ; sans, elle reçoit les colonnes par défaut Nom, Statut, Notes.',
    input: z.object({
      project: z.string().describe('Projet : id ou nom'),
      name: z.string().min(1),
      columns: z
        .array(
          z.object({
            label: z.string().min(1),
            type: z.enum(FIELD_TYPE_VALUES),
            formula: z.string().optional(),
            format: z.enum(['number', 'currency', 'percent', 'text']).optional(),
            choices: z.array(z.string()).optional(),
            preset: statusPreset,
            mapping: z.enum(MAPPING_VALUES).optional(),
          }),
        )
        .optional(),
    }),
    run({ project, name, columns }, host) {
      const p = resolveProject(data(host), project)
      const s = host.store.getState()
      const tableId = s.createTable(p.id, name)
      if (columns?.length) {
        const created = freshTable(host, tableId)
        s.deleteRecords(tableId, [...created.rowOrder])
        for (const fid of [...created.fieldOrder]) s.deleteField(tableId, fid)
        const hasTitle = columns.some((c) => c.mapping === 'entity_title')
        let titled = hasTitle
        for (const c of columns) {
          if (c.type === 'formula' && !c.formula) {
            throw new ToolError(
              `La colonne « ${c.label} » (formula) a besoin d’une formule pour la ligne 1`,
            )
          }
          const mapping = c.mapping ?? (!titled && c.type === 'text' ? 'entity_title' : undefined)
          if (mapping === 'entity_title') titled = true
          s.addField(tableId, {
            label: c.label,
            type: c.type,
            ...(c.formula ? { columnFormula: checkFormula(c.formula) } : {}),
            ...(mapping ? { atelierMapping: mapping } : {}),
            ...(c.type === 'select'
              ? {
                  options: {
                    choices: c.preset
                      ? mergeAtelierStatuses()
                      : choicesFrom(c.choices ?? DEFAULT_CHOICE_LABELS),
                  },
                }
              : {}),
            ...(c.type === 'formula' ? { options: { resultFormat: c.format ?? 'number' } } : {}),
          })
        }
      }
      const t = freshTable(host, tableId)
      return {
        table_id: tableId,
        columns: t.fieldOrder.map((fid) => columnInfo(t, t.fields[fid] as Field)),
      }
    },
  }),

  tool({
    name: 'rename',
    description: 'Renomme un espace de travail, un projet ou une table.',
    input: z.object({
      kind: z.enum(['workspace', 'project', 'table']),
      target: z.string().describe('id ou nom actuel'),
      name: z.string().min(1),
    }),
    run({ kind, target, name }, host) {
      const d = data(host)
      const s = host.store.getState()
      if (kind === 'workspace') s.renameWorkspace(resolveWorkspace(d, target).id, name)
      else if (kind === 'project') s.renameProject(resolveProject(d, target).id, name)
      else s.renameTable(resolveTable(d, target).id, name)
      return { renamed: name }
    },
  }),

  tool({
    name: 'evaluate',
    description:
      'Calcule une formule sur une table sans rien modifier, ex. "=SUM(C1:C3)*1.2" ou "=AVERAGE(D1:D10)". Fonctions : SUM, AVERAGE/AVG, MIN, MAX, COUNT, COUNTA, IF, IFERROR, AND, OR, NOT, ROUND, ABS, CONCAT.',
    input: z.object({ table: tableRef, formula: z.string().min(1) }),
    run({ table: ref, formula }, host) {
      const table = resolveTable(data(host), ref)
      const v = sheetOf(host, table).preview(checkFormula(formula), '', '')
      return {
        formula: checkFormula(formula),
        value: serializeValue(v),
        ...(isError(v) ? { error: v.message } : {}),
      }
    },
  }),

  tool({
    name: 'check_export',
    description:
      'Vérifie si une table est prête à être exportée vers atelier_projets (schéma 2.1.0) : points bloquants, avertissements, nombre de lignes et totaux.',
    input: z.object({ table: tableRef, rows: z.array(rowRef).optional() }),
    run({ table: ref, rows }, host) {
      const d = data(host)
      const table = resolveTable(d, ref)
      const recordIds = rows?.map((r) => resolveRow(table, r))
      const payload = buildAtelierPayload(d, table.id, sheetOf(host, table), { recordIds })
      const report = validatePayload(payload)
      return {
        status: report.status,
        issues: report.issues,
        records: payload.project.records.length,
        computed_totals: payload.project.summary_metrics.computed_totals,
        columns: payload.project.columns_schema.map(
          (c) => `${c.col_letter} ${c.label} → ${c.atelier_mapping}`,
        ),
      }
    },
  }),

  tool({
    name: 'configure_export',
    description: `Règle l’envoi direct (webhook) : préréglage « ${PROJETS_PRESET_LABEL} » (${PROJETS_LOCAL_IMPORT_URL}), autre adresse https, et projet cible dans Atelier Projets. Sans argument, renvoie la configuration actuelle. Le jeton d’accès ne se règle que dans l’app.`,
    input: z.object({
      preset: z
        .enum(['atelier-projets-local'])
        .optional()
        .describe(`"atelier-projets-local" : ${PROJETS_LOCAL_IMPORT_URL}`),
      url: z
        .string()
        .optional()
        .describe('Adresse de l’API d’import (https, ou http://127.0.0.1 / localhost). "" efface.'),
      project_id: z
        .union([z.string(), z.number()])
        .optional()
        .describe(
          'Atelier Projets : id du projet cible. "" : projet du même nom que le projet Atelier Tab.',
        ),
    }),
    run({ preset, url, project_id }, host) {
      const target = preset
        ? WEBHOOK_PRESETS.find((p) => p.id === preset)?.url
        : url !== undefined
          ? url.trim()
          : undefined
      if (target && !isValidWebhookUrl(target)) {
        throw new ToolError(
          'Adresse invalide : utilisez https:// (ou http://127.0.0.1 / http://localhost pour cette machine)',
        )
      }
      const patch: { webhookUrl?: string; projectId?: string } = {}
      if (target !== undefined) patch.webhookUrl = target
      if (project_id !== undefined) patch.projectId = String(project_id).trim()
      if (Object.keys(patch).length) host.store.getState().setAtelierIntegration(patch)
      const { webhookUrl, projectId } = data(host).integrations.atelierProjets
      return {
        webhook_url: webhookUrl ?? null,
        atelier_projets: webhookUrl ? isProjetsImportUrl(webhookUrl) : false,
        project_id: projectId ?? null,
        send_url: webhookUrl ? withProjetsParams(webhookUrl, { projectId }) : null,
      }
    },
  }),

  tool({
    name: 'export_table',
    description:
      'Exporte une table vers Atelier Projets (atelier_projets) : fichier JSON (schéma 2.1.0), CSV enrichi pour Excel, ou envoi direct au webhook configuré (configure_export). Un envoi à Atelier Projets renvoie son résumé (créés, mis à jour, ignorés, avertissements).',
    input: z.object({
      table: tableRef,
      format: z.enum(['json', 'csv', 'webhook']),
      rows: z
        .array(rowRef)
        .optional()
        .describe('Lignes à exporter. Par défaut : toutes (hors total).'),
      path: z
        .string()
        .optional()
        .describe('Chemin du fichier à écrire (json/csv). Par défaut : dossier exports/.'),
    }),
    async run({ table: ref, format, rows, path }, host) {
      const d = data(host)
      const table = resolveTable(d, ref)
      const recordIds = rows?.map((r) => resolveRow(table, r))
      const payload = buildAtelierPayload(d, table.id, sheetOf(host, table), { recordIds })
      const report = validatePayload(payload)
      if (report.status === 'blocked') {
        throw new ToolError(`Export bloqué : ${report.issues.map((i) => i.message).join(' ; ')}`)
      }
      const count = payload.project.records.length
      let ok = true
      let message: string
      let location: string | undefined
      let summary: ProjetsImportSummary | undefined
      if (format === 'webhook') {
        const { webhookUrl, token, projectId } = d.integrations.atelierProjets
        if (!webhookUrl)
          throw new ToolError(
            `Aucun webhook configuré : renseignez son adresse dans le dialogue d’export de l’app (préréglage « ${PROJETS_PRESET_LABEL} » : ${PROJETS_LOCAL_IMPORT_URL})`,
          )
        const res = await sendToWebhook(
          payload,
          { url: withProjetsParams(webhookUrl, { projectId }), token },
          host.webhookFetch ? { fetch: host.webhookFetch } : {},
        )
        ok = res.ok
        message = res.ok ? `${count} ligne(s) envoyée(s) — ${res.message}` : res.message
        if (res.summary) summary = res.summary
      } else {
        const content =
          format === 'json' ? JSON.stringify(payload, null, 2) : toEnrichedCsv(payload)
        const mime = format === 'json' ? 'application/json' : 'text/csv'
        location = await host.saveExport(exportFilename(table.name, format), content, mime, path)
        message = `${count} ligne(s) exportée(s) en ${format.toUpperCase()}`
      }
      host.store.getState().logExport({
        at: new Date().toISOString(),
        tableId: table.id,
        method: format,
        rows: count,
        ok,
        message,
      })
      if (!ok) throw new ToolError(message)
      return {
        message,
        ...(location ? { file: location } : {}),
        ...(summary ? { atelier_projets: summary } : {}),
        warnings: report.issues.map((i) => i.message),
      }
    },
  }),
]

export type ToolName = (typeof TOOLS)[number]['name']

/** Schémas JSON des outils (format MCP / Ollama). */
export function toolSchemas(): {
  name: string
  description: string
  parameters: Record<string, unknown>
}[] {
  return TOOLS.map((t) => {
    const { $schema: _s, ...parameters } = z.toJSONSchema(t.input) as Record<string, unknown>
    void _s
    return { name: t.name, description: t.description, parameters }
  })
}

export interface ToolResult {
  ok: boolean
  /** Texte JSON destiné à l'IA. */
  content: string
}

/** Exécute un outil par son nom, avec validation des arguments. */
export async function runTool(name: string, args: unknown, host: ToolHost): Promise<ToolResult> {
  const def = TOOLS.find((t) => t.name === name)
  if (!def) {
    return {
      ok: false,
      content: `Outil inconnu : ${name}. Outils : ${TOOLS.map((t) => t.name).join(', ')}`,
    }
  }
  const parsed = def.input.safeParse(args ?? {})
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'arguments'} : ${i.message}`)
      .join(' ; ')
    return { ok: false, content: `Arguments invalides pour ${name} : ${details}` }
  }
  try {
    const result = await (def.run as (a: unknown, h: ToolHost) => unknown)(parsed.data, host)
    return { ok: true, content: JSON.stringify(result) }
  } catch (e) {
    if (e instanceof ToolError) return { ok: false, content: e.message }
    return { ok: false, content: `Erreur interne : ${e instanceof Error ? e.message : String(e)}` }
  }
}
