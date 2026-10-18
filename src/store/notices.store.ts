/** Messages courts affichés en bas de l'écran (mises à jour externes, fichiers invalides…). */
import { create } from 'zustand'

export interface Notice {
  id: number
  tone: 'info' | 'warning' | 'error'
  title: string
  detail?: string
}

interface NoticesState {
  notices: Notice[]
  push(notice: Omit<Notice, 'id'>, ttlMs?: number): void
  dismiss(id: number): void
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
  },
  dismiss(id) {
    set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }))
  },
}))
