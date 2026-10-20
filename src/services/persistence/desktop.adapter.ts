/**
 * Persistance de l'app de bureau : les données vivent dans le dossier ~/Atelier_Tab
 * (fichiers JSON lisibles par les IA), lus et écrits par le processus principal.
 *
 * Premier lancement avec ce stockage : les données de l'ancienne version (IndexedDB)
 * sont reprises et écrites dans le dossier ; à défaut, les données de démonstration.
 *
 * Le mode « En ligne » vient toujours du processus principal (fichier de préférences, hors du
 * dossier de données, docs/SUITE.md §5.1) : une ancienne valeur reprise d'IndexedDB est ignorée.
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

/** État repris d'une ancienne version : mode « En ligne » remis à hors ligne. */
export function withoutOnlineMode(persisted: string): string {
  try {
    const parsed = JSON.parse(persisted) as { state?: Record<string, unknown> }
    if (typeof parsed.state !== 'object' || parsed.state === null) return persisted
    return JSON.stringify({
      ...parsed,
      state: { ...parsed.state, preferences: { onlineMode: false } },
    })
  } catch {
    return persisted
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
      const persisted = legacy
        ? withoutOnlineMode(legacy)
        : JSON.stringify({ state: createDemoData(), version: 1 })
      await api.saveData(persisted)
      markMigrated()
      return persisted
    },
    setItem: (_key, value) => api.saveData(value),
    // Les données ne sont jamais supprimées depuis l'interface.
    removeItem: async () => {},
  }
}
