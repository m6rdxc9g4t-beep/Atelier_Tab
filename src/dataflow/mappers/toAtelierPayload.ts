/**
 * Transformation d'une table Atelier_Tab en payload `atelier_projets` v2.1.0.
 * Fonction pure : les valeurs calculées sont lues via un `SheetReader`
 * (en pratique le TableSheet du moteur), jamais via le store.
 */
import { columnToLetters, serializeValue, type CellInput, type CellValue } from '@/engine/formula'
import type { AppData, Field, Table } from '@/types/domain'
import {
  ATELIER_SCHEMA_VERSION,
  type AtelierColumn,
  type AtelierPayload,
  type AtelierRecord,
} from '../schema/atelier.v2_1'

/** Lecture des valeurs d'une table : saisie effective (vue moteur) et valeur calculée. */
export interface SheetReader {
  value(recordId: string, fieldId: string): CellValue
  input(recordId: string, fieldId: string): CellInput
}

export interface ExportOptions {
  /** Restreint l'export à ces lignes (dans l'ordre de la table). Par défaut : toutes. */
  recordIds?: string[]
  /** Horodatage de l'export (injectable pour des exports reproductibles). */
  exportedAt?: Date
  /** Inclure les lignes de total dans `summary_rows` (défaut : oui). */
  includeSummaryRows?: boolean
}

const NUMERIC_TYPES = new Set<Field['type']>(['number', 'currency', 'percent', 'formula'])

/** Saisie d'origine sous forme de texte, comme l'attend `atelier_projets`. */
export function rawText(input: CellInput): string {
  if (input === null) return ''
  return String(input)
}

export function buildColumns(table: Table): AtelierColumn[] {
  return table.fieldOrder.flatMap((fieldId, i) => {
    const field = table.fields[fieldId]
    if (!field) return []
    return [
      {
        col_letter: columnToLetters(i),
        id: field.id,
        label: field.label,
        type: field.type,
        atelier_mapping: field.atelierMapping ?? 'custom',
      },
    ]
  })
}

function buildRecord(
  recordId: string,
  rowIndex: number,
  columns: AtelierColumn[],
  sheet: SheetReader,
): AtelierRecord {
  const values: AtelierRecord['values'] = {}
  for (const col of columns) {
    values[col.col_letter] = {
      raw: rawText(sheet.input(recordId, col.id)),
      computed: serializeValue(sheet.value(recordId, col.id)),
    }
  }
  return { row_index: rowIndex + 1, record_id: recordId, values }
}

export function buildAtelierPayload(
  data: AppData,
  tableId: string,
  sheet: SheetReader,
  options: ExportOptions = {},
): AtelierPayload {
  const table = data.tables[tableId]
  if (!table) throw new Error(`Table introuvable : ${tableId}`)
  const project = data.projects[table.projectId]
  if (!project) throw new Error(`Projet introuvable : ${table.projectId}`)
  const workspace = data.workspaces[project.workspaceId]
  if (!workspace) throw new Error(`Espace introuvable : ${project.workspaceId}`)

  const columns = buildColumns(table)
  const wanted = options.recordIds ? new Set(options.recordIds) : null

  const records: AtelierRecord[] = []
  const summaryRows: AtelierRecord[] = []
  table.rowOrder.forEach((recordId, rowIndex) => {
    const record = table.records[recordId]
    if (!record) return
    if (record.kind === 'summary') {
      summaryRows.push(buildRecord(recordId, rowIndex, columns, sheet))
      return
    }
    if (wanted && !wanted.has(recordId)) return
    records.push(buildRecord(recordId, rowIndex, columns, sheet))
  })

  // Totaux des colonnes numériques sur les lignes exportées (jamais les lignes de total).
  const computedTotals: Record<string, number> = {}
  for (const col of columns) {
    const field = table.fields[col.id]
    if (!field || !NUMERIC_TYPES.has(field.type)) continue
    let sum = 0
    let seen = false
    for (const r of records) {
      const v = r.values[col.col_letter]?.computed
      if (typeof v === 'number') {
        sum += v
        seen = true
      }
    }
    if (seen) computedTotals[col.col_letter] = Number(sum.toPrecision(15))
  }

  const payload: AtelierPayload = {
    target_system: 'atelier_projets',
    schema_version: ATELIER_SCHEMA_VERSION,
    exported_at: (options.exportedAt ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    workspace: { id: workspace.id, name: workspace.name },
    project: {
      id: project.id,
      name: project.name,
      source_table: { id: table.id, name: table.name },
      summary_metrics: { total_rows: records.length, computed_totals: computedTotals },
      columns_schema: columns,
      records,
    },
  }
  if (options.includeSummaryRows !== false && summaryRows.length > 0) {
    payload.project.summary_rows = summaryRows
  }
  return payload
}
