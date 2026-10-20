/**
 * État de l'assistant intégré : panneau ouvert, moteur et modèles choisis (mémorisés),
 * conversation en cours (en mémoire).
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { DEFAULT_CLAUDE_MODEL, isClaudeModel, type ClaudeModelAlias } from '@/ai/claude'
import { isEngineChoice, type EngineChoice } from '@/ai/engine'
import type { ChatMessage } from '@/ai/ollama'
import type { EngineId } from '@/ai/provider'

export type AssistantEntry =
  | { id: number; kind: 'user'; text: string }
  | {
      id: number
      kind: 'assistant'
      text: string
      /** Moteur qui a effectivement répondu (affiché sous la réponse). */
      engine?: EngineId
      model?: string
    }
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
  /** Modèle Ollama choisi. */
  model: string | null
  /** Moteur choisi : Auto, Ollama ou Claude (docs/SUITE.md §5.2). */
  engine: EngineChoice
  claudeModel: ClaudeModelAlias
  entries: AssistantEntry[]
  /** Historique envoyé au modèle (sans message système). */
  history: ChatMessage[]
  running: boolean
  setOpen(open: boolean): void
  toggle(): void
  setModel(model: string | null): void
  setEngine(engine: EngineChoice): void
  setClaudeModel(model: ClaudeModelAlias): void
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
      engine: 'auto',
      claudeModel: DEFAULT_CLAUDE_MODEL,
      entries: [],
      history: [],
      running: false,
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
      setModel: (model) => set({ model }),
      setEngine: (engine) => set({ engine }),
      setClaudeModel: (claudeModel) => set({ claudeModel }),
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
      partialize: (s) => ({
        open: s.open,
        model: s.model,
        engine: s.engine,
        claudeModel: s.claudeModel,
      }),
      // Valeurs enregistrées abîmées ou d'une version antérieure : valeurs par défaut.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AssistantState>
        return {
          ...current,
          open: p.open === true,
          model: typeof p.model === 'string' ? p.model : null,
          engine: isEngineChoice(p.engine) ? p.engine : 'auto',
          claudeModel: isClaudeModel(p.claudeModel) ? p.claudeModel : DEFAULT_CLAUDE_MODEL,
        }
      },
    },
  ),
)
