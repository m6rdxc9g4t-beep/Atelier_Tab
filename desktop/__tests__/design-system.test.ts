/**
 * Design system de la Suite Atelier (docs/SUITE.md §1.1–1.3) : copies verbatim présentes
 * dans src/styles/atelier-ds/, variables de fondation et couleurs officielles définies,
 * jetons d'Atelier Tab (src/index.css) dérivés.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Test placé avec le code Node (typé pour fs) ; il vérifie les feuilles de src/.
const src = path.resolve(import.meta.dirname, '..', '..', 'src')
const styles = path.join(src, 'styles')
const read = (file: string) => fs.readFileSync(path.join(styles, file), 'utf8')
const indexCss = fs.readFileSync(path.join(src, 'index.css'), 'utf8')

const FOUNDATION = [
  '--bg-main',
  '--bg-surface',
  '--bg-elevated',
  '--text-primary',
  '--text-muted',
  '--border-color',
]
const OFFICIAL = {
  '--type-phase': '#FF8F2B',
  '--type-milestone': '#2A9A30',
  '--type-epic': '#8250DF',
  '--type-story': '#6F42C1',
  '--type-feature': '#2A9A30',
  '--type-task': '#1B66A3',
  '--type-bug': '#D64545',
  '--status-open': '#64748B',
  '--status-progress': '#2563EB',
  '--status-review': '#8B5CF6',
  '--status-hold': '#F59E0B',
  '--status-blocked': '#EA580C',
  '--status-resolved': '#0D9488',
  '--status-closed': '#16A34A',
  '--status-rejected': '#DC2626',
}

/** Déclarations `--nom: valeur;` d'un bloc CSS. */
function declarations(css: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out.set(m[1]!, m[2]!.trim())
  return out
}

// Référence (dépôt voisin) : comparée octet par octet quand elle est présente.
const REFERENCE =
  process.env.ATELIER_DS_DIR ?? path.resolve(src, '..', '..', 'atelier_projets', 'design-system')
const REFERENCE_FILES: Record<string, string> = {
  'light.css': 'themes/light.css',
  'dark.css': 'themes/dark.css',
  'colors.css': 'tokens/colors.css',
}

describe('copies du design system', () => {
  it.skipIf(!fs.existsSync(REFERENCE)).each(Object.entries(REFERENCE_FILES))(
    '%s est identique à design-system/%s',
    (copy, ref) => {
      expect(read(`atelier-ds/${copy}`)).toBe(fs.readFileSync(path.join(REFERENCE, ref), 'utf8'))
    },
  )

  it.each(['light.css', 'dark.css', 'colors.css'])(
    '%s commence par le commentaire d’origine',
    (f) => {
      expect(read(`atelier-ds/${f}`)).toMatch(/^\/\* =+\n {3}Atelier_Projets · Design System — /)
    },
  )

  it('sont protégées du formatage automatique', () => {
    const ignore = fs.readFileSync(path.resolve(src, '..', '.prettierignore'), 'utf8')
    expect(ignore).toContain('src/styles/atelier-ds/')
    expect(ignore).toContain('docs/SUITE.md')
  })

  it('les thèmes clair et sombre définissent les 6 variables de fondation', () => {
    const light = declarations(read('atelier-ds/light.css'))
    const dark = declarations(read('atelier-ds/dark.css'))
    for (const v of FOUNDATION) {
      expect(light.get(v), v).toMatch(/^#[0-9A-F]{6}$/i)
      expect(dark.get(v), v).toMatch(/^#[0-9A-F]{6}$/i)
    }
    expect(read('atelier-ds/dark.css')).toContain('[data-theme="dark"]')
  })

  it('colors.css définit les 15 couleurs officielles (7 types, 8 statuts)', () => {
    const colors = declarations(read('atelier-ds/colors.css'))
    expect(Object.keys(OFFICIAL)).toHaveLength(15)
    for (const [name, hex] of Object.entries(OFFICIAL)) expect(colors.get(name), name).toBe(hex)
  })

  it('les thèmes restent du CSS natif pur (aucune dépendance)', () => {
    for (const f of ['light.css', 'dark.css', 'colors.css']) {
      expect(read(`atelier-ds/${f}`)).not.toMatch(/@import|url\(|var\(/)
    }
  })
})

describe('jetons d’Atelier Tab (src/index.css)', () => {
  it('importe les trois copies', () => {
    for (const f of ['colors.css', 'light.css', 'dark.css']) {
      expect(indexCss).toContain(`@import './styles/atelier-ds/${f}'`)
    }
  })

  it('dérive ses jetons des variables de fondation (§1.2), sans couleur littérale', () => {
    const tokens = declarations(indexCss.split('@theme inline')[0]!)
    expect(tokens.get('--surface')).toBe('var(--bg-surface)')
    expect(tokens.get('--surface-sunken')).toBe('var(--bg-main)')
    expect(tokens.get('--surface-raised')).toBe('var(--bg-surface)')
    expect(tokens.get('--surface-hover')).toContain('var(--bg-elevated)')
    expect(tokens.get('--ink')).toBe('var(--text-primary)')
    expect(tokens.get('--muted')).toBe('var(--text-muted)')
    expect(tokens.get('--line')).toBe('var(--border-color)')
    expect(tokens.get('--accent')).toBe('var(--type-epic)')
    expect(tokens.get('--success')).toBe('var(--status-closed)')
    expect(tokens.get('--danger')).toBe('var(--status-rejected)')
    expect(tokens.get('--warning')).toBe('var(--status-hold)')
    for (const derived of ['--surface-hover', '--line-strong', '--faint', '--accent-soft']) {
      expect(tokens.get(derived), derived).toMatch(/^color-mix\(in oklab, /)
    }
    expect(indexCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('rayons 6 / 10 / 16 px et polices système, sans police téléchargée (§1.3)', () => {
    expect(indexCss).toMatch(/--ds-radius-sm: 6px/)
    expect(indexCss).toMatch(/--ds-radius-md: 10px/)
    expect(indexCss).toMatch(/--ds-radius-lg: 16px/)
    expect(indexCss).toMatch(/--ds-font-sans:\s*ui-sans-serif, system-ui/)
    expect(indexCss).toMatch(/--ds-font-mono:\s*ui-monospace/)
    expect(indexCss).not.toMatch(/Inter|JetBrains|fonts\.googleapis|@font-face/)
  })

  it('le variant dark: de Tailwind suit la classe .dark et data-theme="dark"', () => {
    expect(indexCss).toMatch(
      /@custom-variant dark \(&:where\(\.dark, \.dark \*, \[data-theme='dark'\]/,
    )
  })

  it('chaque statut officiel a sa teinte de badge (§1.4)', () => {
    for (const code of [
      'OPEN',
      'IN_PROGRESS',
      'IN_REVIEW',
      'ON_HOLD',
      'BLOCKED',
      'RESOLVED',
      'CLOSED',
      'REJECTED',
    ]) {
      expect(indexCss).toMatch(
        new RegExp(`\\[data-status='${code}'\\] \\{\\s*--tone: var\\(--status-`),
      )
    }
  })
})
