import { createStore, del, get, set } from 'idb-keyval'
import type { StorageAdapter } from './StorageAdapter'

/** IndexedDB (par défaut) : grande capacité, asynchrone, ne bloque pas l'interface. */
export function indexedDbAdapter(dbName = 'atelier-tab', storeName = 'state'): StorageAdapter {
  const store = createStore(dbName, storeName)
  return {
    name: 'indexeddb',
    getItem: async (key) => (await get<string>(key, store)) ?? null,
    setItem: (key, value) => set(key, value, store),
    removeItem: (key) => del(key, store),
  }
}

/** localStorage : repli si IndexedDB est indisponible (navigation privée de certains navigateurs). */
export function localStorageAdapter(prefix = 'atelier-tab:'): StorageAdapter {
  return {
    name: 'localstorage',
    getItem: async (key) => localStorage.getItem(prefix + key),
    setItem: async (key, value) => localStorage.setItem(prefix + key, value),
    removeItem: async (key) => localStorage.removeItem(prefix + key),
  }
}

/** Mémoire : tests et environnements sans stockage. */
export function memoryAdapter(initial: Record<string, string> = {}): StorageAdapter {
  const data = new Map(Object.entries(initial))
  return {
    name: 'memory',
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value)
    },
    removeItem: async (key) => {
      data.delete(key)
    },
  }
}

/**
 * API REST (préparé pour une synchronisation serveur ou Supabase) :
 * GET/PUT/DELETE `${baseUrl}/state/:key`, corps en texte JSON.
 */
export function restAdapter(baseUrl: string, getToken?: () => string | null): StorageAdapter {
  const headers = (): HeadersInit => {
    const token = getToken?.()
    return {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
  }
  const url = (key: string) => `${baseUrl.replace(/\/$/, '')}/state/${encodeURIComponent(key)}`
  return {
    name: 'rest',
    async getItem(key) {
      const res = await fetch(url(key), { headers: headers() })
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`Lecture impossible (${res.status})`)
      return res.text()
    },
    async setItem(key, value) {
      const res = await fetch(url(key), { method: 'PUT', headers: headers(), body: value })
      if (!res.ok) throw new Error(`Écriture impossible (${res.status})`)
    },
    async removeItem(key) {
      const res = await fetch(url(key), { method: 'DELETE', headers: headers() })
      if (!res.ok && res.status !== 404) throw new Error(`Suppression impossible (${res.status})`)
    },
  }
}

/** Choisit le meilleur stockage disponible dans l'environnement courant. */
export function defaultAdapter(): StorageAdapter {
  if (typeof indexedDB !== 'undefined') return indexedDbAdapter()
  try {
    if (typeof localStorage !== 'undefined') return localStorageAdapter()
  } catch {
    /* accès refusé */
  }
  return memoryAdapter()
}
