/**
 * Sélecteur « Suite Atelier » (docs/SUITE.md §3) : icône grille à gauche du nom de l'app,
 * menu des applications (courante cochée), indicateur « en marche / arrêtée » pour les
 * trois apps locales : l'app courante est toujours « en marche », les autres sont sondées.
 * Atelier Cuisine (app en ligne, sans API locale) n'est jamais sondée : « En ligne ».
 * Marque commune (docs/SUITE.md §1.6) : icône carrée de chaque app, « Atelier Nom ». Règle du
 * témoin muet (DESIGN.md) : seule une app arrêtée est en couleur (rouge) ; « en marche » reste
 * neutre et « Vérification… » est un cercle vide.
 *
 * Clavier : Entrée / Espace / ↓ ouvrent le menu, ↑ ↓ Début Fin naviguent, Échap ferme et
 * rend le focus, Tab ou un clic à l'extérieur ferment. Les vérifications de santé ne
 * bloquent jamais l'affichage du menu.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ChartColumn, Check, Kanban, LayoutGrid, Table, Utensils } from 'lucide-react'
import {
  checkHealth,
  CURRENT_APP,
  openSuiteApp,
  SUITE_APPS,
  type SuiteAppId,
  type SuiteStatus,
} from '@/lib/suite'
import { cn } from '@/lib/cn'

/** Icônes Lucide de la suite (docs/SUITE.md §1.6), mêmes dessins que le portail. */
const ICONS: Record<SuiteAppId, typeof Table> = {
  viz: ChartColumn,
  tab: Table,
  projets: Kanban,
  cuisine: Utensils,
}

type Health = SuiteStatus | 'checking'

const HEALTH_TEXT: Record<Health, string> = {
  up: 'En marche',
  down: 'Arrêtée',
  checking: 'Vérification…',
}
/** Mention des apps en ligne, jamais sondées (docs/SUITE.md §3). */
const ONLINE_TEXT = 'En ligne'
/** Pastille d'état : seule l'app arrêtée est colorée (rouge) ; cercle vide pendant la vérification. */
const HEALTH_DOT: Record<Health, string | null> = {
  up: null,
  down: 'bg-down',
  checking: 'border border-faint',
}

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
      const healthUrl = app.healthUrl
      if (app.id === CURRENT_APP || healthUrl === null) continue
      void checkHealth(healthUrl).then((status) => {
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
    for (const app of SUITE_APPS) {
      if (app.id !== CURRENT_APP && app.healthUrl !== null) checking[app.id] = 'checking'
    }
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
        className={cn('btn-icon', open && 'bg-selection text-ink')}
      >
        <LayoutGrid size={16} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Suite Atelier"
          onKeyDown={onMenuKey}
          className="absolute top-full left-0 z-40 mt-1.5 w-80 rounded-xl border border-edge bg-surface-raised p-1 shadow-glow-strong"
        >
          <p className="px-2 pt-1.5 pb-1 text-[11.5px] font-medium text-faint" aria-hidden>
            Suite Atelier
          </p>
          {SUITE_APPS.map((app, index) => {
            const current = app.id === CURRENT_APP
            // App en ligne (Cuisine) : pas d'indicateur, mention discrète « En ligne ».
            const online = !current && app.healthUrl === null
            const state: Health = current ? 'up' : (health[app.id] ?? 'checking')
            const Icon = ICONS[app.id]
            const statusText = online ? ONLINE_TEXT : HEALTH_TEXT[state]
            const label = `${app.name}${current ? ' (application courante)' : ''} — ${statusText}`
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
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-hover focus-visible:bg-surface-hover"
              >
                {/* Chaque tuile prend la couleur signature de SON app (docs/SUITE.md §1.7). */}
                <span
                  className="atelier-brand__tile atelier-brand__tile--sm"
                  data-atelier-app={app.id}
                  aria-hidden="true"
                >
                  <Icon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-ink">
                    <span className="atelier-brand__name atelier-brand__name--sm">
                      <span className="atelier-brand__prefix">Atelier </span>
                      {app.short}
                    </span>
                    {online ? (
                      <span className="text-[11.5px] text-faint">{ONLINE_TEXT}</span>
                    ) : (
                      <span
                        data-state={state}
                        className={cn(
                          'flex items-center gap-1 text-[11.5px]',
                          state === 'down' ? 'font-medium text-down' : 'text-faint',
                        )}
                      >
                        {HEALTH_DOT[state] && (
                          <span
                            className={cn('size-1.5 rounded-full', HEALTH_DOT[state])}
                            aria-hidden
                          />
                        )}
                        {HEALTH_TEXT[state]}
                      </span>
                    )}
                  </span>
                  <span className="block truncate text-[12px] text-muted">{app.description}</span>
                </span>
                <span className="grid size-5 shrink-0 place-items-center text-accent-fg">
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
