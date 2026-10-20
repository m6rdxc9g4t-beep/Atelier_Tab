/**
 * Interrupteur « Hors ligne / En ligne » de l'en-tête (docs/SUITE.md §5.1), comme Atelier Viz.
 * Hors ligne par défaut ; mémorisé dans atelier.json (`preferences.onlineMode`). C'est le seul
 * moyen de passer en ligne : aucun outil d'IA ne peut le faire.
 */
import { Cloud, HardDrive } from 'lucide-react'
import { useDataStore } from '@/store'
import { cn } from '@/lib/cn'

export function OnlineToggle({ labelClassName }: { labelClassName?: string }) {
  const online = useDataStore((s) => s.preferences?.onlineMode === true)
  const setOnlineMode = useDataStore((s) => s.setOnlineMode)
  const Icon = online ? Cloud : HardDrive
  return (
    <button
      type="button"
      role="switch"
      aria-checked={online}
      aria-label="Mode en ligne"
      onClick={() => setOnlineMode(!online)}
      title={
        online
          ? 'En ligne : Claude est autorisé dans l’assistant. Cliquer pour repasser en local.'
          : 'Hors ligne : tout reste sur la machine. Cliquer pour activer Claude.'
      }
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors',
        online
          ? 'border-accent/40 bg-accent-soft text-accent'
          : 'border-line text-muted hover:bg-surface-hover hover:text-ink',
      )}
    >
      <Icon size={13} aria-hidden />
      <span className={labelClassName}>{online ? 'En ligne' : 'Hors ligne'}</span>
    </button>
  )
}
