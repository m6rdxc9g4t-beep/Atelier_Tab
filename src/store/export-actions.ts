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
  withProjetsParams,
  type AtelierPayload,
  type ProjetsImportSummary,
  type ValidationReport,
  type WebhookFetch,
} from '@/dataflow'
import { getDesktopApi, type DesktopApi } from '@/services/desktop'
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
  /** Résumé d'import renvoyé par Atelier Projets (envoi direct). */
  summary?: ProjetsImportSummary
}

/**
 * App de bureau : tout envoi webhook passe par le processus principal.
 * - L'interface a l'origine `app://atelier`, qu'Atelier Projets n'admet pas (CORS limité à
 *   http://127.0.0.1:* et http://localhost:* ; l'origine `null` est refusée, §4.1) : depuis le
 *   processus principal, la requête part sans en-tête Origin, comme un script local.
 * - La politique de contenu de l'interface (`connect-src`) n'admet que cette machine ; un envoi
 *   https vers l'extérieur, autorisé par l'utilisateur, est donc relayé lui aussi.
 * - Le processus principal revérifie le mode hors ligne et la règle du jeton (§5.4).
 */
export function desktopAwareFetch(desktop: DesktopApi | undefined): WebhookFetch | undefined {
  if (!desktop) return undefined
  return async (url, init) => {
    const res = await desktop.postWebhook({ url, headers: init.headers, body: init.body })
    if (res.status === 0) throw new TypeError(res.error ?? 'Serveur injoignable')
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      text: async () => res.body,
    }
  }
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
    const { webhookUrl, token, projectId } = state.integrations.atelierProjets
    if (!webhookUrl) return { ok: false, message: 'Renseignez l’adresse du webhook' }
    const fetchVia = desktopAwareFetch(getDesktopApi())
    const res = await sendToWebhook(
      payload,
      {
        url: withProjetsParams(webhookUrl, { projectId }),
        token,
        online: state.preferences?.onlineMode === true,
      },
      fetchVia ? { fetch: fetchVia } : {},
    )
    outcome = {
      ok: res.ok,
      message: res.ok
        ? `${rows} ligne${rows > 1 ? 's' : ''} envoyée${rows > 1 ? 's' : ''} — ${res.message}`
        : res.message,
      ...(res.summary ? { summary: res.summary } : {}),
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
