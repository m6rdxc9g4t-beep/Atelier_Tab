import { useState, type KeyboardEvent } from 'react'
import { SquareFunction } from 'lucide-react'
import { CATEGORY_LABELS } from '@/engine/formula'
import { Floating } from '@/components/ui/Floating'
import { cn } from '@/lib/cn'
import { SignatureHint } from './FormulaAssist'
import { applySuggestion, formulaContext, type FormulaContext } from './formula-suggest'

/**
 * Autocomplétion des fonctions et aide sur la syntaxe, pour un champ de saisie de formule.
 * `useFormulaAssist` suit le texte et le curseur ; `onKeyDown` gère ↑ ↓ Tab Échap tant que la
 * liste est ouverte (renvoie vrai si la touche est prise) ; `panel` s'affiche sous le champ
 * (parent `relative`), ou sous `anchor` dans un panneau flottant quand il est fourni.
 */
export function useFormulaAssist(options: {
  value: string
  onChange: (text: string) => void
  /** Champ de saisie, pour replacer le curseur après une insertion. */
  getInput: () => HTMLInputElement | HTMLTextAreaElement | null
  /**
   * Élément sous lequel ouvrir l'aide, rendue dans `<body>` : pour un champ placé dans une zone
   * qui rogne son contenu (cellule de la grille). `null` tant que l'élément n'est pas monté.
   * Pas dans un panneau flottant : un clic dans l'aide serait un clic extérieur, qui le ferme.
   */
  anchor?: HTMLElement | null
}) {
  const { value, onChange, getInput, anchor } = options
  const [caret, setCaret] = useState(value.length)
  const [highlight, setHighlight] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [navigated, setNavigated] = useState(false)

  const ctx: FormulaContext = formulaContext(value, Math.min(caret, value.length))
  const open = ctx.suggestions.length > 0 && dismissed !== `${ctx.start}:${ctx.prefix}`
  const active = Math.min(highlight, Math.max(ctx.suggestions.length - 1, 0))

  const sync = () => {
    const el = getInput()
    if (el) setCaret(el.selectionStart ?? el.value.length)
  }

  const accept = (name: string) => {
    const next = applySuggestion(value, ctx, name)
    onChange(next.text)
    setHighlight(0)
    setNavigated(false)
    requestAnimationFrame(() => {
      const el = getInput()
      if (!el) return
      el.focus()
      el.setSelectionRange(next.caret, next.caret)
      setCaret(next.caret)
    })
  }

  /** Renvoie vrai si la touche a été traitée par la liste de suggestions. */
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
    if (!open) return false
    const n = ctx.suggestions.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
      setNavigated(true)
      return true
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && navigated)) {
      e.preventDefault()
      const chosen = ctx.suggestions[active]
      if (chosen) accept(chosen.insert)
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setDismissed(`${ctx.start}:${ctx.prefix}`)
      return true
    }
    return false
  }

  const content =
    open || ctx.call ? (
      // Un clic dans l'aide laisse le focus (et le curseur) dans le champ.
      <div onMouseDown={(e) => e.preventDefault()}>
        {open ? (
          <ul role="listbox" aria-label="Fonctions" className="max-h-64 overflow-y-auto p-1">
            {ctx.suggestions.map((s, i) => (
              <li
                key={s.insert}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  accept(s.insert)
                }}
                className={cn(
                  'flex cursor-pointer flex-col rounded-md px-2 py-1',
                  i === active && 'bg-surface-hover',
                )}
              >
                <span className="flex items-center gap-2">
                  <SquareFunction size={12} className="shrink-0 text-accent-fg" aria-hidden />
                  <span className="font-mono font-semibold text-ink">{s.insert}</span>
                  {s.doc.fr && s.insert !== s.doc.name && (
                    <span className="font-mono text-[11px] text-faint">{s.doc.name}</span>
                  )}
                  <span className="ml-auto text-[11px] text-faint">
                    {CATEGORY_LABELS[s.doc.category]}
                  </span>
                </span>
                {i === active && <span className="pl-5 text-muted">{s.doc.description}</span>}
              </li>
            ))}
            <li className="px-2 pt-1 text-[11px] text-faint">
              Tab pour insérer · Échap pour fermer
            </li>
          </ul>
        ) : (
          ctx.call && <SignatureHint doc={ctx.call.doc} arg={ctx.call.arg} />
        )}
      </div>
    ) : null

  const panel =
    content === null ? null : anchor !== undefined ? (
      // Sans fermeture propre : le champ garde le clavier (Échap, ↑ ↓, Tab).
      <Floating open anchor={anchor} className={cn(PANEL, 'p-0')}>
        {content}
      </Floating>
    ) : (
      <div
        className={cn(
          PANEL,
          'absolute top-full left-0 z-40 mt-1 rounded-lg border border-edge bg-surface-raised shadow-glow-strong',
        )}
      >
        {content}
      </div>
    )

  return { onKeyDown, sync, panel, open }
}

const PANEL = 'w-[min(420px,calc(100vw-2rem))] overflow-hidden text-[12.5px]'
