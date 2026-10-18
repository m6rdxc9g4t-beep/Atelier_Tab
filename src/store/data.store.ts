/**
 * Store principal : données persistées (espaces, projets, tables, collaborateurs).
 *
 * - Immer pour des mises à jour immuables avec partage structurel : une table non
 *   modifiée garde la même référence, ce qui permet au moteur de ne recalculer que
 *   ce qui a changé.
 * - Persistance via un `StorageAdapter` (IndexedDB par défaut).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { insertField, insertRecord, removeField, removeRecords } from '@/engine/table'
import { createDemoData } from '@/fixtures/demo'
import { newId } from '@/lib/ids'
import { defaultAdapter, type StorageAdapter } from '@/services/persistence'
import type {
  AppData,
  AtelierIntegration,
  CellInput,
  ExportLogEntry,
  Field,
  Table,
  TableRecord,
  ViewMode,
} from '@/types/domain'
import { createDefaultTable, createField, createRecord, createView } from './factories'

export interface DataActions {
  /** Remplace toutes les données (par défaut : données de démonstration). */
  reset(data?: AppData): void

  createWorkspace(name: string): string
  renameWorkspace(workspaceId: string, name: string): void
  deleteWorkspace(workspaceId: string): void

  /** Crée un projet avec une première table. */
  createProject(workspaceId: string, name: string): { projectId: string; tableId: string }
  renameProject(projectId: string, name: string): void
  duplicateProject(projectId: string): string | null
  deleteProject(projectId: string): void

  createTable(projectId: string, name: string): string
  renameTable(tableId: string, name: string): void
  duplicateTable(tableId: string): string | null
  deleteTable(tableId: string): void

  addField(
    tableId: string,
    field: Partial<Field> & Pick<Field, 'label' | 'type'>,
    index?: number,
  ): string
  updateField(tableId: string, fieldId: string, patch: Partial<Omit<Field, 'id'>>): void
  deleteField(tableId: string, fieldId: string): void

  addRecord(
    tableId: string,
    options?: { index?: number; cells?: TableRecord['cells']; kind?: TableRecord['kind'] },
  ): string
  deleteRecords(tableId: string, recordIds: string[]): void
  setCell(tableId: string, recordId: string, fieldId: string, input: CellInput): void
  setRecordKind(tableId: string, recordId: string, kind: TableRecord['kind']): void

  /** Réglages de la connexion à atelier_projets (URL du webhook, jeton). */
  setAtelierIntegration(patch: Partial<Omit<AtelierIntegration, 'lastExport'>>): void
  /** Mémorise le résultat du dernier export (affiché dans la sidebar). */
  logExport(entry: ExportLogEntry): void

  setActiveView(tableId: string, viewId: string): void
  /** Active la première vue du mode demandé, en la créant si besoin. */
  setViewMode(tableId: string, mode: ViewMode): void
}

export type DataState = AppData & DataActions
export type DataStore = ReturnType<typeof createDataStore>

export const DATA_STORAGE_KEY = 'atelier-tab:data'

function pickData(s: AppData): AppData {
  return {
    schemaVersion: s.schemaVersion,
    workspaceOrder: s.workspaceOrder,
    workspaces: s.workspaces,
    projects: s.projects,
    tables: s.tables,
    collaborators: s.collaborators,
    // Données enregistrées avant l'ajout des intégrations : valeur par défaut.
    integrations: s.integrations ?? { atelierProjets: {} },
  }
}

/** Copie profonde d'une table avec un nouvel identifiant (champs et lignes conservent les leurs). */
function cloneTable(table: Table, projectId: string, name = table.name): Table {
  const copy = structuredClone(table)
  return { ...copy, id: newId('tbl'), projectId, name }
}

export function createDataStore(options: { adapter?: StorageAdapter; initialData?: AppData } = {}) {
  const adapter = options.adapter ?? defaultAdapter()

  return create<DataState>()(
    persist(
      immer((set, get) => ({
        ...(options.initialData ?? createDemoData()),

        reset: (data) => set(() => pickData(data ?? createDemoData())),

        // ------------------------------------------------------------ espaces
        createWorkspace: (name) => {
          const id = newId('ws')
          set((s) => {
            s.workspaces[id] = { id, name, projectIds: [] }
            s.workspaceOrder.push(id)
          })
          return id
        },

        renameWorkspace: (workspaceId, name) =>
          set((s) => {
            const ws = s.workspaces[workspaceId]
            if (ws) ws.name = name
          }),

        deleteWorkspace: (workspaceId) =>
          set((s) => {
            const ws = s.workspaces[workspaceId]
            if (!ws) return
            for (const projectId of ws.projectIds) {
              for (const tableId of s.projects[projectId]?.tableIds ?? []) delete s.tables[tableId]
              delete s.projects[projectId]
            }
            delete s.workspaces[workspaceId]
            s.workspaceOrder = s.workspaceOrder.filter((id) => id !== workspaceId)
          }),

        // ------------------------------------------------------------ projets
        createProject: (workspaceId, name) => {
          const projectId = newId('proj')
          const table = createDefaultTable(projectId, 'Table 1')
          set((s) => {
            const ws = s.workspaces[workspaceId]
            if (!ws) throw new Error(`Espace introuvable : ${workspaceId}`)
            s.projects[projectId] = { id: projectId, workspaceId, name, tableIds: [table.id] }
            s.tables[table.id] = table
            ws.projectIds.push(projectId)
          })
          return { projectId, tableId: table.id }
        },

        renameProject: (projectId, name) =>
          set((s) => {
            const p = s.projects[projectId]
            if (p) p.name = name
          }),

        duplicateProject: (projectId) => {
          const source = get().projects[projectId]
          if (!source) return null
          const newProjectId = newId('proj')
          const tables = source.tableIds
            .map((id) => get().tables[id])
            .filter((t): t is Table => t !== undefined)
            .map((t) => cloneTable(t, newProjectId))
          set((s) => {
            s.projects[newProjectId] = {
              id: newProjectId,
              workspaceId: source.workspaceId,
              name: `${source.name} (copie)`,
              tableIds: tables.map((t) => t.id),
            }
            for (const t of tables) s.tables[t.id] = t
            const ws = s.workspaces[source.workspaceId]
            if (ws) ws.projectIds.splice(ws.projectIds.indexOf(projectId) + 1, 0, newProjectId)
          })
          return newProjectId
        },

        deleteProject: (projectId) =>
          set((s) => {
            const p = s.projects[projectId]
            if (!p) return
            for (const tableId of p.tableIds) delete s.tables[tableId]
            const ws = s.workspaces[p.workspaceId]
            if (ws) ws.projectIds = ws.projectIds.filter((id) => id !== projectId)
            delete s.projects[projectId]
          }),

        // ------------------------------------------------------------ tables
        createTable: (projectId, name) => {
          const table = createDefaultTable(projectId, name)
          set((s) => {
            const p = s.projects[projectId]
            if (!p) throw new Error(`Projet introuvable : ${projectId}`)
            s.tables[table.id] = table
            p.tableIds.push(table.id)
          })
          return table.id
        },

        renameTable: (tableId, name) =>
          set((s) => {
            const t = s.tables[tableId]
            if (t) t.name = name
          }),

        duplicateTable: (tableId) => {
          const source = get().tables[tableId]
          if (!source) return null
          const copy = cloneTable(source, source.projectId, `${source.name} (copie)`)
          set((s) => {
            s.tables[copy.id] = copy
            const p = s.projects[source.projectId]
            if (p) p.tableIds.splice(p.tableIds.indexOf(tableId) + 1, 0, copy.id)
          })
          return copy.id
        },

        deleteTable: (tableId) =>
          set((s) => {
            const t = s.tables[tableId]
            if (!t) return
            const p = s.projects[t.projectId]
            if (p) p.tableIds = p.tableIds.filter((id) => id !== tableId)
            delete s.tables[tableId]
          }),

        // ------------------------------------------------------------ champs
        addField: (tableId, partial, index) => {
          const field = createField(partial)
          set((s) => {
            const t = s.tables[tableId]
            if (t) insertField(t, field, index)
          })
          return field.id
        },

        updateField: (tableId, fieldId, patch) =>
          set((s) => {
            const f = s.tables[tableId]?.fields[fieldId]
            if (f) Object.assign(f, patch)
          }),

        deleteField: (tableId, fieldId) =>
          set((s) => {
            const t = s.tables[tableId]
            if (t) removeField(t, fieldId)
          }),

        // ------------------------------------------------------------ lignes
        addRecord: (tableId, opts = {}) => {
          const record = createRecord(opts.cells ?? {}, opts.kind ?? 'data')
          set((s) => {
            const t = s.tables[tableId]
            if (t) insertRecord(t, record, opts.index)
          })
          return record.id
        },

        deleteRecords: (tableId, recordIds) =>
          set((s) => {
            const t = s.tables[tableId]
            if (t) removeRecords(t, recordIds)
          }),

        setCell: (tableId, recordId, fieldId, input) =>
          set((s) => {
            const r = s.tables[tableId]?.records[recordId]
            if (!r) return
            if (input === null || input === '') delete r.cells[fieldId]
            else r.cells[fieldId] = input
          }),

        setRecordKind: (tableId, recordId, kind) =>
          set((s) => {
            const r = s.tables[tableId]?.records[recordId]
            if (r) r.kind = kind
          }),

        // ------------------------------------------------------------ intégration
        setAtelierIntegration: (patch) =>
          set((s) => {
            s.integrations ??= { atelierProjets: {} }
            const target = s.integrations.atelierProjets
            for (const [key, value] of Object.entries(patch) as [
              keyof typeof patch,
              string | undefined,
            ][]) {
              if (value === undefined || value === '') delete target[key]
              else target[key] = value
            }
          }),

        logExport: (entry) =>
          set((s) => {
            s.integrations ??= { atelierProjets: {} }
            s.integrations.atelierProjets.lastExport = entry
          }),

        // ------------------------------------------------------------ vues
        setActiveView: (tableId, viewId) =>
          set((s) => {
            const t = s.tables[tableId]
            if (t && t.views.some((v) => v.id === viewId)) t.activeViewId = viewId
          }),

        setViewMode: (tableId, mode) =>
          set((s) => {
            const t = s.tables[tableId]
            if (!t) return
            let view = t.views.find((v) => v.mode === mode)
            if (!view) {
              const statusField = t.fieldOrder.find((id) => t.fields[id]?.type === 'select')
              view = createView(
                mode,
                mode === 'kanban' && statusField ? { groupByFieldId: statusField } : {},
              )
              t.views.push(view)
            }
            t.activeViewId = view.id
          }),
      })),
      {
        name: DATA_STORAGE_KEY,
        version: 1,
        storage: createJSONStorage(() => adapter),
        partialize: (s) => pickData(s),
        // État enregistré par une version antérieure : on complète les champs manquants.
        merge: (persisted, current) => ({
          ...current,
          ...pickData({ ...current, ...(persisted as Partial<AppData>) }),
        }),
      },
    ),
  )
}
