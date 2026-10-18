import { Plus } from 'lucide-react'
import { FIELD_TYPES, formatValue } from '@/engine/field-types'
import { addRowAndSelect } from '@/store/grid-actions'
import { getSheet, useComputed } from '@/store'
import type { Field, Table } from '@/types/domain'
import { fieldWidth } from '@/lib/field-icons'
import { ADD_COLUMN_WIDTH, GUTTER_WIDTH } from './GridHeader'

/**
 * Pied de grille : bouton d'ajout de ligne et somme de chaque colonne numérique.
 * Les lignes de total sont exclues des agrégats (pas de double comptage).
 */
export function GridFooter({ table, fieldIds }: { table: Table; fieldIds: string[] }) {
  // Se recalcule quand le moteur signale un changement dans cette table.
  useComputed((s) => s.revisions[table.id] ?? 0)
  const sheet = getSheet(table.id)

  return (
    <div className="sticky bottom-0 z-20 flex h-9 border-t border-line bg-surface-sunken">
      <button
        type="button"
        onClick={addRowAndSelect}
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface-sunken pl-4 text-muted hover:text-ink"
        style={{
          width: GUTTER_WIDTH + fieldWidth(table.fields[fieldIds[0] ?? ''] ?? { type: 'text' }),
        }}
      >
        <Plus size={14} />
        Ajouter une ligne
      </button>
      {fieldIds.slice(1).map((fieldId) => {
        const field = table.fields[fieldId]
        if (!field) return null
        return <FooterCell key={fieldId} field={field} sheet={sheet} />
      })}
      <div className="shrink-0" style={{ width: ADD_COLUMN_WIDTH }} />
    </div>
  )
}

function FooterCell({ field, sheet }: { field: Field; sheet: ReturnType<typeof getSheet> }) {
  const width = fieldWidth(field)
  const numeric = FIELD_TYPES[field.type].numeric
  const summary = numeric && sheet ? sheet.summarize(field.id) : null

  if (!summary || summary.count === 0) {
    return <div className="shrink-0 border-r border-line" style={{ width }} />
  }
  const details = [
    `Moyenne : ${formatValue(field, summary.average)}`,
    `Min : ${formatValue(field, summary.min)}`,
    `Max : ${formatValue(field, summary.max)}`,
    `${summary.count} valeur${summary.count > 1 ? 's' : ''}`,
  ].join('\n')

  return (
    <div
      className="flex shrink-0 items-center justify-end gap-1.5 border-r border-line px-2 tabular-nums"
      style={{ width }}
      title={details}
    >
      <span className="text-[11px] text-muted">Somme</span>
      <span className="truncate font-medium">{formatValue(field, summary.sum)}</span>
    </div>
  )
}
