import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { GripVertical, Maximize2, SearchX, Sigma } from 'lucide-react'
import { formatValue } from '@/engine/field-types'
import type { ReferencedArea } from '@/engine/formula'
import {
  beginEdit,
  clearSelection,
  commitEdit,
  copySelection,
  extendSelection,
  fillSelection,
  fillTo,
  moveSelection,
  pasteText,
  selectAll,
  selectColumns,
  selectEdge,
  selectRows,
  toggleCheckbox,
  toggleSelectedCheckboxes,
} from '@/store/grid-actions'
import { moveRowsTo } from '@/store/field-actions'
import { clearFilters } from '@/store/view-actions'
import { activeView, isReordered, useViewRows, visibleFieldIds } from '@/store/view-rows'
import { getSheet, useDataStore, useUIStore } from '@/store'
import { undoable } from '@/store/history'
import type { Field, RowHeight, Table } from '@/types/domain'
import { fieldWidth, refHue } from '@/lib/field-icons'
import { cn } from '@/lib/cn'
import { GridCell } from './GridCell'
import { GridContextMenu, reportPaste } from './GridContextMenu'
import { FOOTER_HEIGHT, GridFooter } from './GridFooter'
import { ADD_COLUMN_WIDTH, GridHeader, GUTTER_WIDTH, HEADER_HEIGHT } from './GridHeader'
import type { GridHandlers } from './grid-handlers'
import { areaIndexAt, useActiveFormulaAreas } from './useActiveFormula'

export const ROW_HEIGHTS: Record<RowHeight, number> = { compact: 30, standard: 36, tall: 68 }

interface HybridGridProps {
  table: Table
  /** Mode tableur pur : texte brut, en-têtes réduits à la lettre de colonne. */
  plain: boolean
}

interface Rect {
  r0: number
  r1: number
  c0: number
  c1: number
}

/** Largeur d'un texte dans la police de la grille (ajustement automatique des colonnes). */
function textWidth(texts: string[], font: string): number {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return 0
  ctx.font = font
  return Math.max(0, ...texts.map((t) => ctx.measureText(t).width))
}

/**
 * Grille hybride : adressage Excel (lettres, numéros de ligne, formules, plages, poignée de
 * recopie, presse-papiers) et rendu Airtable (badges, avatars, cases, colonne figée, fiche).
 * Les lignes sont virtualisées ; leur ordre est celui de la vue (filtres, tri, recherche).
 */
export function HybridGrid({ table, plain }: HybridGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = useViewRows(table)
  const view = activeView(table)
  const search = useUIStore((s) => s.search)
  const rowHeightKind = view?.rowHeight ?? 'standard'
  const rowHeight = ROW_HEIGHTS[rowHeightKind]
  const selection = useUIStore((s) => s.selection)
  const rangeEnd = useUIStore((s) => s.rangeEnd)
  const isEditing = useUIStore((s) => s.editing !== null)
  const openRecord = useUIStore((s) => s.openRecord)
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({})
  const [scrolledX, setScrolledX] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [fillTarget, setFillTarget] = useState<{ r: number; c: number } | null>(null)
  const [dragRow, setDragRow] = useState<string | null>(null)
  const [dropRow, setDropRow] = useState<number | null>(null)

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
  const widths = useMemo(
    () => fields.map((f) => liveWidths[f.id] ?? fieldWidth(f)),
    [fields, liveWidths],
  )
  const offsets = useMemo(() => {
    const out: number[] = []
    let x = GUTTER_WIDTH
    for (const w of widths) {
      out.push(x)
      x += w
    }
    return out
  }, [widths])
  const totalWidth = GUTTER_WIDTH + widths.reduce((sum, w) => sum + w, 0) + ADD_COLUMN_WIDTH
  const rowNumbers = useMemo(
    () => new Map(table.rowOrder.map((id, i) => [id, i + 1])),
    [table.rowOrder],
  )
  const reorderable = !plain && !isReordered(table) && search.trim() === ''

  const areas = useActiveFormulaAreas(table.id)

  // Rectangle de la sélection dans les coordonnées de la vue.
  const rect = useMemo<Rect | null>(() => {
    if (!selection) return null
    const ar = rows.indexOf(selection.recordId)
    const ac = fieldIds.indexOf(selection.fieldId)
    if (ar === -1 || ac === -1) return null
    const er = rangeEnd ? rows.indexOf(rangeEnd.recordId) : ar
    const ec = rangeEnd ? fieldIds.indexOf(rangeEnd.fieldId) : ac
    const br = er === -1 ? ar : er
    const bc = ec === -1 ? ac : ec
    return {
      r0: Math.min(ar, br),
      r1: Math.max(ar, br),
      c0: Math.min(ac, bc),
      c1: Math.max(ac, bc),
    }
  }, [selection, rangeEnd, rows, fieldIds])

  // Zone de recopie : la plage prolongée vers la cible, sur l'axe le plus éloigné.
  const fillRect = useMemo<Rect | null>(() => {
    if (!rect || !fillTarget) return null
    const rowOut =
      fillTarget.r < rect.r0 ? rect.r0 - fillTarget.r : Math.max(0, fillTarget.r - rect.r1)
    const colOut =
      fillTarget.c < rect.c0 ? rect.c0 - fillTarget.c : Math.max(0, fillTarget.c - rect.c1)
    if (rowOut === 0 && colOut === 0) return null
    return rowOut >= colOut
      ? {
          ...rect,
          r0: Math.min(rect.r0, fillTarget.r),
          r1: Math.max(rect.r1, fillTarget.r),
        }
      : { ...rect, c0: Math.min(rect.c0, fillTarget.c), c1: Math.max(rect.c1, fillTarget.c) }
  }, [rect, fillTarget])

  // Pas de React Compiler dans ce projet : l'avertissement de mémoïsation ne s'applique pas.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    paddingStart: HEADER_HEIGHT,
    paddingEnd: FOOTER_HEIGHT,
    scrollPaddingStart: HEADER_HEIGHT,
    scrollPaddingEnd: FOOTER_HEIGHT,
    initialRect: { width: 1200, height: 800 },
  })
  useEffect(() => {
    virtualizer.measure()
  }, [rowHeight, virtualizer])

  // Amène la cellule « au bout » de la sélection dans la zone visible (lignes et colonnes).
  const focusRecord = (rangeEnd ?? selection)?.recordId
  const focusField = (rangeEnd ?? selection)?.fieldId
  const focusRow = focusRecord ? rows.indexOf(focusRecord) : -1
  const focusCol = focusField ? fieldIds.indexOf(focusField) : -1
  useEffect(() => {
    if (focusRow >= 0) virtualizer.scrollToIndex(focusRow, { align: 'auto' })
  }, [focusRow, virtualizer])
  useEffect(() => {
    const el = scrollRef.current
    if (!el || focusCol <= 0) return
    const left = offsets[focusCol] ?? 0
    const right = left + (widths[focusCol] ?? 0)
    const frozenRight = GUTTER_WIDTH + (widths[0] ?? 0)
    if (left < el.scrollLeft + frozenRight) el.scrollLeft = left - frozenRight
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth
  }, [focusCol, offsets, widths])

  const focusGrid = useCallback(() => {
    scrollRef.current?.focus({ preventScroll: true })
  }, [])

  // ------------------------------------------------------------------ souris
  const drag = useRef<{ kind: 'select' | 'fill' | 'rows'; anchorRow?: string } | null>(null)
  const latest = useRef({ rows, fieldIds, rect })
  useLayoutEffect(() => {
    latest.current = { rows, fieldIds, rect }
  })

  useEffect(() => {
    const up = () => {
      const d = drag.current
      drag.current = null
      if (d?.kind === 'fill') {
        setFillTarget((target) => {
          if (target) {
            const recordId = latest.current.rows[target.r]
            const fieldId = latest.current.fieldIds[target.c]
            if (recordId && fieldId) queueMicrotask(() => fillTo({ recordId, fieldId }))
          }
          return null
        })
      }
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const handlers = useMemo<GridHandlers>(
    () => ({
      cellMouseDown(cell, e) {
        const ui = useUIStore.getState()
        if (ui.editing) {
          // Clic ailleurs pendant une saisie : on valide d'abord, comme Excel.
          if (!commitEdit('none')) return
        }
        if (e.button === 2) {
          const r = latest.current.rect
          const row = latest.current.rows.indexOf(cell.recordId)
          const col = latest.current.fieldIds.indexOf(cell.fieldId)
          const inside = r && row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1
          if (!inside) ui.select(cell)
          return
        }
        if (e.button !== 0) return
        e.preventDefault()
        if (e.shiftKey && ui.selection) ui.extendTo(cell)
        else ui.select(cell)
        drag.current = { kind: 'select' }
        focusGrid()
      },
      cellMouseEnter(cell) {
        const d = drag.current
        if (!d) return
        if (d.kind === 'select') useUIStore.getState().extendTo(cell)
        else if (d.kind === 'fill') {
          setFillTarget({
            r: latest.current.rows.indexOf(cell.recordId),
            c: latest.current.fieldIds.indexOf(cell.fieldId),
          })
        } else if (d.kind === 'rows' && d.anchorRow) {
          selectRows(d.anchorRow, cell.recordId)
        }
      },
      cellDoubleClick(cell) {
        beginEdit(cell)
      },
      cellContextMenu(_cell, e) {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      },
      toggleCheckbox(cell) {
        toggleCheckbox(cell)
      },
      fillHandleMouseDown(e) {
        e.preventDefault()
        e.stopPropagation()
        drag.current = { kind: 'fill' }
      },
      rowHeaderMouseDown(recordId, e) {
        if (e.button !== 0) return
        if ((e.target as HTMLElement).closest('button, [draggable="true"]')) return
        e.preventDefault()
        const ui = useUIStore.getState()
        if (ui.editing && !commitEdit('none')) return
        if (e.shiftKey && ui.selection) selectRows(ui.selection.recordId, recordId)
        else selectRows(recordId)
        drag.current = { kind: 'rows', anchorRow: e.shiftKey ? ui.selection?.recordId : recordId }
        focusGrid()
      },
      rowHeaderMouseEnter(recordId) {
        const d = drag.current
        if (d?.kind === 'rows' && d.anchorRow) selectRows(d.anchorRow, recordId)
      },
      expandRecord(recordId) {
        openRecord(recordId)
      },
      rowDragStart(recordId, e) {
        e.dataTransfer.setData('application/x-atelier-row', recordId)
        e.dataTransfer.effectAllowed = 'move'
        setDragRow(recordId)
      },
      focusGrid,
    }),
    [focusGrid, openRecord],
  )

  const onRowsDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!dragRow) return
    e.preventDefault()
    const el = scrollRef.current
    if (!el) return
    const y = e.clientY - el.getBoundingClientRect().top + el.scrollTop - HEADER_HEIGHT
    setDropRow(Math.max(0, Math.min(rows.length, Math.round(y / rowHeight))))
  }
  const onRowsDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const recordId = dragRow
    const to = dropRow
    setDragRow(null)
    setDropRow(null)
    if (!recordId || to === null) return
    // Plusieurs lignes sélectionnées dont celle qu'on tire : le bloc entier se déplace.
    const r = latest.current.rect
    const index = rows.indexOf(recordId)
    const block = r && index >= r.r0 && index <= r.r1 ? rows.slice(r.r0, r.r1 + 1) : [recordId]
    moveRowsTo(table.id, block, to)
  }

  // ------------------------------------------------------------------ colonnes
  const onResize = useCallback((fieldId: string, width: number | null) => {
    setLiveWidths((w) => {
      const next = { ...w }
      if (width === null) delete next[fieldId]
      else next[fieldId] = width
      return next
    })
  }, [])
  const onAutoFit = useCallback(
    (fieldId: string) => {
      const field = table.fields[fieldId]
      const el = scrollRef.current
      if (!field || !el) return
      const sheet = getSheet(table.id)
      const style = getComputedStyle(el)
      const font = `${style.fontSize} ${style.fontFamily}`
      const texts = rows
        .slice(0, 2000)
        .map((id) => formatValue(field, sheet?.value(id, fieldId) ?? null))
      const badge = field.type === 'select' || field.type === 'owner' ? 34 : 0
      const content = textWidth(texts, font) + badge + 24
      const header = textWidth([field.label], `600 ${style.fontSize} ${style.fontFamily}`) + 72
      const width = Math.round(Math.max(80, Math.min(480, Math.max(content, header))))
      undoable('Ajuster la largeur', table.id, () =>
        useDataStore.getState().updateField(table.id, fieldId, { width }),
      )
    },
    [rows, table.fields, table.id],
  )

  // ------------------------------------------------------------------ clavier
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isEditing || e.target !== e.currentTarget) return
    const mod = e.metaKey || e.ctrlKey
    const ui = useUIStore.getState()

    if (!selection) {
      if (e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const recordId = rows[0]
        const fieldId = fieldIds[0]
        if (recordId && fieldId) ui.select({ recordId, fieldId })
      }
      return
    }

    const arrow: Record<string, 'up' | 'down' | 'left' | 'right'> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
    }
    const dir = arrow[e.key]
    if (dir) {
      e.preventDefault()
      if (mod) {
        const edge = { up: 'top', down: 'bottom', left: 'rowStart', right: 'rowEnd' } as const
        return selectEdge(edge[dir], e.shiftKey)
      }
      return e.shiftKey ? extendSelection(dir) : moveSelection(dir)
    }

    if (mod) {
      switch (e.key.toLowerCase()) {
        case 'a':
          e.preventDefault()
          return selectAll()
        case 'd':
          e.preventDefault()
          return fillSelection('down')
        case 'r':
          e.preventDefault()
          return fillSelection('right')
        case 'home':
          e.preventDefault()
          return selectEdge('first', e.shiftKey)
        case 'end':
          e.preventDefault()
          return selectEdge('last', e.shiftKey)
        case ';':
          // Ctrl+; : date du jour, comme Excel.
          e.preventDefault()
          return beginEdit(selection, new Date().toLocaleDateString('fr-FR'))
        case ' ':
          e.preventDefault()
          return selectColumns(selection.fieldId)
      }
      return
    }

    switch (e.key) {
      case 'Home':
        e.preventDefault()
        return selectEdge('rowStart', e.shiftKey)
      case 'End':
        e.preventDefault()
        return selectEdge('rowEnd', e.shiftKey)
      case 'PageDown':
        e.preventDefault()
        return e.shiftKey ? extendSelection('down', 10) : moveSelection('down', 10)
      case 'PageUp':
        e.preventDefault()
        return e.shiftKey ? extendSelection('up', 10) : moveSelection('up', 10)
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
        return clearSelection()
      case 'Escape':
        return ui.rangeEnd ? ui.select(selection) : ui.select(null)
      case 'ContextMenu':
        e.preventDefault()
        return openMenuAtSelection()
      case 'F10':
        if (e.shiftKey) {
          e.preventDefault()
          return openMenuAtSelection()
        }
        break
      case ' ':
        e.preventDefault()
        if (e.shiftKey) return selectRows(selection.recordId)
        if (table.fields[selection.fieldId]?.type === 'checkbox') {
          return ui.rangeEnd ? toggleSelectedCheckboxes() : toggleCheckbox(selection)
        }
        // Espace : fiche détaillée de la ligne, comme Airtable.
        return openRecord(selection.recordId)
    }

    // Une frappe de caractère commence la saisie, comme dans Excel.
    if (e.key.length === 1 && !e.altKey) {
      e.preventDefault()
      beginEdit(selection, e.key)
    }
  }

  const openMenuAtSelection = () => {
    const sel = useUIStore.getState().selection
    const el = sel
      ? scrollRef.current?.querySelector<HTMLElement>(
          `[data-cell="${sel.recordId}:${sel.fieldId}"]`,
        )
      : null
    const box = el?.getBoundingClientRect()
    if (box) setMenu({ x: box.left + 12, y: box.bottom })
  }

  // ------------------------------------------------------------------ presse-papiers
  const onCopy = (e: ClipboardEvent<HTMLDivElement>, cut = false) => {
    if (isEditing || e.target !== e.currentTarget) return
    const text = copySelection(cut)
    if (text === null) return
    e.preventDefault()
    e.clipboardData.setData('text/plain', text)
  }
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (isEditing || e.target !== e.currentTarget) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    reportPaste(pasteText(text))
  }

  const total = virtualizer.getTotalSize()
  const isData = (id: string) => table.records[id]?.kind === 'data'
  const filteredOut = !rows.some(isData) && table.rowOrder.some(isData)

  return (
    <div className="relative m-3 mt-2 flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        role="grid"
        aria-label={table.name}
        aria-rowcount={rows.length}
        aria-multiselectable
        tabIndex={0}
        onKeyDown={onKeyDown}
        onCopy={(e) => onCopy(e)}
        onCut={(e) => onCopy(e, true)}
        onPaste={onPaste}
        onScroll={(e) => {
          const x = e.currentTarget.scrollLeft > 0
          if (x !== scrolledX) setScrolledX(x)
        }}
        className="relative min-h-0 flex-1 overflow-auto rounded-xl border border-edge bg-surface shadow-glow outline-none"
      >
        <div
          style={{ width: totalWidth, minWidth: '100%', minHeight: '100%', height: total }}
          className="relative flex flex-col"
          onDragOver={onRowsDragOver}
          onDrop={onRowsDrop}
        >
          <GridHeader
            table={table}
            fieldIds={fieldIds}
            plain={plain}
            activeC0={rect?.c0 ?? -1}
            activeC1={rect?.c1 ?? -1}
            frozenShadow={scrolledX}
            liveWidths={liveWidths}
            onResize={onResize}
            onAutoFit={onAutoFit}
          />
          {virtualizer.getVirtualItems().map((item) => {
            const recordId = rows[item.index]
            const record = recordId ? table.records[recordId] : undefined
            if (!record) return null
            const i = item.index
            const inRange = rect !== null && i >= rect.r0 && i <= rect.r1
            const inFill = fillRect !== null && i >= fillRect.r0 && i <= fillRect.r1
            return (
              <GridRow
                key={record.id}
                tableId={table.id}
                recordId={record.id}
                rowIndex={i}
                rowNumber={rowNumbers.get(record.id) ?? i + 1}
                top={item.start}
                height={rowHeight}
                wrap={rowHeightKind === 'tall'}
                summary={record.kind === 'summary'}
                fields={fields}
                widths={widths}
                columnIndexes={columnIndexes}
                plain={plain}
                areas={areas}
                activeFieldId={selection?.recordId === record.id ? selection.fieldId : null}
                rangeC0={inRange ? rect.c0 : -1}
                rangeC1={inRange ? rect.c1 : -1}
                rangeTop={inRange && i === rect.r0}
                rangeBottom={inRange && i === rect.r1}
                fillC0={inFill ? fillRect.c0 : -1}
                fillC1={inFill ? fillRect.c1 : -1}
                fillTop={inFill && i === fillRect.r0}
                fillBottom={inFill && i === fillRect.r1}
                fillHandleCol={rect && !isEditing && i === rect.r1 ? rect.c1 : -1}
                frozenShadow={scrolledX}
                reorderable={reorderable && record.kind === 'data'}
                dropBefore={dropRow === i}
                dropAfter={dropRow === rows.length && i === rows.length - 1}
                handlers={handlers}
              />
            )
          })}
          <div className="flex-1" />
          <GridFooter
            table={table}
            fieldIds={fieldIds}
            rows={rows}
            liveWidths={liveWidths}
            frozenShadow={scrolledX}
          />
        </div>
        {filteredOut && (
          <div className="pointer-events-none absolute inset-x-0 top-24 grid place-items-center">
            <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-2 rounded-xl border border-line bg-surface px-6 py-5 text-center shadow-glow">
              <SearchX size={20} className="text-faint" />
              <p className="font-medium text-ink">Aucune ligne ne correspond</p>
              <p className="text-muted">
                {search.trim()
                  ? `Rien ne contient « ${search.trim()} » dans les colonnes affichées.`
                  : 'Les filtres de la vue masquent toutes les lignes.'}
              </p>
              <button type="button" className="btn mt-1" onClick={() => clearFilters(table.id)}>
                Effacer les filtres et la recherche
              </button>
            </div>
          </div>
        )}
      </div>
      <GridContextMenu position={menu} onClose={() => setMenu(null)} />
    </div>
  )
}

interface GridRowProps {
  tableId: string
  recordId: string
  rowIndex: number
  /** Numéro de ligne de la table (adresse A1), même quand la vue est triée. */
  rowNumber: number
  top: number
  height: number
  wrap: boolean
  summary: boolean
  fields: Field[]
  widths: number[]
  columnIndexes: number[]
  plain: boolean
  areas: ReferencedArea[]
  activeFieldId: string | null
  rangeC0: number
  rangeC1: number
  rangeTop: boolean
  rangeBottom: boolean
  fillC0: number
  fillC1: number
  fillTop: boolean
  fillBottom: boolean
  fillHandleCol: number
  frozenShadow: boolean
  reorderable: boolean
  dropBefore: boolean
  dropAfter: boolean
  handlers: GridHandlers
}

function edgesOf(c: number, c0: number, c1: number, top: boolean, bottom: boolean): string {
  if (c0 < 0 || c < c0 || c > c1) return ''
  return `${top ? 't' : ''}${bottom ? 'b' : ''}${c === c0 ? 'l' : ''}${c === c1 ? 'r' : ''}`
}

const GridRow = memo(function GridRow({
  tableId,
  recordId,
  rowIndex,
  rowNumber,
  top,
  height,
  wrap,
  summary,
  fields,
  widths,
  columnIndexes,
  plain,
  areas,
  activeFieldId,
  rangeC0,
  rangeC1,
  rangeTop,
  rangeBottom,
  fillC0,
  fillC1,
  fillTop,
  fillBottom,
  fillHandleCol,
  frozenShadow,
  reorderable,
  dropBefore,
  dropAfter,
  handlers,
}: GridRowProps) {
  const tableRow = rowNumber - 1
  const rowRefIndex = areas.length
    ? areas.findIndex((a) => tableRow >= a.r0 && tableRow <= a.r1)
    : -1
  const highlighted = rangeC0 >= 0 || activeFieldId !== null
  const multi = rangeC0 >= 0 && (rangeC1 > rangeC0 || !rangeTop || !rangeBottom)

  return (
    <div
      role="row"
      aria-rowindex={rowIndex + 1}
      className="group absolute top-0 left-0 flex w-full"
      style={{ height, transform: `translateY(${top}px)` }}
    >
      {dropBefore && <span className="absolute -top-px right-0 left-0 z-30 h-0.5 bg-accent" />}
      {dropAfter && <span className="absolute right-0 -bottom-px left-0 z-30 h-0.5 bg-accent" />}
      <div
        onMouseDown={(e) => handlers.rowHeaderMouseDown(recordId, e)}
        onMouseEnter={() => handlers.rowHeaderMouseEnter(recordId)}
        onDoubleClick={() => handlers.expandRecord(recordId)}
        className={cn(
          'sticky left-0 z-[6] flex shrink-0 cursor-default items-center gap-0.5 border-r border-b border-line pr-1 pl-0.5 text-[11px] tabular-nums select-none',
          summary ? 'bg-surface-sunken' : 'bg-surface group-hover:bg-row-hover',
          highlighted ? 'text-accent-fg' : 'text-faint',
          multi && 'bg-accent-soft',
        )}
        style={{ width: GUTTER_WIDTH }}
      >
        {reorderable ? (
          <span
            draggable
            onDragStart={(e) => handlers.rowDragStart(recordId, e)}
            title="Glisser pour déplacer la ligne"
            className="cursor-grab text-faint opacity-0 group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical size={12} />
          </span>
        ) : (
          <span className="w-3" />
        )}
        <span
          className={cn('min-w-0 flex-1 truncate font-semibold', rowRefIndex >= 0 && 'ref-text')}
          style={rowRefIndex >= 0 ? { ['--h' as string]: refHue(rowRefIndex) } : undefined}
        >
          {rowNumber}
        </span>
        {summary ? (
          <Sigma size={12} aria-label="Ligne de total" className="shrink-0" />
        ) : (
          <button
            type="button"
            aria-label={`Développer la ligne ${rowNumber}`}
            title="Développer la ligne (Espace)"
            onClick={() => handlers.expandRecord(recordId)}
            className="shrink-0 rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-surface-hover hover:text-accent-fg focus-visible:opacity-100 pointer-coarse:opacity-100"
          >
            <Maximize2 size={11} />
          </button>
        )}
      </div>
      {fields.map((field, c) => {
        const col = columnIndexes[c] ?? -1
        const areaIndex = areas.length ? areaIndexAt(areas, tableRow, col) : -1
        const area = areaIndex >= 0 ? areas[areaIndex] : undefined
        // Bords extérieurs de la zone : un seul cadre autour d'une plage.
        const refEdges = area
          ? `${tableRow === area.r0 ? 't' : ''}${tableRow === area.r1 ? 'b' : ''}${col === area.c0 ? 'l' : ''}${col === area.c1 ? 'r' : ''}`
          : ''
        const rangeEdges = multi ? edgesOf(c, rangeC0, rangeC1, rangeTop, rangeBottom) : ''
        return (
          <GridCell
            key={field.id}
            tableId={tableId}
            recordId={recordId}
            field={field}
            width={widths[c] ?? 120}
            plain={plain}
            summary={summary}
            wrap={wrap}
            active={activeFieldId === field.id}
            inRange={multi && c >= rangeC0 && c <= rangeC1}
            rangeEdges={rangeEdges}
            fillHandle={fillHandleCol === c}
            fillEdges={edgesOf(c, fillC0, fillC1, fillTop, fillBottom)}
            frozenLeft={c === 0 ? GUTTER_WIDTH : null}
            frozenShadow={frozenShadow}
            refHue={areaIndex >= 0 ? refHue(areaIndex) : undefined}
            refEdges={refEdges}
            handlers={handlers}
          />
        )
      })}
    </div>
  )
})
