import { memo, useEffect, useRef } from 'react'
import { FIELD_TYPES } from '@/engine/field-types'
import { isFormula } from '@/engine/formula'
import { beginEdit, toggleCheckbox } from '@/store/grid-actions'
import { useCellValue, useDataStore, useUIStore } from '@/store'
import type { Field } from '@/types/domain'
import { CellContent } from '@/components/cells/CellContent'
import { CellEditor } from '@/components/cells/CellEditor'
import { cn } from '@/lib/cn'

interface GridCellProps {
  tableId: string
  recordId: string
  field: Field
  width: number
  plain: boolean
  summary: boolean
  /** Teinte de la référence de formule qui couvre cette cellule, le cas échéant. */
  refHue: number | undefined
  /** Bords de la zone référencée portés par cette cellule : t, b, l, r. */
  refEdges: string
  focusGrid: () => void
}

export const GridCell = memo(function GridCell({
  tableId,
  recordId,
  field,
  width,
  plain,
  summary,
  refHue,
  refEdges,
  focusGrid,
}: GridCellProps) {
  const value = useCellValue(tableId, recordId, field.id)
  const stored = useDataStore((s) => s.tables[tableId]?.records[recordId]?.cells[field.id] ?? null)
  const collaborators = useDataStore((s) => s.collaborators)
  const selected = useUIStore(
    (s) => s.selection?.recordId === recordId && s.selection.fieldId === field.id,
  )
  const editing = useUIStore(
    (s) => s.editing?.cell.recordId === recordId && s.editing.cell.fieldId === field.id,
  )
  const select = useUIStore((s) => s.select)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [selected])

  const spec = FIELD_TYPES[field.type]
  // Une cellule de colonne-formule sans valeur saisie affiche la formule recopiée.
  const isComputed = isFormula(stored) || (field.type === 'formula' && stored === null && !summary)
  const align = typeof value === 'number' ? 'right' : spec.align
  const isOverride = field.type === 'formula' && stored !== null && !isFormula(stored)

  return (
    <div
      ref={ref}
      role="gridcell"
      aria-selected={selected}
      data-cell={`${recordId}:${field.id}`}
      style={{ width, ...refStyle(refHue, refEdges) }}
      onMouseDown={(e) => {
        if (editing) return
        e.preventDefault()
        select({ recordId, fieldId: field.id })
        focusGrid()
      }}
      onDoubleClick={() => beginEdit({ recordId, fieldId: field.id })}
      onClick={(e) => {
        if (field.type === 'checkbox' && !plain && (e.target as HTMLElement).closest('span')) {
          toggleCheckbox({ recordId, fieldId: field.id })
        }
      }}
      title={isOverride ? 'Valeur saisie à la main : remplace la formule de la colonne' : undefined}
      className={cn(
        'relative flex h-full shrink-0 items-center overflow-hidden border-r border-b border-line px-2',
        align === 'right' && 'justify-end',
        align === 'center' && 'justify-center',
        isComputed && !plain && 'bg-surface-sunken/60',
        summary && 'font-semibold',
        refHue !== undefined && 'ref-outline',
        selected && !editing && 'z-10 shadow-[inset_0_0_0_2px_var(--accent)]',
        isOverride && !plain && 'italic',
      )}
    >
      {editing ? (
        <CellEditor field={field} align={align} onDone={focusGrid} />
      ) : (
        <CellContent
          field={field}
          value={value}
          stored={stored}
          collaborators={collaborators}
          plain={plain}
        />
      )}
    </div>
  )
})

function refStyle(hue: number | undefined, edges: string): Record<string, string | number> {
  if (hue === undefined) return {}
  const w = (edge: string) => (edges.includes(edge) ? '1.5px' : '0px')
  return { '--h': hue, '--ref-t': w('t'), '--ref-b': w('b'), '--ref-l': w('l'), '--ref-r': w('r') }
}
