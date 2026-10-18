/**
 * État d'interface : table ouverte, cellule sélectionnée, sidebar.
 * Persisté dans localStorage (léger, synchrone) pour rouvrir l'application là où on l'a laissée.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEMO_DEFAULT_TABLE_ID } from '@/fixtures/demo'

export interface CellPosition {
  recordId: string
  fieldId: string
}

export interface UIState {
  activeTableId: string | null
  selection: CellPosition | null
  /** Cellule en cours d'édition, et texte initial de l'éditeur. */
  editing: { cell: CellPosition; draft: string } | null
  sidebarCollapsed: boolean
  expandedProjectIds: string[]

  openTable(tableId: string | null): void
  select(cell: CellPosition | null): void
  startEditing(cell: CellPosition, draft: string): void
  updateDraft(draft: string): void
  stopEditing(): void
  toggleSidebar(): void
  toggleProject(projectId: string, expanded?: boolean): void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeTableId: DEMO_DEFAULT_TABLE_ID,
      selection: null,
      editing: null,
      sidebarCollapsed: false,
      expandedProjectIds: ['proj_renovation_2026'],

      openTable: (tableId) => set({ activeTableId: tableId, selection: null, editing: null }),
      select: (cell) => set({ selection: cell }),
      startEditing: (cell, draft) => set({ selection: cell, editing: { cell, draft } }),
      updateDraft: (draft) => set((s) => (s.editing ? { editing: { ...s.editing, draft } } : s)),
      stopEditing: () => set({ editing: null }),
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
