import { memo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Columns3, Plus } from 'lucide-react'
import { formatValue } from '@/engine/field-types'
import { kanbanColumns } from '@/engine/table'
import { getSheet, useCellValue, useComputed, useDataStore, useUIStore } from '@/store'
import { addRowAndSelect } from '@/store/grid-actions'
import { createField } from '@/store/field-actions'
import { undoable } from '@/store/history'
import { DEFAULT_STATUS_CHOICES } from '@/store/factories'
import { setGroupBy } from '@/store/view-actions'
import { activeView, useViewRows, visibleFieldIds } from '@/store/view-rows'
import type { Field, SelectChoice, Table } from '@/types/domain'
import { CellContent } from '@/components/cells/CellContent'
import { StatusBadge } from '@/components/ui/Badge'
import { FIELD_ICONS } from '@/lib/field-icons'
import { cn } from '@/lib/cn'

/** Nombre de champs affichés sur une carte, en plus du titre. */
const CARD_FIELDS = 4

/**
 * Vue Kanban : une colonne par choix du champ Statut (puis « Sans statut »), une carte par
 * ligne de la vue (filtres, tri et recherche appliqués). Glisser une carte change son statut ;
 * un clic ouvre sa fiche.
 */
export function KanbanView({ table }: { table: Table }) {
  const view = activeView(table)
  const rows = useViewRows(table)
  const openRecord = useUIStore((s) => s.openRecord)
  const [dragging, setDragging] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )

  const selectFields = table.fieldOrder
    .map((id) => table.fields[id])
    .filter((f): f is Field => f?.type === 'select')
  const groupField =
    (view?.groupByFieldId ? table.fields[view.groupByFieldId] : undefined) ?? selectFields[0]

  if (!groupField || groupField.type !== 'select') {
    return <NoStatusField table={table} />
  }

  const primary = table.fields[table.fieldOrder[0] ?? '']
  const cardFields = visibleFieldIds(table)
    .map((id) => table.fields[id])
    .filter((f): f is Field => f !== undefined && f.id !== primary?.id && f.id !== groupField.id)
    .slice(0, CARD_FIELDS)
  const total = table.fieldOrder
    .map((id) => table.fields[id])
    .find(
      (f): f is Field =>
        f?.type === 'currency' || (f?.type === 'formula' && f.options?.resultFormat === 'currency'),
    )
  const columns = kanbanColumns(table, groupField, rows).filter(
    (c) => c.choiceId !== null || c.recordIds.length > 0,
  )

  const onDragStart = (e: DragStartEvent) => setDragging(String(e.active.id))
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const recordId = String(e.active.id)
    const target = e.over?.id
    if (target === undefined) return
    const choiceId = target === 'none' ? null : String(target)
    const current = table.records[recordId]?.cells[groupField.id] ?? null
    if (current === choiceId) return
    const label =
      groupField.options?.choices?.find((c) => c.id === choiceId)?.label ?? 'Sans statut'
    useUIStore.getState().pin([recordId])
    undoable(`Déplacer vers « ${label} »`, table.id, () =>
      useDataStore.getState().setCell(table.id, recordId, groupField.id, choiceId),
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        role="region"
        aria-label={`Kanban de ${table.name}`}
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3"
      >
        {columns.map((column) => {
          const choice = groupField.options?.choices?.find((c) => c.id === column.choiceId)
          return (
            <KanbanColumn
              key={column.choiceId ?? 'none'}
              table={table}
              groupField={groupField}
              choice={choice}
              recordIds={column.recordIds}
              primary={primary}
              cardFields={cardFields}
              total={total}
              dragging={dragging}
              onOpen={openRecord}
            />
          )
        })}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <Card
            table={table}
            recordId={dragging}
            primary={primary}
            cardFields={cardFields}
            overlay
            onOpen={() => {}}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

function KanbanColumn({
  table,
  groupField,
  choice,
  recordIds,
  primary,
  cardFields,
  total,
  dragging,
  onOpen,
}: {
  table: Table
  groupField: Field
  choice: SelectChoice | undefined
  recordIds: string[]
  primary: Field | undefined
  cardFields: Field[]
  total: Field | undefined
  dragging: string | null
  onOpen: (recordId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: choice?.id ?? 'none' })
  useComputed((s) => s.revisions[table.id] ?? 0)
  const sheet = getSheet(table.id)
  const sum =
    total && recordIds.length
      ? recordIds.reduce((acc, id) => {
          const v = sheet?.value(id, total.id)
          return typeof v === 'number' ? acc + v : acc
        }, 0)
      : null

  return (
    <section
      ref={setNodeRef}
      aria-label={choice?.label ?? 'Sans statut'}
      className={cn(
        'flex w-72 shrink-0 flex-col rounded-xl border bg-surface-sunken/70 transition-colors',
        isOver ? 'border-accent shadow-glow' : 'border-line',
      )}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        {choice ? (
          <StatusBadge label={choice.label} color={choice.color} />
        ) : (
          <span className="text-[12px] font-medium text-muted">Sans statut</span>
        )}
        <span className="text-[12px] text-faint tabular-nums">{recordIds.length}</span>
        {sum !== null && total && (
          <span className="ml-auto truncate text-[12px] font-medium text-muted tabular-nums">
            {formatValue(total, Number(sum.toPrecision(15)))}
          </span>
        )}
      </header>
      <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {recordIds.map((id) => (
          <DraggableCard
            key={id}
            table={table}
            recordId={id}
            primary={primary}
            cardFields={cardFields}
            hidden={dragging === id}
            onOpen={onOpen}
          />
        ))}
        <button
          type="button"
          onClick={() => {
            const id = addRowAndSelect(choice ? { [groupField.id]: choice.id } : {})
            if (id) onOpen(id)
          }}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-muted hover:bg-surface-hover hover:text-accent-fg"
        >
          <Plus size={14} /> Nouvelle carte
        </button>
      </div>
    </section>
  )
}

function DraggableCard(props: {
  table: Table
  recordId: string
  primary: Field | undefined
  cardFields: Field[]
  hidden: boolean
  onOpen: (recordId: string) => void
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({ id: props.recordId })
  return (
    <Card
      {...props}
      nodeRef={setNodeRef}
      dragProps={{ ...attributes, ...listeners }}
      className={cn(props.hidden && 'opacity-30')}
    />
  )
}

const Card = memo(function Card({
  table,
  recordId,
  primary,
  cardFields,
  overlay,
  onOpen,
  nodeRef,
  dragProps,
  className,
}: {
  table: Table
  recordId: string
  primary: Field | undefined
  cardFields: Field[]
  overlay?: boolean
  onOpen: (recordId: string) => void
  /** Glisser-déposer (dnd-kit) : nœud et attributs posés sur la carte elle-même. */
  nodeRef?: (el: HTMLElement | null) => void
  dragProps?: Record<string, unknown>
  className?: string
}) {
  const title = useCellValue(table.id, recordId, primary?.id ?? '')
  const titleText = primary && title !== null ? formatValue(primary, title) : ''
  return (
    <div
      ref={nodeRef}
      {...dragProps}
      role="button"
      tabIndex={0}
      aria-roledescription="carte déplaçable"
      aria-label={`Ouvrir ${titleText || 'la fiche'}`}
      onClick={() => onOpen(recordId)}
      onKeyDown={(e) => {
        // Entrée ouvre la fiche ; Espace et les flèches restent au glisser-déposer au clavier.
        if (e.key === 'Enter') return onOpen(recordId)
        const drag = dragProps?.onKeyDown as ((event: typeof e) => void) | undefined
        drag?.(e)
      }}
      className={cn(
        'flex cursor-pointer flex-col gap-1.5 rounded-lg border border-line-strong bg-surface p-2.5 text-left hover:border-edge hover:shadow-glow',
        overlay && 'rotate-1 border-edge shadow-glow-strong',
        className,
      )}
    >
      <p className={cn('font-medium', titleText ? 'text-ink' : 'text-faint')}>
        {titleText || 'Sans titre'}
      </p>
      {cardFields.map((field) => (
        <CardField key={field.id} table={table} recordId={recordId} field={field} />
      ))}
    </div>
  )
})

function CardField({ table, recordId, field }: { table: Table; recordId: string; field: Field }) {
  const value = useCellValue(table.id, recordId, field.id)
  const stored = useDataStore((s) => s.tables[table.id]?.records[recordId]?.cells[field.id] ?? null)
  const collaborators = useDataStore((s) => s.collaborators)
  if (value === null || value === '' || (field.type === 'checkbox' && value !== true)) return null
  const Icon = FIELD_ICONS[field.type]
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
      <Icon size={11} className="shrink-0 text-faint" aria-label={field.label} />
      <span className="flex min-w-0 flex-1 items-center text-ink">
        <CellContent
          field={field}
          value={value}
          stored={stored}
          collaborators={collaborators}
          plain={false}
        />
      </span>
    </div>
  )
}

function NoStatusField({ table }: { table: Table }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center text-muted">
        <Columns3 size={22} className="text-faint" />
        <p className="font-medium text-ink">Le Kanban regroupe les lignes par statut</p>
        <p>Ajoutez une colonne Statut à cette table pour voir ses lignes en cartes.</p>
        <button
          type="button"
          className="atelier-btn-primary mt-2 h-8 rounded-lg px-3 font-medium"
          onClick={() => {
            const id = createField(table.id, {
              label: 'Statut',
              type: 'select',
              options: { choices: DEFAULT_STATUS_CHOICES.map((c) => ({ ...c })) },
            })
            setGroupBy(table.id, id)
          }}
        >
          Ajouter une colonne Statut
        </button>
      </div>
    </div>
  )
}
