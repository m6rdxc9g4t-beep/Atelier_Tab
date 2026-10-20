import { describe, expect, it, vi } from 'vitest'
import { bringToFront } from '../window-focus'

describe('retour au premier plan (route de santé, SUITE.md §3)', () => {
  const win = (minimized: boolean) => ({
    isMinimized: vi.fn(() => minimized),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
  })

  it('show() / focus() seulement : aucun vol du premier plan', () => {
    const w = win(false)
    bringToFront(w)
    expect(w.show).toHaveBeenCalledOnce()
    expect(w.focus).toHaveBeenCalledOnce()
    expect(w.restore).not.toHaveBeenCalled()
    // L'API ne reçoit que la fenêtre : aucun accès à `app.focus({ steal: true })`.
    expect(bringToFront.length).toBe(1)
  })

  it('fenêtre réduite : restaurée d’abord', () => {
    const w = win(true)
    bringToFront(w)
    expect(w.restore).toHaveBeenCalledOnce()
    expect(w.show).toHaveBeenCalledOnce()
  })

  it('le processus principal n’appelle jamais app.focus({ steal: true })', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const main = fs.readFileSync(path.join(import.meta.dirname, '..', 'main.ts'), 'utf8')
    expect(main).not.toMatch(/steal\s*:\s*true/)
    expect(main).toMatch(/bringToFront\(win\)/)
  })
})
