/**
 * État d'interface : table ouverte, sélection (cellule active et plage), édition en cours,
 * recherche rapide, fiche ouverte, sidebar.
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
  /** Cellule active (celle de la barre de formules). */
  selection: CellPosition | null
  /** Autre coin de la plage sélectionnée (Maj + flèches, glisser) ; null : la cellule seule. */
  rangeEnd: CellPosition | null
  editing: EditingState | null
  /** Message affiché quand une saisie est refusée (« 12abc » dans une colonne Devise…). */
  inputError: string | null
  sidebarCollapsed: boolean
  expandedProjectIds: string[]
  /** Non persisté. */
  importRequest: ImportRequest | null
  /** Recherche rapide de la vue (non enregistrée). */
  search: string
  /** Lignes gardées visibles malgré les filtres (ajoutées ou modifiées depuis). */
  pinnedRecordIds: string[]
  /** Fiche détaillée ouverte. */
  expandedRecordId: string | null
  /** Palette de commandes (⌘K). */
  paletteOpen: boolean

  openTable(tableId: string | null): void
  select(cell: CellPosition | null): void
  /** Sélectionne une plage : `anchor` devient la cellule active. */
  selectRange(anchor: CellPosition, end: CellPosition): void
  /** Étend la plage jusqu'à `end` (la cellule active ne change pas). */
  extendTo(end: CellPosition): void
  startEditing(cell: CellPosition, draft: string, origin?: EditingState['origin']): void
  updateDraft(draft: string): void
  stopEditing(): void
  setInputError(message: string | null): void
  toggleSidebar(): void
  toggleProject(projectId: string, expanded?: boolean): void
  openImport(request: ImportRequest): void
  closeImport(): void
  setSearch(search: string): void
  pin(recordIds: string[]): void
  clearPins(): void
  openRecord(recordId: string | null): void
  setPaletteOpen(open: boolean): void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeTableId: DEMO_DEFAULT_TABLE_ID,
      selection: null,
      rangeEnd: null,
      editing: null,
      inputError: null,
      sidebarCollapsed: false,
      expandedProjectIds: ['proj_renovation_2026'],
      importRequest: null,
      search: '',
      pinnedRecordIds: [],
      expandedRecordId: null,
      paletteOpen: false,

      openTable: (tableId) =>
        set({
          activeTableId: tableId,
          selection: null,
          rangeEnd: null,
          editing: null,
          inputError: null,
          search: '',
          pinnedRecordIds: [],
          expandedRecordId: null,
        }),
      select: (cell) => set({ selection: cell, rangeEnd: null, inputError: null }),
      selectRange: (anchor, end) =>
        set({
          selection: anchor,
          rangeEnd: anchor.recordId === end.recordId && anchor.fieldId === end.fieldId ? null : end,
          inputError: null,
        }),
      extendTo: (end) =>
        set((s) =>
          s.selection
            ? {
                rangeEnd:
                  s.selection.recordId === end.recordId && s.selection.fieldId === end.fieldId
                    ? null
                    : end,
              }
            : { selection: end, rangeEnd: null },
        ),
      startEditing: (cell, draft, origin = 'cell') =>
        set({
          selection: cell,
          rangeEnd: null,
          editing: { cell, draft, origin },
          inputError: null,
        }),
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
      setSearch: (search) => set({ search }),
      pin: (recordIds) =>
        set((s) => {
          const fresh = recordIds.filter((id) => !s.pinnedRecordIds.includes(id))
          return fresh.length ? { pinnedRecordIds: [...s.pinnedRecordIds, ...fresh] } : s
        }),
      clearPins: () => set((s) => (s.pinnedRecordIds.length ? { pinnedRecordIds: [] } : s)),
      openRecord: (recordId) => set({ expandedRecordId: recordId, editing: null }),
      setPaletteOpen: (open) => set({ paletteOpen: open }),
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
