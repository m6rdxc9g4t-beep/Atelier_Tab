import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, CopyPlus, Plus, SquareFunction, Trash2, X } from 'lucide-react'
import { formatValue, parseUserInput, toEditText } from '@/engine/field-types'
import { isError, isFormula } from '@/engine/formula'
import { useCellValue, useDataStore, useUIStore } from '@/store'
import { deleteRows, duplicateRows, effectiveInputOf } from '@/store/grid-actions'
import { undoable } from '@/store/history'
import { activeView, useViewRows } from '@/store/view-rows'
import type { Field, Table } from '@/types/domain'
import { OwnerChip, StatusBadge } from '@/components/ui/Badge'
import { FIELD_ICONS } from '@/lib/field-icons'
import { cn } from '@/lib/cn'

/**
 * Fiche détaillée d'une ligne, comme l'enregistrement développé d'Airtable : tous les champs
 * en formulaire (y compris ceux masqués dans la vue), ligne précédente / suivante, dupliquer,
 * supprimer. Chaque modification est une étape annulable.
 */
export function RecordPanel({ table }: { table: Table }) {
  const recordId = useUIStore((s) => s.expandedRecordId)
  const openRecord = useUIStore((s) => s.openRecord)
  const rows = useViewRows(table)
  const record = recordId ? table.records[recordId] : undefined
  const panelRef = useRef<HTMLDivElement>(null)
  const index = recordId ? rows.indexOf(recordId) : -1
  const rowNumber = recordId ? table.rowOrder.indexOf(recordId) + 1 : 0
  const hidden = new Set(activeView(table)?.hiddenFieldIds ?? [])
  const fields = table.fieldOrder
    .map((id) => table.fields[id])
    .filter((f): f is Field => f !== undefined)
  const shown = fields.filter((f) => !hidden.has(f.id))
  const others = fields.filter((f) => hidden.has(f.id))
  const primary = fields[0]
  const title = useCellValue(table.id, recordId ?? '', primary?.id ?? '')

  const go = (delta: number) => {
    const next = rows[index + delta]
    if (next) openRecord(next)
  }

  useEffect(() => {
    if (!recordId) return
    const previous = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest('input, textarea, select')
      if (e.key === 'Escape' && !typing) {
        e.stopPropagation()
        openRecord(null)
      }
      if (!typing && (e.key === 'ArrowDown' || e.key === 'j')) go(1)
      if (!typing && (e.key === 'ArrowUp' || e.key === 'k')) go(-1)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.({ preventScroll: true })
    }
    // go dépend de rows et index : relu à chaque rendu via la fermeture ci-dessous.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, index, rows])

  if (!recordId || !record) return null

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/20 dark:bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) openRecord(null)
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Fiche de la ligne ${rowNumber}`}
        tabIndex={-1}
        className="flex h-full w-[min(560px,100vw)] flex-col border-l border-edge bg-surface-raised shadow-glow-strong outline-none"
      >
        <header className="flex items-center gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11.5px] text-muted">
              {table.name} · ligne {rowNumber}
              {record.kind === 'summary' && ' · ligne de total'}
            </p>
            <h2 className="truncate text-[16px] font-semibold text-ink">
              {primary && title !== null && title !== ''
                ? formatValue(primary, title)
                : 'Sans titre'}
            </h2>
          </div>
          <span className="text-[12px] text-faint tabular-nums">
            {index + 1} / {rows.length}
          </span>
          <button
            type="button"
            className="btn-icon"
            aria-label="Ligne précédente"
            title="Ligne précédente (↑)"
            disabled={index <= 0}
            onClick={() => go(-1)}
          >
            <ChevronUp size={16} />
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Ligne suivante"
            title="Ligne suivante (↓)"
            disabled={index < 0 || index >= rows.length - 1}
            onClick={() => go(1)}
          >
            <ChevronDown size={16} />
          </button>
          <button
            type="button"
            className="btn-icon"
            aria-label="Fermer la fiche"
            title="Fermer (Échap)"
            onClick={() => openRecord(null)}
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-4">
            {shown.map((field) => (
              <FieldRow
                key={`${recordId}:${field.id}`}
                table={table}
                recordId={recordId}
                field={field}
              />
            ))}
          </div>
          {others.length > 0 && (
            <details className="mt-6 rounded-lg border border-line px-3 py-2">
              <summary className="cursor-pointer text-[12px] font-medium text-muted select-none">
                {others.length} champ{others.length > 1 ? 's' : ''} masqué
                {others.length > 1 ? 's' : ''} dans cette vue
              </summary>
              <div className="mt-3 flex flex-col gap-4">
                {others.map((field) => (
                  <FieldRow
                    key={`${recordId}:${field.id}`}
                    table={table}
                    recordId={recordId}
                    field={field}
                  />
                ))}
              </div>
            </details>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          <button type="button" className="btn" onClick={() => duplicateRows([recordId])}>
            <CopyPlus size={14} /> Dupliquer
          </button>
          <button
            type="button"
            className="btn hover:text-danger"
            onClick={() => {
              const next = rows[index + 1] ?? rows[index - 1] ?? null
              deleteRows([recordId])
              openRecord(next)
            }}
          >
            <Trash2 size={14} /> Supprimer
          </button>
          <span className="ml-auto text-[11.5px] text-faint">
            ↑ ↓ pour changer de ligne · Échap pour fermer
          </span>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------

function FieldRow({ table, recordId, field }: { table: Table; recordId: string; field: Field }) {
  const Icon = FIELD_ICONS[field.type]
  const stored = useDataStore((s) => s.tables[table.id]?.records[recordId]?.cells[field.id] ?? null)
  const value = useCellValue(table.id, recordId, field.id)
  const [error, setError] = useState<string | null>(null)
  const computed = field.type === 'formula' || isFormula(stored)

  /** Enregistre un texte tapé comme dans la grille ; renvoie faux s'il est refusé. */
  const write = (text: string): boolean => {
    const ctx = { collaborators: useDataStore.getState().collaborators }
    const parsed = parseUserInput(field, text, ctx)
    if (!parsed.ok) {
      setError(parsed.reason)
      return false
    }
    setError(null)
    if (parsed.input === stored) return true
    useUIStore.getState().pin([recordId])
    undoable(`Modifier ${field.label}`, table.id, () =>
      useDataStore.getState().setCell(table.id, recordId, field.id, parsed.input),
    )
    return true
  }

  let editor: ReactNode
  if (computed) {
    editor = <ComputedValue table={table} recordId={recordId} field={field} write={write} />
  } else if (field.type === 'select' || field.type === 'owner') {
    editor = <ChoicePicker table={table} recordId={recordId} field={field} stored={stored} />
  } else if (field.type === 'checkbox') {
    editor = (
      <button
        type="button"
        role="checkbox"
        aria-checked={stored === true}
        aria-label={field.label}
        onClick={() => write(stored === true ? 'non' : 'oui')}
        className={cn(
          'inline-grid size-5 place-items-center rounded border',
          stored === true
            ? 'border-accent bg-accent text-accent-ink'
            : 'border-line-strong bg-field',
        )}
      >
        {stored === true && '✓'}
      </button>
    )
  } else if (field.type === 'date') {
    editor = (
      <input
        type="date"
        aria-label={field.label}
        value={typeof stored === 'string' ? stored : ''}
        onChange={(e) => write(e.target.value ? e.target.value.split('-').reverse().join('/') : '')}
        className="field-input w-48"
      />
    )
  } else {
    const initial = toEditText(field, stored, {
      collaborators: useDataStore.getState().collaborators,
    })
    editor = (
      <TextEditor
        key={initial}
        field={field}
        initial={initial}
        multiline={field.type === 'text'}
        onCommit={write}
      />
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
        <Icon size={12} aria-hidden />
        {field.label}
        {value !== null && isError(value) && (
          <span className="text-danger" title={value.message}>
            {value.code}
          </span>
        )}
      </span>
      {editor}
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function TextEditor({
  field,
  initial,
  multiline,
  onCommit,
}: {
  field: Field
  initial: string
  multiline: boolean
  onCommit: (text: string) => boolean
}) {
  // Une nouvelle valeur (annuler, autre ligne) remonte le composant : voir `key` chez l'appelant.
  const [draft, setDraft] = useState(initial)
  const commit = () => {
    if (draft !== initial && !onCommit(draft)) return
  }
  const common = {
    value: draft,
    'aria-label': field.label,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  }
  return multiline ? (
    <textarea
      {...common}
      rows={Math.min(8, Math.max(2, draft.split('\n').length))}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setDraft(initial)
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur()
      }}
      className="field-input h-auto resize-y py-1.5 leading-5"
    />
  ) : (
    <input
      {...common}
      inputMode={field.type === 'text' ? 'text' : 'decimal'}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') setDraft(initial)
      }}
      className={cn('field-input', field.type !== 'text' && 'w-48 text-right tabular-nums')}
    />
  )
}

/** Valeur calculée (colonne-formule ou formule de cellule), avec la formule en dessous. */
function ComputedValue({
  table,
  recordId,
  field,
  write,
}: {
  table: Table
  recordId: string
  field: Field
  write: (text: string) => boolean
}) {
  const value = useCellValue(table.id, recordId, field.id)
  const stored = useDataStore((s) => s.tables[table.id]?.records[recordId]?.cells[field.id] ?? null)
  const collaborators = useDataStore((s) => s.collaborators)
  const formula = effectiveInputOf(table.id, { recordId, fieldId: field.id })
  const [editing, setEditing] = useState(false)
  const text = useMemo(
    () => toEditText(field, stored ?? formula, { collaborators }),
    [field, stored, formula, collaborators],
  )
  if (editing) {
    return (
      <TextEditor
        field={field}
        initial={text}
        multiline={false}
        onCommit={(t) => {
          const ok = write(t)
          if (ok) setEditing(false)
          return ok
        }}
      />
    )
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium text-ink tabular-nums">
        {value === null || value === '' ? (
          <span className="text-faint">—</span>
        ) : (
          formatValue(field, value)
        )}
      </span>
      {isFormula(formula) && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex w-fit items-center gap-1 font-mono text-[11.5px] text-muted hover:text-accent-fg"
          title="Modifier la formule de cette cellule"
        >
          <SquareFunction size={11} /> {formula}
        </button>
      )}
    </div>
  )
}

/** Choix d'un statut ou d'un responsable : badges cliquables. */
function ChoicePicker({
  table,
  recordId,
  field,
  stored,
}: {
  table: Table
  recordId: string
  field: Field
  stored: unknown
}) {
  const collaborators = useDataStore((s) => s.collaborators)
  const [adding, setAdding] = useState(false)
  const set = (value: string | null, label: string) =>
    undoable(`${field.label} : ${label}`, table.id, () => {
      useUIStore.getState().pin([recordId])
      useDataStore.getState().setCell(table.id, recordId, field.id, value)
    })
  const add = (label: string) => {
    const clean = label.trim()
    if (!clean) return setAdding(false)
    undoable(`Ajouter « ${clean} »`, table.id, () => {
      const data = useDataStore.getState()
      const id =
        field.type === 'select'
          ? data.addChoice(table.id, field.id, clean)
          : data.addCollaborator(clean)
      if (id) data.setCell(table.id, recordId, field.id, id)
    })
    setAdding(false)
  }
  const items =
    field.type === 'select'
      ? (field.options?.choices ?? []).map((c) => ({
          id: c.id,
          label: c.label,
          node: <StatusBadge label={c.label} color={c.color} />,
        }))
      : Object.values(collaborators).map((c) => ({
          id: c.id,
          label: c.name,
          node: <OwnerChip person={c} />,
        }))

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={field.label}>
      {items.map((item) => {
        const checked = stored === item.id
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={() => set(checked ? null : item.id, checked ? 'vide' : item.label)}
            className={cn(
              'rounded-full p-0.5 ring-1',
              checked ? 'ring-accent' : 'opacity-60 ring-transparent hover:opacity-100',
            )}
          >
            {item.node}
          </button>
        )
      })}
      {adding ? (
        <input
          autoFocus
          placeholder={field.type === 'select' ? 'Nouveau choix' : 'Nom'}
          onBlur={(e) => add(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add(e.currentTarget.value)
            if (e.key === 'Escape') setAdding(false)
          }}
          className="field-input h-7 w-36"
        />
      ) : (
        <button type="button" className="btn-ghost h-6 text-[12px]" onClick={() => setAdding(true)}>
          <Plus size={12} /> Ajouter
        </button>
      )}
    </div>
  )
}
