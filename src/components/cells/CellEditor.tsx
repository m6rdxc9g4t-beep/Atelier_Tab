import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cancelEdit, commitEdit, type Move } from '@/store/grid-actions'
import { useDataStore, useUIStore } from '@/store'
import type { Field } from '@/types/domain'
import { OwnerChip, StatusBadge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'

interface CellEditorProps {
  field: Field
  align: 'left' | 'right' | 'center'
  /** Rend le focus à la grille après validation ou annulation. */
  onDone: () => void
}

interface Option {
  value: string
  render: React.ReactNode
}

/**
 * Éditeur en place. Champ texte pour tous les types ; pour un statut ou un responsable,
 * une liste de choix filtrée par la saisie s'ouvre sous la cellule.
 */
export function CellEditor({ field, align, onDone }: CellEditorProps) {
  const draft = useUIStore((s) => s.editing?.draft ?? '')
  const focusHere = useUIStore((s) => s.editing?.origin === 'cell')
  const updateDraft = useUIStore((s) => s.updateDraft)
  const collaborators = useDataStore((s) => s.collaborators)
  const inputRef = useRef<HTMLInputElement>(null)
  const [highlight, setHighlight] = useState(0)

  useEffect(() => {
    if (!focusHere) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [focusHere])

  const options = useMemo<Option[]>(() => {
    if (draft.startsWith('=')) return []
    const q = draft.trim().toLocaleLowerCase('fr')
    const match = (label: string) => q === '' || label.toLocaleLowerCase('fr').includes(q)
    if (field.type === 'select') {
      return (field.options?.choices ?? [])
        .filter((c) => match(c.label))
        .map((c) => ({ value: c.label, render: <StatusBadge label={c.label} color={c.color} /> }))
    }
    if (field.type === 'owner') {
      return Object.values(collaborators)
        .filter((c) => match(c.name))
        .map((c) => ({ value: c.name, render: <OwnerChip person={c} /> }))
    }
    return []
  }, [draft, field, collaborators])

  const listOpen = options.length > 0
  const active = Math.min(highlight, Math.max(options.length - 1, 0))

  const finish = (move: Move) => {
    if (commitEdit(move)) onDone()
  }

  const pick = (value: string) => {
    updateDraft(value)
    // La sélection d'un choix valide immédiatement la cellule.
    queueMicrotask(() => finish('none'))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (listOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((active + delta + options.length) % options.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = listOpen ? options[active] : undefined
      if (chosen && chosen.value !== draft) {
        pick(chosen.value)
        return
      }
      finish(e.shiftKey ? 'up' : 'down')
    } else if (e.key === 'Tab') {
      e.preventDefault()
      finish(e.shiftKey ? 'left' : 'right')
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
      onDone()
    }
  }

  return (
    <div className="absolute inset-0 z-20">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => {
          updateDraft(e.target.value)
          setHighlight(0)
        }}
        onKeyDown={onKeyDown}
        placeholder={field.type === 'date' ? 'JJ/MM/AAAA' : undefined}
        spellCheck={false}
        aria-label={`Modifier ${field.label}`}
        className={cn(
          'size-full bg-surface-raised px-2 text-ink shadow-[inset_0_0_0_2px_var(--accent)] outline-none placeholder:text-faint',
          draft.startsWith('=') && 'font-mono text-[12px]',
          align === 'right' && !draft.startsWith('=') && 'text-right',
        )}
      />
      {listOpen && (
        <ul
          role="listbox"
          className="absolute top-full left-0 mt-1 min-w-full rounded-lg border border-line bg-surface-raised p-1 shadow-lg shadow-black/10 dark:shadow-glow-strong"
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(o.value)
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                'flex cursor-pointer items-center rounded-md px-2 py-1',
                i === active && 'bg-surface-hover',
              )}
            >
              {o.render}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
