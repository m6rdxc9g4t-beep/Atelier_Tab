import { useState, type ReactNode } from 'react'
import { ArrowDownUp, Eye, EyeOff, ListFilter, Plus, Trash2, X } from 'lucide-react'
import { parseUserInput, toEditText } from '@/engine/field-types'
import { columnToLetters } from '@/engine/formula'
import { operatorNeedsValue, operatorsFor } from '@/engine/table'
import { useDataStore } from '@/store'
import { activeView } from '@/store/view-rows'
import {
  addFilter,
  clearFilters,
  removeFilter,
  setAllFieldsHidden,
  setFieldHidden,
  setSorts,
  updateFilter,
} from '@/store/view-actions'
import type { Field, Filter, FilterOperator, Sort, Table } from '@/types/domain'
import { FIELD_ICONS } from '@/lib/field-icons'
import { cn } from '@/lib/cn'

// ---------------------------------------------------------------------------
// Champs masqués
// ---------------------------------------------------------------------------

export function FieldsMenu({ table }: { table: Table }) {
  const [query, setQuery] = useState('')
  const hidden = new Set(activeView(table)?.hiddenFieldIds ?? [])
  const fields = table.fieldOrder
    .map((id) => table.fields[id])
    .filter((f): f is Field => f !== undefined)
  const q = query.trim().toLocaleLowerCase('fr')
  const shown = q ? fields.filter((f) => f.label.toLocaleLowerCase('fr').includes(q)) : fields

  return (
    <div className="w-72">
      <div className="p-1">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Chercher un champ"
          aria-label="Chercher un champ"
          className="field-input h-7"
        />
      </div>
      <ul className="max-h-80 overflow-y-auto py-1">
        {shown.map((field) => {
          const Icon = FIELD_ICONS[field.type]
          const primary = field.id === table.fieldOrder[0]
          const visible = !hidden.has(field.id)
          return (
            <li key={field.id}>
              <label
                className={cn(
                  'flex h-8 items-center gap-2 rounded-md px-2 hover:bg-surface-hover',
                  primary ? 'cursor-default opacity-60' : 'cursor-pointer',
                )}
                title={primary ? 'La première colonne reste toujours visible' : undefined}
              >
                <Switch
                  checked={visible}
                  disabled={primary}
                  onChange={(v) => setFieldHidden(table.id, field.id, !v)}
                  label={`Afficher ${field.label}`}
                />
                <Icon size={13} className="shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-ink">{field.label}</span>
                <span className="text-[11px] text-faint tabular-nums">
                  {columnToLetters(table.fieldOrder.indexOf(field.id))}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      <div className="flex gap-1 border-t border-line p-1">
        <button
          type="button"
          className="btn-ghost flex-1 justify-center"
          onClick={() => setAllFieldsHidden(table.id, true)}
        >
          <EyeOff size={13} /> Tout masquer
        </button>
        <button
          type="button"
          className="btn-ghost flex-1 justify-center"
          onClick={() => setAllFieldsHidden(table.id, false)}
        >
          <Eye size={13} /> Tout afficher
        </button>
      </div>
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault()
        onChange(!checked)
      }}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors',
        checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-sunken',
      )}
    >
      <span
        className={cn(
          'absolute size-3 rounded-full bg-surface shadow-sm transition-transform',
          checked ? 'translate-x-3' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------

/** Libellé d'un opérateur, adapté au type de colonne. */
export function operatorLabel(field: Field, op: FilterOperator): string {
  const dated = field.type === 'date' || field.options?.resultFormat === 'date'
  switch (op) {
    case 'contains':
      return 'contient'
    case 'equals':
      return 'est'
    case 'not_equals':
      return 'n’est pas'
    case 'gt':
      return dated ? 'après' : 'supérieur à'
    case 'lt':
      return dated ? 'avant' : 'inférieur à'
    case 'is_empty':
      return 'est vide'
    case 'is_not_empty':
      return 'n’est pas vide'
  }
}

export function FilterMenu({ table }: { table: Table }) {
  const filters = activeView(table)?.filters ?? []
  const fields = table.fieldOrder
    .map((id) => table.fields[id])
    .filter((f): f is Field => f !== undefined)

  return (
    <div className="w-[min(560px,calc(100vw-2rem))] p-2">
      {filters.length === 0 ? (
        <p className="px-1 pb-2 text-muted">
          Aucun filtre : toutes les lignes sont affichées. Les filtres sont enregistrés avec la vue.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 pb-2">
          {filters.map((filter, i) => (
            <FilterRow
              key={filter.id}
              table={table}
              filter={filter}
              fields={fields}
              first={i === 0}
            />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-ghost text-accent-fg"
          onClick={() => addFilter(table.id)}
        >
          <Plus size={14} /> Ajouter un filtre
        </button>
        {filters.length > 0 && (
          <button
            type="button"
            className="btn-ghost ml-auto"
            onClick={() => clearFilters(table.id)}
          >
            Tout effacer
          </button>
        )}
      </div>
    </div>
  )
}

function FilterRow({
  table,
  filter,
  fields,
  first,
}: {
  table: Table
  filter: Filter
  fields: Field[]
  first: boolean
}) {
  const field = table.fields[filter.fieldId]
  if (!field) return null
  return (
    <li className="flex items-center gap-1.5">
      <span className="w-9 shrink-0 text-right text-[12px] text-muted">{first ? 'Où' : 'et'}</span>
      <select
        aria-label="Champ du filtre"
        value={filter.fieldId}
        onChange={(e) => updateFilter(table.id, filter.id, { fieldId: e.target.value })}
        className="field-input h-7 w-36 shrink-0"
      >
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Condition"
        value={filter.operator}
        onChange={(e) =>
          updateFilter(table.id, filter.id, { operator: e.target.value as FilterOperator })
        }
        className="field-input h-7 w-32 shrink-0"
      >
        {operatorsFor(field).map((op) => (
          <option key={op} value={op}>
            {operatorLabel(field, op)}
          </option>
        ))}
      </select>
      <div className="min-w-0 flex-1">
        {operatorNeedsValue(filter.operator) && (
          <FilterValue table={table} field={field} filter={filter} />
        )}
      </div>
      <button
        type="button"
        className="btn-icon"
        aria-label="Retirer le filtre"
        title="Retirer le filtre"
        onClick={() => removeFilter(table.id, filter.id)}
      >
        <Trash2 size={13} />
      </button>
    </li>
  )
}

/** Type de saisie d'une valeur de filtre : celui de la colonne (ou du résultat d'une formule). */
function valueField(field: Field): Field {
  if (field.type !== 'formula') return field
  const format = field.options?.resultFormat ?? 'number'
  return { ...field, type: format === 'text' ? 'text' : format === 'date' ? 'date' : format }
}

function FilterValue({ table, field, filter }: { table: Table; field: Field; filter: Filter }) {
  const collaborators = useDataStore((s) => s.collaborators)
  const target = valueField(field)
  const set = (value: Filter['value']) => updateFilter(table.id, filter.id, { value })

  if (target.type === 'checkbox') {
    return (
      <select
        aria-label="Valeur du filtre"
        value={filter.value === false ? 'false' : 'true'}
        onChange={(e) => set(e.target.value === 'true')}
        className="field-input h-7"
      >
        <option value="true">coché</option>
        <option value="false">non coché</option>
      </select>
    )
  }
  if (target.type === 'select' || target.type === 'owner') {
    const options =
      target.type === 'select'
        ? (target.options?.choices ?? []).map((c) => ({ id: c.id, label: c.label }))
        : Object.values(collaborators).map((c) => ({ id: c.id, label: c.name }))
    return (
      <select
        aria-label="Valeur du filtre"
        value={typeof filter.value === 'string' ? filter.value : ''}
        onChange={(e) => set(e.target.value || undefined)}
        className="field-input h-7"
      >
        <option value="">Choisir…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    )
  }
  if (target.type === 'date') {
    return (
      <input
        type="date"
        aria-label="Valeur du filtre"
        value={typeof filter.value === 'string' ? filter.value : ''}
        onChange={(e) => set(e.target.value || undefined)}
        className="field-input h-7"
      />
    )
  }
  return <TextFilterValue field={target} filter={filter} onChange={set} />
}

function TextFilterValue({
  field,
  filter,
  onChange,
}: {
  field: Field
  filter: Filter
  onChange: (value: Filter['value']) => void
}) {
  const ctx = { collaborators: useDataStore.getState().collaborators }
  const initial =
    typeof filter.value === 'number'
      ? toEditText(field, filter.value, ctx)
      : String(filter.value ?? '')
  const [draft, setDraft] = useState(initial)
  const numeric = field.type === 'number' || field.type === 'currency' || field.type === 'percent'
  return (
    <input
      aria-label="Valeur du filtre"
      value={draft}
      placeholder={numeric ? 'Nombre' : 'Texte'}
      onChange={(e) => {
        const text = e.target.value
        setDraft(text)
        if (!numeric) return onChange(text)
        const parsed = parseUserInput(field, text, ctx)
        onChange(parsed.ok && typeof parsed.input === 'number' ? parsed.input : text)
      }}
      className="field-input h-7"
    />
  )
}

// ---------------------------------------------------------------------------
// Tri
// ---------------------------------------------------------------------------

function directionLabels(field: Field): [string, string] {
  const type = valueField(field).type
  if (type === 'number' || type === 'currency' || type === 'percent') return ['1 → 9', '9 → 1']
  if (type === 'date') return ['Ancien → récent', 'Récent → ancien']
  if (type === 'select') return ['Ordre des choix', 'Ordre inverse']
  if (type === 'checkbox') return ['Non coché d’abord', 'Coché d’abord']
  return ['A → Z', 'Z → A']
}

export function SortMenu({ table }: { table: Table }) {
  const sorts = activeView(table)?.sorts ?? []
  const fields = table.fieldOrder
    .map((id) => table.fields[id])
    .filter((f): f is Field => f !== undefined)
  const unused = fields.filter((f) => !sorts.some((s) => s.fieldId === f.id))
  const next = unused[0]
  const update = (index: number, patch: Partial<Sort>) =>
    setSorts(
      table.id,
      sorts.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    )

  return (
    <div className="w-[min(440px,calc(100vw-2rem))] p-2">
      {sorts.length === 0 ? (
        <p className="px-1 pb-2 text-muted">
          L’ordre des lignes de la table est conservé : le tri ne change que l’affichage, les
          formules restent intactes.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5 pb-2">
          {sorts.map((sort, i) => {
            const field = table.fields[sort.fieldId]
            if (!field) return null
            const [asc, desc] = directionLabels(field)
            return (
              <li key={sort.fieldId} className="flex items-center gap-1.5">
                <span className="w-12 shrink-0 text-right text-[12px] text-muted">
                  {i === 0 ? 'Trier' : 'puis'}
                </span>
                <select
                  aria-label="Champ du tri"
                  value={sort.fieldId}
                  onChange={(e) => update(i, { fieldId: e.target.value })}
                  className="field-input h-7 min-w-0 flex-1"
                >
                  {[field, ...unused].map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Sens du tri"
                  value={sort.direction}
                  onChange={(e) => update(i, { direction: e.target.value as Sort['direction'] })}
                  className="field-input h-7 w-36 shrink-0"
                >
                  <option value="asc">{asc}</option>
                  <option value="desc">{desc}</option>
                </select>
                <button
                  type="button"
                  className="btn-icon"
                  aria-label="Retirer le tri"
                  title="Retirer le tri"
                  onClick={() =>
                    setSorts(
                      table.id,
                      sorts.filter((_, j) => j !== i),
                    )
                  }
                >
                  <X size={13} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {next && (
        <button
          type="button"
          className="btn-ghost text-accent-fg"
          onClick={() => setSorts(table.id, [...sorts, { fieldId: next.id, direction: 'asc' }])}
        >
          <Plus size={14} /> Ajouter un tri
        </button>
      )}
    </div>
  )
}

/** Bouton d'outil de la barre de vue : actif (teinté) quand un réglage est appliqué. */
export function ToolButton({
  tool,
  icon,
  label,
  count,
  active,
  onClick,
  expanded,
}: {
  /** Identifiant de l'outil (`data-tool`), pour l'ouvrir depuis la palette de commandes. */
  tool: string
  icon: ReactNode
  label: string
  count?: number
  active?: boolean
  onClick: (el: HTMLButtonElement) => void
  expanded?: boolean
}) {
  return (
    <button
      type="button"
      data-tool={tool}
      onClick={(e) => onClick(e.currentTarget)}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      title={label}
      className={cn('btn-ghost', active && 'btn-active')}
    >
      {icon}
      <span className="@max-[52rem]:sr-only">
        {label}
        {count ? ` (${count})` : ''}
      </span>
    </button>
  )
}

export const TOOL_ICONS = { fields: EyeOff, filter: ListFilter, sort: ArrowDownUp }
