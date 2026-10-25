import { lazy, Suspense, useCallback, useEffect, useState, type DragEvent } from 'react'
import { FileUp } from 'lucide-react'
import { Toaster } from '@/components/ui/Toaster'
import { useAssistant } from '@/store/assistant.store'
import { CommandPalette } from '@/components/command/CommandPalette'
import { FormulaBar } from '@/components/formula-bar/FormulaBar'
import { HybridGrid } from '@/components/grid/HybridGrid'
import { Header } from '@/components/layout/Header'
import { StatusBar } from '@/components/layout/StatusBar'
import { RecordPanel } from '@/components/record/RecordPanel'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ViewBar, VIEW_SEARCH_ID } from '@/components/view/ViewBar'
import { KanbanView } from '@/components/views/KanbanView'
import { useDataStore, useUIStore } from '@/store'
import { redo, undo } from '@/store/history'
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

  // Raccourcis globaux : ⌘J assistant, ⌘K palette, ⌘Z / ⇧⌘Z / Ctrl+Y annuler-rétablir,
  // ⌘F recherche dans la vue (quand le focus est dans la grille).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const target = e.target instanceof Element ? e.target : null
      // Un champ de saisie garde son propre annuler / rétablir.
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]')
      if (key === 'j') {
        e.preventDefault()
        useAssistant.getState().toggle()
      } else if (key === 'k') {
        e.preventDefault()
        const ui = useUIStore.getState()
        ui.setPaletteOpen(!ui.paletteOpen)
      } else if (!typing && (key === 'z' || key === 'y')) {
        e.preventDefault()
        if (key === 'y' || e.shiftKey) redo()
        else undo()
      } else if (key === 'f' && target?.closest('[role="grid"]')) {
        const search = document.getElementById(VIEW_SEARCH_ID)
        if (search) {
          e.preventDefault()
          search.focus()
        }
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
            <Header table={table} />
            <ViewBar table={table} mode={mode} />
            {mode === 'kanban' ? (
              <KanbanView table={table} />
            ) : (
              <>
                <FormulaBar table={table} onCommit={focusGrid} />
                <HybridGrid key={table.id} table={table} plain={mode === 'sheet'} />
              </>
            )}
            <StatusBar table={table} mode={mode} />
            <RecordPanel table={table} />
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
      <CommandPalette />
      <Toaster />
    </div>
  )
}
