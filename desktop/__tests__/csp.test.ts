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

  it('autorise le script de thème d’index.html (et du build, s’il existe)', () => {
    for (const file of [path.join(root, 'index.html'), path.join(root, 'dist', 'index.html')]) {
      if (!fs.existsSync(file)) continue
      const html = fs.readFileSync(file, 'utf8')
      const body = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
      expect(body).toMatch(/data-theme/)
      const hash = `'sha256-${createHash('sha256').update(body).digest('base64')}'`
      expect(directives(rendererCsp(html))['script-src']).toContain(hash)
    }
  })
})
