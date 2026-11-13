import { Fragment, memo, useMemo, useState, type CSSProperties } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Columns3, Plus } from 'lucide-react'
import { formatValue } from '@/engine/field-types'
import {
  isBlankOnCard,
  kanbanCardLayout,
  kanbanCells,
  kanbanColumns,
  kanbanLaneField,
  kanbanLanes,
  type KanbanCardLayout,
  type KanbanLane,
} from '@/engine/table'
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

/** Largeur d'une carte quand les cartes d'une ligne sont posées côte à côte (celle d'une colonne simple). */
const CARD_WIDTH = '16.875rem'

type OpenRecord = (recordId: string) => void

/**
 * Colonne visée : celle sous le pointeur ; au clavier (Espace, flèches), sans pointeur, celle
 * que recouvre le plus la carte déplacée.
 */
const dropTarget: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args)

/**
 * Vue Kanban : une colonne par choix du champ Statut (puis « Sans statut »), une carte par
 * ligne de la vue (filtres, tri et recherche appliqués). Glisser une carte change son statut ;
 * un clic ouvre sa fiche. Avec des lignes (« Lignes par Date »), les cartes d'une même valeur
 * sont côte à côte, sur une même ligne dans toutes les colonnes.
 */
export function KanbanView({ table }: { table: Table }) {
  const view = activeView(table)
  const rows = useViewRows(table)
  const revision = useComputed((s) => s.revisions[table.id] ?? 0)
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
  const laneField = kanbanLaneField(table, view, groupField)
  const laneDirection = view?.sorts.find((s) => s.fieldId === laneField?.id)?.direction

  const card = useMemo(() => {
    void revision
    const sheet = getSheet(table.id)
    return kanbanCardLayout(
      table,
      visibleFieldIds(table),
      [groupField?.id, laneField?.id],
      (recordId, fieldId) => sheet?.value(recordId, fieldId) ?? null,
    )
  }, [table, revision, groupField?.id, laneField?.id])
  const lanes = useMemo(() => {
    void revision
    if (!laneField) return null
    const sheet = getSheet(table.id)
    const data = rows.filter((id) => table.records[id]?.kind === 'data')
    return kanbanLanes(
      laneField,
      data,
      (recordId, fieldId) => sheet?.value(recordId, fieldId) ?? null,
      laneDirection,
    )
  }, [table, rows, revision, laneField, laneDirection])

  if (!groupField || groupField.type !== 'select') {
    return <NoStatusField table={table} />
  }

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

  // Avec des lignes : une seule grille, dont chaque colonne reprend les rangées (subgrid), et un
  // seul défilement pour tout le tableau ; sinon chaque colonne empile et fait défiler ses cartes.
  const rowCount = lanes ? 2 + lanes.length * 2 : 0
  const LaneIcon = laneField ? FIELD_ICONS[laneField.type] : null

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={dropTarget}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)}
    >
      <div
        role="region"
        aria-label={`Kanban de ${table.name}`}
        data-lanes={lanes ? laneField?.id : undefined}
        className={cn(
          'min-h-0 flex-1 gap-x-3 p-3',
          lanes ? 'grid content-start justify-start overflow-auto' : 'flex overflow-x-auto',
        )}
        style={
          lanes
            ? {
                gridTemplateColumns: `repeat(${columns.length}, max-content)`,
                gridTemplateRows: `repeat(${rowCount}, max-content)`,
              }
            : undefined
        }
      >
        {columns.map((column, index) => {
          const choice = groupField.options?.choices?.find((c) => c.id === column.choiceId)
          return (
            <KanbanColumn
              key={column.choiceId ?? 'none'}
              table={table}
              groupField={groupField}
              choice={choice}
              recordIds={column.recordIds}
              card={card}
              lanes={lanes}
              index={index}
              total={total}
              dragging={dragging}
              onOpen={openRecord}
            />
          )
        })}
        {lanes?.map((lane, k) => (
          // Libellé de la ligne, posé une fois par-dessus les colonnes ; il reste à gauche quand
          // le tableau défile en largeur. Les cases portent le même nom pour les lecteurs d'écran.
          <div
            key={lane.key}
            aria-hidden
            data-lane-label
            style={{ gridColumn: '1 / -1', gridRow: 2 + k * 2 }}
            className="pointer-events-none flex h-7 items-center"
          >
            <span className="sticky left-3 flex items-center gap-1.5 pl-[13px] text-[12px] font-medium text-muted tabular-nums">
              {LaneIcon && <LaneIcon size={12} className="shrink-0 text-faint" />}
              {lane.label}
              <span className="font-normal text-faint">{lane.recordIds.length}</span>
            </span>
          </div>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <Card table={table} recordId={dragging} card={card} overlay onOpen={() => {}} />
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
  card,
  lanes,
  index,
  total,
  dragging,
  onOpen,
}: {
  table: Table
  groupField: Field
  choice: SelectChoice | undefined
  recordIds: string[]
  card: KanbanCardLayout
  /** Lignes du Kanban (cartes d'une même valeur côte à côte), ou `null` : cartes empilées. */
  lanes: KanbanLane[] | null
  index: number
  total: Field | undefined
  dragging: string | null
  onOpen: OpenRecord
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
  const laid = useMemo(() => (lanes ? kanbanCells(lanes, recordIds) : null), [lanes, recordIds])

  const header = (
    <header
      className={cn(
        'flex items-center gap-2 px-3 pt-3 pb-2',
        // Un seul défilement pour tout le tableau : l'en-tête de la colonne reste en haut, collé au
        // bord de la zone (-top-3 rattrape sa marge intérieure : rien ne passe au-dessus de lui).
        laid && 'sticky -top-3 z-10 rounded-t-xl bg-inherit',
      )}
    >
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
  )
  const draggable = (id: string) => (
    <DraggableCard
      key={id}
      table={table}
      recordId={id}
      card={card}
      hidden={dragging === id}
      onOpen={onOpen}
    />
  )
  const addCard = (
    <button
      type="button"
      onClick={() => {
        const id = addRowAndSelect(choice ? { [groupField.id]: choice.id } : {})
        if (id) onOpen(id)
      }}
      className={cn(
        'flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-muted hover:bg-surface-hover hover:text-accent-fg',
        laid && 'mx-2 mb-2',
      )}
    >
      <Plus size={14} /> Nouvelle carte
    </button>
  )
  const tone = isOver ? 'border-accent bg-accent-soft' : 'border-line bg-surface-sunken'

  if (laid && lanes) {
    return (
      <section
        ref={setNodeRef}
        aria-label={choice?.label ?? 'Sans statut'}
        style={
          {
            gridColumn: index + 1,
            gridRow: '1 / -1',
            '--kanban-across': laid.across,
          } as CSSProperties
        }
        className={cn('grid grid-rows-subgrid rounded-xl border transition-colors', tone)}
      >
        {header}
        {laid.cells.map((ids, k) => (
          <Fragment key={lanes[k]?.key ?? k}>
            {/* Place du libellé de la ligne (posé par-dessus les colonnes). */}
            <div aria-hidden className={cn('h-7', k > 0 && 'border-t border-line')} />
            <div
              role="group"
              aria-label={lanes[k]?.label}
              className="grid min-w-0 grid-cols-[repeat(var(--kanban-across),var(--kanban-card))] content-start gap-2 px-2 pb-2 max-sm:grid-cols-[var(--kanban-card)]"
              style={{ '--kanban-card': CARD_WIDTH } as CSSProperties}
            >
              {ids.map(draggable)}
            </div>
          </Fragment>
        ))}
        {addCard}
      </section>
    )
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={choice?.label ?? 'Sans statut'}
      className={cn('flex w-72 shrink-0 flex-col rounded-xl border transition-colors', tone)}
    >
      {header}
      <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {recordIds.map(draggable)}
        {addCard}
      </div>
    </section>
  )
}

function DraggableCard(props: {
  table: Table
  recordId: string
  card: KanbanCardLayout
  hidden: boolean
  onOpen: OpenRecord
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

/**
 * Carte : le titre et la pastille (première liste de choix) sur une même ligne, puis une grille
 * à deux colonnes fixes (icône, valeur) où chaque champ garde sa rangée même vide : la date et
 * les montants tombent au même endroit d'une carte à l'autre.
 */
const Card = memo(function Card({
  table,
  recordId,
  card,
  overlay,
  onOpen,
  nodeRef,
  dragProps,
  className,
}: {
  table: Table
  recordId: string
  card: KanbanCardLayout
  overlay?: boolean
  onOpen: OpenRecord
  /** Glisser-déposer (dnd-kit) : nœud et attributs posés sur la carte elle-même. */
  nodeRef?: (el: HTMLElement | null) => void
  dragProps?: Record<string, unknown>
  className?: string
}) {
  const { primary, badge, fields } = card
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
        'flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-lg border border-line bg-surface p-2.5 text-left hover:border-line-strong',
        overlay && 'rotate-1 border-line-strong shadow-glow-strong',
        className,
      )}
    >
      <div data-card-head className="flex min-w-0 items-start gap-2">
        <p
          title={titleText || undefined}
          className={cn(
            'line-clamp-2 min-w-0 flex-1 leading-5 font-medium break-words',
            titleText ? 'text-ink' : 'text-faint',
          )}
        >
          {titleText || 'Sans titre'}
        </p>
        {badge && <CardBadge table={table} recordId={recordId} field={badge} />}
      </div>
      {fields.length > 0 && (
        <div className="grid grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1 text-[12px]">
          {fields.map((field) => (
            <CardField key={field.id} table={table} recordId={recordId} field={field} />
          ))}
        </div>
      )}
    </div>
  )
})

/** Valeur calculée et stockée d'un champ de la carte. */
function useCardValue(table: Table, recordId: string, field: Field) {
  const value = useCellValue(table.id, recordId, field.id)
  const stored = useDataStore((s) => s.tables[table.id]?.records[recordId]?.cells[field.id] ?? null)
  const collaborators = useDataStore((s) => s.collaborators)
  return { value, stored, collaborators }
}

/** Pastille de la ligne du titre : abrégée si elle est longue, absente si la carte n'en a pas. */
function CardBadge({ table, recordId, field }: { table: Table; recordId: string; field: Field }) {
  const { value, stored, collaborators } = useCardValue(table, recordId, field)
  if (isBlankOnCard(field, value)) return null
  return (
    <span
      data-card-badge
      title={`${field.label} : ${formatValue(field, value)}`}
      className="flex h-5 max-w-[60%] min-w-0 shrink-0 items-center text-[12px] text-ink"
    >
      <CellContent
        field={field}
        value={value}
        stored={stored}
        collaborators={collaborators}
        plain={false}
      />
    </span>
  )
}

/** Rangée d'un champ : icône puis valeur, de hauteur constante ; « — » quand la cellule est vide. */
function CardField({ table, recordId, field }: { table: Table; recordId: string; field: Field }) {
  const { value, stored, collaborators } = useCardValue(table, recordId, field)
  const Icon = FIELD_ICONS[field.type]
  const blank = field.type !== 'checkbox' && isBlankOnCard(field, value)
  const text = blank ? 'vide' : field.type === 'checkbox' ? '' : formatValue(field, value)
  return (
    <>
      <Icon size={12} className="shrink-0 text-faint" aria-label={field.label} />
      <span
        data-card-field={field.id}
        title={text ? `${field.label} : ${text}` : field.label}
        className="flex h-5 min-w-0 items-center text-ink tabular-nums"
      >
        {blank ? (
          <span className="text-faint">—</span>
        ) : typeof value === 'number' ? (
          // Nombres alignés à droite dans une colonne de largeur fixe : les montants d'une
          // carte, et d'une carte à l'autre, s'alignent sur leurs décimales.
          <span className="min-w-28 truncate text-right">{formatValue(field, value)}</span>
        ) : (
          <CellContent
            field={field}
            value={value}
            stored={stored}
            collaborators={collaborators}
            plain={false}
            blankCheckbox
          />
        )}
      </span>
    </>
  )
}

function NoStatusField({ table }: { table: Table }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center text-muted">
        <Columns3 size={22} className="text-faint" />
        <p className="text-[15px] font-semibold text-ink">
          Le Kanban regroupe les lignes par statut
        </p>
        <p>Ajoutez une colonne Statut à cette table pour voir ses lignes en cartes.</p>
        <button
          type="button"
          className="atelier-btn-primary mt-2 h-[30px] rounded-lg px-3 font-medium"
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
