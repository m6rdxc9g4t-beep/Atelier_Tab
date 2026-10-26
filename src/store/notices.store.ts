/** Messages courts affichés en bas de l'écran (mises à jour externes, fichiers invalides…). */
import { create } from 'zustand'

export interface Notice {
  id: number
  tone: 'info' | 'warning' | 'error'
  title: string
  detail?: string
  /** Bouton du message (« Annuler » après une suppression). */
  action?: { label: string; run: () => void }
}

interface NoticesState {
  notices: Notice[]
  /** Affiche un message ; renvoie son id. */
  push(notice: Omit<Notice, 'id'>, ttlMs?: number): number
  dismiss(id: number): void
  /** Retire le bouton d'un message (son action ne vaut plus), le message reste. */
  clearAction(id: number): void
}

let nextId = 1

export const useNotices = create<NoticesState>((set, get) => ({
  notices: [],
  push(notice, ttlMs = 5000) {
    const id = nextId++
    // Un même message répété ne s'empile pas.
    const others = get().notices.filter((n) => n.title !== notice.title)
    set({ notices: [...others.slice(-2), { ...notice, id }] })
    if (ttlMs > 0) setTimeout(() => get().dismiss(id), ttlMs)
    return id
  },
  dismiss(id) {
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
  },
  clearAction(id) {
    set((s) => ({
      notices: s.notices.map((n) => {
        if (n.id !== id || !n.action) return n
        const { action: _action, ...rest } = n
        void _action
        return rest
      }),
    }))
  },
}))
