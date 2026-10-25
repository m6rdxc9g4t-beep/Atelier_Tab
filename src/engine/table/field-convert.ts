/**
 * Changement du type d'une colonne, comme dans Airtable, sans perte de données :
 * chaque valeur est relue comme si on la retapait dans le nouveau type (« 45 000 » devient
 * 45000 dans une colonne Nombre) ; une valeur qui ne se convertit pas est gardée telle quelle,
 * en texte, et comptée dans le rapport.
 *
 * - vers Statut : un choix par valeur distincte (statuts de la suite reconnus et colorés) ;
 * - depuis Formule : les valeurs calculées des lignes de données sont figées ;
 * - vers Formule : la formule de colonne remplace les valeurs des lignes de données (les lignes
 *   de total gardent les leurs).
 * Les formules saisies dans une cellule sont toujours conservées.
 *
 * Module pur, appelé dans un producteur Immer (modifie la table reçue).
 */
import {
  choicesFromLabels,
  parseUserInput,
  toEditText,
  type LookupContext,
} from '@/engine/field-types'
import { isError, isFormula, type CellInput, type CellValue } from '@/engine/formula'
import type { Field, FieldType, Table } from '@/types/domain'
import { operatorsFor } from './view'

export interface ConversionReport {
  /** Valeurs converties dans le nouveau type. */
  converted: number
  /** Valeurs gardées telles quelles (non convertibles). */
  kept: number
}

export interface ConversionOptions {
  /** Valeurs calculées actuelles (pour figer une colonne-formule). */
  computed?: (recordId: string, fieldId: string) => CellValue
  /** Nouvelle colonne-formule (type `formula`), écrite pour la ligne 1. */
  formula?: string
}

/** Texte d'une valeur calculée, tel qu'on le taperait. */
function computedText(v: CellValue): string | null {
  if (v === null || isError(v)) return null
  if (typeof v === 'number') return String(v).replace('.', ',')
  if (typeof v === 'boolean') return v ? 'oui' : 'non'
  return v
}

export function changeFieldType(
  table: Table,
  fieldId: string,
  type: FieldType,
  ctx: LookupContext,
  options: ConversionOptions = {},
): ConversionReport {
  const report: ConversionReport = { converted: 0, kept: 0 }
  const old = table.fields[fieldId]
  if (!old || old.type === type) return report

  // Texte de départ de chaque cellule non vide (formules exclues).
  const texts = new Map<string, string>()
  for (const recordId of table.rowOrder) {
    const record = table.records[recordId]
    if (!record) continue
    const stored = record.cells[fieldId] ?? null
    if (isFormula(stored)) continue
    let text: string | null = null
    if (stored !== null) text = toEditText(old, stored, ctx)
    else if (old.type === 'formula' && record.kind === 'data' && options.computed) {
      text = computedText(options.computed(recordId, fieldId))
    }
    if (text !== null && text.trim() !== '') texts.set(recordId, text)
  }

  const next: Field = { ...old, type }
  const opts = { ...(old.options ?? {}) }
  delete next.columnFormula
  if (type === 'select') {
    const labels = [...new Set([...texts.values()].map((t) => t.trim()))]
    opts.choices = old.type === 'select' ? (opts.choices ?? []) : choicesFromLabels(labels)
  } else {
    delete opts.choices
  }
  if (type === 'currency') opts.currency ??= 'EUR'
  else delete opts.currency
  if (type === 'formula') {
    next.columnFormula = options.formula ?? '=0'
    opts.resultFormat ??= old.type === 'currency' || old.type === 'percent' ? old.type : 'number'
  } else {
    delete opts.resultFormat
  }
  if (!['number', 'currency', 'percent', 'formula'].includes(type)) delete opts.decimals
  if (Object.keys(opts).length > 0) next.options = opts
  else delete next.options
  table.fields[fieldId] = next

  for (const recordId of table.rowOrder) {
    const record = table.records[recordId]
    if (!record) continue
    const stored = record.cells[fieldId] ?? null
    if (isFormula(stored)) continue
    if (type === 'formula' && record.kind === 'data') {
      delete record.cells[fieldId]
      continue
    }
    const text = texts.get(recordId)
    if (text === undefined) {
      delete record.cells[fieldId]
      continue
    }
    const parsed = parseUserInput(next, text, ctx)
    if (parsed.ok && parsed.input !== null) {
      record.cells[fieldId] = parsed.input as CellInput
      report.converted++
    } else {
      record.cells[fieldId] = text
      report.kept++
    }
  }

  // Les filtres de la colonne ne valent plus pour le nouveau type ; le regroupement Kanban
  // n'a de sens que sur un statut.
  for (const view of table.views) {
    view.filters = view.filters.filter(
      (f) =>
        f.fieldId !== fieldId || (operatorsFor(next).includes(f.operator) && f.value === undefined),
    )
    if (view.groupByFieldId === fieldId && type !== 'select') delete view.groupByFieldId
  }
  return report
}
