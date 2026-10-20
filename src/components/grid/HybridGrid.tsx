import { memo, useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Sigma, Trash2 } from 'lucide-react'
import type { ReferencedArea } from '@/engine/formula'
import {
  beginEdit,
  clearCell,
  moveSelection,
  selectEdge,
  toggleCheckbox,
  visibleFieldIds,
} from '@/store/grid-actions'
import { useDataStore, useUIStore } from '@/store'
import type { Field, Table } from '@/types/domain'
import { fieldWidth, refHue } from '@/lib/field-icons'
import { cn } from '@/lib/cn'
import { GridCell } from './GridCell'
import { GridFooter } from './GridFooter'
import { ADD_COLUMN_WIDTH, GridHeader, GUTTER_WIDTH } from './GridHeader'
import { areaIndexAt, useActiveFormulaAreas } from './useActiveFormula'

const ROW_HEIGHT = 34

interface HybridGridProps {
  table: Table
  /** Mode tableur pur : texte brut, en-têtes réduits à la lettre de colonne. */
  plain: boolean
}

/**
 * Grille hybride : adressage Excel (lettres, numéros de ligne, formules) et rendu
 * Airtable (badges, avatars, cases). Les lignes sont virtualisées.
 */
export function HybridGrid({ table, plain }: HybridGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const selection = useUIStore((s) => s.selection)
  const isEditing = useUIStore((s) => s.editing !== null)
  const select = useUIStore((s) => s.select)

  const fieldIds = useMemo(
    () => visibleFieldIds(table),
    // visibleFieldIds ne lit que l'ordre des champs et la vue active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table.fieldOrder, table.views, table.activeViewId],
  )
  const fields = useMemo(
    () => fieldIds.map((id) => table.fields[id]).filter((f): f is Field => f !== undefined),
    [fieldIds, table.fields],
  )
  const columnIndexes = useMemo(
    () => fields.map((f) => table.fieldOrder.indexOf(f.id)),
    [fields, table.fieldOrder],
  )
  const totalWidth =
    GUTTER_WIDTH + fields.reduce((sum, f) => sum + fieldWidth(f), 0) + ADD_COLUMN_WIDTH

  const areas = useActiveFormulaAreas(table.id)

  // Pas de React Compiler dans ce projet : l'avertissement de mémoïsation ne s'applique pas.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: table.rowOrder.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    initialRect: { width: 1200, height: 800 },
  })

  // Amène la ligne sélectionnée dans la zone visible (elle peut ne pas être rendue).
  const selectedRow = selection ? table.rowOrder.indexOf(selection.recordId) : -1
  useEffect(() => {
    if (selectedRow >= 0) virtualizer.scrollToIndex(selectedRow, { align: 'auto' })
  }, [selectedRow, virtualizer])

  const focusGrid = useCallback(() => {
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isEditing || e.target !== e.currentTarget) return
    const mod = e.metaKey || e.ctrlKey

    if (!selection) {
      if (e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const recordId = table.rowOrder[0]
        const fieldId = fieldIds[0]
        if (recordId && fieldId) select({ recordId, fieldId })
      }
      return
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        return mod ? selectEdge('top') : moveSelection('up')
      case 'ArrowDown':
        e.preventDefault()
        return mod ? selectEdge('bottom') : moveSelection('down')
      case 'ArrowLeft':
        e.preventDefault()
        return mod ? selectEdge('rowStart') : moveSelection('left')
      case 'ArrowRight':
        e.preventDefault()
        return mod ? selectEdge('rowEnd') : moveSelection('right')
      case 'Home':
        e.preventDefault()
        return selectEdge('rowStart')
      case 'End':
        e.preventDefault()
        return selectEdge('rowEnd')
      case 'PageDown':
        e.preventDefault()
        return moveSelection('down', 10)
      case 'PageUp':
        e.preventDefault()
        return moveSelection('up', 10)
      case 'Tab':
        e.preventDefault()
        return moveSelection(e.shiftKey ? 'left' : 'right')
      case 'Enter':
      case 'F2':
        e.preventDefault()
        return beginEdit(selection)
      case 'Delete':
      case 'Backspace':
        e.preventDefault()
        return clearCell(selection)
      case 'Escape':
        return select(null)
      case ' ':
        if (table.fields[selection.fieldId]?.type === 'checkbox') {
          e.preventDefault()
          return toggleCheckbox(selection)
        }
        break
    }

    // Une frappe de caractère commence la saisie, comme dans Excel.
    if (e.key.length === 1 && !mod && !e.altKey) {
      e.preventDefault()
      beginEdit(selection, e.key)
    }
  }

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={table.name}
      aria-rowcount={table.rowOrder.length}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative m-3 mt-2.5 min-h-0 flex-1 overflow-auto rounded-xl border border-edge bg-surface shadow-glow outline-none"
    >
      <div style={{ width: totalWidth, minWidth: '100%' }} className="flex min-h-full flex-col">
        <GridHeader
          table={table}
          fieldIds={fieldIds}
          plain={plain}
          selectedFieldId={selection?.fieldId}
        />
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const recordId = table.rowOrder[item.index]
            const record = recordId ? table.records[recordId] : undefined
            if (!record) return null
            return (
              <GridRow
                key={record.id}
                tableId={table.id}
                recordId={record.id}
                rowIndex={item.index}
                top={item.start}
                summary={record.kind === 'summary'}
                fields={fields}
                columnIndexes={columnIndexes}
                plain={plain}
                areas={areas}
                selected={selection?.recordId === record.id}
                focusGrid={focusGrid}
              />
            )
          })}
        </div>
        <div className="flex-1" />
        <GridFooter table={table} fieldIds={fieldIds} />
      </div>
    </div>
  )
}

interface GridRowProps {
  tableId: string
  recordId: string
  rowIndex: number
  top: number
  summary: boolean
  fields: Field[]
  columnIndexes: number[]
  plain: boolean
  areas: ReferencedArea[]
  selected: boolean
  focusGrid: () => void
}

const GridRow = memo(function GridRow({
  tableId,
  recordId,
  rowIndex,
  top,
  summary,
  fields,
  columnIndexes,
  plain,
  areas,
  selected,
  focusGrid,
}: GridRowProps) {
  const deleteRecords = useDataStore((s) => s.deleteRecords)
  const rowRefIndex = areas.length
    ? areas.findIndex((a) => rowIndex >= a.r0 && rowIndex <= a.r1)
    : -1

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 1}
      className={cn(
        'group absolute left-0 flex w-full',
        summary && 'bg-surface-sunken',
        summary && '[&>*]:border-t [&>*]:border-t-line-strong',
      )}
      style={{ height: ROW_HEIGHT, transform: `translateY(${top}px)` }}
    >
      <div
        className={cn(
          'sticky left-0 z-10 flex shrink-0 items-center justify-between border-r border-b border-line px-2 text-[11px] tabular-nums',
          summary ? 'bg-surface-sunken' : 'bg-surface',
          selected ? 'text-accent-fg' : 'text-faint',
        )}
        style={{ width: GUTTER_WIDTH }}
      >
        <span
          className={cn('font-semibold', rowRefIndex >= 0 && 'ref-text')}
          style={rowRefIndex >= 0 ? { ['--h' as string]: refHue(rowRefIndex) } : undefined}
        >
          {rowIndex + 1}
        </span>
        {summary ? (
          <Sigma size={12} aria-label="Ligne de total" />
        ) : (
          <button
            type="button"
            aria-label={`Supprimer la ligne ${rowIndex + 1}`}
            title="Supprimer la ligne"
            onClick={() => deleteRecords(tableId, [recordId])}
            className="rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      {fields.map((field, i) => {
        const col = columnIndexes[i] ?? -1
        const areaIndex = areas.length ? areaIndexAt(areas, rowIndex, col) : -1
        const area = areaIndex >= 0 ? areas[areaIndex] : undefined
        // Bords extérieurs de la zone : un seul cadre autour d'une plage.
        const edges = area
          ? `${rowIndex === area.r0 ? 't' : ''}${rowIndex === area.r1 ? 'b' : ''}${col === area.c0 ? 'l' : ''}${col === area.c1 ? 'r' : ''}`
          : ''
        return (
          <GridCell
            key={field.id}
            tableId={tableId}
            recordId={recordId}
            field={field}
            width={fieldWidth(field)}
            plain={plain}
            summary={summary}
            refHue={areaIndex >= 0 ? refHue(areaIndex) : undefined}
            refEdges={edges}
            focusGrid={focusGrid}
          />
        )
      })}
    </div>
  )
})
