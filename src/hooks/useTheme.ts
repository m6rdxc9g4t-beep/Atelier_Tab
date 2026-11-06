import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

/**
 * Préférence de thème commune à la Suite Atelier (docs/SUITE.md §1.5) : gérée par la copie
 * verbatim de styles/atelier-brand/atelier-theme.js, insérée en script bloquant dans index.html
 * (cookie `atelier_theme` sur le VPS, sinon cette clé de localStorage).
 */
export const THEME_STORAGE_KEY = 'atelier:theme'
/** Ancienne clé propre à Tab (v1) : reprise une fois, puis effacée. */
export const LEGACY_THEME_STORAGE_KEY = 'atelier-tab:theme'
/** Événement émis par atelier-theme.js à chaque changement (detail = préférence). */
export const THEME_EVENT = 'atelier-theme'

export const THEME_CHOICES: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Clair' },
  { value: 'dark', label: 'Sombre' },
  { value: 'system', label: 'Système' },
]

/** API posée par atelier-theme.js. */
interface AtelierThemeApi {
  get(): ThemePreference
  set(pref: ThemePreference): void
  resolved(): ResolvedTheme
}

declare global {
  interface Window {
    atelierTheme?: AtelierThemeApi
  }
}

const isPreference = (v: unknown): v is ThemePreference =>
  v === 'light' || v === 'dark' || v === 'system'

/** Lecture de repli (script absent : tests, page sans index.html). */
function storedPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    return isPreference(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

function readPreference(): ThemePreference {
  return window.atelierTheme?.get() ?? storedPreference()
}

/**
 * Reprend l'ancienne préférence de Tab si aucune préférence commune n'existe encore,
 * puis efface l'ancienne clé (plus rien ne la lit).
 */
export function migrateLegacyPreference(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_THEME_STORAGE_KEY)
    if (legacy === null) return
    localStorage.removeItem(LEGACY_THEME_STORAGE_KEY)
    const hasShared =
      localStorage.getItem(THEME_STORAGE_KEY) !== null ||
      /(?:^|; )atelier_theme=/.test(document.cookie)
    if (!hasShared && isPreference(legacy) && legacy !== 'system') writePreference(legacy)
  } catch {
    /* stockage indisponible : rien à reprendre */
  }
}

function writePreference(next: ThemePreference): void {
  if (window.atelierTheme) {
    window.atelierTheme.set(next)
    return
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    /* stockage indisponible : la préférence reste en mémoire */
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: next }))
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
}

/**
 * Pose les deux marqueurs de thème de la Suite Atelier sur <html> (docs/SUITE.md §1.5) :
 * la classe `dark` (Tailwind) et `data-theme` (design system), comme atelier-theme.js.
 */
export function applyTheme(root: HTMLElement, theme: ResolvedTheme): void {
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

/** Thème de l'application : préférence Système / Clair / Sombre, commune à la suite. */
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

  // Changement venu d'ailleurs (autre composant, autre app de la suite au retour sur la page).
  useEffect(() => {
    const onTheme = (e: Event) => {
      const next = (e as CustomEvent<unknown>).detail
      if (isPreference(next)) setPreference(next)
    }
    const onVisible = () => {
      if (!document.hidden) setPreference(readPreference())
    }
    window.addEventListener(THEME_EVENT, onTheme)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(THEME_EVENT, onTheme)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const resolved = resolveTheme(preference, systemDark)

  useEffect(() => {
    applyTheme(document.documentElement, resolved)
  }, [resolved])

  const setTheme = useCallback((next: ThemePreference) => {
    setPreference(next)
    writePreference(next)
  }, [])

  const toggle = useCallback(() => {
    setTheme(resolved === 'dark' ? 'light' : 'dark')
  }, [resolved, setTheme])

  return { preference, resolved, setTheme, toggle }
}
