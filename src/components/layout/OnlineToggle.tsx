/**
 * Interrupteur « Hors ligne / En ligne » de l'en-tête (docs/SUITE.md §5.1), comme Atelier Viz.
 * Hors ligne par défaut ; mémorisé hors du dossier de données (fichier de préférences du
 * processus principal, `setOnlineModeByUser`). C'est le seul moyen de passer en ligne : aucun
 * outil d'IA ne peut le faire.
 */
import { Cloud, HardDrive } from 'lucide-react'
import { useDataStore } from '@/store'
import { setOnlineModeByUser } from '@/store/preferences-actions'
import { useNotices } from '@/store/notices.store'
import { cn } from '@/lib/cn'

export function OnlineToggle({ labelClassName }: { labelClassName?: string }) {
  const online = useDataStore((s) => s.preferences?.onlineMode === true)
  const Icon = online ? Cloud : HardDrive
  return (
    <button
      type="button"
      role="switch"
      aria-checked={online}
      aria-label="Mode en ligne"
      onClick={() =>
        void setOnlineModeByUser(!online).catch((e: unknown) =>
          useNotices.getState().push({
            tone: 'warning',
            title: 'Réglage non enregistré',
            detail: e instanceof Error ? e.message : String(e),
          }),
        )
      }
      title={
        online
          ? 'En ligne : Claude est autorisé dans l’assistant. Cliquer pour repasser en local.'
          : 'Hors ligne : tout reste sur la machine. Cliquer pour activer Claude.'
      }
      className={cn(
        'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors',
        online
          ? 'border-accent/40 bg-accent-soft text-accent-fg'
          : 'border-line text-muted hover:bg-surface-hover hover:text-ink',
      )}
    >
      <Icon size={13} aria-hidden />
      <span className={labelClassName}>{online ? 'En ligne' : 'Hors ligne'}</span>
    </button>
  )
}
