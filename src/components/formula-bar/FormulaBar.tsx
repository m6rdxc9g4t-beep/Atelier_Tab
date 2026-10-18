import { useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { AlertCircle, SquareFunction } from 'lucide-react'
import { formatValue } from '@/engine/field-types'
import { isError, isFormula, tokenizeForDisplay } from '@/engine/formula'
import { beginEdit, cancelEdit, commitEdit, editTextOf } from '@/store/grid-actions'
import { getSheet, useComputed, useDataStore, useUIStore } from '@/store'
import type { Table } from '@/types/domain'
import { refHue } from '@/lib/field-icons'
import { cn } from '@/lib/cn'

/**
 * Barre de formules : adresse de la cellule active (D1) et nom du champ, saisie brute,
 * aperçu du résultat en direct pendant la frappe d'une formule.
 */
export function FormulaBar({ table, onCommit }: { table: Table; onCommit: () => void }) {
  const selection = useUIStore((s) => s.selection)
  const editing = useUIStore((s) => s.editing)
  const inputError = useUIStore((s) => s.inputError)
  const updateDraft = useUIStore((s) => s.updateDraft)
  const revision = useComputed((s) => s.revisions[table.id] ?? 0)
  const stored = useDataStore((s) =>
    selection
      ? s.tables[table.id]?.records[selection.recordId]?.cells[selection.fieldId]
      : undefined,
  )
  const overlayRef = useRef<HTMLDivElement>(null)

  const field = selection ? table.fields[selection.fieldId] : undefined
  const sheet = getSheet(table.id)
  const address = selection && sheet ? sheet.address(selection.recordId, selection.fieldId) : null

  const shown = useMemo(() => {
    void stored
    void revision
    if (editing) return editing.draft
    return selection ? editTextOf(table.id, selection) : ''
  }, [editing, selection, table.id, stored, revision])

  const preview = useMemo(() => {
    if (!editing || !selection || !sheet || !field || !isFormula(editing.draft)) return null
    return sheet.preview(editing.draft, selection.recordId, selection.fieldId)
  }, [editing, selection, sheet, field])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (commitEdit('none')) onCommit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
      onCommit()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (commitEdit(e.shiftKey ? 'left' : 'right')) onCommit()
    }
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
      <div
        className="flex h-7 w-36 shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface-sunken px-2"
        title={field ? `${address ?? ''} · ${field.label}` : undefined}
      >
        <span className="font-mono text-[12px] font-semibold text-ink">{address ?? '—'}</span>
        {field && <span className="truncate text-[12px] text-muted">{field.label}</span>}
      </div>

      <SquareFunction size={16} className="shrink-0 text-faint" aria-hidden />

      <div className="relative min-w-0 flex-1">
        {/* Calque coloré derrière le champ : chaque référence prend la teinte de sa zone dans la grille. */}
        {isFormula(shown) && (
          <div
            ref={overlayRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden border border-transparent px-2 font-mono text-[12.5px] whitespace-pre"
          >
            <ColoredFormula formula={shown} />
          </div>
        )}
        <input
          value={shown}
          onScroll={(e) => {
            if (overlayRef.current) overlayRef.current.scrollLeft = e.currentTarget.scrollLeft
          }}
          disabled={!selection}
          onFocus={() => {
            if (selection && !editing) beginEdit(selection, undefined, 'bar')
          }}
          onChange={(e) => {
            if (!editing && selection) beginEdit(selection, e.target.value, 'bar')
            else updateDraft(e.target.value)
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          placeholder={
            selection ? 'Valeur ou formule (ex. =SUM(C1:C3))' : 'Sélectionnez une cellule'
          }
          aria-label="Barre de formules"
          className={cn(
            'h-7 w-full rounded-md border border-transparent bg-transparent px-2 outline-none placeholder:text-faint',
            'focus:border-accent focus:bg-surface-raised',
            isFormula(shown) ? 'font-mono text-[12.5px] text-transparent caret-ink' : 'text-ink',
            inputError && 'border-danger',
          )}
        />
      </div>

      <PreviewOrError
        error={inputError}
        preview={
          preview !== null && field ? (
            <PreviewValue value={preview} format={(v) => formatValue(field, v)} />
          ) : null
        }
      />
    </div>
  )
}

function PreviewOrError({ error, preview }: { error: string | null; preview: ReactNode }) {
  if (error) {
    return (
      <span role="alert" className="flex shrink-0 items-center gap-1 text-[12px] text-danger">
        <AlertCircle size={13} />
        {error}
      </span>
    )
  }
  return preview
}

function PreviewValue({
  value,
  format,
}: {
  value: ReturnType<NonNullable<ReturnType<typeof getSheet>>['preview']>
  format: (v: typeof value) => string
}) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-md px-2 py-0.5 text-[12px] tabular-nums',
        isError(value) ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-ink',
      )}
      title={isError(value) ? value.message : 'Résultat si vous validez'}
    >
      = {format(value)}
    </span>
  )
}

/** Formule colorée : chaque référence reçoit la teinte de sa zone dans la grille. */
function ColoredFormula({ formula }: { formula: string }) {
  const parts = tokenizeForDisplay(formula)
  let refIndex = -1
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'ref') {
          refIndex++
          return (
            <span key={i} className="ref-text" style={{ ['--h' as string]: refHue(refIndex) }}>
              {p.text}
            </span>
          )
        }
        return (
          <span key={i} className={p.kind === 'function' ? 'text-accent' : 'text-ink'}>
            {p.text}
          </span>
        )
      })}
    </>
  )
}
