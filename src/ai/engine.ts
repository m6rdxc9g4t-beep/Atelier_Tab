/**
 * Choix du moteur de l'assistant (docs/SUITE.md §5.1–5.2), mêmes règles que Viz. Module pur.
 *
 * - Claude n'est sélectionnable que dans l'app de bureau **et** en ligne ; sinon le choix
 *   « Claude » retombe sur « Auto ».
 * - Auto : Claude si l'app est en ligne et Claude disponible, sinon Ollama.
 */
import type { ClaudeStatus } from './claude'
import type { EngineId } from './provider'

export type EngineChoice = 'auto' | 'ollama' | 'claude'

export const ENGINE_CHOICES: readonly { value: EngineChoice; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'claude', label: 'Claude' },
]

export function isEngineChoice(value: unknown): value is EngineChoice {
  return value === 'auto' || value === 'ollama' || value === 'claude'
}

export interface EngineInputs {
  choice: EngineChoice
  /** Mode « En ligne » de l'app. */
  online: boolean
  /** App de bureau (la CLI Claude n'est appelable que par son processus principal). */
  desktop: boolean
  claude: ClaudeStatus | null
  /** Ollama joignable avec au moins un modèle à outils choisi. */
  ollamaReady: boolean
}

export interface EngineState {
  /** Choix effectif (Claude impossible → Auto). */
  choice: EngineChoice
  /** Moteur qui répondra. */
  engine: EngineId
  /** Le bouton « Claude » est actif. */
  claudeSelectable: boolean
  /** Pourquoi « Claude » est grisé (null s'il est actif). */
  claudeHint: string | null
  /** Le moteur qui répondra n'est pas disponible. */
  down: boolean
}

export const CLAUDE_OFFLINE_HINT = 'Activez le mode « En ligne » pour utiliser Claude.'
export const CLAUDE_BROWSER_HINT = 'Claude est disponible dans l’app de bureau.'

export function resolveEngine(input: EngineInputs): EngineState {
  const claudeHint = !input.desktop
    ? CLAUDE_BROWSER_HINT
    : !input.online
      ? CLAUDE_OFFLINE_HINT
      : null
  const claudeSelectable = claudeHint === null
  const choice: EngineChoice =
    input.choice === 'claude' && !claudeSelectable ? 'auto' : input.choice
  const claudeReady = claudeSelectable && input.claude?.available === true
  const engine: EngineId =
    choice === 'claude' || (choice === 'auto' && claudeReady) ? 'claude' : 'ollama'
  const down = engine === 'claude' ? !claudeReady : !input.ollamaReady
  return { choice, engine, claudeSelectable, claudeHint, down }
}

/** Ligne bouclier : ce qui est envoyé quand ce moteur répond (contrat §5.2, cas de Tab). */
export function privacyNote(engine: EngineId): string {
  return engine === 'claude'
    ? 'Réponse par Claude. Seules la demande et les cellules que l’assistant lit avec ses outils (contenu des tables) sont envoyées.'
    : 'Réponse par Ollama (local). Rien ne quitte cet ordinateur.'
}
