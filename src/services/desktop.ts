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

/** Requête POST vers un service local de la suite (Atelier Projets), relayée par l'app. */
export interface LocalPostRequest {
  url: string
  headers: Record<string, string>
  body: string
}

export interface LocalPostResponse {
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
   * Envoie un POST JSON à un service local (127.0.0.1 / localhost) depuis le processus
   * principal : la page de l'app (origine app://atelier) n'est pas une origine admise par
   * le CORS d'Atelier Projets, alors qu'une requête sans origine l'est.
   */
  postLocal(request: LocalPostRequest): Promise<LocalPostResponse>
}

declare global {
  interface Window {
    atelierDesktop?: DesktopApi
  }
}

export function getDesktopApi(): DesktopApi | undefined {
  return typeof window !== 'undefined' ? window.atelierDesktop : undefined
}
