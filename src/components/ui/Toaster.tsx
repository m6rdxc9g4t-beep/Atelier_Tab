import { AlertTriangle, Info, OctagonX, X } from 'lucide-react'
import { useNotices } from '@/store'
import { cn } from '@/lib/cn'

/** Messages courts en bas à gauche de la zone de travail. */
export function Toaster() {
  const notices = useNotices((s) => s.notices)
  const dismiss = useNotices((s) => s.dismiss)
  if (notices.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-12 left-1/2 z-40 flex w-[min(460px,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2">
      {notices.map((n) => {
        const Icon = n.tone === 'error' ? OctagonX : n.tone === 'warning' ? AlertTriangle : Info
        return (
          <div
            key={n.id}
            role="status"
            className="pointer-events-auto flex items-start gap-2 rounded-lg border border-edge bg-surface-raised px-3 py-2 shadow-glow-strong"
          >
            <Icon
              size={15}
              className={cn(
                'mt-0.5 shrink-0',
                n.tone === 'error'
                  ? 'text-danger'
                  : n.tone === 'warning'
                    ? 'text-warning'
                    : 'text-accent-fg',
              )}
            />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{n.title}</p>
              {n.detail && (
                <p className="mt-0.5 text-[12px] whitespace-pre-line text-muted">{n.detail}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              aria-label="Fermer"
              className="rounded p-0.5 text-muted hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
