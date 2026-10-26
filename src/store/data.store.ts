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
import { applyImport, type ImportChanges } from '@/dataflow/import'
import {
  changeFieldType,
  duplicateField,
  duplicateRecord,
  insertField,
  insertRecord,
  insertRecords,
  moveField,
  moveRecords,
  removeField,
  removeRecords,
  type ConversionOptions,
  type ConversionReport,
} from '@/engine/table'
import { CHOICE_COLORS, choicesFromLabels } from '@/engine/field-types'
import { createDemoData } from '@/fixtures/demo'
import { newId } from '@/lib/ids'
import { defaultAdapter, type StorageAdapter } from '@/services/persistence'
import type {
  AppData,
  AtelierIntegration,
  BadgeColor,
  CellInput,
  ExportLogEntry,
  Field,
  FieldType,
  Table,
  TableRecord,
  View,
  ViewMode,
} from '@/types/domain'
import { buildTable, createDefaultTable, createField, createRecord, createView } from './factories'

/** Écriture d'une cellule dans un lot (collage, recopie, effacement d'une plage). */
export interface CellWrite {
  recordId: string
  fieldId: string
  input: CellInput
}

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
  /**
   * Copie d'une colonne (type, options, formule, valeurs) insérée juste à droite, sous le
   * libellé `label` ; ses références à elle-même visent la copie. Renvoie l'id de la copie.
   */
  duplicateField(tableId: string, fieldId: string, label: string): string | null
  deleteField(tableId: string, fieldId: string): void

  addRecord(
    tableId: string,
    options?: { index?: number; cells?: TableRecord['cells']; kind?: TableRecord['kind'] },
  ): string
  /** Ajoute plusieurs lignes en une fois (une seule réécriture des formules). Renvoie leurs ids. */
  addRecords(tableId: string, cellsList: TableRecord['cells'][], index?: number): string[]
  /** Copie d'une ligne, insérée juste en dessous (formules décalées d'une ligne, comme Excel). */
  duplicateRecord(tableId: string, recordId: string): string | null
  deleteRecords(tableId: string, recordIds: string[]): void
  setCell(tableId: string, recordId: string, fieldId: string, input: CellInput): void
  /** Plusieurs cellules en une seule mise à jour (un seul recalcul). */
  setCells(tableId: string, writes: CellWrite[]): void
  setRecordKind(tableId: string, recordId: string, kind: TableRecord['kind']): void
  /** Déplace des lignes consécutives avant l'index `to` ; les formules suivent. */
  moveRecords(tableId: string, recordIds: string[], to: number): boolean
  /** Déplace une colonne avant l'index `to` ; les formules suivent. */
  moveField(tableId: string, fieldId: string, to: number): boolean
  /** Change le type d'une colonne en convertissant ses valeurs. */
  changeFieldType(
    tableId: string,
    fieldId: string,
    type: FieldType,
    options?: ConversionOptions,
  ): ConversionReport
  /** Ajoute un choix à une colonne Statut ; renvoie son id (celui d'un choix de même libellé s'il existe). */
  addChoice(tableId: string, fieldId: string, label: string): string | null
  /** Remplace une table entière (annuler / rétablir). */
  replaceTable(table: Table): void

  /** Ajoute un collaborateur (colonne Responsable) ; renvoie son id. */
  addCollaborator(name: string): string

  /**
   * Import CSV dans une table existante, en une seule mise à jour (une seule réécriture des
   * formules et un seul recalcul). Renvoie les ids des lignes ajoutées.
   */
  importIntoTable(tableId: string, changes: ImportChanges): string[]
  /** Crée une table à partir d'un import CSV (vues Grille, et Kanban s'il y a un statut). */
  createTableFromImport(projectId: string, name: string, changes: ImportChanges): string

  /** Réglages de la connexion à atelier_projets (URL du webhook, jeton). */
  setAtelierIntegration(patch: Partial<Omit<AtelierIntegration, 'lastExport'>>): void
  /** Mémorise le résultat du dernier export (affiché dans la sidebar). */
  logExport(entry: ExportLogEntry): void

  /** Mode « En ligne » (docs/SUITE.md §5.1) : choix de l'utilisateur seulement (aucun outil IA). */
  setOnlineMode(online: boolean): void

  setActiveView(tableId: string, viewId: string): void
  /** Filtres, tri, champs masqués, regroupement, hauteur des lignes… d'une vue. */
  updateView(tableId: string, viewId: string, patch: Partial<Omit<View, 'id' | 'mode'>>): void
  /** Active la première vue du mode demandé, en la créant si besoin. */
  setViewMode(tableId: string, mode: ViewMode): void
}

export type DataState = AppData & DataActions
export type DataStore = ReturnType<typeof createDataStore>

export const DATA_STORAGE_KEY = 'atelier-tab:data'

/** Données seules (sans les actions), telles qu'elles sont enregistrées. */
export function pickData(s: AppData): AppData {
  return {
    schemaVersion: s.schemaVersion,
    workspaceOrder: s.workspaceOrder,
    workspaces: s.workspaces,
    projects: s.projects,
    tables: s.tables,
    collaborators: s.collaborators,
    // Données enregistrées avant l'ajout des intégrations : valeur par défaut.
    integrations: s.integrations ?? { atelierProjets: {} },
    // Données enregistrées avant l'ajout des réglages : hors ligne.
    preferences: { onlineMode: s.preferences?.onlineMode === true },
  }
}

/** Même contenu une fois écrit en JSON (ordre des clés et valeurs `undefined` ignorés). */
function sameContent(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => sameContent(x, b[i]))
    )
  }
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(x).filter((k) => x[k] !== undefined)
  return (
    keys.length === Object.keys(y).filter((k) => y[k] !== undefined).length &&
    keys.every((k) => sameContent(x[k], y[k]))
  )
}

/**
 * Données relues après une modification externe : ce qui n'a pas changé (une table, ou ses
 * colonnes, lignes, ordres et vues) garde son objet actuel. Une table que l'autre programme n'a
 * pas touchée n'est ainsi ni recalculée ni privée de son historique d'annulation, qui compare
 * les objets.
 */
export function keepUnchanged(current: AppData, next: AppData): AppData {
  const tables: AppData['tables'] = {}
  for (const [id, table] of Object.entries(next.tables)) {
    const was = current.tables[id]
    if (!was || sameContent(was, table)) {
      tables[id] = was ?? table
      continue
    }
    const part = <K extends keyof Table>(key: K): Table[K] =>
      sameContent(was[key], table[key]) ? was[key] : table[key]
    tables[id] = {
      ...table,
      fields: part('fields'),
      records: part('records'),
      rowOrder: part('rowOrder'),
      fieldOrder: part('fieldOrder'),
      views: part('views'),
    }
  }
  const collaborators = sameContent(current.collaborators, next.collaborators)
    ? current.collaborators
    : next.collaborators
  return { ...next, tables, collaborators }
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

        duplicateField: (tableId, fieldId, label) => {
          const field = get().tables[tableId]?.fields[fieldId]
          if (!field) return null
          const copy = createField({
            label,
            type: field.type,
            ...(field.options ? { options: structuredClone(field.options) } : {}),
            ...(field.width ? { width: field.width } : {}),
          })
          let done = false
          set((s) => {
            const t = s.tables[tableId]
            if (t) done = duplicateField(t, fieldId, copy)
          })
          return done ? copy.id : null
        },

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

        addRecords: (tableId, cellsList, index) => {
          const records = cellsList.map((cells) => createRecord(cells))
          set((s) => {
            const t = s.tables[tableId]
            if (t) insertRecords(t, records, index)
          })
          return records.map((r) => r.id)
        },

        duplicateRecord: (tableId, recordId) => {
          const source = get().tables[tableId]?.records[recordId]
          if (!source) return null
          // Cellules recopiées dans le producteur, formules décalées pour la nouvelle ligne.
          const copy = createRecord({}, source.kind)
          let done = false
          set((s) => {
            const t = s.tables[tableId]
            if (t) done = duplicateRecord(t, recordId, copy)
          })
          return done ? copy.id : null
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

        setCells: (tableId, writes) =>
          set((s) => {
            const t = s.tables[tableId]
            if (!t) return
            for (const { recordId, fieldId, input } of writes) {
              const r = t.records[recordId]
              if (!r || !t.fields[fieldId]) continue
              if (input === null || input === '') delete r.cells[fieldId]
              else r.cells[fieldId] = input
            }
          }),

        moveRecords: (tableId, recordIds, to) => {
          let moved = false
          set((s) => {
            const t = s.tables[tableId]
            if (t) moved = moveRecords(t, recordIds, to)
          })
          return moved
        },

        moveField: (tableId, fieldId, to) => {
          let moved = false
          set((s) => {
            const t = s.tables[tableId]
            if (t) moved = moveField(t, fieldId, to)
          })
          return moved
        },

        changeFieldType: (tableId, fieldId, type, options) => {
          let report: ConversionReport = { converted: 0, kept: 0 }
          const ctx = { collaborators: get().collaborators }
          set((s) => {
            const t = s.tables[tableId]
            if (t) report = changeFieldType(t, fieldId, type, ctx, options)
          })
          return report
        },

        addChoice: (tableId, fieldId, label) => {
          const clean = label.trim()
          const field = get().tables[tableId]?.fields[fieldId]
          if (!clean || field?.type !== 'select') return null
          const existing = field.options?.choices ?? []
          const same = existing.find(
            (c) => c.label.localeCompare(clean, 'fr', { sensitivity: 'base' }) === 0,
          )
          if (same) return same.id
          const [choice] = choicesFromLabels([clean], existing, existing.length)
          if (!choice) return null
          set((s) => {
            const f = s.tables[tableId]?.fields[fieldId]
            if (!f) return
            f.options = { ...f.options, choices: [...(f.options?.choices ?? []), choice] }
          })
          return choice.id
        },

        replaceTable: (table) =>
          set((s) => {
            s.tables[table.id] = table
          }),

        addCollaborator: (name) => {
          const clean = name.trim()
          if (!clean) throw new Error('Nom de collaborateur vide')
          const same = Object.values(get().collaborators).find(
            (c) => c.name.localeCompare(clean, 'fr', { sensitivity: 'base' }) === 0,
          )
          if (same) return same.id
          const id = newId('usr')
          const words = clean.split(/\s+/)
          const letters =
            words.length > 1
              ? `${words[0]?.[0] ?? ''}${words.at(-1)?.[0] ?? ''}`
              : clean.slice(0, 2)
          const count = Object.keys(get().collaborators).length
          const color = CHOICE_COLORS[count % CHOICE_COLORS.length] as BadgeColor
          set((s) => {
            s.collaborators[id] = {
              id,
              name: clean,
              initials: letters.toLocaleUpperCase('fr'),
              color,
            }
          })
          return id
        },

        setRecordKind: (tableId, recordId, kind) =>
          set((s) => {
            const r = s.tables[tableId]?.records[recordId]
            if (r) r.kind = kind
          }),

        // ------------------------------------------------------------ import
        importIntoTable: (tableId, changes) => {
          let inserted: string[] = []
          set((s) => {
            const t = s.tables[tableId]
            if (!t) throw new Error(`Table introuvable : ${tableId}`)
            inserted = applyImport(t, changes)
          })
          return inserted
        },

        createTableFromImport: (projectId, name, changes) => {
          if (!get().projects[projectId]) throw new Error(`Projet introuvable : ${projectId}`)
          const table = buildTable({
            id: newId('tbl'),
            projectId,
            name,
            fields: [],
            records: [],
            views: [createView('hybrid')],
          })
          applyImport(table, changes)
          if (table.fieldOrder.length === 0) {
            insertField(
              table,
              createField({ label: 'Nom', type: 'text', atelierMapping: 'entity_title' }),
            )
          }
          const status =
            table.fieldOrder.find((id) => table.fields[id]?.atelierMapping === 'workflow_state') ??
            table.fieldOrder.find((id) => table.fields[id]?.type === 'select')
          if (status) table.views.push(createView('kanban', { groupByFieldId: status }))
          set((s) => {
            const p = s.projects[projectId]
            if (!p) return
            s.tables[table.id] = table
            p.tableIds.push(table.id)
          })
          return table.id
        },

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

        setOnlineMode: (online) =>
          set((s) => {
            s.preferences = { onlineMode: online }
          }),

        // ------------------------------------------------------------ vues
        setActiveView: (tableId, viewId) =>
          set((s) => {
            const t = s.tables[tableId]
            if (t && t.views.some((v) => v.id === viewId)) t.activeViewId = viewId
          }),

        updateView: (tableId, viewId, patch) =>
          set((s) => {
            const view = s.tables[tableId]?.views.find((v) => v.id === viewId)
            if (view) Object.assign(view, patch)
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
