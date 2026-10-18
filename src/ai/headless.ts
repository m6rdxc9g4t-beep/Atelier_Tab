/**
 * Hôte d'outils sans interface : un store et un moteur de calcul en mémoire, initialisés
 * à partir d'un état donné. Utilisé par le serveur MCP (une instance par appel, à partir
 * des fichiers) et par les tests.
 */
import { memoryAdapter } from '@/services/persistence/adapters'
import { connectComputed } from '@/store/computed.store'
import { createDataStore, pickData } from '@/store/data.store'
import type { AppData } from '@/types/domain'
import type { ToolHost } from './tools'

export interface HeadlessSession {
  host: ToolHost
  /** État courant, sans les actions (à enregistrer après l'appel). */
  snapshot(): AppData
  dispose(): void
}

export function createHeadlessSession(
  initial: AppData,
  saveExport: ToolHost['saveExport'],
): HeadlessSession {
  const store = createDataStore({ adapter: memoryAdapter(), initialData: structuredClone(initial) })
  const engine = connectComputed(store)
  return {
    host: { store, getSheet: engine.getSheet, saveExport },
    snapshot: () => pickData(store.getState()),
    dispose: engine.disconnect,
  }
}
