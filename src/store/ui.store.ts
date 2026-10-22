/**
 * État d'interface : table ouverte, cellule sélectionnée, édition en cours, sidebar.
 * Seuls la table ouverte, la sidebar et les projets dépliés sont persistés (localStorage).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEMO_DEFAULT_TABLE_ID } from '@/fixtures/demo'

export interface CellPosition {
  recordId: string
  fieldId: string
}

export interface EditingState {
  cell: CellPosition
  draft: string
  /** Où se trouve le curseur : dans la cellule ou dans la barre de formules. */
  origin: 'cell' | 'bar'
}

/** Assistant d'import CSV ouvert : projet et table de destination proposés, fichier éventuel. */
export interface ImportRequest {
  projectId: string
  /** Table proposée comme destination ; nul : nouvelle table. */
  tableId: string | null
  /** Fichier déposé sur l'app ; absent : l'assistant demande un fichier. */
  file?: File
}

export interface UIState {
  activeTableId: string | null
  selection: CellPosition | null
  editing: EditingState | null
  /** Message affiché quand une saisie est refusée (« 12abc » dans une colonne Devise…). */
  inputError: string | null
  sidebarCollapsed: boolean
  expandedProjectIds: string[]
  /** Non persisté. */
  importRequest: ImportRequest | null

  openTable(tableId: string | null): void
  select(cell: CellPosition | null): void
  startEditing(cell: CellPosition, draft: string, origin?: EditingState['origin']): void
  updateDraft(draft: string): void
  stopEditing(): void
  setInputError(message: string | null): void
  toggleSidebar(): void
  toggleProject(projectId: string, expanded?: boolean): void
  openImport(request: ImportRequest): void
  closeImport(): void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeTableId: DEMO_DEFAULT_TABLE_ID,
      selection: null,
      editing: null,
      inputError: null,
      sidebarCollapsed: false,
      expandedProjectIds: ['proj_renovation_2026'],
      importRequest: null,

      openTable: (tableId) =>
        set({ activeTableId: tableId, selection: null, editing: null, inputError: null }),
      select: (cell) => set({ selection: cell, inputError: null }),
      startEditing: (cell, draft, origin = 'cell') =>
        set({ selection: cell, editing: { cell, draft, origin }, inputError: null }),
      updateDraft: (draft) =>
        set((s) => (s.editing ? { editing: { ...s.editing, draft }, inputError: null } : s)),
      stopEditing: () => set({ editing: null }),
      setInputError: (message) => set({ inputError: message }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleProject: (projectId, expanded) =>
        set((s) => {
          const isOpen = s.expandedProjectIds.includes(projectId)
          const open = expanded ?? !isOpen
          if (open === isOpen) return s
          return {
            expandedProjectIds: open
              ? [...s.expandedProjectIds, projectId]
              : s.expandedProjectIds.filter((id) => id !== projectId),
          }
        }),
      openImport: (request) => set({ importRequest: request, editing: null }),
      closeImport: () => set({ importRequest: null }),
    }),
    {
      name: 'atelier-tab:ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        activeTableId: s.activeTableId,
        sidebarCollapsed: s.sidebarCollapsed,
        expandedProjectIds: s.expandedProjectIds,
      }),
    },
  ),
)
