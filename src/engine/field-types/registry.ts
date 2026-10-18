import type { AtelierMapping, FieldType } from '@/types/domain'

export interface FieldTypeSpec {
  type: FieldType
  label: string
  /** Nom d'icône Lucide (résolu côté interface). */
  icon: string
  align: 'left' | 'right' | 'center'
  /** Valeurs numériques : agrégées dans le pied de grille. */
  numeric: boolean
  /** Rôle `atelier_projets` proposé par défaut. */
  defaultMapping: AtelierMapping
}

export const FIELD_TYPES: Record<FieldType, FieldTypeSpec> = {
  text: {
    type: 'text',
    label: 'Texte',
    icon: 'Type',
    align: 'left',
    numeric: false,
    defaultMapping: 'custom',
  },
  number: {
    type: 'number',
    label: 'Nombre',
    icon: 'Hash',
    align: 'right',
    numeric: true,
    defaultMapping: 'quantity',
  },
  currency: {
    type: 'currency',
    label: 'Devise',
    icon: 'Euro',
    align: 'right',
    numeric: true,
    defaultMapping: 'financial_ht',
  },
  percent: {
    type: 'percent',
    label: 'Pourcentage',
    icon: 'Percent',
    align: 'right',
    numeric: true,
    defaultMapping: 'custom',
  },
  select: {
    type: 'select',
    label: 'Statut',
    icon: 'CircleDot',
    align: 'left',
    numeric: false,
    defaultMapping: 'workflow_state',
  },
  date: {
    type: 'date',
    label: 'Date',
    icon: 'Calendar',
    align: 'left',
    numeric: false,
    defaultMapping: 'due_date',
  },
  checkbox: {
    type: 'checkbox',
    label: 'Case à cocher',
    icon: 'SquareCheck',
    align: 'center',
    numeric: false,
    defaultMapping: 'flag',
  },
  owner: {
    type: 'owner',
    label: 'Responsable',
    icon: 'User',
    align: 'left',
    numeric: false,
    defaultMapping: 'assignee',
  },
  formula: {
    type: 'formula',
    label: 'Formule',
    icon: 'SquareFunction',
    align: 'right',
    numeric: true,
    defaultMapping: 'custom',
  },
}

export const FIELD_TYPE_LIST: FieldTypeSpec[] = Object.values(FIELD_TYPES)
