import { lazy, Suspense, useCallback, useEffect, useState, type DragEvent } from 'react'
import { Columns3, FileUp } from 'lucide-react'
import { Toaster } from '@/components/ui/Toaster'
import { useAssistant } from '@/store/assistant.store'
import { FormulaBar } from '@/components/formula-bar/FormulaBar'
import { HybridGrid } from '@/components/grid/HybridGrid'
import { Header } from '@/components/layout/Header'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { useDataStore, useUIStore } from '@/store'
import { isCsvFile } from '@/store/import-actions'

// Chargé à la première ouverture : l'assistant n'alourdit pas le démarrage.
const AssistantPanel = lazy(() =>
  import('@/components/assistant/AssistantPanel').then((m) => ({ default: m.AssistantPanel })),
)

// Chargé à la première ouverture, comme l'export.
const ImportDialog = lazy(() =>
  import('@/components/dataflow/ImportDialog').then((m) => ({ default: m.ImportDialog })),
)

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

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
  const importOpen = useUIStore((s) => s.importRequest !== null)
  const [dropping, setDropping] = useState(false)

  // Fichier CSV glissé sur la zone de travail : assistant d'import sur la table ouverte.
  const onDragOver = (e: DragEvent) => {
    if (!table || importOpen || !hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropping(true)
  }
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
  }
  const onDrop = (e: DragEvent) => {
    if (!table || importOpen || !hasFiles(e)) return
    e.preventDefault()
    setDropping(false)
    const file = Array.from(e.dataTransfer.files).find(isCsvFile) ?? e.dataTransfer.files[0]
    if (file) {
      useUIStore.getState().openImport({ projectId: table.projectId, tableId: table.id, file })
    }
  }

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
      <main
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dropping && (
          <div className="pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-accent-soft/80 backdrop-blur-[1px]">
            <div className="flex flex-col items-center gap-2 text-center">
              <FileUp size={26} className="text-accent-fg" />
              <p className="font-medium text-ink">Déposez le fichier CSV pour l’importer</p>
            </div>
          </div>
        )}
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
      {importOpen && (
        <Suspense fallback={null}>
          <ImportDialog />
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
