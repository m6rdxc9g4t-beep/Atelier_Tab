/**
 * Persistance de l'app de bureau : les données vivent dans le dossier ~/Atelier_Tab
 * (fichiers JSON lisibles par les IA), lus et écrits par le processus principal.
 *
 * Premier lancement avec ce stockage : les données de l'ancienne version (IndexedDB)
 * sont reprises et écrites dans le dossier ; à défaut, les données de démonstration.
 */
import { createDemoData } from '@/fixtures/demo'
import type { DesktopApi } from '@/services/desktop'
import { indexedDbAdapter } from './adapters'
import type { StorageAdapter } from './StorageAdapter'

const MIGRATED_FLAG = 'atelier-tab:migrated-to-files'

function migratedAlready(): boolean {
  try {
    return localStorage.getItem(MIGRATED_FLAG) === '1'
  } catch {
    return false
  }
}

function markMigrated(): void {
  try {
    localStorage.setItem(MIGRATED_FLAG, '1')
  } catch {
    /* stockage indisponible */
  }
}

export function desktopAdapter(api: DesktopApi): StorageAdapter {
  return {
    name: 'desktop-files',
    async getItem(key) {
      const { data } = await api.loadData()
      if (data) {
        markMigrated()
        return JSON.stringify({ state: data, version: 1 })
      }
      // Dossier vide : reprise des données de l'ancienne version, sinon démonstration.
      const legacy = migratedAlready()
        ? null
        : await indexedDbAdapter()
            .getItem(key)
            .catch(() => null)
      const persisted = legacy ?? JSON.stringify({ state: createDemoData(), version: 1 })
      await api.saveData(persisted)
      markMigrated()
      return persisted
    },
    setItem: (_key, value) => api.saveData(value),
    // Les données ne sont jamais supprimées depuis l'interface.
    removeItem: async () => {},
  }
}
