import { Table2 } from 'lucide-react'
import { ThemeToggle } from '@/components/layout/ThemeToggle'

/**
 * Coquille provisoire (phase 0). La sidebar, la barre de formules et la grille
 * hybride viendront la remplacer dans les phases 3 et 4.
 */
export function App() {
  return (
    <div className="flex h-dvh">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface-sunken">
        <div className="flex h-11 items-center gap-2 border-b border-line px-3 font-semibold">
          <Table2 size={16} className="text-accent" />
          Atelier_Tab
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 items-center justify-between border-b border-line px-4">
          <span className="text-muted">Aucun projet ouvert</span>
          <ThemeToggle />
        </header>
        <div className="grid flex-1 place-items-center text-muted">
          Socle prêt : la grille hybride arrive en phase 3.
        </div>
      </main>
    </div>
  )
}
