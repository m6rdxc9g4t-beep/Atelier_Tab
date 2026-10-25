import { memo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  Copy,
  EyeOff,
  ListFilter,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  ArrowLeftToLine,
  ArrowRightToLine,
} from 'lucide-react'
import { columnToLetters } from '@/engine/formula'
import { activeFilters, activeSorts } from '@/engine/table'
import { selectAll, selectColumns } from '@/store/grid-actions'
import {
  deleteField,
  duplicateField,
  insertFieldBeside,
  moveFieldTo,
  renameField,
  resizeField,
} from '@/store/field-actions'
import { addFilter, setFieldHidden, sortBy } from '@/store/view-actions'
import { activeView } from '@/store/view-rows'
import { useUIStore } from '@/store'
import type { Field, Table } from '@/types/domain'
import { FieldEditor } from '@/components/fields/FieldEditor'
import { Floating, type FloatingAnchor } from '@/components/ui/Floating'
import { MenuItem, MenuSeparator } from '@/components/ui/Popover'
import { FIELD_ICONS, fieldWidth } from '@/lib/field-icons'
import { cn } from '@/lib/cn'

export const GUTTER_WIDTH = 56
export const ADD_COLUMN_WIDTH = 44
export const HEADER_HEIGHT = 36

/** Événement demandant à la barre de vue d'ouvrir un panneau (filtres…). */
export const OPEN_VIEW_PANEL = 'atelier:open-view-panel'

interface GridHeaderProps {
  table: Table
  fieldIds: string[]
  plain: boolean
  /** Colonnes (index visibles) couvertes par la sélection. */
  activeC0: number
  activeC1: number
  frozenShadow: boolean
  /** Largeurs en cours de redimensionnement (px), par id de champ. */
  liveWidths: Record<string, number>
  onResize: (fieldId: string, width: number | null) => void
  onAutoFit: (fieldId: string) => void
}

/**
 * En-tête de la grille : lettre de colonne (Excel) et nom typé (Airtable). Clic : sélectionne
 * la colonne ; double-clic : éditeur de champ ; ⌄ ou clic droit : menu ; bord droit : largeur ;
 * glisser : déplacer la colonne (les formules suivent).
 */
export const GridHeader = memo(function GridHeader({
  table,
  fieldIds,
  plain,
  activeC0,
  activeC1,
  frozenShadow,
  liveWidths,
  onResize,
  onAutoFit,
}: GridHeaderProps) {
  const [drop, setDrop] = useState<{ index: number } | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const view = activeView(table)
  const sorts = activeSorts(table, view)
  const filters = activeFilters(table, view)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const fieldId = e.dataTransfer.getData('application/x-atelier-field') || dragging
    setDragging(null)
    setDrop(null)
    if (!fieldId || !drop) return
    // Index d'affichage → index dans l'ordre de la table (colonnes masquées comprises).
    const target = fieldIds[drop.index]
    const to = target ? table.fieldOrder.indexOf(target) : table.fieldOrder.length
    moveFieldTo(table.id, fieldId, to)
  }

  return (
    <div
      role="row"
      className="sticky top-0 z-20 flex border-b border-line-strong bg-surface-sunken"
      style={{ height: HEADER_HEIGHT }}
      onDragOver={(e) => {
        if (dragging) e.preventDefault()
      }}
      onDrop={onDrop}
    >
      <button
        type="button"
        aria-label="Tout sélectionner"
        title="Tout sélectionner (⌘A)"
        onClick={selectAll}
        className="sticky left-0 z-30 shrink-0 border-r border-line-strong bg-surface-sunken text-[10px] text-faint hover:text-accent-fg"
        style={{ width: GUTTER_WIDTH }}
      >
        ◢
      </button>
      {fieldIds.map((fieldId, i) => {
        const field = table.fields[fieldId]
        if (!field) return null
        return (
          <ColumnHeader
            key={fieldId}
            table={table}
            field={field}
            index={i}
            letter={columnToLetters(table.fieldOrder.indexOf(fieldId))}
            plain={plain}
            active={i >= activeC0 && i <= activeC1}
            frozen={i === 0}
            frozenShadow={frozenShadow}
            width={liveWidths[fieldId] ?? fieldWidth(field)}
            sort={sorts.find((s) => s.fieldId === fieldId)?.direction}
            filtered={filters.some((f) => f.fieldId === fieldId)}
            dropBefore={drop?.index === i && dragging !== fieldId}
            dropAfter={drop?.index === fieldIds.length && i === fieldIds.length - 1}
            onDragStartColumn={(e) => {
              e.dataTransfer.setData('application/x-atelier-field', fieldId)
              e.dataTransfer.effectAllowed = 'move'
              setDragging(fieldId)
            }}
            onDragOverColumn={(e) => {
              if (!dragging) return
              e.preventDefault()
              const box = e.currentTarget.getBoundingClientRect()
              const after = e.clientX > box.left + box.width / 2
              setDrop({ index: after ? i + 1 : i })
            }}
            onDragEndColumn={() => {
              setDragging(null)
              setDrop(null)
            }}
            onResize={onResize}
            onAutoFit={onAutoFit}
          />
        )
      })}
      <AddColumnButton tableId={table.id} />
    </div>
  )
})

function ColumnHeader({
  table,
  field,
  index,
  letter,
  plain,
  active,
  frozen,
  frozenShadow,
  width,
  sort,
  filtered,
  dropBefore,
  dropAfter,
  onDragStartColumn,
  onDragOverColumn,
  onDragEndColumn,
  onResize,
  onAutoFit,
}: {
  table: Table
  field: Field
  index: number
  letter: string
  plain: boolean
  active: boolean
  frozen: boolean
  frozenShadow: boolean
  width: number
  sort: 'asc' | 'desc' | undefined
  filtered: boolean
  dropBefore: boolean
  dropAfter: boolean
  onDragStartColumn: (e: DragEvent) => void
  onDragOverColumn: (e: DragEvent<HTMLDivElement>) => void
  onDragEndColumn: () => void
  onResize: (fieldId: string, width: number | null) => void
  onAutoFit: (fieldId: string) => void
}) {
  const headerRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<FloatingAnchor | null>(null)
  const [editor, setEditor] = useState<HTMLElement | null>(null)
  const [renaming, setRenaming] = useState(false)
  const Icon = FIELD_ICONS[field.type]
  const SortIcon = sort === 'desc' ? ArrowDown : ArrowUp

  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || renaming) return
    if ((e.target as HTMLElement).closest('button, input, [data-resize]')) return
    const ui = useUIStore.getState()
    if (e.shiftKey && ui.selection) selectColumns(ui.selection.fieldId, field.id)
    else selectColumns(field.id)
    document.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true })
  }

  const startResize = (e: MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = width
    let current = startWidth
    const move = (ev: globalThis.MouseEvent) => {
      current = Math.max(60, Math.min(800, startWidth + ev.clientX - startX))
      onResize(field.id, current)
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      onResize(field.id, null)
      if (current !== startWidth) resizeField(table.id, field.id, current)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div
      ref={headerRef}
      role="columnheader"
      aria-label={plain ? letter : `${letter} ${field.label}`}
      draggable={!renaming}
      onDragStart={onDragStartColumn}
      onDragOver={onDragOverColumn}
      onDragEnd={onDragEndColumn}
      onMouseDown={onMouseDown}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button, input, [data-resize]')) return
        setEditor(e.currentTarget)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      className={cn(
        'group relative flex shrink-0 cursor-default items-center gap-1.5 border-r border-line px-2 text-muted select-none',
        frozen && 'sticky z-[25]',
        frozen && frozenShadow && 'frozen-shadow',
        active ? 'bg-accent-soft text-ink' : 'bg-surface-sunken hover:bg-surface-hover',
      )}
      style={{ width, ...(frozen ? { left: GUTTER_WIDTH } : {}) }}
      title={plain ? field.label : undefined}
    >
      {dropBefore && <span className="absolute top-0 bottom-0 -left-px z-10 w-0.5 bg-accent" />}
      {dropAfter && <span className="absolute top-0 -right-px bottom-0 z-10 w-0.5 bg-accent" />}
      <span
        className={cn(
          'shrink-0 text-center text-[11px] font-semibold tabular-nums',
          active ? 'text-accent-fg' : 'text-faint',
          plain ? 'w-full' : 'w-4',
        )}
      >
        {letter}
      </span>
      {!plain && (
        <>
          <Icon size={13} className="shrink-0" aria-hidden />
          {renaming ? (
            <input
              autoFocus
              defaultValue={field.label}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => {
                renameField(table.id, field.id, e.target.value)
                setRenaming(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenaming(false)
              }}
              className="min-w-0 flex-1 rounded border border-accent bg-field px-1 text-ink outline-none"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">
              {field.label}
            </span>
          )}
          {filtered && (
            <ListFilter size={12} className="shrink-0 text-accent-fg" aria-label="Filtrée" />
          )}
          {sort && <SortIcon size={12} className="shrink-0 text-accent-fg" aria-label="Triée" />}
          <button
            type="button"
            aria-label={`Options de la colonne ${field.label}`}
            onClick={(e) => setMenu(e.currentTarget)}
            className={cn(
              'shrink-0 rounded p-0.5 hover:bg-surface-hover hover:text-ink focus-visible:opacity-100',
              menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100',
            )}
          >
            <ChevronDown size={13} />
          </button>
        </>
      )}
      <span
        data-resize
        role="separator"
        aria-orientation="vertical"
        aria-label={`Largeur de ${field.label}`}
        title="Glissez pour changer la largeur, double-cliquez pour l’ajuster"
        onMouseDown={startResize}
        onDoubleClick={(e) => {
          e.stopPropagation()
          onAutoFit(field.id)
        }}
        className="absolute top-0 -right-[3px] bottom-0 z-10 w-[6px] cursor-col-resize hover:bg-accent/50"
      />

      <Floating
        open={menu !== null}
        anchor={menu}
        onClose={() => setMenu(null)}
        role="menu"
        align="end"
        className="min-w-56"
      >
        <ColumnMenuItems
          table={table}
          field={field}
          index={index}
          onDone={() => setMenu(null)}
          onEdit={() => {
            setMenu(null)
            setEditor(headerRef.current)
          }}
          onRename={() => {
            setMenu(null)
            setRenaming(true)
          }}
        />
      </Floating>
      {editor && (
        <FieldEditor
          tableId={table.id}
          fieldId={field.id}
          anchor={editor}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}

function ColumnMenuItems({
  table,
  field,
  index,
  onDone,
  onEdit,
  onRename,
}: {
  table: Table
  field: Field
  index: number
  onDone: () => void
  onEdit: () => void
  onRename: () => void
}) {
  const [confirm, setConfirm] = useState(false)
  const primary = index === 0 && table.fieldOrder[0] === field.id
  const run = (fn: () => void) => () => {
    fn()
    onDone()
  }
  if (confirm) {
    return (
      <div className="flex w-64 flex-col gap-2 p-2">
        <p className="text-ink">
          Supprimer la colonne « {field.label} » et ses valeurs ? Les formules qui la lisent
          afficheront #REF!.
        </p>
        <p className="text-[12px] text-muted">Vous pourrez annuler avec ⌘Z.</p>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>
            Garder
          </button>
          <button
            type="button"
            autoFocus
            className="h-7 rounded-md bg-danger px-2.5 font-medium text-solid-ink hover:brightness-110"
            onClick={run(() => deleteField(table.id, field.id))}
          >
            Supprimer
          </button>
        </div>
      </div>
    )
  }
  return (
    <>
      <MenuItem icon={<Settings2 size={13} />} onSelect={onEdit}>
        Modifier la colonne…
      </MenuItem>
      <MenuItem icon={<Pencil size={13} />} onSelect={onRename}>
        Renommer
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<ArrowUpNarrowWide size={13} />}
        onSelect={run(() => sortBy(table.id, field.id, 'asc'))}
      >
        Trier par ordre croissant
      </MenuItem>
      <MenuItem
        icon={<ArrowDownWideNarrow size={13} />}
        onSelect={run(() => sortBy(table.id, field.id, 'desc'))}
      >
        Trier par ordre décroissant
      </MenuItem>
      <MenuItem
        icon={<ListFilter size={13} />}
        onSelect={run(() => {
          addFilter(table.id, field.id)
          window.dispatchEvent(new CustomEvent(OPEN_VIEW_PANEL, { detail: 'filter' }))
        })}
      >
        Filtrer selon cette colonne
      </MenuItem>
      <MenuItem
        icon={<EyeOff size={13} />}
        disabled={primary}
        onSelect={run(() => setFieldHidden(table.id, field.id, true))}
      >
        Masquer la colonne
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        icon={<ArrowLeftToLine size={13} />}
        onSelect={run(() => insertFieldBeside(table.id, field.id, 'left'))}
      >
        Insérer une colonne à gauche
      </MenuItem>
      <MenuItem
        icon={<ArrowRightToLine size={13} />}
        onSelect={run(() => insertFieldBeside(table.id, field.id, 'right'))}
      >
        Insérer une colonne à droite
      </MenuItem>
      <MenuItem icon={<Copy size={13} />} onSelect={run(() => duplicateField(table.id, field.id))}>
        Dupliquer la colonne
      </MenuItem>
      <MenuSeparator />
      <MenuItem danger icon={<Trash2 size={13} />} onSelect={() => setConfirm(true)}>
        Supprimer la colonne
      </MenuItem>
    </>
  )
}

function AddColumnButton({ tableId }: { tableId: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <div className="relative shrink-0 border-r border-line" style={{ width: ADD_COLUMN_WIDTH }}>
      <button
        type="button"
        aria-label="Ajouter une colonne"
        title="Ajouter une colonne"
        onClick={(e) => setAnchor((a) => (a ? null : e.currentTarget))}
        className="grid size-full place-items-center text-muted hover:bg-surface-hover hover:text-accent-fg"
      >
        <Plus size={15} />
      </button>
      {anchor && <FieldEditor tableId={tableId} anchor={anchor} onClose={() => setAnchor(null)} />}
    </div>
  )
}
