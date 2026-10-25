import { memo } from 'react'
import { FIELD_TYPES } from '@/engine/field-types'
import { isFormula } from '@/engine/formula'
import { useCellValue, useDataStore, useUIStore } from '@/store'
import type { Field } from '@/types/domain'
import { CellContent } from '@/components/cells/CellContent'
import { CellEditor } from '@/components/cells/CellEditor'
import { cn } from '@/lib/cn'
import type { GridHandlers } from './grid-handlers'

interface GridCellProps {
  tableId: string
  recordId: string
  field: Field
  width: number
  plain: boolean
  summary: boolean
  /** Lignes hautes : le texte passe à la ligne. */
  wrap: boolean
  /** Cellule active (contour plein). */
  active: boolean
  /** Dans la plage sélectionnée ; bords de la plage portés par la cellule : t, b, l, r. */
  inRange: boolean
  rangeEdges: string
  /** Coin inférieur droit de la sélection : porte la poignée de recopie. */
  fillHandle: boolean
  /** Zone de recopie en cours (pointillés) : bords portés par la cellule. */
  fillEdges: string
  /** Première colonne, figée à gauche : décalage (px), sinon null. */
  frozenLeft: number | null
  frozenShadow: boolean
  /** Teinte de la référence de formule qui couvre cette cellule, le cas échéant. */
  refHue: number | undefined
  /** Bords de la zone référencée portés par cette cellule : t, b, l, r. */
  refEdges: string
  handlers: GridHandlers
}

export const GridCell = memo(function GridCell({
  tableId,
  recordId,
  field,
  width,
  plain,
  summary,
  wrap,
  active,
  inRange,
  rangeEdges,
  fillHandle,
  fillEdges,
  frozenLeft,
  frozenShadow,
  refHue,
  refEdges,
  handlers,
}: GridCellProps) {
  const value = useCellValue(tableId, recordId, field.id)
  const stored = useDataStore((s) => s.tables[tableId]?.records[recordId]?.cells[field.id] ?? null)
  const collaborators = useDataStore((s) => s.collaborators)
  const editing = useUIStore(
    (s) => s.editing?.cell.recordId === recordId && s.editing.cell.fieldId === field.id,
  )
  const cell = { recordId, fieldId: field.id }

  const spec = FIELD_TYPES[field.type]
  // Une cellule de colonne-formule sans valeur saisie affiche la formule recopiée.
  const isComputed = isFormula(stored) || (field.type === 'formula' && stored === null && !summary)
  const align = typeof value === 'number' ? 'right' : spec.align
  const isOverride = field.type === 'formula' && stored !== null && !isFormula(stored)

  return (
    <div
      role="gridcell"
      aria-selected={active || inRange}
      data-cell={`${recordId}:${field.id}`}
      style={{
        width,
        ...(frozenLeft !== null ? { left: frozenLeft } : {}),
        ...refStyle(refHue, refEdges),
      }}
      onMouseDown={(e) => {
        if (editing) return
        handlers.cellMouseDown(cell, e)
      }}
      onMouseEnter={() => handlers.cellMouseEnter(cell)}
      onDoubleClick={() => handlers.cellDoubleClick(cell)}
      onClick={(e) => {
        if (
          field.type === 'checkbox' &&
          !plain &&
          (e.target as HTMLElement).closest('[data-check]')
        ) {
          handlers.toggleCheckbox(cell)
        }
      }}
      onContextMenu={(e) => handlers.cellContextMenu(cell, e)}
      title={isOverride ? 'Valeur saisie à la main : remplace la formule de la colonne' : undefined}
      className={cn(
        'relative flex h-full shrink-0 border-r border-b border-line px-2',
        wrap ? 'items-start py-1.5' : 'items-center overflow-hidden',
        align === 'right' && 'justify-end',
        align === 'center' && 'justify-center',
        frozenLeft !== null && 'sticky z-[5]',
        frozenLeft !== null && frozenShadow && 'frozen-shadow',
        summary
          ? 'bg-surface-sunken font-semibold'
          : isComputed && !plain
            ? 'bg-surface-sunken/60'
            : frozenLeft !== null
              ? 'bg-surface group-hover:bg-row-hover'
              : 'group-hover:bg-row-hover',
        refHue !== undefined && 'ref-outline',
        isOverride && !plain && 'italic',
        active && 'z-10',
      )}
    >
      {inRange && !active && <span className="pointer-events-none absolute inset-0 bg-range" />}
      {editing ? (
        <CellEditor field={field} align={align} onDone={handlers.focusGrid} />
      ) : (
        <CellContent
          field={field}
          value={value}
          stored={stored}
          collaborators={collaborators}
          plain={plain}
          wrap={wrap}
        />
      )}
      {rangeEdges && (
        <span
          className="pointer-events-none absolute -inset-px z-10"
          style={edgeStyle(rangeEdges, 1.5, 'solid')}
        />
      )}
      {active && !editing && (
        <span className="pointer-events-none absolute -inset-px z-10 border-2 border-accent" />
      )}
      {fillEdges && (
        <span
          className="pointer-events-none absolute -inset-px z-10"
          style={edgeStyle(fillEdges, 1.5, 'dashed')}
        />
      )}
      {fillHandle && !editing && (
        <span
          role="presentation"
          title="Poignée de recopie : glissez pour prolonger (séries 1, 2, 3…, dates)"
          onMouseDown={(e) => handlers.fillHandleMouseDown(e)}
          className="absolute -right-[4px] -bottom-[4px] z-20 size-[8px] cursor-crosshair border border-surface bg-accent"
        />
      )}
    </div>
  )
})

function edgeStyle(edges: string, width: number, style: 'solid' | 'dashed') {
  const line = (edge: string) =>
    edges.includes(edge) ? `${width}px ${style} var(--accent)` : 'none'
  return {
    borderTop: line('t'),
    borderBottom: line('b'),
    borderLeft: line('l'),
    borderRight: line('r'),
  }
}

function refStyle(hue: number | undefined, edges: string): Record<string, string | number> {
  if (hue === undefined) return {}
  const w = (edge: string) => (edges.includes(edge) ? '1.5px' : '0px')
  return { '--h': hue, '--ref-t': w('t'), '--ref-b': w('b'), '--ref-l': w('l'), '--ref-r': w('r') }
}
