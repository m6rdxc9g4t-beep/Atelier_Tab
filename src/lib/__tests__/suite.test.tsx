// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SuiteSwitcher } from '@/components/layout/SuiteSwitcher'
import { checkHealth, CURRENT_APP, HEALTH_TIMEOUT_MS, SUITE_APPS } from '../suite'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete window.atelierDesktop
})

describe('module suite (SUITE.md §2–3)', () => {
  it('liste les trois applications avec leurs adresses par défaut', () => {
    expect(CURRENT_APP).toBe('tab')
    expect(SUITE_APPS.map((a) => [a.id, a.name, a.url, a.healthUrl])).toEqual([
      ['viz', 'Atelier Viz', 'http://127.0.0.1:8000', 'http://127.0.0.1:8000/api/health'],
      ['tab', 'Atelier Tab', 'http://127.0.0.1:4175', null],
      ['projets', 'Atelier Projets', 'http://127.0.0.1:4174', 'http://127.0.0.1:3000/api/health'],
    ])
    expect(HEALTH_TIMEOUT_MS).toBe(1500)
    // Marque commune (SUITE.md §1.6) : « atelier_Viz »…
    expect(SUITE_APPS.map((a) => a.short)).toEqual(['Viz', 'Tab', 'Projets'])
  })

  it('réponse opaque = en marche, erreur réseau = arrêtée (no-cors)', async () => {
    const opaque = vi.fn<typeof fetch>(async () => ({ type: 'opaque', ok: false }) as Response)
    expect(await checkHealth('http://127.0.0.1:3000/api/health', 1500, opaque)).toBe('up')
    expect(opaque.mock.calls[0]?.[1]).toMatchObject({ mode: 'no-cors', credentials: 'omit' })
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect(await checkHealth('http://127.0.0.1:8000/api/health', 1500, failing)).toBe('down')
  })

  it('délai dépassé = arrêtée', async () => {
    vi.useFakeTimers()
    const hanging = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    )
    const result = checkHealth('http://127.0.0.1:8000/api/health', 1500, hanging)
    await vi.advanceTimersByTimeAsync(1500)
    expect(await result).toBe('down')
  })
})

describe('sélecteur « Suite Atelier »', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.includes(':3000')) return { type: 'opaque', ok: false } as Response
      throw new TypeError('Failed to fetch')
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch
    // Comme un navigateur : rappel après le rendu du menu.
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0) as unknown as number
  })

  const open = async () => {
    const trigger = screen.getByRole('button', { name: /Suite Atelier/ })
    await act(async () => {
      fireEvent.click(trigger)
      await new Promise((r) => setTimeout(r, 0))
    })
    return trigger
  }

  it('affiche les trois applications, l’app courante cochée, et l’état des API', async () => {
    render(<SuiteSwitcher />)
    await open()
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((i) => i.getAttribute('aria-label'))).toEqual([
      'Atelier Viz — Arrêtée',
      'Atelier Tab (application courante)',
      'Atelier Projets — En marche',
    ])
    expect(items[1]?.getAttribute('aria-checked')).toBe('true')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('ouvre une application dans un nouvel onglet (navigateur)', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<SuiteSwitcher />)
    await open()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Atelier Projets/ }))
    expect(openSpy).toHaveBeenCalledWith('http://127.0.0.1:4174', '_blank', 'noopener,noreferrer')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('passe par shell.openExternal dans l’app de bureau', async () => {
    const openLocalApp = vi.fn(async () => true)
    window.atelierDesktop = { openLocalApp } as unknown as NonNullable<typeof window.atelierDesktop>
    const openSpy = vi.spyOn(window, 'open')
    render(<SuiteSwitcher />)
    await open()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Atelier Viz/ }))
    expect(openLocalApp).toHaveBeenCalledWith('http://127.0.0.1:8000')
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('clavier : flèches, Échap rend le focus ; clic extérieur ferme', async () => {
    render(
      <>
        <SuiteSwitcher />
        <p>ailleurs</p>
      </>,
    )
    const trigger = await open()
    const items = screen.getAllByRole('menuitemradio')
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' })
    expect(document.activeElement).toBe(items[2])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)

    await open()
    fireEvent.mouseDown(screen.getByText('ailleurs'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
