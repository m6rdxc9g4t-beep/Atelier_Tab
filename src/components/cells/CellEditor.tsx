import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { cancelEdit, commitEdit, commitWithNewOption, type Move } from '@/store/grid-actions'
import { useDataStore, useUIStore } from '@/store'
import type { Field } from '@/types/domain'
import { OwnerChip, StatusBadge } from '@/components/ui/Badge'
import { useFormulaAssist } from '@/components/formula/useFormulaAssist'
import { cn } from '@/lib/cn'

interface CellEditorProps {
  field: Field
  align: 'left' | 'right' | 'center'
  /** Rend le focus à la grille après validation ou annulation. */
  onDone: () => void
}

interface Option {
  value: string
  render: ReactNode
  /** Choix à créer (« + Ajouter « Urgent » »). */
  create?: boolean
}

/**
 * Éditeur en place. Champ texte pour tous les types ; pour un statut ou un responsable,
 * une liste de choix filtrée par la saisie s'ouvre sous la cellule (avec « Ajouter » pour un
 * libellé nouveau, comme Airtable) ; pour une formule, l'aide sur les fonctions.
 */
export function CellEditor({ field, align, onDone }: CellEditorProps) {
  const draft = useUIStore((s) => s.editing?.draft ?? '')
  const focusHere = useUIStore((s) => s.editing?.origin === 'cell')
  const updateDraft = useUIStore((s) => s.updateDraft)
  const collaborators = useDataStore((s) => s.collaborators)
  const inputRef = useRef<HTMLInputElement>(null)
  const [highlight, setHighlight] = useState(0)
  const formula = draft.startsWith('=')
  const assist = useFormulaAssist({
    value: draft,
    onChange: updateDraft,
    getInput: () => inputRef.current,
  })

  useEffect(() => {
    if (!focusHere) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [focusHere])

  const options = useMemo<Option[]>(() => {
    if (formula) return []
    const q = draft.trim().toLocaleLowerCase('fr')
    const match = (label: string) => q === '' || label.toLocaleLowerCase('fr').includes(q)
    const exact = (label: string) => label.toLocaleLowerCase('fr') === q
    if (field.type === 'select') {
      const choices = field.options?.choices ?? []
      const list: Option[] = choices
        .filter((c) => match(c.label))
        .map((c) => ({ value: c.label, render: <StatusBadge label={c.label} color={c.color} /> }))
      if (q && !choices.some((c) => exact(c.label))) {
        list.push({ value: draft.trim(), create: true, render: <NewOption label={draft.trim()} /> })
      }
      return list
    }
    if (field.type === 'owner') {
      const people = Object.values(collaborators)
      const list: Option[] = people
        .filter((c) => match(c.name))
        .map((c) => ({ value: c.name, render: <OwnerChip person={c} /> }))
      if (q && !people.some((c) => exact(c.name) || c.initials.toLocaleLowerCase('fr') === q)) {
        list.push({
          value: draft.trim(),
          create: true,
          render: <NewOption label={draft.trim()} person />,
        })
      }
      return list
    }
    return []
  }, [draft, field, collaborators, formula])

  const listOpen = options.length > 0
  const active = Math.min(highlight, Math.max(options.length - 1, 0))

  const finish = (move: Move) => {
    if (commitEdit(move)) onDone()
  }

  const pick = (option: Option) => {
    if (option.create) {
      if (commitWithNewOption(option.value)) onDone()
      return
    }
    updateDraft(option.value)
    // La sélection d'un choix valide immédiatement la cellule.
    queueMicrotask(() => finish('none'))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (formula && assist.onKeyDown(e)) return
    if (listOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const delta = e.key === 'ArrowDown' ? 1 : -1
      setHighlight((active + delta + options.length) % options.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const chosen = listOpen ? options[active] : undefined
      if (chosen && (chosen.create || chosen.value !== draft)) {
        pick(chosen)
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
          assist.sync()
        }}
        onKeyDown={onKeyDown}
        onKeyUp={assist.sync}
        onClick={assist.sync}
        placeholder={field.type === 'date' ? 'JJ/MM/AAAA' : undefined}
        spellCheck={false}
        aria-label={`Modifier ${field.label}`}
        className={cn(
          'size-full bg-surface-raised px-2 text-ink shadow-[inset_0_0_0_2px_var(--accent)] outline-none placeholder:text-faint',
          formula && 'font-mono text-[12px]',
          align === 'right' && !formula && 'text-right',
        )}
      />
      {formula && assist.panel}
      {listOpen && (
        <ul
          role="listbox"
          className="absolute top-full left-0 mt-1 max-h-72 min-w-full overflow-y-auto rounded-lg border border-edge bg-surface-raised p-1 shadow-glow-strong"
        >
          {options.map((o, i) => (
            <li
              key={`${o.create ? '+' : ''}${o.value}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(o)
              }}
              onMouseEnter={() => setHighlight(i)}
              className={cn(
                'flex cursor-pointer items-center rounded-md px-2 py-1 whitespace-nowrap',
                i === active && 'bg-surface-hover',
                o.create && 'mt-1 border-t border-line pt-1.5',
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

function NewOption({ label, person }: { label: string; person?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-accent-fg">
      <Plus size={13} />
      {person ? 'Ajouter le collaborateur' : 'Ajouter le choix'} « {label} »
    </span>
  )
}
