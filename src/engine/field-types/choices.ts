/**
 * Fabrique de choix de champ `select` à partir de libellés : ids lisibles et stables
 * (`opt_en_cours`), libellés existants conservés, statuts de workflow reconnus affichés
 * avec leur couleur officielle. Module pur, partagé par les outils d'IA et l'import CSV.
 */
import type { BadgeColor, SelectChoice } from '@/types/domain'
import { workflowStatus, workflowStatusCode } from './workflow-status'

/** Teintes attribuées tour à tour aux choix qui ne sont pas des statuts de workflow. */
export const CHOICE_COLORS: readonly BadgeColor[] = [
  'gray',
  'blue',
  'green',
  'amber',
  'red',
  'violet',
  'pink',
  'teal',
]

function slug(label: string): string {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'choix'
  )
}

/**
 * Choix correspondant à `labels`, dans l'ordre. Un libellé déjà présent dans `existing`
 * (sans tenir compte de la casse ni des accents) garde son id et sa couleur.
 * `colorOffset` décale la teinte des nouveaux choix (ajout à une liste existante).
 */
export function choicesFromLabels(
  labels: readonly string[],
  existing: readonly SelectChoice[] = [],
  colorOffset = 0,
): SelectChoice[] {
  const used = new Set<string>()
  return labels.map((label, i) => {
    const keep = existing.find(
      (c) => c.label.localeCompare(label, 'fr', { sensitivity: 'base' }) === 0,
    )
    if (keep) {
      used.add(keep.id)
      return { ...keep, label }
    }
    const base = `opt_${slug(label)}`
    let id = base
    for (let n = 2; used.has(id) || existing.some((c) => c.id === id && c.label !== label); n++) {
      id = `${base}_${n}`
    }
    used.add(id)
    // Un statut de workflow reconnu prend la teinte de sa couleur officielle.
    const code = workflowStatusCode(label)
    const color = code
      ? workflowStatus(code).color
      : (CHOICE_COLORS[(i + colorOffset) % CHOICE_COLORS.length] as BadgeColor)
    return { id, label, color }
  })
}
