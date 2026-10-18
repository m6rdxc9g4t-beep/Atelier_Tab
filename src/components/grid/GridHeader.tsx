import { useState } from 'react'
import { ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { FIELD_TYPE_LIST } from '@/engine/field-types'
import { columnToLetters } from '@/engine/formula'
import { useDataStore } from '@/store'
import type { Field, FieldType, Table } from '@/types/domain'
import { MenuItem, Popover } from '@/components/ui/Popover'
import { FIELD_ICONS, fieldWidth } from '@/lib/field-icons'
import { cn } from '@/lib/cn'

export const GUTTER_WIDTH = 52
export const ADD_COLUMN_WIDTH = 44

interface GridHeaderProps {
  table: Table
  fieldIds: string[]
  plain: boolean
  selectedFieldId: string | undefined
}

export function GridHeader({ table, fieldIds, plain, selectedFieldId }: GridHeaderProps) {
  return (
    <div role="row" className="sticky top-0 z-20 flex h-9 border-b border-line bg-surface-sunken">
      <div
        className="sticky left-0 z-10 shrink-0 border-r border-line bg-surface-sunken"
        style={{ width: GUTTER_WIDTH }}
      />
      {fieldIds.map((fieldId) => {
        const field = table.fields[fieldId]
        if (!field) return null
        return (
          <ColumnHeader
            key={fieldId}
            table={table}
            field={field}
            letter={columnToLetters(table.fieldOrder.indexOf(fieldId))}
            plain={plain}
            active={selectedFieldId === fieldId}
          />
        )
      })}
      <AddColumnButton tableId={table.id} />
    </div>
  )
}

function ColumnHeader({
  table,
  field,
  letter,
  plain,
  active,
}: {
  table: Table
  field: Field
  letter: string
  plain: boolean
  active: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const updateField = useDataStore((s) => s.updateField)
  const deleteField = useDataStore((s) => s.deleteField)
  const Icon = FIELD_ICONS[field.type]

  const rename = (label: string) => {
    const clean = label.trim()
    if (clean && clean !== field.label) updateField(table.id, field.id, { label: clean })
    setRenaming(false)
  }

  return (
    <div
      role="columnheader"
      className={cn(
        'group relative flex shrink-0 items-center gap-1.5 border-r border-line px-2 text-muted',
        active && 'bg-accent-soft text-ink',
      )}
      style={{ width: fieldWidth(field) }}
      title={plain ? field.label : undefined}
    >
      <span
        className={cn(
          'w-5 shrink-0 text-center text-[11px] font-semibold tabular-nums',
          active ? 'text-accent' : 'text-faint',
          plain && 'w-full',
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
              onBlur={(e) => rename(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') rename(e.currentTarget.value)
                if (e.key === 'Escape') setRenaming(false)
              }}
              className="min-w-0 flex-1 rounded border border-accent bg-surface px-1 text-ink outline-none"
            />
          ) : (
            <span
              className="min-w-0 flex-1 truncate font-medium text-ink"
              onDoubleClick={() => setRenaming(true)}
            >
              {field.label}
            </span>
          )}
          <button
            type="button"
            aria-label={`Options de la colonne ${field.label}`}
            onClick={() => setMenuOpen((o) => !o)}
            className="absolute right-1 rounded bg-surface-sunken p-0.5 opacity-0 group-hover:opacity-100 hover:bg-surface-hover focus-visible:opacity-100"
          >
            <ChevronDown size={13} />
          </button>
          <Popover open={menuOpen} onClose={() => setMenuOpen(false)} align="end">
            <MenuItem
              icon={<Pencil size={13} />}
              onSelect={() => {
                setMenuOpen(false)
                setRenaming(true)
              }}
            >
              Renommer
            </MenuItem>
            <MenuItem
              danger
              icon={<Trash2 size={13} />}
              onSelect={() => {
                setMenuOpen(false)
                deleteField(table.id, field.id)
              }}
            >
              Supprimer la colonne
            </MenuItem>
          </Popover>
        </>
      )}
    </div>
  )
}

const DEFAULT_LABELS: Record<FieldType, string> = {
  text: 'Texte',
  number: 'Nombre',
  currency: 'Montant',
  percent: 'Taux',
  select: 'Statut',
  date: 'Date',
  checkbox: 'Fait',
  owner: 'Responsable',
  formula: 'Calcul',
}

function AddColumnButton({ tableId }: { tableId: string }) {
  const [open, setOpen] = useState(false)
  const addField = useDataStore((s) => s.addField)

  const add = (type: FieldType) => {
    setOpen(false)
    const table = useDataStore.getState().tables[tableId]
    const taken = new Set(Object.values(table?.fields ?? {}).map((f) => f.label))
    let label = DEFAULT_LABELS[type]
    for (let n = 2; taken.has(label); n++) label = `${DEFAULT_LABELS[type]} ${n}`
    addField(tableId, {
      label,
      type,
      ...(type === 'select'
        ? {
            options: {
              choices: [
                { id: 'opt_todo', label: 'À faire', color: 'gray' as const },
                { id: 'opt_doing', label: 'En cours', color: 'blue' as const },
                { id: 'opt_done', label: 'Validé', color: 'green' as const },
              ],
            },
          }
        : {}),
      ...(type === 'formula'
        ? { columnFormula: '=0', options: { resultFormat: 'number' as const } }
        : {}),
    })
  }

  return (
    <div className="relative shrink-0" style={{ width: ADD_COLUMN_WIDTH }}>
      <button
        type="button"
        aria-label="Ajouter une colonne"
        title="Ajouter une colonne"
        onClick={() => setOpen((o) => !o)}
        className="grid size-full place-items-center text-muted hover:bg-surface-hover hover:text-ink"
      >
        <Plus size={15} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} align="end" className="min-w-52">
        <p className="px-2 pt-1 pb-1.5 text-[12px] text-muted">Type de la nouvelle colonne</p>
        {FIELD_TYPE_LIST.map((spec) => {
          const Icon = FIELD_ICONS[spec.type]
          return (
            <MenuItem key={spec.type} icon={<Icon size={13} />} onSelect={() => add(spec.type)}>
              {spec.label}
            </MenuItem>
          )
        })}
      </Popover>
    </div>
  )
}
