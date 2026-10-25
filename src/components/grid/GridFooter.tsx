import { memo, useState } from 'react'
import { Plus } from 'lucide-react'
import { FIELD_TYPES, formatValue } from '@/engine/field-types'
import { isError, type CellValue } from '@/engine/formula'
import { addRowAndSelect } from '@/store/grid-actions'
import { getSheet, useComputed } from '@/store'
import { activeView } from '@/store/view-rows'
import { setSummary } from '@/store/view-actions'
import type { Field, SummaryKind, Table } from '@/types/domain'
import { Floating } from '@/components/ui/Floating'
import { MenuItem, MenuLabel } from '@/components/ui/Popover'
import { fieldWidth } from '@/lib/field-icons'
import { cn } from '@/lib/cn'
import { ADD_COLUMN_WIDTH, GUTTER_WIDTH } from './GridHeader'

export const FOOTER_HEIGHT = 36

const LABELS: Record<SummaryKind, string> = {
  none: 'Aucun',
  sum: 'Somme',
  average: 'Moyenne',
  min: 'Min',
  max: 'Max',
  count: 'Nombres',
  filled: 'Remplies',
  empty: 'Vides',
}

function isNumeric(field: Field): boolean {
  if (field.type === 'formula') {
    const f = field.options?.resultFormat ?? 'number'
    return f === 'number' || f === 'currency' || f === 'percent'
  }
  return FIELD_TYPES[field.type].numeric
}

export function summaryKinds(field: Field): SummaryKind[] {
  return isNumeric(field)
    ? ['none', 'sum', 'average', 'min', 'max', 'count', 'filled', 'empty']
    : ['none', 'filled', 'empty']
}

/** Agrégat par défaut : la somme des colonnes numériques, rien ailleurs. */
export function defaultSummary(field: Field): SummaryKind {
  return isNumeric(field) ? 'sum' : 'none'
}

/** Valeur d'un agrégat sur des valeurs calculées (lignes de total exclues par l'appelant). */
export function summarize(field: Field, values: CellValue[], kind: SummaryKind): string | null {
  const blank = (v: CellValue) =>
    v === null || v === '' || (field.type === 'checkbox' && v !== true)
  if (kind === 'none') return null
  if (kind === 'filled') return String(values.filter((v) => !blank(v)).length)
  if (kind === 'empty') return String(values.filter(blank).length)
  const nums = values.filter((v): v is number => typeof v === 'number' && !isError(v))
  if (kind === 'count') return String(nums.length)
  if (nums.length === 0) return '—'
  const total = nums.reduce((a, b) => a + b, 0)
  const value =
    kind === 'sum'
      ? total
      : kind === 'average'
        ? total / nums.length
        : kind === 'min'
          ? Math.min(...nums)
          : Math.max(...nums)
  return formatValue(field, Number(value.toPrecision(15)))
}

/**
 * Pied de grille : bouton d'ajout de ligne et, pour chaque colonne, un agrégat au choix
 * (somme, moyenne, min, max, remplies…) calculé sur les lignes visibles de la vue, comme la
 * barre de synthèse d'Airtable. Les lignes de total sont exclues (pas de double comptage).
 */
export const GridFooter = memo(function GridFooter({
  table,
  fieldIds,
  rows,
  liveWidths,
  frozenShadow,
}: {
  table: Table
  fieldIds: string[]
  rows: string[]
  liveWidths: Record<string, number>
  frozenShadow: boolean
}) {
  // Se recalcule quand le moteur signale un changement dans cette table.
  useComputed((s) => s.revisions[table.id] ?? 0)
  const sheet = getSheet(table.id)
  const dataRows = rows.filter((id) => table.records[id]?.kind === 'data')
  const view = activeView(table)
  const first = table.fields[fieldIds[0] ?? '']

  return (
    <div
      className="sticky bottom-0 z-20 flex border-t border-line-strong bg-surface-sunken"
      style={{ height: FOOTER_HEIGHT }}
    >
      <button
        type="button"
        onClick={() => addRowAndSelect()}
        className={cn(
          'sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-line bg-surface-sunken pl-4 text-muted hover:text-accent-fg',
          frozenShadow && 'frozen-shadow',
        )}
        style={{
          width: GUTTER_WIDTH + (first ? (liveWidths[first.id] ?? fieldWidth(first)) : 0),
        }}
      >
        <Plus size={14} />
        Ajouter une ligne
      </button>
      {fieldIds.slice(1).map((fieldId) => {
        const field = table.fields[fieldId]
        if (!field) return null
        const kind = view?.summaries?.[fieldId] ?? defaultSummary(field)
        const values = dataRows.map((id) => sheet?.value(id, fieldId) ?? null)
        return (
          <FooterCell
            key={fieldId}
            table={table}
            field={field}
            width={liveWidths[fieldId] ?? fieldWidth(field)}
            kind={kind}
            text={summarize(field, values, kind)}
          />
        )
      })}
      <div className="shrink-0" style={{ width: ADD_COLUMN_WIDTH }} />
    </div>
  )
})

function FooterCell({
  table,
  field,
  width,
  kind,
  text,
}: {
  table: Table
  field: Field
  width: number
  kind: SummaryKind
  text: string | null
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <div className="shrink-0 border-r border-line" style={{ width }}>
      <button
        type="button"
        onClick={(e) => setAnchor((a) => (a ? null : e.currentTarget))}
        aria-label={`Résumé de ${field.label} : ${text === null ? 'aucun' : `${LABELS[kind]} ${text}`}`}
        className="group flex size-full items-center justify-end gap-1.5 px-2 tabular-nums hover:bg-surface-hover"
      >
        {text === null ? (
          <span className="text-[11px] text-faint opacity-0 group-hover:opacity-100">Résumé</span>
        ) : (
          <>
            <span className="text-[11px] text-muted">{LABELS[kind]}</span>
            <span className="truncate font-medium text-ink">{text}</span>
          </>
        )}
      </button>
      <Floating
        open={anchor !== null}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        role="menu"
        align="end"
      >
        <MenuLabel>Résumé de « {field.label} »</MenuLabel>
        {summaryKinds(field).map((k) => (
          <MenuItem
            key={k}
            checked={k === kind}
            onSelect={() => {
              setSummary(table.id, field.id, k)
              setAnchor(null)
            }}
          >
            {LABELS[k]}
          </MenuItem>
        ))}
      </Floating>
    </div>
  )
}
