import { useEffect, useRef, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

interface PopoverProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  align?: 'start' | 'end'
}

/**
 * Panneau flottant ancré à son parent (qui doit être `relative`).
 * Se ferme au clic extérieur et avec Échap.
 */
export function Popover({ open, onClose, children, className, align = 'start' }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      ref={ref}
      className={cn(
        'absolute top-full z-30 mt-1 min-w-44 rounded-lg border border-edge bg-surface-raised p-1 shadow-glow-strong',
        align === 'end' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function MenuItem({
  children,
  onSelect,
  danger,
  icon,
  shortcut,
  disabled,
  checked,
}: {
  children: ReactNode
  onSelect: () => void
  danger?: boolean
  icon?: ReactNode
  /** Raccourci affiché à droite (⌘C). */
  shortcut?: string
  disabled?: boolean
  /** Coche de sélection (choix d'une liste). */
  checked?: boolean
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover disabled:pointer-events-none disabled:opacity-45',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {icon && (
        <span className={cn('shrink-0', danger ? 'text-danger' : 'text-muted')}>{icon}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked && <Check size={13} className="shrink-0 text-accent-fg" aria-hidden />}
      {shortcut && <kbd className="kbd shrink-0">{shortcut}</kbd>}
    </button>
  )
}

export function MenuSeparator() {
  return <div role="separator" className="my-1 border-t border-line" />
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 pt-1.5 pb-1 text-[11.5px] font-medium text-muted">{children}</p>
}
