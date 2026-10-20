/**
 * État des moteurs de l'assistant (docs/SUITE.md §5.2) : modèles Ollama et état de Claude.
 * Partagé par les pastilles de l'en-tête et le panneau de l'assistant ; non enregistré.
 */
import { create } from 'zustand'
import { createClaudeTransport, type ClaudeStatus, type ClaudeTransport } from '@/ai/claude'
import { CLAUDE_BROWSER_HINT } from '@/ai/engine'
import {
  createOllamaTransport,
  listModels,
  preferredModel,
  type ModelsResult,
  type OllamaTransport,
} from '@/ai/ollama'
import { useAssistant } from './assistant.store'
import { useDataStore } from './index'

interface AiStatusState {
  ollama: ModelsResult | null
  claude: ClaudeStatus | null
  checkingOllama: boolean
  checkingClaude: boolean
}

export const useAiStatus = create<AiStatusState>()(() => ({
  ollama: null,
  claude: null,
  checkingOllama: false,
  checkingClaude: false,
}))

let ollamaTransport: OllamaTransport | null = null
let claudeTransport: ClaudeTransport | null | undefined

/** Transport Ollama de l'app (créé à la première utilisation). */
export function getOllamaTransport(): OllamaTransport {
  ollamaTransport ??= createOllamaTransport()
  return ollamaTransport
}

/** Transport Claude (processus principal) ; null hors de l'app de bureau. */
export function getClaudeTransport(): ClaudeTransport | null {
  if (claudeTransport === undefined) claudeTransport = createClaudeTransport()
  return claudeTransport
}

/** Pour les tests : oublie les transports créés. */
export function resetAiTransports(): void {
  ollamaTransport = null
  claudeTransport = undefined
}

/** Recherche d'Ollama et de ses modèles ; choisit un modèle à outils si besoin. */
export async function refreshOllama(): Promise<void> {
  useAiStatus.setState({ checkingOllama: true })
  try {
    const res = await listModels(getOllamaTransport())
    useAiStatus.setState({ ollama: res })
    if (res.ok) {
      const { model, setModel } = useAssistant.getState()
      const usable = res.models.filter((m) => m.tools)
      if (!model || !usable.some((m) => m.name === model))
        setModel(preferredModel(res.models) ?? null)
    }
  } finally {
    useAiStatus.setState({ checkingOllama: false })
  }
}

let claudeSeq = 0

/** État de Claude (`force` : sans le cache de 60 s du processus principal). */
export async function refreshClaude(force = false): Promise<void> {
  // Seule la dernière vérification lancée est retenue (réponses dans le désordre).
  const seq = ++claudeSeq
  const transport = getClaudeTransport()
  const online = useDataStore.getState().preferences?.onlineMode === true
  if (!transport) {
    useAiStatus.setState({
      claude: { online, found: false, available: false, detail: CLAUDE_BROWSER_HINT },
    })
    return
  }
  useAiStatus.setState({ checkingClaude: true })
  try {
    let status = await transport.status(force)
    // Le processus principal relit atelier.json : juste après une bascule, l'enregistrement
    // peut ne pas être encore écrit. Une seconde lecture lève le doute.
    if (status.online !== online) {
      await new Promise((r) => setTimeout(r, 300))
      status = await transport.status(force)
    }
    if (seq === claudeSeq) useAiStatus.setState({ claude: status })
  } catch (e) {
    if (seq !== claudeSeq) return
    useAiStatus.setState({
      claude: {
        online,
        found: false,
        available: false,
        detail: `État de Claude illisible : ${e instanceof Error ? e.message : String(e)}`,
      },
    })
  } finally {
    if (seq === claudeSeq) useAiStatus.setState({ checkingClaude: false })
  }
}

/** Revérifie les deux moteurs. */
export function refreshAiStatus(force = false): Promise<void> {
  return Promise.all([refreshOllama(), refreshClaude(force)]).then(() => undefined)
}

let watching = false

/**
 * Première vérification, puis suivi du mode « En ligne » : à chaque bascule (interrupteur,
 * ou atelier.json modifié à côté), l'état de Claude est relu.
 */
export function startAiStatusWatch(): () => void {
  if (watching) return () => {}
  watching = true
  const { ollama, claude } = useAiStatus.getState()
  if (!ollama || !claude) void refreshAiStatus()
  const unsubscribe = useDataStore.subscribe((s, prev) => {
    // Différé : l'abonnement est notifié avant l'envoi de l'enregistrement (data:save).
    if (s.preferences?.onlineMode !== prev.preferences?.onlineMode)
      setTimeout(() => void refreshClaude(true), 0)
  })
  return () => {
    watching = false
    unsubscribe()
  }
}
