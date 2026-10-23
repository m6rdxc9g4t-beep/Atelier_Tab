import type { AtelierMapping } from '@/types/domain'

/** Libellés des rôles atelier_projets, tels qu'affichés dans l'interface. */
export const MAPPING_LABELS: Record<AtelierMapping, string> = {
  entity_title: 'Titre de l’entité',
  workflow_state: 'État du workflow',
  financial_ht: 'Montant HT',
  financial_ttc: 'Montant TTC',
  assignee: 'Responsable',
  due_date: 'Échéance',
  start_date: 'Date de début',
  quantity: 'Quantité',
  description: 'Description',
  flag: 'Indicateur oui/non',
  custom: 'Champ libre',
  item_type: 'Type d’élément (Feature, Task, Bug)',
  time_spent: 'Temps passé (heures)',
}
