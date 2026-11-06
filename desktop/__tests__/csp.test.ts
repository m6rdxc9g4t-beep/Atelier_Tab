import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONNECT_SRC, inlineScriptHashes, rendererCsp } from '../csp'

const root = path.resolve(import.meta.dirname, '..', '..')
const directives = (csp: string) =>
  Object.fromEntries(
    csp.split('; ').map((d) => {
      const [name, ...values] = d.split(' ')
      return [name, values]
    }),
  ) as Record<string, string[]>

describe('politique de contenu de l’interface (SUITE.md §5.4)', () => {
  it('connect-src : l’app et cette machine seulement', () => {
    const csp = directives(rendererCsp('<html></html>'))
    expect(csp['connect-src']).toEqual(["'self'", 'http://127.0.0.1:*', 'http://localhost:*'])
    expect(CONNECT_SRC).not.toContain('https:')
    expect(csp['default-src']).toEqual(["'self'"])
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['frame-src']).toEqual(["'none'"])
    expect(csp['form-action']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'none'"])
  })

  it('scripts : ceux de l’app et les scripts en ligne par leur empreinte, jamais eval', () => {
    const html = '<script>var a = 1</script><script type="module" src="/x.js"></script>'
    const expected = `'sha256-${createHash('sha256').update('var a = 1').digest('base64')}'`
    expect(inlineScriptHashes(html)).toEqual([expected])
    const csp = rendererCsp(html)
    expect(directives(csp)['script-src']).toEqual(["'self'", expected])
    expect(csp).not.toMatch(/unsafe-eval/)
    expect(directives(csp)['script-src']).not.toContain("'unsafe-inline'")
  })

  it('autorise le script de thème commun (atelier-theme.js inséré dans index.html)', () => {
    // index.html ne porte plus de script en ligne : vite.config.ts y insère la copie verbatim.
    expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toContain('atelier-theme.js')
    const script = fs.readFileSync(
      path.join(root, 'src', 'styles', 'atelier-brand', 'atelier-theme.js'),
      'utf8',
    )
    const pages = [`<head><script>${script}</script></head>`]
    const built = path.join(root, 'dist', 'index.html')
    if (fs.existsSync(built)) pages.push(fs.readFileSync(built, 'utf8'))
    for (const html of pages) {
      const body = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
      expect(body).toContain('window.atelierTheme')
      expect(body).toMatch(/dataset\.theme/)
      const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`
      expect(directives(rendererCsp(html))['script-src']).toContain(hash)
    }
  })
})
