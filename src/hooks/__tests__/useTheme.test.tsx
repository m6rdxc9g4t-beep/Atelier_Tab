// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { applyTheme, resolveTheme, THEME_STORAGE_KEY, useTheme } from '../useTheme'

let systemDark = false
const listeners = new Set<(e: MediaQueryListEvent) => void>()

beforeEach(() => {
  localStorage.clear()
  systemDark = false
  listeners.clear()
  document.documentElement.className = ''
  delete document.documentElement.dataset.theme
  window.matchMedia = ((query: string) => ({
    matches: systemDark,
    media: query,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
  })) as unknown as typeof window.matchMedia
})
afterEach(cleanup)

const html = document.documentElement
const markers = () => ({ dark: html.classList.contains('dark'), theme: html.dataset.theme })

describe('thème (SUITE.md §1.5)', () => {
  it('pose les deux marqueurs : classe dark et data-theme', () => {
    applyTheme(html, 'dark')
    expect(markers()).toEqual({ dark: true, theme: 'dark' })
    applyTheme(html, 'light')
    expect(markers()).toEqual({ dark: false, theme: 'light' })
  })

  it('résout la préférence Système', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('suit le système par défaut, puis ses changements', () => {
    systemDark = true
    const { result } = renderHook(() => useTheme())
    expect(result.current.preference).toBe('system')
    expect(markers()).toEqual({ dark: true, theme: 'dark' })
    act(() => {
      for (const cb of listeners) cb({ matches: false } as MediaQueryListEvent)
    })
    expect(markers()).toEqual({ dark: false, theme: 'light' })
  })

  it('mémorise un choix explicite sous sa propre clé', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('dark'))
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(THEME_STORAGE_KEY).toBe('atelier-tab:theme')
    expect(markers()).toEqual({ dark: true, theme: 'dark' })
  })

  it('le menu propose Clair, Sombre et Système', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: 'Thème : Clair' }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual(['Clair', 'Sombre', 'Système'])
    expect(items[0]?.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Sombre' }))
    expect(markers()).toEqual({ dark: true, theme: 'dark' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
