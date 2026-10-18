/**
 * État de l'assistant intégré : panneau ouvert, modèle choisi (mémorisés), conversation
 * en cours (en mémoire).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ChatMessage } from '@/ai/ollama'

export type AssistantEntry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | {
      id: number
      kind: 'tool'
      name: string
      args: Record<string, unknown>
      status: 'running' | 'ok' | 'error'
      detail?: string
    }
  | { id: number; kind: 'error'; text: string }

/** Omit appliqué à chaque membre de l'union. */
type NewEntry = AssistantEntry extends infer E
  ? E extends AssistantEntry
    ? Omit<E, 'id'>
    : never
  : never

interface AssistantState {
  open: boolean
  model: string | null
  entries: AssistantEntry[]
  /** Historique envoyé au modèle (sans message système). */
  history: ChatMessage[]
  running: boolean
  setOpen(open: boolean): void
  toggle(): void
  setModel(model: string | null): void
  addEntry(entry: NewEntry): number
  updateEntry(id: number, patch: Record<string, unknown>): void
  setHistory(history: ChatMessage[]): void
  setRunning(running: boolean): void
  reset(): void
}

let nextId = 1

export const useAssistant = create<AssistantState>()(
  persist(
    (set) => ({
      open: false,
      model: null,
      entries: [],
      history: [],
      running: false,
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
      setModel: (model) => set({ model }),
      addEntry: (entry) => {
        const id = nextId++
        set((s) => ({ entries: [...s.entries, { ...entry, id } as AssistantEntry] }))
        return id
      },
      updateEntry: (id, patch) =>
        set((s) => ({
          entries: s.entries.map((e) => (e.id === id ? ({ ...e, ...patch } as AssistantEntry) : e)),
        })),
      setHistory: (history) => set({ history }),
      setRunning: (running) => set({ running }),
      reset: () => set({ entries: [], history: [], running: false }),
    }),
    {
      name: 'atelier-tab:assistant',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ open: s.open, model: s.model }),
    },
  ),
)
