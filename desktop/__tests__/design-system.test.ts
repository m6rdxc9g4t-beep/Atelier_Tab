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

// Marque commune, charte v2 « Linear » (docs/SUITE.md §1.6–1.7) : copies à l'octet près.
const BRAND_FILES = [
  'atelier-brand.css',
  'atelier-theme.js',
  'inter-latin-wght-normal.woff2',
  'inter-latin-ext-wght-normal.woff2',
  'LICENSE-Inter.txt',
]
const BRAND_REFERENCE = path.resolve(REFERENCE, 'brand', 'atelier-brand.css')
const brandCss = read('atelier-brand/atelier-brand.css')

describe('marque commune (src/styles/atelier-brand/)', () => {
  it.skipIf(!fs.existsSync(BRAND_REFERENCE)).each(BRAND_FILES)(
    '%s est identique à design-system/brand/',
    (file) => {
      expect(fs.readFileSync(path.join(styles, 'atelier-brand', file))).toEqual(
        fs.readFileSync(path.resolve(REFERENCE, 'brand', file)),
      )
    },
  )

  it('embarque Inter (et sa licence), plus Nunito', () => {
    const dir = fs.readdirSync(path.join(styles, 'atelier-brand'))
    for (const file of BRAND_FILES) expect(dir).toContain(file)
    expect(dir.some((f) => /nunito/i.test(f))).toBe(false)
    expect(brandCss).toContain('url("./inter-latin-wght-normal.woff2")')
  })

  it.each([
    ['tab', '#1c8742'],
    ['viz', '#996c00'],
    ['projets', '#568100'],
    ['cuisine', '#8568a7'],
  ])('définit la signature de %s (%s) pour le sélecteur de la suite', (app, hex) => {
    expect(brandCss).toMatch(new RegExp(`--atelier-sig-${app}: ${hex};`, 'i'))
    expect(brandCss).toContain(
      `[data-atelier-app="${app}"] { --atelier-signature: var(--atelier-sig-${app});`,
    )
  })

  it('est protégée du formatage automatique', () => {
    const ignore = fs.readFileSync(path.resolve(src, '..', '.prettierignore'), 'utf8')
    expect(ignore).toContain('src/styles/atelier-brand/')
  })
})

describe('jetons d’Atelier Tab (src/index.css)', () => {
  it('importe les trois copies', () => {
    for (const f of ['colors.css', 'light.css', 'dark.css']) {
      expect(indexCss).toContain(`@import './styles/atelier-ds/${f}'`)
    }
  })

  it('branche ses jetons sur la structure neutre de la marque (§1.7), sans couleur littérale', () => {
    const tokens = declarations(indexCss.split('@theme inline')[0]!)
    expect(tokens.get('--page')).toBe('var(--atelier-bg)')
    expect(tokens.get('--sidebar')).toBe('var(--atelier-sidebar)')
    expect(tokens.get('--surface')).toBe('var(--atelier-surface)')
    expect(tokens.get('--surface-hover')).toBe('var(--atelier-surface-2)')
    expect(tokens.get('--field')).toBe('var(--atelier-field)')
    expect(tokens.get('--ink')).toBe('var(--atelier-text)')
    expect(tokens.get('--muted')).toBe('var(--atelier-muted)')
    expect(tokens.get('--faint')).toBe('var(--atelier-faint)')
    expect(tokens.get('--selection')).toBe('var(--atelier-surface-3)')
    expect(tokens.get('--edge')).toBe('var(--atelier-border)')
    expect(tokens.get('--line')).toBe('var(--atelier-line)')
    expect(tokens.get('--line-strong')).toBe('var(--atelier-border-soft)')
    // Accent = couleur signature de Tab, posée par data-atelier-app="tab".
    expect(tokens.get('--accent')).toBe('var(--atelier-signature)')
    expect(tokens.get('--accent-fg')).toBe('var(--atelier-ink)')
    // Couleurs qui portent un sens : officielles, inchangées.
    expect(tokens.get('--success')).toBe('var(--status-closed)')
    expect(tokens.get('--danger')).toBe('var(--status-rejected)')
    expect(tokens.get('--warning')).toBe('var(--status-hold)')
    for (const derived of ['--surface-sunken', '--accent-soft', '--row-hover']) {
      expect(tokens.get(derived), derived).toMatch(/^color-mix\(in oklab, /)
    }
    expect(indexCss).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('plat au repos : fond uni, ni grille ni lueur de fond', () => {
    expect(indexCss).toMatch(/background: var\(--page\);/)
    expect(indexCss).not.toContain('--atelier-backdrop')
    expect(indexCss).not.toMatch(/text-shadow|--atelier-signature-glow/)
  })

  it('rayons 5 / 7 / 10 px et police Inter embarquée de la marque, aucune police distante (§1.3)', () => {
    expect(indexCss).toMatch(/--ds-radius-sm: var\(--atelier-radius-sm\)/)
    expect(indexCss).toMatch(/--ds-radius-md: var\(--atelier-radius-md\)/)
    expect(indexCss).toMatch(/--ds-radius-lg: var\(--atelier-radius-lg\)/)
    expect(brandCss).toMatch(
      /--atelier-radius-sm: 5px;[\s\S]*--atelier-radius-md: 7px;[\s\S]*--atelier-radius-lg: 10px;/,
    )
    expect(indexCss).toMatch(/--ds-font-sans: var\(--atelier-font\)/)
    expect(indexCss).toMatch(/--ds-font-mono: var\(--atelier-font-mono\)/)
    expect(indexCss).not.toMatch(/fonts\.googleapis|@font-face|url\(/)
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
