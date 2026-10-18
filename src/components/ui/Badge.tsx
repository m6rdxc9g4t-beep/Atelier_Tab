import type { BadgeColor, Collaborator } from '@/types/domain'
import { cn } from '@/lib/cn'

export function StatusBadge({ label, color }: { label: string; color: BadgeColor }) {
  return (
    <span
      className={cn(
        `tone-${color} tone-soft`,
        'inline-flex max-w-full items-center gap-1.5 truncate rounded-full py-0.5 pr-2 pl-1.5 text-[12px] leading-4 font-medium',
      )}
    >
      <span className={`tone-${color} tone-dot size-1.5 shrink-0 rounded-full`} />
      <span className="truncate">{label}</span>
    </span>
  )
}

export function Avatar({ person, size = 20 }: { person: Collaborator; size?: number }) {
  return (
    <span
      className={`tone-${person.color} tone-solid inline-grid shrink-0 place-items-center rounded-full font-semibold`}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {person.initials}
    </span>
  )
}

export function OwnerChip({ person }: { person: Collaborator }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar person={person} />
      <span className="truncate">{person.name}</span>
    </span>
  )
}
