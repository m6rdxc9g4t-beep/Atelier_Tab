/**
 * Lance un tour de conversation avec l'assistant (Ollama ou Claude) sur les données de l'app.
 * Les outils demandés par le modèle sont exécutés ici, par les actions du store.
 *
 * Les actions sensibles de l'assistant (envoi hors de cette machine, réglage d'une telle
 * adresse, suppression de lignes ou de colonnes) attendent la réponse de l'utilisateur à une
 * carte « Autoriser / Refuser » du panneau (docs/SUITE.md §5.4).
 */
import { runAgent, type AgentContext } from '@/ai/agent'
import type { ChatProvider } from '@/ai/provider'
import type { ConfirmRequest, ToolHost } from '@/ai/tools'
import { downloadText } from '@/dataflow'
import { getDesktopApi } from '@/services/desktop'
import { useAssistant } from './assistant.store'
import { desktopAwareFetch } from './export-actions'
import { getSheet, useDataStore, useUIStore } from './index'

const pendingConfirmations = new Map<number, (allowed: boolean) => void>()

/**
 * Soumet une action de l'assistant à l'utilisateur : ajoute une carte au panneau et attend
 * sa réponse (`answerConfirmation`). Une demande annulée vaut un refus.
 */
export function requestConfirmation(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const id = useAssistant.getState().addEntry({ kind: 'confirm', request, status: 'pending' })
    pendingConfirmations.set(id, resolve)
  })
}

/** Réponse de l'utilisateur à une carte de confirmation. */
export function answerConfirmation(id: number, allowed: boolean): void {
  const resolve = pendingConfirmations.get(id)
  if (!resolve) return
  pendingConfirmations.delete(id)
  useAssistant.getState().updateEntry(id, { status: allowed ? 'allowed' : 'refused' })
  resolve(allowed)
}

/** Outils exécutés directement sur le store de l'app : l'interface se met à jour en direct. */
export function appToolHost(): ToolHost {
  const desktop = getDesktopApi()
  const webhookFetch = desktopAwareFetch(desktop)
  const atelierEvents = desktop?.atelierEvents?.bind(desktop)
  return {
    caller: 'assistant',
    confirm: requestConfirmation,
    store: useDataStore,
    getSheet,
    ...(webhookFetch ? { webhookFetch } : {}),
    // Journal du nœud Atelier : tenu par le processus principal (app de bureau seulement).
    ...(atelierEvents ? { readEvents: atelierEvents } : {}),
    async saveExport(filename, content, mime) {
      const desktop = getDesktopApi()
      if (desktop) return desktop.saveExport(filename, content)
      downloadText(filename, content, mime)
      return `téléchargé (${filename})`
    },
  }
}

function currentContext(): AgentContext {
  const { activeTableId, selection } = useUIStore.getState()
  const table = activeTableId ? useDataStore.getState().tables[activeTableId] : undefined
  let selectionText: string | undefined
  if (table && selection) {
    const address = getSheet(table.id)?.address(selection.recordId, selection.fieldId)
    const field = table.fields[selection.fieldId]
    if (address && field) selectionText = `${address} (colonne « ${field.label} »)`
  }
  return {
    today: new Date().toLocaleDateString('fr-FR'),
    ...(table ? { table: { id: table.id, name: table.name } } : {}),
    ...(selectionText ? { selection: selectionText } : {}),
  }
}

let currentRequest: string | null = null
let currentProvider: ChatProvider | null = null
let cancelled = false

export async function askAssistant(prompt: string, provider: ChatProvider): Promise<void> {
  const state = useAssistant.getState()
  const text = prompt.trim()
  if (!text || state.running) return
  cancelled = false
  currentProvider = provider
  state.addEntry({ kind: 'user', text })
  state.setRunning(true)
  const toolEntries: number[] = []

  try {
    const history = await runAgent({
      provider,
      history: state.history,
      prompt: text,
      host: appToolHost(),
      context: currentContext(),
      onRequest: (id) => {
        currentRequest = id
      },
      isCancelled: () => cancelled,
      onEvent(event) {
        const s = useAssistant.getState()
        if (event.type === 'tool_call') {
          toolEntries.push(
            s.addEntry({ kind: 'tool', name: event.name, args: event.args, status: 'running' }),
          )
        } else if (event.type === 'tool_result') {
          const id = toolEntries.at(-1)
          if (id !== undefined) {
            s.updateEntry(id, {
              status: event.ok ? 'ok' : 'error',
              ...(event.ok ? {} : { detail: event.content }),
            })
          }
        } else if (event.type === 'answer') {
          s.addEntry({
            kind: 'assistant',
            text: event.text,
            engine: provider.engine,
            model: provider.model,
          })
        } else if (event.type === 'error') {
          s.addEntry({ kind: 'error', text: event.message })
        } else {
          s.addEntry({ kind: 'error', text: 'Demande annulée.' })
        }
      },
    })
    useAssistant.getState().setHistory(history)
  } finally {
    currentRequest = null
    currentProvider = null
    useAssistant.getState().setRunning(false)
  }
}

export function cancelAssistant(): void {
  cancelled = true
  // Une confirmation en attente est refusée : rien ne part après « Arrêter ».
  for (const id of [...pendingConfirmations.keys()]) answerConfirmation(id, false)
  if (currentRequest) currentProvider?.cancel(currentRequest)
}
