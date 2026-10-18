/**
 * Modèle de domaine d'Atelier_Tab.
 *
 * Règle d'or : les identifiants sont stables, les coordonnées sont dérivées.
 * La lettre d'une colonne vient de sa position dans `fieldOrder`, le numéro d'une
 * ligne de sa position dans `rowOrder`.
 */
import type { CellInput } from '@/engine/formula'

export type { CellInput }

export type FieldType =
  'text' | 'number' | 'currency' | 'percent' | 'select' | 'date' | 'checkbox' | 'owner' | 'formula'

export type BadgeColor = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'violet' | 'pink' | 'teal'

export interface SelectChoice {
  id: string
  label: string
  color: BadgeColor
}

export type CurrencyCode = 'EUR' | 'USD' | 'GBP' | 'CHF'

export interface FieldOptions {
  /** Champ `select` : choix possibles, dans l'ordre (aussi l'ordre des colonnes Kanban). */
  choices?: SelectChoice[]
  /** Champ `currency`. */
  currency?: CurrencyCode
  /** Nombre de décimales affichées (number, currency, percent, formula). */
  decimals?: number
  /** Champ `formula` : format d'affichage du résultat. */
  resultFormat?: 'number' | 'currency' | 'percent' | 'text'
}

/** Rôle d'une colonne côté `atelier_projets`. */
export type AtelierMapping =
  | 'entity_title'
  | 'workflow_state'
  | 'financial_ht'
  | 'financial_ttc'
  | 'assignee'
  | 'due_date'
  | 'start_date'
  | 'quantity'
  | 'description'
  | 'flag'
  | 'custom'

export interface Field {
  id: string
  label: string
  type: FieldType
  options?: FieldOptions
  /**
   * Champ `formula` : modèle écrit pour la ligne 1 (ex. `=C1*1.2`), recopié sur chaque
   * ligne de données comme une poignée de recopie Excel (`=C2*1.2` en ligne 2…).
   */
  columnFormula?: string
  atelierMapping?: AtelierMapping
  /** Largeur d'affichage en pixels. */
  width?: number
}

/**
 * Valeur stockée d'une cellule, selon le type de champ :
 * - text → string · number / currency / percent → number (pourcentage en fraction : 0.2)
 * - select → id du choix · owner → id du collaborateur · date → "AAAA-MM-JJ"
 * - checkbox → boolean · n'importe quel champ → formule "=…"
 */
export type CellStore = Record<string, CellInput>

export interface TableRecord {
  id: string
  /** `summary` : ligne de synthèse (total…), exclue des agrégats et des enregistrements exportés. */
  kind: 'data' | 'summary'
  cells: CellStore
}

export type ViewMode = 'hybrid' | 'sheet' | 'kanban'

export type FilterOperator =
  'contains' | 'equals' | 'not_equals' | 'is_empty' | 'is_not_empty' | 'gt' | 'lt'

export interface Filter {
  id: string
  fieldId: string
  operator: FilterOperator
  value?: string | number | boolean
}

export interface Sort {
  fieldId: string
  direction: 'asc' | 'desc'
}

export interface View {
  id: string
  name: string
  mode: ViewMode
  filters: Filter[]
  sorts: Sort[]
  /** Kanban : champ `select` qui définit les colonnes. */
  groupByFieldId?: string
  hiddenFieldIds: string[]
}

export interface Table {
  id: string
  projectId: string
  name: string
  fieldOrder: string[]
  rowOrder: string[]
  fields: Record<string, Field>
  records: Record<string, TableRecord>
  views: View[]
  activeViewId: string
}

export interface Project {
  id: string
  workspaceId: string
  name: string
  tableIds: string[]
}

export interface Workspace {
  id: string
  name: string
  projectIds: string[]
}

export interface Collaborator {
  id: string
  name: string
  initials: string
  color: BadgeColor
}

/** État persistant complet. */
export interface AppData {
  schemaVersion: 1
  workspaceOrder: string[]
  workspaces: Record<string, Workspace>
  projects: Record<string, Project>
  tables: Record<string, Table>
  collaborators: Record<string, Collaborator>
}
