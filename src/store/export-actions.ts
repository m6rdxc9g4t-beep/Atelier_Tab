/**
 * Orchestration de l'export DataFlow : construit le payload à partir du store et du
 * moteur, le valide, puis le télécharge ou l'envoie, et garde une trace du résultat.
 */
import {
  buildAtelierPayload,
  downloadText,
  exportFilename,
  sendToWebhook,
  toEnrichedCsv,
  validatePayload,
  type AtelierPayload,
  type ValidationReport,
} from '@/dataflow'
import type { ExportMethod } from '@/types/domain'
import { getSheet, useDataStore } from './index'

export interface PreparedExport {
  payload: AtelierPayload
  report: ValidationReport
}

/** Construit et valide le payload d'une table (ou d'une sélection de lignes). */
export function prepareExport(tableId: string, recordIds?: string[]): PreparedExport | null {
  const sheet = getSheet(tableId)
  const data = useDataStore.getState()
  if (!sheet || !data.tables[tableId]) return null
  const payload = buildAtelierPayload(data, tableId, sheet, { recordIds })
  return { payload, report: validatePayload(payload) }
}

export interface ExportOutcome {
  ok: boolean
  message: string
}

export async function runExport(
  tableId: string,
  method: ExportMethod,
  recordIds?: string[],
): Promise<ExportOutcome> {
  const prepared = prepareExport(tableId, recordIds)
  const state = useDataStore.getState()
  const table = state.tables[tableId]
  if (!prepared || !table) return { ok: false, message: 'Table introuvable' }
  if (prepared.report.status === 'blocked') {
    return { ok: false, message: 'Corrigez les points bloquants avant d’exporter' }
  }

  const { payload } = prepared
  const rows = payload.project.records.length
  let outcome: ExportOutcome

  if (method === 'json') {
    downloadText(
      exportFilename(table.name, 'json'),
      JSON.stringify(payload, null, 2),
      'application/json',
    )
    outcome = {
      ok: true,
      message: `${rows} ligne${rows > 1 ? 's' : ''} exportée${rows > 1 ? 's' : ''} en JSON`,
    }
  } else if (method === 'csv') {
    downloadText(exportFilename(table.name, 'csv'), toEnrichedCsv(payload), 'text/csv')
    outcome = {
      ok: true,
      message: `${rows} ligne${rows > 1 ? 's' : ''} exportée${rows > 1 ? 's' : ''} en CSV`,
    }
  } else {
    const { webhookUrl, token } = state.integrations.atelierProjets
    if (!webhookUrl) return { ok: false, message: 'Renseignez l’adresse du webhook' }
    const res = await sendToWebhook(payload, { url: webhookUrl, token })
    outcome = {
      ok: res.ok,
      message: res.ok
        ? `${rows} ligne${rows > 1 ? 's' : ''} envoyée${rows > 1 ? 's' : ''} — ${res.message}`
        : res.message,
    }
  }

  useDataStore.getState().logExport({
    at: new Date().toISOString(),
    tableId,
    method,
    rows,
    ok: outcome.ok,
    message: outcome.message,
  })
  return outcome
}
