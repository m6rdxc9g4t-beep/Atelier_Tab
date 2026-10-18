import { Check } from 'lucide-react'
import { formatValue } from '@/engine/field-types'
import { isError, type CellValue } from '@/engine/formula'
import type { Collaborator, Field } from '@/types/domain'
import { OwnerChip, StatusBadge } from '@/components/ui/Badge'
import { cn } from '@/lib/cn'

interface CellContentProps {
  field: Field
  value: CellValue
  /** Valeur stockée (id de statut, id de collaborateur…) quand elle n'est pas une formule. */
  stored: unknown
  collaborators: Record<string, Collaborator>
  /** Mode tableur pur : texte brut, sans badge ni avatar. */
  plain: boolean
}

/** Rendu en lecture d'une cellule, selon son type et le mode d'affichage. */
export function CellContent({ field, value, stored, collaborators, plain }: CellContentProps) {
  if (isError(value)) {
    return (
      <span className="font-medium text-danger" title={value.message}>
        {value.code}
      </span>
    )
  }
  if (value === null || value === '') return null

  if (!plain) {
    if (field.type === 'select') {
      const choice =
        field.options?.choices?.find((c) => c.id === stored) ??
        field.options?.choices?.find((c) => c.label === value)
      if (choice) return <StatusBadge label={choice.label} color={choice.color} />
    }
    if (field.type === 'owner') {
      const person =
        (typeof stored === 'string' ? collaborators[stored] : undefined) ??
        Object.values(collaborators).find((c) => c.name === value)
      if (person) return <OwnerChip person={person} />
    }
    if (field.type === 'checkbox') {
      return (
        <span
          className={cn(
            'inline-grid size-4 place-items-center rounded border',
            value === true ? 'border-accent bg-accent text-accent-ink' : 'border-line-strong',
          )}
        >
          {value === true && <Check size={12} strokeWidth={3} />}
        </span>
      )
    }
  }

  return <span className="truncate">{formatValue(field, value)}</span>
}
