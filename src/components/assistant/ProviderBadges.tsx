/**
 * Pastilles d'état « Ollama » et « Claude » de l'en-tête (docs/SUITE.md §5.2) : vert =
 * disponible, gris = indisponible ou hors ligne ; le détail est dans l'info-bulle. Un clic
 * revérifie les deux moteurs.
 */
import { useEffect } from 'react'
import { refreshAiStatus, startAiStatusWatch, useAiStatus } from '@/store/ai-status.store'
import { cn } from '@/lib/cn'
import { claudeBadge, ollamaBadge } from './provider-status'

export function ProviderBadges({ className }: { className?: string }) {
  const ollama = useAiStatus((s) => s.ollama)
  const claude = useAiStatus((s) => s.claude)
  const checking = useAiStatus((s) => s.checkingOllama || s.checkingClaude)
  useEffect(() => startAiStatusWatch(), [])

  const badges = [
    { name: 'Ollama', ...ollamaBadge(ollama) },
    { name: 'Claude', ...claudeBadge(claude) },
  ]
  return (
    <button
      type="button"
      onClick={() => void refreshAiStatus(true)}
      aria-label={`Moteurs d’IA : ${badges.map((b) => `${b.name} ${b.available ? 'disponible' : 'indisponible'}`).join(', ')}. Revérifier`}
      title={`${badges.map((b) => b.detail).join('\n')}\n\nCliquer pour revérifier.`}
      aria-busy={checking}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-full text-muted hover:text-ink',
        className,
      )}
    >
      {badges.map((b) => (
        <span
          key={b.name}
          className="flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-[12px]"
        >
          <span
            aria-hidden
            className={cn('size-1.5 rounded-full', b.available ? 'bg-success' : 'bg-faint')}
          />
          {b.name}
        </span>
      ))}
    </button>
  )
}
