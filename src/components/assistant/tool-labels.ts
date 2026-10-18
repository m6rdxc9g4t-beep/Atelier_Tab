/** Libellés lisibles des actions de l'assistant (« Modification de 2 cellules… »). */
import type { AppData } from '@/types/domain'

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`
}

export function describeToolCall(
  name: string,
  args: Record<string, unknown>,
  tables: AppData['tables'],
): string {
  const ref = args.table
  const table = typeof ref === 'string' ? (tables[ref]?.name ?? ref) : 'la table'
  const count = (key: string) => (Array.isArray(args[key]) ? (args[key] as unknown[]).length : 0)
  const text = (key: string) => String(args[key] ?? '')
  switch (name) {
    case 'list_tables':
      return 'Liste des tables'
    case 'read_table':
      return `Lecture de « ${table} »`
    case 'set_cells':
      return `Modification de ${plural(count('cells'), 'cellule')} dans « ${table} »`
    case 'add_rows':
      return `Ajout de ${plural(count('rows'), 'ligne')} dans « ${table} »`
    case 'delete_rows':
      return `Suppression de ${plural(count('rows'), 'ligne')} dans « ${table} »`
    case 'add_column':
      return `Ajout de la colonne « ${text('label')} »`
    case 'update_column':
      return `Modification de la colonne « ${text('column')} »`
    case 'delete_column':
      return `Suppression de la colonne « ${text('column')} »`
    case 'create_project':
      return `Création du projet « ${text('name')} »`
    case 'create_table':
      return `Création de la table « ${text('name')} »`
    case 'rename':
      return `Renommage en « ${text('name')} »`
    case 'evaluate':
      return `Calcul de ${text('formula')}`
    case 'check_export':
      return `Vérification de l’export de « ${table} »`
    case 'export_table':
      return `Export ${text('format').toUpperCase()} de « ${table} »`
    default:
      return name
  }
}
