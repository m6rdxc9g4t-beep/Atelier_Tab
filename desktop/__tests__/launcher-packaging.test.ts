/**
 * Lanceur installé (ADR 0005) : empaquetage electron-builder, point d'entrée, écran de démarrage
 * et serveur MCP livré dans l'app (`Contents/Resources/atelier-mcp`), exécuté sous Linux avec un
 * faux exécutable d'app.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = path.resolve(import.meta.dirname, '..', '..')
const readRoot = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

type BuildConfig = {
  appId: string
  productName: string
  files: string[]
  extraMetadata?: { main?: string }
  extraResources: { from: string; to: string }[]
}
const pkg = JSON.parse(readRoot('package.json')) as {
  main: string
  scripts: Record<string, string>
  build: BuildConfig
}

describe('empaquetage du lanceur', () => {
  it('même identité qu’avant (Dock, Spotlight, sélecteur de la suite)', () => {
    expect(pkg.build.appId).toBe('fr.atelier.tab')
    expect(pkg.build.productName).toBe('Atelier_Tab')
  })

  it('l’app ne contient que le point d’entrée : le code vient du dépôt', () => {
    expect(pkg.build.extraMetadata?.main).toBe('desktop/launcher/stub.cjs')
    expect(pkg.build.files).toContain('desktop/launcher/stub.cjs')
    expect(pkg.build.files.some((f) => f.startsWith('dist'))).toBe(false)
    // `electron .` (npm run app) garde le processus principal compilé.
    expect(pkg.main).toBe('dist-desktop/main.cjs')
  })

  it('ressources : chemin du dépôt et lanceur MCP, plus de serveur MCP figé', () => {
    expect(pkg.build.extraResources).toEqual([
      { from: 'dist-launcher/atelier-repo', to: 'atelier-repo' },
      { from: 'desktop/bin/atelier-mcp', to: 'atelier-mcp' },
    ])
  })

  it('scripts : app:build construit le lanceur, app:update met à jour depuis le terminal', () => {
    expect(pkg.scripts['app:build']).toMatch(
      /^node scripts\/build-launcher\.mjs && electron-builder/,
    )
    expect(pkg.scripts['app:update']).toBe('node desktop/launcher/cli.cjs')
    expect(pkg.scripts['app:install']).toContain('scripts/install-mac.mjs')
    expect(pkg.scripts.app).toContain('electron .')
  })

  it('le point d’entrée n’utilise que Node et Electron (rien à installer dans l’app)', () => {
    const stub = readRoot('desktop/launcher/stub.cjs')
    const required = [...stub.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1])
    expect(new Set(required)).toEqual(new Set(['node:fs', 'node:path', 'electron']))
    expect(stub).toContain("path.join(process.resourcesPath, 'atelier-repo')")
  })

  it('tampon, verrou et compilation en cours ignorés par git', () => {
    const ignored = readRoot('.gitignore').split('\n')
    expect(ignored).toContain('.mise-a-jour')
    expect(ignored).toContain('dist-launcher')
  })
})

describe('écran de démarrage', () => {
  const html = readRoot('desktop/launcher/splash.html')

  it('page locale : aucune ressource réseau, textes posés en textContent', () => {
    expect(html).toContain("default-src 'none'")
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toContain('innerHTML')
    expect(html).toContain('data-atelier-app="tab"')
  })

  it('la feuille de la marque commune existe au chemin relatif utilisé', () => {
    const href = /href="([^"]+atelier-brand\.css)"/.exec(html)?.[1]
    expect(href).toBeDefined()
    expect(fs.existsSync(path.resolve(root, 'desktop', 'launcher', href ?? ''))).toBe(true)
  })
})

describe('serveur MCP livré dans l’app (Contents/Resources/atelier-mcp)', () => {
  let tmp = ''
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  })

  /** Fausse app : l'exécutable affiche son environnement et ses arguments. */
  function fakeApp(repo: string | null) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-mcp-'))
    const contents = path.join(tmp, 'Atelier_Tab.app', 'Contents')
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true })
    fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true })
    fs.writeFileSync(
      path.join(contents, 'MacOS', 'Atelier_Tab'),
      '#!/bin/sh\necho "RUN_AS_NODE=$ELECTRON_RUN_AS_NODE $*"\n',
      { mode: 0o755 },
    )
    const launcher = path.join(contents, 'Resources', 'atelier-mcp')
    fs.copyFileSync(path.join(root, 'desktop', 'bin', 'atelier-mcp'), launcher)
    fs.chmodSync(launcher, 0o755)
    if (repo !== null)
      fs.writeFileSync(path.join(contents, 'Resources', 'atelier-repo'), `${repo}\n`)
    return launcher
  }

  it('lance dist-desktop/atelier-mcp.mjs du dépôt avec le Node.js d’Electron', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-depot '))
    try {
      fs.mkdirSync(path.join(repoDir, 'dist-desktop'))
      fs.writeFileSync(path.join(repoDir, 'dist-desktop', 'atelier-mcp.mjs'), '')
      const res = spawnSync(fakeApp(repoDir), ['--option'], { encoding: 'utf8' })
      expect(res.status).toBe(0)
      expect(res.stdout.trim()).toBe(
        `RUN_AS_NODE=1 ${path.join(repoDir, 'dist-desktop', 'atelier-mcp.mjs')} --option`,
      )
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true })
    }
  })

  it('pas compilé → message clair, code 1, sans rien lancer', () => {
    const res = spawnSync(fakeApp('/nulle/part'), [], { encoding: 'utf8' })
    expect(res.status).toBe(1)
    expect(res.stdout).toBe('')
    expect(res.stderr).toContain('le serveur MCP n')
    expect(res.stderr).toContain('npm run app:update')
  })

  it('chemin du dépôt absent → message clair, code 1', () => {
    const res = spawnSync(fakeApp(null), [], { encoding: 'utf8' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('npm run app:install')
  })
})
