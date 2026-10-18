import { useEffect, useRef, type ReactNode } from 'react'
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
        'absolute top-full z-30 mt-1 min-w-44 rounded-lg border border-line bg-surface-raised p-1 shadow-lg shadow-black/10 dark:shadow-black/40',
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
}: {
  children: ReactNode
  onSelect: () => void
  danger?: boolean
  icon?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover',
        danger ? 'text-danger' : 'text-ink',
      )}
    >
      {icon && <span className="text-muted">{icon}</span>}
      {children}
    </button>
  )
}
