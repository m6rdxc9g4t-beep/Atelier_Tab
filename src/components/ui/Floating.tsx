import {
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'

/** Point d'ancrage : un élément (sous lequel s'ouvrir) ou une position (menu contextuel). */
export type FloatingAnchor = HTMLElement | { x: number; y: number }

interface FloatingProps {
  open: boolean
  anchor: FloatingAnchor | null
  /**
   * Fermeture au clic extérieur et avec Échap. Sans elle, le panneau accompagne simplement son
   * ancre (liste sous une cellule en cours de saisie) : le champ de saisie garde le clavier.
   */
  onClose?: () => void
  children: ReactNode
  className?: string
  /** Aligné sur le bord gauche (start) ou droit (end) de l'ancre. */
  align?: 'start' | 'end'
  /** Au moins aussi large que l'ancre (liste de choix sous une cellule). */
  matchWidth?: boolean
  /** Rôle ARIA du panneau (menu, dialog…). */
  role?: string
  label?: string
}

const MARGIN = 8
/** Choix actifs d'un menu, parcourus au clavier. */
const MENU_ITEMS = '[role^="menuitem"]:not([disabled])'

/**
 * Panneau flottant rendu dans `<body>` (jamais rogné par une zone qui défile, comme la grille),
 * placé sous son ancre et ramené dans la fenêtre ; ouvert au-dessus s'il manque de place.
 * Se ferme au clic extérieur et avec Échap. Un menu (`role="menu"`) prend le focus sur son
 * premier choix, se parcourt avec ↑ ↓ Début Fin, puis rend le focus à l'élément qui l'avait.
 */
export function Floating({
  open,
  anchor,
  onClose,
  children,
  className,
  align = 'start',
  matchWidth = false,
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
          : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0 }
      if (matchWidth) panel.style.minWidth = `${box.width}px`
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
  }, [open, anchor, align, matchWidth])

  useEffect(() => {
    if (!open || !onClose) return
    const inside = (e: Event) => ref.current?.contains(e.target as Node) ?? false
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (ref.current?.contains(target)) return
      if (anchor instanceof HTMLElement && anchor.contains(target)) return
      onClose()
    }
    // Échap hors du panneau (focus resté sur la grille ou l'ancre) : fermé avant tout autre
    // gestionnaire, pour que la grille, par exemple, garde sa sélection.
    const onKeyOutside = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || inside(e)) return
      e.stopPropagation()
      onClose()
    }
    // Échap dans le panneau : ses champs passent d'abord (une liste de suggestions se ferme
    // seule et l'indique par preventDefault) ; sinon, le panneau se ferme.
    const onKeyInside = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !inside(e)) return
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKeyOutside, true)
    document.addEventListener('keydown', onKeyInside)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKeyOutside, true)
      document.removeEventListener('keydown', onKeyInside)
    }
  }, [open, anchor, onClose])

  // Menu : le premier choix prend le focus (menu ouvert au clavier par Maj+F10, ou par ⌄) ; à la
  // fermeture, le focus revient à l'élément qui l'avait (grille, bouton), si rien ne l'a pris.
  useEffect(() => {
    if (!open || !anchor || role !== 'menu') return
    const panel = ref.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel?.querySelector<HTMLElement>(MENU_ITEMS)?.focus({ preventScroll: true })
    return () => {
      const active = document.activeElement
      const lost = !active || active === document.body || (panel?.contains(active) ?? false)
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [open, anchor, role])

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEMS))
    const n = items.length
    // Sans choix (confirmation d'une suppression…) : Tab et les flèches gardent leur rôle.
    if (n === 0) return
    if (e.key === 'Tab') {
      // Tab quitte le menu, comme un menu natif ; le focus revient à l'élément d'origine.
      e.preventDefault()
      e.stopPropagation()
      onClose?.()
      return
    }
    const i = items.indexOf(document.activeElement as HTMLElement)
    const next =
      e.key === 'ArrowDown'
        ? items[i < 0 ? 0 : (i + 1) % n]
        : e.key === 'ArrowUp'
          ? items[i < 0 ? n - 1 : (i - 1 + n) % n]
          : e.key === 'Home'
            ? items[0]
            : e.key === 'End'
              ? items[n - 1]
              : undefined
    if (!next) return
    e.preventDefault()
    e.stopPropagation()
    next.focus()
  }

  if (!open || !anchor) return null
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={label}
      onKeyDown={role === 'menu' ? onMenuKeyDown : undefined}
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
