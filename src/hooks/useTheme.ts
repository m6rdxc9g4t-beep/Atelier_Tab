import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/** Clé de préférence propre à Atelier Tab (chaque app de la suite garde la sienne). */
export const THEME_STORAGE_KEY = 'atelier-tab:theme'

export const THEME_CHOICES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
  { value: 'system', label: 'Système' },
]

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}

/**
 * Pose les deux marqueurs de thème de la Suite Atelier sur <html> (docs/SUITE.md §1.5) :
 * la classe `dark` (Tailwind) et `data-theme` (design system). Même logique que le script
 * de index.html qui évite un flash au chargement.
 */
export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme
}

/** Thème de l'application : préférence Clair / Sombre / Système, mémorisée. */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(preference, systemDark)

  useEffect(() => {
    applyTheme(document.documentElement, resolved)
  }, [resolved])

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* stockage indisponible : la préférence reste en mémoire */
    }
  }, [])

  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark')
  }, [resolved, setTheme])

  return { preference, resolved, setTheme, toggle }
}
