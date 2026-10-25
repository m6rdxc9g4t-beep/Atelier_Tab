import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ListChecks, Plus, Trash2 } from 'lucide-react'
import {
  ATELIER_STATUS_PRESET_NAME,
  CHOICE_COLORS,
  FIELD_TYPE_LIST,
  formatValue,
  mergeAtelierStatuses,
} from '@/engine/field-types'
import { columnToLetters, isError } from '@/engine/formula'
import { getSheet, useDataStore } from '@/store'
import { DEFAULT_STATUS_CHOICES } from '@/store/factories'
import {
  checkColumnFormula,
  createField,
  freeLabel,
  saveField,
  type FieldDraft,
} from '@/store/field-actions'
import type {
  AtelierMapping,
  BadgeColor,
  CurrencyCode,
  Field,
  FieldOptions,
  FieldType,
  SelectChoice,
} from '@/types/domain'
import { Floating, type FloatingAnchor } from '@/components/ui/Floating'
import { StatusBadge } from '@/components/ui/Badge'
import { MAPPING_LABELS } from '@/components/dataflow/labels'
import { useFormulaAssist } from '@/components/formula/FormulaAssist'
import { FIELD_ICONS } from '@/lib/field-icons'
import { newId } from '@/lib/ids'
import { cn } from '@/lib/cn'

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

const TYPE_HINTS: Record<FieldType, string> = {
  text: 'Texte libre, sur une ou plusieurs lignes.',
  number: 'Nombre saisi à la française (45 000,5) ou à l’anglaise.',
  currency: 'Montant dans la devise choisie, aligné à droite et totalisé.',
  percent: 'Tapez 20 pour 20 % ; la valeur stockée est la fraction 0,2.',
  select: 'Liste de choix colorés (badges) ; sert aussi de colonnes au Kanban.',
  date: 'Date JJ/MM/AAAA, utilisable dans les formules (AUJOURDHUI, DATEDIF…).',
  checkbox: 'Case à cocher : Espace pour cocher, filtres « coché / non coché ».',
  owner: 'Membre de l’équipe, affiché avec son avatar.',
  formula:
    'Formule écrite pour la ligne 1 et recopiée sur chaque ligne, comme une poignée de recopie.',
}

const CURRENCIES: CurrencyCode[] = ['EUR', 'USD', 'GBP', 'CHF']
const DECIMALS = [undefined, 0, 1, 2, 3, 4] as const

interface FieldEditorProps {
  tableId: string
  /** Colonne modifiée ; absente : création d'une colonne (à l'index `index`). */
  fieldId?: string
  index?: number
  anchor: FloatingAnchor | null
  onClose: () => void
}

/**
 * Éditeur de champ, comme dans Airtable : nom, type (les valeurs sont converties), options
 * propres au type (choix colorés, devise, décimales, formule de colonne avec aide), rôle pour
 * Atelier Projets. Une seule étape annulable.
 */
export function FieldEditor({ tableId, fieldId, index, anchor, onClose }: FieldEditorProps) {
  const table = useDataStore((s) => s.tables[tableId])
  const field = fieldId ? table?.fields[fieldId] : undefined
  const creating = !field
  const [label, setLabel] = useState(field?.label ?? freeLabel(tableId, 'Texte'))
  const [labelTouched, setLabelTouched] = useState(!creating)
  const [type, setType] = useState<FieldType>(field?.type ?? 'text')
  const [options, setOptions] = useState<FieldOptions>(structuredClone(field?.options ?? {}))
  const [formula, setFormula] = useState(field?.columnFormula ?? '=')
  const [mapping, setMapping] = useState<AtelierMapping | undefined>(field?.atelierMapping)
  const [error, setError] = useState<string | null>(null)
  if (!table) return null

  const changeType = (next: FieldType) => {
    setType(next)
    setError(null)
    if (!labelTouched) setLabel(freeLabel(tableId, DEFAULT_LABELS[next]))
    if (next === 'select' && !options.choices?.length) {
      setOptions((o) => ({ ...o, choices: DEFAULT_STATUS_CHOICES.map((c) => ({ ...c })) }))
    }
    if (next === 'currency' && !options.currency) setOptions((o) => ({ ...o, currency: 'EUR' }))
    if (next === 'formula' && !options.resultFormat) {
      setOptions((o) => ({
        ...o,
        resultFormat:
          field?.type === 'currency' || field?.type === 'percent' ? field.type : 'number',
      }))
    }
  }

  const save = () => {
    const name = label.trim()
    if (!name) return setError('Donnez un nom à la colonne')
    let columnFormula: string | undefined
    if (type === 'formula') {
      const checked = checkColumnFormula(formula)
      if (!checked.ok) return setError(`Formule : ${checked.reason}`)
      columnFormula = checked.formula
    }
    const keep: FieldOptions = {}
    if (type === 'select') keep.choices = (options.choices ?? []).filter((c) => c.label.trim())
    if (type === 'currency') keep.currency = options.currency ?? 'EUR'
    if (
      ['number', 'currency', 'percent', 'formula'].includes(type) &&
      options.decimals !== undefined
    ) {
      keep.decimals = options.decimals
    }
    if (type === 'formula') keep.resultFormat = options.resultFormat ?? 'number'
    if (type === 'formula' && keep.resultFormat === 'currency')
      keep.currency = options.currency ?? 'EUR'
    const draft: FieldDraft = {
      label: name,
      type,
      options: keep,
      ...(columnFormula ? { columnFormula } : {}),
      atelierMapping: mapping,
    }
    if (creating) createField(tableId, draft, index)
    else if (fieldId) saveField(tableId, fieldId, draft)
    onClose()
  }

  return (
    <Floating
      open
      anchor={anchor}
      onClose={onClose}
      role="dialog"
      label={creating ? 'Nouvelle colonne' : `Modifier la colonne ${field?.label ?? ''}`}
      className="w-[min(380px,calc(100vw-1rem))] p-0"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="flex max-h-[min(640px,calc(100dvh-2rem))] flex-col"
      >
        <div className="flex flex-col gap-3 overflow-y-auto p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted">Nom</span>
            <input
              autoFocus
              value={label}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => {
                setLabel(e.target.value)
                setLabelTouched(true)
                setError(null)
              }}
              className="field-input"
              aria-label="Nom de la colonne"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-muted">Type</span>
            <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Type de colonne">
              {FIELD_TYPE_LIST.map((spec) => {
                const Icon = FIELD_ICONS[spec.type]
                const checked = type === spec.type
                return (
                  <button
                    key={spec.type}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    onClick={() => changeType(spec.type)}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-md border px-2 text-left text-[12.5px]',
                      checked
                        ? 'border-accent bg-accent-soft font-medium text-ink'
                        : 'border-line text-muted hover:bg-surface-hover hover:text-ink',
                    )}
                  >
                    <Icon size={13} className={cn('shrink-0', checked && 'text-accent-fg')} />
                    <span className="truncate">{spec.label}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[12px] text-muted">{TYPE_HINTS[type]}</p>
            {!creating && field && field.type !== type && (
              <p className="rounded-md bg-surface-sunken px-2 py-1.5 text-[12px] text-muted">
                Les valeurs existantes seront converties ; celles qui ne s’y prêtent pas sont
                gardées telles quelles.{' '}
                {field.type === 'formula' && 'Les résultats de la formule sont figés. '}
                Annulable avec ⌘Z.
              </p>
            )}
          </div>

          {type === 'select' && (
            <ChoicesEditor
              choices={options.choices ?? []}
              onChange={(choices) => setOptions((o) => ({ ...o, choices }))}
            />
          )}
          {type === 'currency' && (
            <label className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-muted">Devise</span>
              <select
                value={options.currency ?? 'EUR'}
                onChange={(e) =>
                  setOptions((o) => ({ ...o, currency: e.target.value as CurrencyCode }))
                }
                className="field-input h-7 w-32"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          {type === 'formula' && (
            <FormulaOptions
              tableId={tableId}
              fieldId={fieldId}
              formula={formula}
              onFormula={(f) => {
                setFormula(f)
                setError(null)
              }}
              options={options}
              onOptions={setOptions}
            />
          )}
          {['number', 'currency', 'percent', 'formula'].includes(type) && (
            <label className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-muted">Décimales</span>
              <select
                value={options.decimals === undefined ? 'auto' : String(options.decimals)}
                onChange={(e) =>
                  setOptions((o) => {
                    const next = { ...o }
                    if (e.target.value === 'auto') delete next.decimals
                    else next.decimals = Number(e.target.value)
                    return next
                  })
                }
                className="field-input h-7 w-32"
              >
                {DECIMALS.map((d) => (
                  <option key={String(d)} value={d === undefined ? 'auto' : String(d)}>
                    {d === undefined ? 'Automatique' : d === 0 ? 'Aucune' : `${d}`}
                  </option>
                ))}
              </select>
            </label>
          )}

          <details className="group rounded-md border border-line px-2 py-1.5">
            <summary className="cursor-pointer text-[12px] font-medium text-muted select-none">
              Export vers Atelier Projets
            </summary>
            <label className="mt-2 flex flex-col gap-1">
              <span className="text-[12px] text-muted">Rôle de la colonne</span>
              <select
                value={mapping ?? ''}
                onChange={(e) =>
                  setMapping((e.target.value || undefined) as AtelierMapping | undefined)
                }
                className="field-input h-7"
              >
                <option value="">Automatique (selon le type)</option>
                {(Object.keys(MAPPING_LABELS) as AtelierMapping[]).map((m) => (
                  <option key={m} value={m}>
                    {MAPPING_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          </details>

          {error && (
            <p role="alert" className="text-[12px] text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-3 py-2">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="atelier-btn-primary h-8 rounded-lg px-3 font-medium">
            {creating ? 'Créer la colonne' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </Floating>
  )
}

// ---------------------------------------------------------------------------
// Choix d'une colonne Statut
// ---------------------------------------------------------------------------

function ChoicesEditor({
  choices,
  onChange,
}: {
  choices: SelectChoice[]
  onChange: (choices: SelectChoice[]) => void
}) {
  const [palette, setPalette] = useState<string | null>(null)
  const update = (id: string, patch: Partial<SelectChoice>) =>
    onChange(choices.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...choices]
    const [item] = next.splice(i, 1)
    if (item) next.splice(i + d, 0, item)
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-muted">Choix</span>
      <ul className="flex flex-col gap-1">
        {choices.map((choice, i) => (
          <li key={choice.id} className="relative flex items-center gap-1">
            <button
              type="button"
              aria-label={`Couleur de ${choice.label || 'ce choix'}`}
              onClick={() => setPalette((p) => (p === choice.id ? null : choice.id))}
              className={`tone-${choice.color} tone-dot size-5 shrink-0 rounded-full ring-2 ring-surface hover:ring-line-strong`}
            />
            <input
              value={choice.label}
              onChange={(e) => update(choice.id, { label: e.target.value })}
              aria-label={`Libellé du choix ${i + 1}`}
              className="field-input h-7 min-w-0 flex-1"
            />
            <button
              type="button"
              className="btn-icon size-6"
              aria-label="Monter"
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp size={12} />
            </button>
            <button
              type="button"
              className="btn-icon size-6"
              aria-label="Descendre"
              disabled={i === choices.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={12} />
            </button>
            <button
              type="button"
              className="btn-icon size-6 hover:text-danger"
              aria-label={`Retirer ${choice.label || 'ce choix'}`}
              onClick={() => onChange(choices.filter((c) => c.id !== choice.id))}
            >
              <Trash2 size={12} />
            </button>
            {palette === choice.id && (
              <div className="absolute top-full left-0 z-10 mt-1 flex gap-1 rounded-lg border border-edge bg-surface-raised p-1.5 shadow-glow-strong">
                {CHOICE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Couleur ${color}`}
                    onClick={() => {
                      update(choice.id, { color: color as BadgeColor })
                      setPalette(null)
                    }}
                    className={cn(
                      `tone-${color} tone-dot size-5 rounded-full`,
                      choice.color === color && 'ring-2 ring-focus',
                    )}
                  />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className="btn-ghost text-accent-fg"
          onClick={() =>
            onChange([
              ...choices,
              {
                id: newId('opt'),
                label: '',
                color: CHOICE_COLORS[choices.length % CHOICE_COLORS.length] as BadgeColor,
              },
            ])
          }
        >
          <Plus size={13} /> Ajouter un choix
        </button>
        <button
          type="button"
          className="btn-ghost"
          title="Les 8 statuts communs de la Suite Atelier, reconnus par Atelier Projets"
          onClick={() => onChange(mergeAtelierStatuses(choices))}
        >
          <ListChecks size={13} /> {ATELIER_STATUS_PRESET_NAME}
        </button>
      </div>
      {choices.some((c) => c.label.trim()) && (
        <div className="flex flex-wrap gap-1 pt-1" aria-hidden>
          {choices
            .filter((c) => c.label.trim())
            .map((c) => (
              <StatusBadge key={c.id} label={c.label} color={c.color} />
            ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Colonne-formule
// ---------------------------------------------------------------------------

const RESULT_FORMATS: { value: NonNullable<FieldOptions['resultFormat']>; label: string }[] = [
  { value: 'number', label: 'Nombre' },
  { value: 'currency', label: 'Montant' },
  { value: 'percent', label: 'Pourcentage' },
  { value: 'date', label: 'Date' },
  { value: 'text', label: 'Texte' },
]

function FormulaOptions({
  tableId,
  fieldId,
  formula,
  onFormula,
  options,
  onOptions,
}: {
  tableId: string
  fieldId: string | undefined
  formula: string
  onFormula: (f: string) => void
  options: FieldOptions
  onOptions: (fn: (o: FieldOptions) => FieldOptions) => void
}) {
  const table = useDataStore((s) => s.tables[tableId])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const assist = useFormulaAssist({
    value: formula,
    onChange: onFormula,
    getInput: () => inputRef.current,
  })
  const firstRow = table?.rowOrder.find((id) => table.records[id]?.kind === 'data')
  const previewField: Field = {
    id: fieldId ?? 'apercu',
    label: '',
    type: 'formula',
    options: { ...options },
  }
  const preview = useMemo(() => {
    const sheet = getSheet(tableId)
    const checked = checkColumnFormula(formula)
    if (!sheet || !firstRow || !checked.ok) return null
    return sheet.preview(checked.formula, firstRow, fieldId ?? table?.fieldOrder[0] ?? '')
  }, [tableId, formula, firstRow, fieldId, table])

  const insertRef = (ref: string) => {
    const el = inputRef.current
    const start = el?.selectionStart ?? formula.length
    const end = el?.selectionEnd ?? formula.length
    const next = formula.slice(0, start) + ref + formula.slice(end)
    onFormula(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + ref.length, start + ref.length)
      assist.sync()
    })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12px] font-medium text-muted">Formule (écrite pour la ligne 1)</span>
      <div className="relative">
        <textarea
          ref={inputRef}
          value={formula}
          rows={2}
          spellCheck={false}
          aria-label="Formule de la colonne"
          onChange={(e) => {
            onFormula(e.target.value)
            assist.sync()
          }}
          onKeyDown={(e) => {
            if (assist.onKeyDown(e)) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          onKeyUp={assist.sync}
          onClick={assist.sync}
          className="field-input h-auto min-h-14 resize-y py-1.5 font-mono text-[12.5px]"
        />
        {assist.panel}
      </div>
      <div className="flex flex-wrap gap-1">
        {table?.fieldOrder
          .filter((id) => id !== fieldId)
          .map((id) => {
            const f = table.fields[id]
            if (!f) return null
            const letter = columnToLetters(table.fieldOrder.indexOf(id))
            return (
              <button
                key={id}
                type="button"
                title={`Insérer ${letter}1 (${f.label}, ligne courante)`}
                onClick={() => insertRef(`${letter}1`)}
                className="inline-flex h-6 items-center gap-1 rounded-md border border-line px-1.5 text-[11.5px] text-muted hover:border-line-strong hover:text-ink"
              >
                <span className="font-mono font-semibold text-accent-fg">{letter}</span>
                <span className="max-w-24 truncate">{f.label}</span>
              </button>
            )
          })}
      </div>
      {preview !== null && (
        <p className="text-[12px] text-muted">
          Ligne 1 :{' '}
          <span className={cn('font-medium', isError(preview) ? 'text-danger' : 'text-ink')}>
            {isError(preview)
              ? `${preview.code} — ${preview.message}`
              : formatValue(previewField, preview) || '(vide)'}
          </span>
        </p>
      )}
      <label className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium text-muted">Afficher le résultat comme</span>
        <select
          value={options.resultFormat ?? 'number'}
          onChange={(e) =>
            onOptions((o) => ({
              ...o,
              resultFormat: e.target.value as NonNullable<FieldOptions['resultFormat']>,
            }))
          }
          className="field-input h-7 w-32"
        >
          {RESULT_FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
