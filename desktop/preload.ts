/**
 * Preload : expose à l'interface une API minimale et typée (window.atelierDesktop).
 * L'interface n'a aucun accès direct à Node ni au système de fichiers.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '@/services/desktop'
import type { AppData } from '@/types/domain'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DesktopApi = {
  platform: process.platform,
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (json) => ipcRenderer.invoke('data:save', json),
  onExternalChange: (cb) => subscribe<AppData>('data:external', cb),
  onDataErrors: (cb) => subscribe<string[]>('data:errors', cb),
  revealDataDir: () => ipcRenderer.invoke('data:reveal'),
  saveExport: (filename, content) => ipcRenderer.invoke('export:save', filename, content),
  ollama: (request) => ipcRenderer.invoke('ollama:request', request),
  ollamaCancel: (id) => ipcRenderer.invoke('ollama:cancel', id),
  mcpInfo: () => ipcRenderer.invoke('mcp:info'),
  openLocalApp: (url) => ipcRenderer.invoke('suite:open', url),
  postLocal: (request) => ipcRenderer.invoke('suite:post', request),
  claudeStatus: (refresh) => ipcRenderer.invoke('claude:status', refresh === true),
  claudeChat: (request) => ipcRenderer.invoke('claude:chat', request),
  claudeCancel: (id) => ipcRenderer.invoke('claude:cancel', id),
}

contextBridge.exposeInMainWorld('atelierDesktop', api)
