/**
 * Lance un tour de conversation avec l'assistant (Ollama ou Claude) sur les données de l'app.
 * Les outils demandés par le modèle sont exécutés ici, par les actions du store.
 */
import { runAgent, type AgentContext } from '@/ai/agent'
import type { ChatProvider } from '@/ai/provider'
import type { ToolHost } from '@/ai/tools'
import { downloadText } from '@/dataflow'
import { getDesktopApi } from '@/services/desktop'
import { useAssistant } from './assistant.store'
import { desktopAwareFetch } from './export-actions'
import { getSheet, useDataStore, useUIStore } from './index'

/** Outils exécutés directement sur le store de l'app : l'interface se met à jour en direct. */
export function appToolHost(): ToolHost {
  const webhookFetch = desktopAwareFetch(getDesktopApi())
  return {
    store: useDataStore,
    getSheet,
    ...(webhookFetch ? { webhookFetch } : {}),
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
  if (currentRequest) currentProvider?.cancel(currentRequest)
}
