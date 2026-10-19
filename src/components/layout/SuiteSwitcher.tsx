/**
 * Sélecteur « Suite Atelier » (docs/SUITE.md §3) : icône grille à gauche du nom de l'app,
 * menu des trois applications (courante cochée), indicateur « en marche / arrêtée » pour
 * celles qui ont une API.
 *
 * Clavier : Entrée / Espace / ↓ ouvrent le menu, ↑ ↓ Début Fin naviguent, Échap ferme et
 * rend le focus, Tab ou un clic à l'extérieur ferment. Les vérifications de santé ne
 * bloquent jamais l'affichage du menu.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { BarChart3, Check, KanbanSquare, LayoutGrid, Table2 } from 'lucide-react'
import {
  checkHealth,
  CURRENT_APP,
  openSuiteApp,
  SUITE_APPS,
  type SuiteAppId,
  type SuiteStatus,
} from '@/lib/suite'
import { cn } from '@/lib/cn'

const ICONS: Record<SuiteAppId, typeof Table2> = {
  viz: BarChart3,
  tab: Table2,
  projets: KanbanSquare,
}

type Health = SuiteStatus | 'checking'

const HEALTH_TEXT: Record<Health, string> = {
  up: 'En marche',
  down: 'Arrêtée',
  checking: 'Vérification…',
}
/** Teinte de la pastille : statuts officiels (succès / danger), neutre pendant la vérification. */
const HEALTH_STATUS: Record<Health, string> = { up: 'CLOSED', down: 'REJECTED', checking: 'OPEN' }

export function SuiteSwitcher() {
  const [open, setOpen] = useState(false)
  const [health, setHealth] = useState<Partial<Record<SuiteAppId, Health>>>({})
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }, [])

  // Santé relue à chaque ouverture, en parallèle, sans attendre pour afficher le menu
  // (l'état « Vérification… » est posé par openMenu).
  useEffect(() => {
    if (!open) return
    let cancelled = false
    for (const app of SUITE_APPS) {
      if (!app.healthUrl) continue
      void checkHealth(app.healthUrl).then((status) => {
        if (!cancelled) setHealth((current) => ({ ...current, [app.id]: status }))
      })
    }
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) close(false)
    }
    // Capture : Échap ferme le menu seul, pas un dialogue ouvert derrière.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, close])

  const focusItem = (index: number) => {
    const list = items.current.filter((item): item is HTMLButtonElement => item !== null)
    list[(index + list.length) % list.length]?.focus()
  }

  const openMenu = (focus: 'first' | 'last') => {
    const checking: Partial<Record<SuiteAppId, Health>> = {}
    for (const app of SUITE_APPS) if (app.healthUrl) checking[app.id] = 'checking'
    setHealth(checking)
    setOpen(true)
    requestAnimationFrame(() => focusItem(focus === 'first' ? 0 : -1))
  }

  const onTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      openMenu(event.key === 'ArrowDown' ? 'first' : 'last')
    }
  }

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items.current.filter((item): item is HTMLButtonElement => item !== null)
    const index = list.indexOf(document.activeElement as HTMLButtonElement)
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: list.length - 1,
    }
    const target = moves[event.key]
    if (target !== undefined) {
      event.preventDefault()
      focusItem(target)
    } else if (event.key === 'Tab') {
      close(false)
    }
  }

  return (
    <div className="relative shrink-0" ref={root}>
      <button
        ref={trigger}
        type="button"
        aria-label="Suite Atelier : changer d’application"
        title="Suite Atelier"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={onTriggerKey}
        className={cn(
          'grid size-7 place-items-center rounded-md text-muted hover:bg-surface-hover hover:text-ink',
          open && 'bg-surface-hover text-ink',
        )}
      >
        <LayoutGrid size={16} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Suite Atelier"
          onKeyDown={onMenuKey}
          className="absolute top-full left-0 z-40 mt-2 w-80 rounded-lg border border-line bg-surface-raised p-1.5 shadow-lg shadow-black/10 dark:shadow-black/40"
        >
          <p
            className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase"
            aria-hidden
          >
            Suite Atelier
          </p>
          {SUITE_APPS.map((app, index) => {
            const current = app.id === CURRENT_APP
            const state = app.healthUrl ? (health[app.id] ?? 'checking') : null
            const Icon = ICONS[app.id]
            const label = `${app.name}${current ? ' (application courante)' : ''}${state ? ` — ${HEALTH_TEXT[state]}` : ''}`
            return (
              <button
                key={app.id}
                ref={(element) => {
                  items.current[index] = element
                }}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                aria-label={label}
                title={current ? undefined : `Ouvrir ${app.name} (${app.url})`}
                onClick={() => {
                  if (!current) openSuiteApp(app)
                  close(true)
                }}
                className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left hover:bg-surface-hover focus-visible:bg-surface-hover"
              >
                <span
                  className={cn(
                    'grid size-9 shrink-0 place-items-center rounded-md',
                    current ? 'bg-accent text-accent-ink' : 'bg-surface-sunken text-accent',
                  )}
                >
                  <Icon size={18} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold text-ink">
                    {app.name}
                    {state && (
                      <span
                        data-status={HEALTH_STATUS[state]}
                        className="flex items-center gap-1 text-[11.5px] font-normal text-muted"
                      >
                        <span className="tone-dot size-1.5 rounded-full" aria-hidden />
                        {HEALTH_TEXT[state]}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[12px] text-muted">{app.description}</span>
                </span>
                <span className="grid size-5 shrink-0 place-items-center text-accent">
                  {current && <Check size={15} aria-hidden />}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
