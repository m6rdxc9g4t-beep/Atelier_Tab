import { describe, expect, it, vi } from 'vitest'
import { openSuiteOrExternal, suiteBundleFor, type ExecFileFn } from '../suite-launch'

describe('suiteBundleFor (SUITE.md §3)', () => {
  it('reconnaît les trois apps par hôte local et port', () => {
    expect(suiteBundleFor('http://127.0.0.1:8000')).toBe('fr.atelier-viz.app')
    expect(suiteBundleFor('http://localhost:4175/')).toBe('fr.atelier.tab')
    expect(suiteBundleFor('http://127.0.0.1:4174/#/gantt')).toBe('local.atelier-projets.desktop')
  })

  it('reconnaît Atelier Cuisine par son adresse en ligne (https, hôte exact)', () => {
    expect(suiteBundleFor('https://atelier-cuisine-iota.vercel.app')).toBe('fr.ateliercuisine.app')
    expect(suiteBundleFor('https://atelier-cuisine-iota.vercel.app/stock?x=1')).toBe(
      'fr.ateliercuisine.app',
    )
    // Ni http, ni autre port, ni identifiants, ni hôte voisin.
    expect(suiteBundleFor('http://atelier-cuisine-iota.vercel.app')).toBeNull()
    expect(suiteBundleFor('https://atelier-cuisine-iota.vercel.app:8443')).toBeNull()
    expect(suiteBundleFor('https://u:p@atelier-cuisine-iota.vercel.app')).toBeNull()
    expect(suiteBundleFor('https://evil.atelier-cuisine-iota.vercel.app')).toBeNull()
    expect(suiteBundleFor('https://atelier-cuisine-iota.vercel.app.evil.com')).toBeNull()
    expect(suiteBundleFor('https://vercel.app')).toBeNull()
    expect(suiteBundleFor('https://constructor')).toBeNull()
  })

  it('ignore les autres adresses', () => {
    expect(suiteBundleFor('http://127.0.0.1:3000')).toBeNull()
    expect(suiteBundleFor('http://example.com:8000')).toBeNull()
    expect(suiteBundleFor('http://192.168.1.2:4174')).toBeNull()
    expect(suiteBundleFor('https://github.com')).toBeNull()
    expect(suiteBundleFor('file:///tmp/x')).toBeNull()
    expect(suiteBundleFor('pas une adresse')).toBeNull()
    expect(suiteBundleFor(42)).toBeNull()
  })
})

function deps(platform: string, fails = false) {
  const calls: string[][] = []
  const execFile: ExecFileFn = (file, args, callback) => {
    calls.push([file, ...args])
    callback(fails ? new Error('introuvable') : null)
  }
  const openExternal = vi.fn(async () => undefined)
  return { calls, openExternal, deps: { execFile, openExternal, platform } }
}

describe('openSuiteOrExternal', () => {
  it("ouvre l'application installée sur macOS", async () => {
    const d = deps('darwin')
    expect(await openSuiteOrExternal('http://127.0.0.1:8000', d.deps)).toBe('app')
    expect(d.calls).toEqual([['/usr/bin/open', '-b', 'fr.atelier-viz.app']])
    expect(d.openExternal).not.toHaveBeenCalled()
  })

  it("revient au navigateur si l'app n'est pas installée", async () => {
    const d = deps('darwin', true)
    expect(await openSuiteOrExternal('http://127.0.0.1:4174', d.deps)).toBe('browser')
    expect(d.openExternal).toHaveBeenCalledWith('http://127.0.0.1:4174')
  })

  it("ouvre l'app Mac d'Atelier Cuisine, sinon sa PWA dans le navigateur", async () => {
    const url = 'https://atelier-cuisine-iota.vercel.app'
    const installed = deps('darwin')
    expect(await openSuiteOrExternal(url, installed.deps)).toBe('app')
    expect(installed.calls).toEqual([['/usr/bin/open', '-b', 'fr.ateliercuisine.app']])
    expect(installed.openExternal).not.toHaveBeenCalled()
    const missing = deps('darwin', true)
    expect(await openSuiteOrExternal(url, missing.deps)).toBe('browser')
    expect(missing.openExternal).toHaveBeenCalledWith(url)
  })

  it('hors macOS, va directement au navigateur', async () => {
    const d = deps('linux')
    expect(await openSuiteOrExternal('http://127.0.0.1:8000', d.deps)).toBe('browser')
    expect(d.calls).toEqual([])
    expect(d.openExternal).toHaveBeenCalledOnce()
  })

  it("une adresse hors suite n'appelle jamais open", async () => {
    const d = deps('darwin')
    expect(await openSuiteOrExternal('https://github.com', d.deps)).toBe('browser')
    expect(d.calls).toEqual([])
  })

  it("l'adresse de Tab lui-même ramène sa fenêtre, sans open ni navigateur (pas de boucle)", async () => {
    for (const platform of ['darwin', 'linux']) {
      const d = deps(platform)
      const focus = vi.fn()
      const self = { bundleId: 'fr.atelier.tab', focus }
      expect(await openSuiteOrExternal('http://127.0.0.1:4175/', { ...d.deps, self })).toBe('self')
      expect(focus).toHaveBeenCalledOnce()
      expect(d.calls).toEqual([])
      expect(d.openExternal).not.toHaveBeenCalled()
      // Les autres apps restent ouvertes normalement.
      expect(await openSuiteOrExternal('http://127.0.0.1:8000', { ...d.deps, self })).not.toBe(
        'self',
      )
    }
  })
})
