import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

/** Point d'ancrage : un élément (sous lequel s'ouvrir) ou une position (menu contextuel). */
export type FloatingAnchor = HTMLElement | { x: number; y: number }

interface FloatingProps {
  open: boolean
  anchor: FloatingAnchor | null
  onClose: () => void
  children: ReactNode
  className?: string
  /** Aligné sur le bord gauche (start) ou droit (end) de l'ancre. */
  align?: 'start' | 'end'
  /** Rôle ARIA du panneau (menu, dialog…). */
  role?: string
  label?: string
}

const MARGIN = 8

/**
 * Panneau flottant rendu dans `<body>` (jamais rogné par une zone qui défile, comme la grille),
 * placé sous son ancre et ramené dans la fenêtre ; ouvert au-dessus s'il manque de place.
 * Se ferme au clic extérieur et avec Échap.
 */
export function Floating({
  open,
  anchor,
  onClose,
  children,
  className,
  align = 'start',
  role,
  label,
}: FloatingProps) {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) return
    const place = () => {
      const panel = ref.current
      if (!panel) return
      const box =
        anchor instanceof HTMLElement
          ? anchor.getBoundingClientRect()
          : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y }
      const w = panel.offsetWidth
      const h = panel.offsetHeight
      let left = align === 'end' ? box.right - w : box.left
      left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN))
      let top = box.bottom + 4
      if (top + h > window.innerHeight - MARGIN && box.top - h - 4 > MARGIN) top = box.top - h - 4
      top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN))
      // Placement écrit directement sur le panneau : aucun rendu supplémentaire.
      panel.style.left = `${left}px`
      panel.style.top = `${top}px`
      panel.style.visibility = 'visible'
    }
    place()
    // Le contenu change de taille (éditeur de champ…) : on replace le panneau.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    if (ref.current) observer?.observe(ref.current)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, anchor, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (anchor instanceof HTMLElement && anchor.contains(target)) return
      onClose()
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
  }, [open, anchor, onClose])

  if (!open || !anchor) return null
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
      className={cn(
        'z-50 min-w-44 rounded-lg border border-edge bg-surface-raised p-1 text-[13px] shadow-glow-strong',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  )
}
