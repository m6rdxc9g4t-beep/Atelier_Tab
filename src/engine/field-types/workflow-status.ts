/**
 * Statuts de workflow communs à la Suite Atelier (docs/SUITE.md §1.4).
 *
 * Un choix de champ `select` dont le libellé est reconnu comme un statut officiel est
 * affiché avec la couleur officielle de ce statut (`--status-*`), quelle que soit la
 * teinte nommée enregistrée avec le choix. Module pur, sans React.
 */
import type { BadgeColor, SelectChoice } from '@/types/domain'

export type WorkflowStatusCode =
  'OPEN' | 'IN_PROGRESS' | 'IN_REVIEW' | 'ON_HOLD' | 'BLOCKED' | 'RESOLVED' | 'CLOSED' | 'REJECTED'

export interface WorkflowStatus {
  code: WorkflowStatusCode
  /** Libellé français commun aux trois applications. */
  label: string
  /** Variable CSS du design system. */
  cssVar: `--status-${string}`
  /** Teinte nommée la plus proche, enregistrée avec le choix (format de fichier). */
  color: BadgeColor
}

/** Les 8 statuts, dans l'ordre du workflow. */
export const WORKFLOW_STATUSES: readonly WorkflowStatus[] = [
  { code: 'OPEN', label: 'À faire', cssVar: '--status-open', color: 'gray' },
  { code: 'IN_PROGRESS', label: 'En cours', cssVar: '--status-progress', color: 'blue' },
  { code: 'IN_REVIEW', label: 'En revue', cssVar: '--status-review', color: 'violet' },
  { code: 'ON_HOLD', label: 'En attente', cssVar: '--status-hold', color: 'amber' },
  { code: 'BLOCKED', label: 'Bloquée', cssVar: '--status-blocked', color: 'red' },
  { code: 'RESOLVED', label: 'Résolue', cssVar: '--status-resolved', color: 'teal' },
  { code: 'CLOSED', label: 'Terminée', cssVar: '--status-closed', color: 'green' },
  { code: 'REJECTED', label: 'Rejetée', cssVar: '--status-rejected', color: 'red' },
]

/** Synonymes acceptés (§1.4), en plus des libellés et des codes. */
const SYNONYMS: Record<string, WorkflowStatusCode> = {
  ouvert: 'OPEN',
  nouveau: 'OPEN',
  fait: 'CLOSED',
  termine: 'CLOSED',
  clos: 'CLOSED',
  bloque: 'BLOCKED',
  resolu: 'RESOLVED',
  rejete: 'REJECTED',
  annule: 'REJECTED',
}

/** Comparaison insensible à la casse, aux accents et aux séparateurs (`IN_PROGRESS` = « in progress »). */
export function normalizeStatusText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .trim()
}

const BY_TEXT = new Map<string, WorkflowStatusCode>()
for (const s of WORKFLOW_STATUSES) {
  BY_TEXT.set(normalizeStatusText(s.label), s.code)
  BY_TEXT.set(normalizeStatusText(s.code), s.code)
}
for (const [word, code] of Object.entries(SYNONYMS)) BY_TEXT.set(word, code)

/** Code du statut officiel correspondant à un libellé (ou à un code), sinon null. */
export function workflowStatusCode(label: string): WorkflowStatusCode | null {
  return BY_TEXT.get(normalizeStatusText(label)) ?? null
}

export function workflowStatus(code: WorkflowStatusCode): WorkflowStatus {
  return WORKFLOW_STATUSES.find((s) => s.code === code) as WorkflowStatus
}

/** Identifiant stable d'un choix du préréglage : `OPEN` → `opt_open`. */
export function atelierStatusChoiceId(code: WorkflowStatusCode): string {
  return `opt_${code.toLowerCase()}`
}

/** Préréglage « Statuts Atelier » : les 8 statuts, dans l'ordre (aussi celui du Kanban). */
export function atelierStatusChoices(): SelectChoice[] {
  return WORKFLOW_STATUSES.map((s) => ({
    id: atelierStatusChoiceId(s.code),
    label: s.label,
    color: s.color,
  }))
}

export const ATELIER_STATUS_PRESET_NAME = 'Statuts Atelier'

/**
 * Applique le préréglage à une liste de choix existante sans perdre de données : un choix
 * déjà reconnu comme statut (« Bloqué », « Validé »…) garde son id et prend le libellé
 * officiel ; les choix non reconnus sont conservés à la fin, pour que les cellules qui les
 * utilisent gardent leur valeur.
 */
export function mergeAtelierStatuses(existing: readonly SelectChoice[] = []): SelectChoice[] {
  const used = new Set<string>()
  const merged = WORKFLOW_STATUSES.map((s) => {
    const keep = existing.find((c) => !used.has(c.id) && workflowStatusCode(c.label) === s.code)
    let id = keep?.id ?? atelierStatusChoiceId(s.code)
    for (let n = 2; !keep && existing.some((c) => c.id === id); n++) {
      id = `${atelierStatusChoiceId(s.code)}_${n}`
    }
    used.add(id)
    return { id, label: s.label, color: s.color }
  })
  return [...merged, ...existing.filter((c) => !used.has(c.id))]
}
