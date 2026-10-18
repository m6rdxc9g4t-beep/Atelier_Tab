import { lazy, Suspense, useCallback, useEffect } from 'react'
import { Columns3 } from 'lucide-react'
import { Toaster } from '@/components/ui/Toaster'
import { useAssistant } from '@/store/assistant.store'
import { FormulaBar } from '@/components/formula-bar/FormulaBar'
import { HybridGrid } from '@/components/grid/HybridGrid'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { useDataStore, useUIStore } from '@/store'

// Chargé à la première ouverture : l'assistant n'alourdit pas le démarrage.
const AssistantPanel = lazy(() =>
  import('@/components/assistant/AssistantPanel').then((m) => ({ default: m.AssistantPanel })),
)

export function App() {
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const activeTableId = useUIStore((s) => s.activeTableId)
  // Repli sur la première table si la table mémorisée n'existe plus.
  const table = useDataStore((s) =>
    activeTableId && s.tables[activeTableId] ? s.tables[activeTableId] : Object.values(s.tables)[0],
  )

  const focusGrid = useCallback(() => {
    document.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true })
  }, [])

  const mode = table?.views.find((v) => v.id === table.activeViewId)?.mode ?? 'hybrid'
  const assistantOpen = useAssistant((s) => s.open)

  // ⌘J / Ctrl+J : afficher ou masquer l'assistant.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        useAssistant.getState().toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-dvh overflow-hidden">
      {!sidebarCollapsed && <Sidebar />}
      <main className="flex min-w-0 flex-1 flex-col">
        {table ? (
          <>
            <Header table={table} mode={mode} />
            {mode === 'kanban' ? (
              <KanbanPlaceholder />
            ) : (
              <>
                <FormulaBar table={table} onCommit={focusGrid} />
                <HybridGrid key={table.id} table={table} plain={mode === 'sheet'} />
              </>
            )}
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-muted">
            Créez un projet dans le panneau de gauche pour commencer.
          </div>
        )}
      </main>
      {assistantOpen && (
        <Suspense fallback={<div className="w-[380px] shrink-0 border-l border-line" />}>
          <AssistantPanel />
        </Suspense>
      )}
      <Toaster />
    </div>
  )
}

function KanbanPlaceholder() {
  return (
    <div className="grid flex-1 place-items-center">
      <div className="flex max-w-sm flex-col items-center gap-2 text-center text-muted">
        <Columns3 size={22} className="text-faint" />
        <p className="font-medium text-ink">La vue Kanban arrive dans une prochaine version</p>
        <p>
          Les lignes y seront regroupées en colonnes selon leur statut, avec les montants calculés
          sur chaque carte.
        </p>
      </div>
    </div>
  )
}
