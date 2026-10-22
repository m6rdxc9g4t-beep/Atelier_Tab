/**
 * Actions de l'import CSV : lecture du fichier, aperçu, import dans le store.
 * Le calcul est fait par `@/dataflow/import` (pur) ; l'écriture par les actions du store.
 */
import {
  buildImport,
  CsvImportError,
  decodeCsvBytes,
  type CsvAnalysis,
  type CsvEncoding,
  type ImportPlan,
  type ImportResult,
} from '@/dataflow/import'
import type { LookupContext } from '@/engine/field-types'
import { useDataStore, useNotices } from './index'
import { useUIStore } from './ui.store'

/** Taille maximale d'un fichier importé. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024

const CSV_NAME = /\.(csv|tsv|txt)$/i

/** Fichier qui ressemble à un CSV (extension ou type MIME). */
export function isCsvFile(file: { name: string; type: string }): boolean {
  return CSV_NAME.test(file.name) || /^text\/(csv|tab-separated-values|plain)$/.test(file.type)
}

/** Nom de table proposé : nom du fichier sans extension. */
export function tableNameFromFile(name: string): string {
  return name.replace(CSV_NAME, '').replace(/[_]+/g, ' ').trim() || 'Import CSV'
}

/** Lit un fichier et le décode (UTF-8, UTF-16 ou Windows-1252). */
export async function readCsvFile(file: File): Promise<{ text: string; encoding: CsvEncoding }> {
  if (file.size > MAX_IMPORT_BYTES) {
    const mb = (file.size / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })
    throw new CsvImportError(`Fichier trop volumineux : ${mb} Mo (maximum 20 Mo)`)
  }
  return decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))
}

export function lookupContext(): LookupContext {
  return { collaborators: useDataStore.getState().collaborators }
}

/** Résultat de l'import tel qu'il serait appliqué maintenant (rien n'est écrit). */
export function previewImport(
  analysis: CsvAnalysis,
  plan: ImportPlan,
  tableId: string | null,
): ImportResult {
  const table = tableId ? (useDataStore.getState().tables[tableId] ?? null) : null
  return buildImport(analysis, plan, table, lookupContext())
}

export type ImportDestination =
  { kind: 'table'; tableId: string } | { kind: 'new'; projectId: string; name: string }

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`

/** Phrase de bilan : « 12 lignes ajoutées, 3 mises à jour ». */
export function describeImport(r: Pick<ImportResult, 'inserted' | 'updated'>): string {
  const parts: string[] = []
  if (r.inserted) parts.push(plural(r.inserted, 'ligne ajoutée', 'lignes ajoutées'))
  if (r.updated) parts.push(plural(r.updated, 'ligne mise à jour', 'lignes mises à jour'))
  return parts.join(', ') || 'Aucune ligne importée'
}

/**
 * Importe pour de bon : recalcule les changements sur l'état actuel du store, les applique en
 * une seule mise à jour, ouvre la table et affiche un bilan.
 */
export function commitImport(
  analysis: CsvAnalysis,
  plan: ImportPlan,
  destination: ImportDestination,
): { tableId: string; result: ImportResult } {
  const store = useDataStore.getState()
  const tableId = destination.kind === 'table' ? destination.tableId : null
  const result = previewImport(analysis, plan, tableId)
  let id: string
  if (destination.kind === 'table') {
    if (!store.tables[destination.tableId]) throw new CsvImportError('La table a été supprimée')
    store.importIntoTable(destination.tableId, result.changes)
    id = destination.tableId
  } else {
    id = store.createTableFromImport(
      destination.projectId,
      destination.name.trim() || 'Import CSV',
      result.changes,
    )
    useUIStore.getState().toggleProject(destination.projectId, true)
  }
  useUIStore.getState().openTable(id)
  useNotices.getState().push(
    {
      tone: result.issueCount ? 'warning' : 'info',
      title: `Import CSV : ${describeImport(result)}`,
      ...(result.issueCount
        ? {
            detail: `${plural(result.issueCount, 'valeur refusée', 'valeurs refusées')} : cellule${result.issueCount > 1 ? 's' : ''} laissée${result.issueCount > 1 ? 's' : ''} vide${result.issueCount > 1 ? 's' : ''}.`,
          }
        : {}),
    },
    result.issueCount ? 8000 : 4000,
  )
  return { tableId: id, result }
}
