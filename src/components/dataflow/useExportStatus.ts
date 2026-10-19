import { useMemo } from 'react'
import type { ExportStatus } from '@/dataflow'
import { prepareExport } from '@/store/export-actions'
import { useComputed, useDataStore } from '@/store'

/** Statut d'export d'une table (pastille de la sidebar), recalculé quand la table change. */
export function useExportStatus(tableId: string): ExportStatus | null {
  const table = useDataStore((s) => s.tables[tableId])
  const revision = useComputed((s) => s.revisions[tableId] ?? 0)
  return useMemo(() => {
    void table
    void revision
    return prepareExport(tableId)?.report.status ?? null
  }, [tableId, table, revision])
}

export const STATUS_LABELS: Record<ExportStatus, string> = {
  ready: 'Prête pour Atelier Projets',
  warnings: 'Exportable, avec des points à vérifier',
  blocked: 'Pas encore exportable',
}
