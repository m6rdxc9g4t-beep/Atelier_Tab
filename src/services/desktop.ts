/**
 * Pont vers le processus principal de l'application de bureau (exposé par le preload).
 * Absent dans la version navigateur : `getDesktopApi()` renvoie alors `undefined`.
 */
import type { AppData } from '@/types/domain'

export interface DesktopLoadResult {
  data: AppData | null
  errors: string[]
  /** Dossier de données (ex. /Users/françois/Atelier_Tab). */
  dir: string
}

export interface OllamaRequest {
  /** Identifiant pour pouvoir annuler la requête. */
  id: string
  path: '/api/tags' | '/api/show' | '/api/chat' | '/api/version'
  method?: 'GET' | 'POST'
  body?: unknown
}

export interface OllamaResponse {
  ok: boolean
  status: number
  data: unknown
  /** Message lisible quand Ollama est injoignable. */
  error?: string
}

/** Alias des modèles Claude proposés (docs/SUITE.md §5.2). */
export type ClaudeModelAlias = 'sonnet' | 'opus' | 'haiku'

/**
 * Message de la conversation transmise à la CLI Claude (transcription sur l'entrée standard).
 * `tool` : résultat d'un outil exécuté par l'app, rendu en bloc de données délimité, jamais
 * comme un message de l'utilisateur (docs/SUITE.md §5.4).
 */
export type ClaudeMessage =
  { role: 'user' | 'assistant'; content: string } | { role: 'tool'; name: string; content: string }

/**
 * Requête `claude:chat` : seulement la conversation, le prompt système, le schéma de sortie
 * et l'alias du modèle. Le processus principal la valide et construit seul la ligne de
 * commande (docs/SUITE.md §5.3) : aucun argument libre ne vient de l'interface.
 */
export interface ClaudeChatRequest {
  id: string
  model: ClaudeModelAlias
  /** Consignes seulement (passées en argument `--system-prompt`). */
  system: string
  /** Contexte de l'app (données) : sur l'entrée standard, avant la conversation. */
  context?: string
  messages: ClaudeMessage[]
  /** JSON Schema de la réponse (`--json-schema`). */
  schema?: Record<string, unknown>
}

export type ClaudeErrorCode = 'invalid' | 'offline' | 'missing' | 'timeout' | 'cancelled' | 'cli'

export type ClaudeChatResponse =
  | {
      ok: true
      /** Sortie structurée (`structured_output`), ou JSON relu dans `result`. */
      output?: unknown
      /** Texte final (`result`). */
      text: string
    }
  | { ok: false; code: ClaudeErrorCode; error: string }

/** État de Claude (pastille de l'en-tête, choix du moteur). */
export interface ClaudeStatus {
  /** Mode « En ligne » de l'app (fichier de préférences du processus principal). */
  online: boolean
  /** Exécutable `claude` trouvé. */
  found: boolean
  /** Utilisable : en ligne, trouvé et `claude auth status` réussi. */
  available: boolean
  /** Explication (indisponible, ou avertissement). */
  detail: string | null
  /** Version de la CLI (« 2.1.0 (Claude Code) »). */
  version?: string
}

export interface McpInfo {
  /** Commande à lancer pour enregistrer le serveur dans Claude Code. */
  claudeCommand: string
  /** Lanceur du serveur MCP (chemin absolu). */
  launcher: string
}

/** Envoi webhook (POST JSON), relayé par le processus principal de l'app de bureau. */
export interface WebhookPostRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export interface WebhookPostResponse {
  /** 0 : serveur injoignable. */
  status: number
  body: string
  error?: string
}

export interface DesktopApi {
  platform: string
  loadData(): Promise<DesktopLoadResult>
  /** Enregistre l'état complet (JSON du store persisté). */
  saveData(json: string): Promise<void>
  onExternalChange(cb: (data: AppData) => void): () => void
  onDataErrors(cb: (errors: string[]) => void): () => void
  revealDataDir(): Promise<void>
  /** Écrit un fichier d'export dans le dossier exports/ ; renvoie son chemin. */
  saveExport(filename: string, content: string): Promise<string>
  ollama(request: OllamaRequest): Promise<OllamaResponse>
  ollamaCancel(id: string): Promise<void>
  mcpInfo(): Promise<McpInfo>
  /**
   * Ouvre une application de la Suite Atelier dans le navigateur par défaut
   * (shell.openExternal). Seules les adresses http(s) vers 127.0.0.1 / localhost sont acceptées.
   */
  openLocalApp(url: string): Promise<boolean>
  /**
   * Envoi webhook depuis le processus principal (docs/SUITE.md §4.1, §5.4) :
   * - la page de l'app (origine app://atelier) n'est pas admise par le CORS d'Atelier Projets
   *   (ni `null`, refusée), alors qu'une requête sans en-tête Origin l'est ;
   * - la politique de contenu de l'interface limite `connect-src` à cette machine : un envoi
   *   https vers l'extérieur passe donc forcément par ici ;
   * - le processus principal revérifie : hors ligne (fichier de préférences), seules les
   *   adresses de cette machine ; jeton seulement vers Atelier Projets local ; pas de redirection.
   */
  postWebhook(request: WebhookPostRequest): Promise<WebhookPostResponse>
  /**
   * Mode « En ligne » choisi par l'utilisateur (interrupteur de l'en-tête), enregistré par le
   * processus principal hors du dossier de données (docs/SUITE.md §5.1).
   */
  setOnlineMode(online: boolean): Promise<boolean>
  /** État de Claude (mis en cache 60 s par le processus principal ; `refresh` force la vérification). */
  claudeStatus(refresh?: boolean): Promise<ClaudeStatus>
  /** Un appel isolé à la CLI Claude (docs/SUITE.md §5.3), refusé hors ligne. */
  claudeChat(request: ClaudeChatRequest): Promise<ClaudeChatResponse>
  claudeCancel(id: string): Promise<void>
}

declare global {
  interface Window {
    atelierDesktop?: DesktopApi
  }
}

export function getDesktopApi(): DesktopApi | undefined {
  return typeof window !== 'undefined' ? window.atelierDesktop : undefined
}
