/**
 * Contrat de stockage clé/valeur utilisé par le store.
 * Compatible avec `createJSONStorage` de Zustand (getItem / setItem / removeItem).
 */
export interface StorageAdapter {
  readonly name: string
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}
