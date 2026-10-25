/**
 * Actions de l'interface sur les colonnes : création et modification (éditeur de champ),
 * changement de type, insertion, duplication, déplacement, largeur, suppression.
 * Chacune est une étape annulable (⌘Z), y compris la suppression.
 */
import { parseFormula } from '@/engine/formula'
import type { ConversionReport } from '@/engine/table'
import type { Field, FieldOptions, FieldType } from '@/types/domain'
import { undoable, undo } from './history'
import { getSheet, useDataStore, useNotices } from './index'
import { useUIStore } from './ui.store'

/** Ce que l'éditeur de champ enregistre. */
export interface FieldDraft {
  label: string
  type: FieldType
  options?: FieldOptions
  /** Colonne-formule : formule écrite pour la ligne 1. */
  columnFormula?: string
  atelierMapping?: Field['atelierMapping']
}

/** Formule normalisée (`=` en tête), ou message d'erreur si elle ne se lit pas. */
export function checkColumnFormula(
  formula: string,
): { ok: true; formula: string } | { ok: false; reason: string } {
  const text = formula.trim()
  if (!text) return { ok: false, reason: 'Écrivez une formule, ex. =C1*1.2' }
  const f = text.startsWith('=') ? text : `=${text}`
  try {
    parseFormula(f)
    return { ok: true, formula: f }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'Formule invalide' }
  }
}

/** Libellé libre, dérivé de `base` (« Texte 2 »…). */
export function freeLabel(tableId: string, base: string): string {
  const taken = new Set(
    Object.values(useDataStore.getState().tables[tableId]?.fields ?? {}).map((f) => f.label),
  )
  let label = base
  for (let n = 2; taken.has(label); n++) label = `${base} ${n}`
  return label
}

export function createField(tableId: string, draft: FieldDraft, index?: number): string {
  const id = undoable(`Ajouter la colonne « ${draft.label} »`, tableId, () =>
    useDataStore.getState().addField(
      tableId,
      {
        label: draft.label,
        type: draft.type,
        ...(draft.options && Object.keys(draft.options).length ? { options: draft.options } : {}),
        ...(draft.type === 'formula' ? { columnFormula: draft.columnFormula ?? '=0' } : {}),
        ...(draft.atelierMapping ? { atelierMapping: draft.atelierMapping } : {}),
      },
      index,
    ),
  )
  const ui = useUIStore.getState()
  const recordId = ui.selection?.recordId ?? useDataStore.getState().tables[tableId]?.rowOrder[0]
  if (recordId) ui.select({ recordId, fieldId: id })
  return id
}

/**
 * Enregistre l'éditeur de champ : type (avec conversion des valeurs), libellé, options,
 * formule et rôle d'export, en une seule étape annulable.
 */
export function saveField(
  tableId: string,
  fieldId: string,
  draft: FieldDraft,
): ConversionReport | null {
  const field = useDataStore.getState().tables[tableId]?.fields[fieldId]
  if (!field) return null
  const report = undoable(`Modifier la colonne « ${draft.label} »`, tableId, () => {
    const data = useDataStore.getState()
    const sheet = getSheet(tableId)
    const converted =
      draft.type === field.type
        ? null
        : data.changeFieldType(tableId, fieldId, draft.type, {
            computed: (r, f) => sheet?.value(r, f) ?? null,
            ...(draft.columnFormula ? { formula: draft.columnFormula } : {}),
          })
    const current = useDataStore.getState().tables[tableId]?.fields[fieldId]
    data.updateField(tableId, fieldId, {
      label: draft.label,
      options: { ...(current?.options ?? {}), ...(draft.options ?? {}) },
      ...(draft.type === 'formula' && draft.columnFormula
        ? { columnFormula: draft.columnFormula }
        : {}),
      atelierMapping: draft.atelierMapping,
    })
    return converted
  })
  if (report && report.kept > 0) {
    useNotices.getState().push(
      {
        tone: 'warning',
        title:
          report.kept === 1
            ? '1 valeur gardée telle quelle'
            : `${report.kept} valeurs gardées telles quelles`,
        detail:
          'Elles ne se convertissent pas dans le nouveau type : le texte d’origine est conservé.',
        action: { label: 'Annuler', run: () => undo() },
      },
      8000,
    )
  }
  return report
}

export function renameField(tableId: string, fieldId: string, label: string): void {
  const clean = label.trim()
  const field = useDataStore.getState().tables[tableId]?.fields[fieldId]
  if (!field || !clean || clean === field.label) return
  undoable(`Renommer « ${field.label} »`, tableId, () =>
    useDataStore.getState().updateField(tableId, fieldId, { label: clean }),
  )
}

/** Insère une colonne Texte vide à gauche ou à droite d'une colonne. */
export function insertFieldBeside(
  tableId: string,
  fieldId: string,
  side: 'left' | 'right',
): string | null {
  const table = useDataStore.getState().tables[tableId]
  if (!table) return null
  const index = table.fieldOrder.indexOf(fieldId) + (side === 'right' ? 1 : 0)
  return createField(tableId, { label: freeLabel(tableId, 'Texte'), type: 'text' }, index)
}

export function duplicateField(tableId: string, fieldId: string): string | null {
  const table = useDataStore.getState().tables[tableId]
  const field = table?.fields[fieldId]
  if (!table || !field) return null
  return undoable(`Dupliquer « ${field.label} »`, tableId, () => {
    const data = useDataStore.getState()
    const copyId = data.addField(
      tableId,
      {
        label: freeLabel(tableId, `${field.label} (copie)`),
        type: field.type,
        ...(field.options ? { options: structuredClone(field.options) } : {}),
        ...(field.columnFormula ? { columnFormula: field.columnFormula } : {}),
        ...(field.width ? { width: field.width } : {}),
      },
      table.fieldOrder.indexOf(fieldId) + 1,
    )
    const fresh = useDataStore.getState().tables[tableId]
    if (fresh) {
      data.setCells(
        tableId,
        fresh.rowOrder.flatMap((recordId) => {
          const input = fresh.records[recordId]?.cells[fieldId]
          return input === undefined ? [] : [{ recordId, fieldId: copyId, input }]
        }),
      )
    }
    return copyId
  })
}

export function deleteField(tableId: string, fieldId: string): void {
  const field = useDataStore.getState().tables[tableId]?.fields[fieldId]
  if (!field) return
  undoable(`Supprimer la colonne « ${field.label} »`, tableId, () =>
    useDataStore.getState().deleteField(tableId, fieldId),
  )
  const ui = useUIStore.getState()
  if (ui.selection?.fieldId === fieldId || ui.rangeEnd?.fieldId === fieldId) ui.select(null)
  useNotices.getState().push(
    {
      tone: 'info',
      title: `Colonne « ${field.label} » supprimée`,
      action: { label: 'Annuler', run: () => undo() },
    },
    8000,
  )
}

export function resizeField(tableId: string, fieldId: string, width: number): void {
  const w = Math.round(Math.max(60, Math.min(800, width)))
  const field = useDataStore.getState().tables[tableId]?.fields[fieldId]
  if (!field || field.width === w) return
  undoable('Largeur de colonne', tableId, () =>
    useDataStore.getState().updateField(tableId, fieldId, { width: w }),
  )
}

export function moveFieldTo(tableId: string, fieldId: string, to: number): void {
  const field = useDataStore.getState().tables[tableId]?.fields[fieldId]
  if (!field) return
  undoable(`Déplacer « ${field.label} »`, tableId, () =>
    useDataStore.getState().moveField(tableId, fieldId, to),
  )
}

export function moveRowsTo(tableId: string, recordIds: string[], to: number): void {
  undoable(recordIds.length > 1 ? 'Déplacer les lignes' : 'Déplacer la ligne', tableId, () =>
    useDataStore.getState().moveRecords(tableId, recordIds, to),
  )
}
