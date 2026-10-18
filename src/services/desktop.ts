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

export interface McpInfo {
  /** Commande à lancer pour enregistrer le serveur dans Claude Code. */
  claudeCommand: string
  /** Lanceur du serveur MCP (chemin absolu). */
  launcher: string
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
}

declare global {
  interface Window {
    atelierDesktop?: DesktopApi
  }
}

export function getDesktopApi(): DesktopApi | undefined {
  return typeof window !== 'undefined' ? window.atelierDesktop : undefined
}
