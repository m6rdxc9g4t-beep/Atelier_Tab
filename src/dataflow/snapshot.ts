/**
 * Instantanés DataFlow pour Atelier Viz (docs/SUITE.md §4.2).
 *
 * L'app de bureau publie, à chaque enregistrement, `exports/<tableId>.json` : l'enveloppe
 * DataFlow v2.1.0 de la table entière, valeurs `computed` évaluées par le moteur. Contrairement
 * à un export vers Atelier Projets, aucun contrôle bloquant de `validate.ts` n'est appliqué :
 * une table sans colonne `entity_title` (ou vide) est publiée quand même. Les colonnes sans
 * rôle reçoivent `custom` (règle de `buildColumns`).
 *
 * Module pur : le moteur (TableSheet) est créé ici si l'appelant n'en fournit pas, ce qui
 * permet au processus principal Electron et au serveur MCP de produire les instantanés à
 * partir des seules données enregistrées.
 */
import { TableSheet } from '@/engine/table'
import type { AppData } from '@/types/domain'
import { buildAtelierPayload, type SheetReader } from './mappers/toAtelierPayload'
import type { AtelierPayload } from './schema/atelier.v2_1'

/** Dossier des instantanés, relatif au dossier de données (~/Atelier_Tab). */
export const SNAPSHOTS_DIR = 'exports'

/** Id de table utilisable comme nom de fichier d'instantané (pas de `/`, `\\`, `.`). */
const SNAPSHOT_ID = /^[A-Za-z0-9_-]+$/

/**
 * Chemin relatif de l'instantané d'une table. Refuse un id qui ne serait pas un nom de
 * fichier sûr (`../x`, chemin absolu…) : l'id vient de données éditables.
 */
export function snapshotFile(tableId: string): string {
  if (!SNAPSHOT_ID.test(tableId))
    throw new Error(`Id de table refusé pour un instantané : "${tableId}"`)
  return `${SNAPSHOTS_DIR}/${tableId}.json`
}

/** Moteur de calcul d'une table, à partir des seules données enregistrées. */
export function sheetFor(data: AppData, tableId: string): TableSheet {
  const table = data.tables[tableId]
  if (!table) throw new Error(`Table introuvable : ${tableId}`)
  const sheet = new TableSheet()
  sheet.sync(table, { collaborators: data.collaborators })
  return sheet
}

/** Enveloppe DataFlow d'une table entière, sans contrôle bloquant. */
export function buildSnapshotPayload(
  data: AppData,
  tableId: string,
  options: { sheet?: SheetReader; exportedAt?: Date } = {},
): AtelierPayload {
  const sheet = options.sheet ?? sheetFor(data, tableId)
  return buildAtelierPayload(data, tableId, sheet, {
    ...(options.exportedAt ? { exportedAt: options.exportedAt } : {}),
  })
}

/** Texte du fichier d'instantané (JSON indenté, fin de ligne). */
export function serializeSnapshot(payload: AtelierPayload): string {
  return JSON.stringify(payload, null, 2) + '\n'
}

/**
 * Contenu comparable de deux instantanés : tout sauf l'horodatage. Sert à ne réécrire un
 * fichier que si la table (ou son contexte : noms, collaborateurs) a réellement changé.
 */
export function snapshotFingerprint(payload: AtelierPayload): string {
  const { exported_at: _at, ...rest } = payload
  void _at
  return JSON.stringify(rest)
}

/**
 * Vrai si un fichier JSON est un instantané publié pour la table `tableId` (enveloppe
 * DataFlow dont `project.source_table.id` vaut l'id). Protège les exports manuels rangés
 * dans le même dossier (`atelier_projets_<table>_<date>.json`) de toute suppression.
 */
export function isSnapshotOf(text: string, tableId: string): boolean {
  try {
    const json = JSON.parse(text) as {
      target_system?: unknown
      project?: { source_table?: { id?: unknown } }
    }
    return json.target_system === 'atelier_projets' && json.project?.source_table?.id === tableId
  } catch {
    return false
  }
}
