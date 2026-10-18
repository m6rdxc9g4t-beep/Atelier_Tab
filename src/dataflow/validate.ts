/**
 * Contrôles avant export. Distingue ce qui empêche l'export (bloquant) de ce qui
 * mérite l'attention mais n'empêche rien (avertissement).
 */
import { ERROR_CODES } from '@/engine/formula/values'
import { atelierPayloadSchema, type AtelierPayload } from './schema/atelier.v2_1'

export type ExportStatus = 'ready' | 'warnings' | 'blocked'

export interface ValidationIssue {
  level: 'error' | 'warning'
  code:
    | 'schema'
    | 'no_title_column'
    | 'no_records'
    | 'formula_errors'
    | 'empty_titles'
    | 'duplicate_mapping'
  message: string
  /** Adresses ou libellés concernés (ex. ["D2", "D3"]). */
  details?: string[]
}

export interface ValidationReport {
  status: ExportStatus
  issues: ValidationIssue[]
}

const ERRORS = new Set<string>(ERROR_CODES)
const UNIQUE_MAPPINGS = new Set([
  'entity_title',
  'workflow_state',
  'financial_ht',
  'financial_ttc',
  'assignee',
  'due_date',
  'start_date',
])

export function validatePayload(payload: AtelierPayload): ValidationReport {
  const issues: ValidationIssue[] = []

  const parsed = atelierPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    issues.push({
      level: 'error',
      code: 'schema',
      message: 'Le payload ne respecte pas le schéma atelier_projets 2.1.0',
      details: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join('.')} : ${i.message}`),
    })
  }

  const columns = payload.project.columns_schema
  const titleColumn = columns.find((c) => c.atelier_mapping === 'entity_title')
  if (!titleColumn) {
    issues.push({
      level: 'error',
      code: 'no_title_column',
      message: 'Aucune colonne n’est associée au titre des entités (entity_title)',
    })
  }

  if (payload.project.records.length === 0) {
    issues.push({ level: 'error', code: 'no_records', message: 'Aucune ligne à exporter' })
  }

  const errorCells: string[] = []
  for (const r of payload.project.records) {
    for (const [letter, v] of Object.entries(r.values)) {
      if (typeof v.computed === 'string' && ERRORS.has(v.computed) && v.raw.startsWith('=')) {
        errorCells.push(`${letter}${r.row_index} (${v.computed})`)
      }
    }
  }
  if (errorCells.length > 0) {
    issues.push({
      level: 'warning',
      code: 'formula_errors',
      message: `${errorCells.length} cellule${errorCells.length > 1 ? 's' : ''} en erreur, exportée${errorCells.length > 1 ? 's' : ''} avec leur code d’erreur`,
      details: errorCells.slice(0, 8),
    })
  }

  if (titleColumn) {
    const empty = payload.project.records
      .filter((r) => (r.values[titleColumn.col_letter]?.raw ?? '').trim() === '')
      .map((r) => `Ligne ${r.row_index}`)
    if (empty.length > 0) {
      issues.push({
        level: 'warning',
        code: 'empty_titles',
        message: `${empty.length} ligne${empty.length > 1 ? 's' : ''} sans titre (colonne ${titleColumn.col_letter})`,
        details: empty.slice(0, 8),
      })
    }
  }

  const byMapping = new Map<string, string[]>()
  for (const c of columns) {
    if (!UNIQUE_MAPPINGS.has(c.atelier_mapping)) continue
    byMapping.set(c.atelier_mapping, [...(byMapping.get(c.atelier_mapping) ?? []), c.col_letter])
  }
  for (const [mapping, letters] of byMapping) {
    if (letters.length > 1) {
      issues.push({
        level: 'warning',
        code: 'duplicate_mapping',
        message: `Plusieurs colonnes associées à ${mapping} : ${letters.join(', ')}`,
      })
    }
  }

  const status: ExportStatus = issues.some((i) => i.level === 'error')
    ? 'blocked'
    : issues.length > 0
      ? 'warnings'
      : 'ready'
  return { status, issues }
}
