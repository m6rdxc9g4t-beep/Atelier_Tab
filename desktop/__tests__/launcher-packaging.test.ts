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

type Resource = { from: string; to: string }
type BuildConfig = {
  appId: string
  productName: string
  files: string[]
  extraMetadata?: { main?: string }
  extraResources: Resource[]
  win?: { target: string[]; icon: string; extraResources: Resource[] }
}
const WIN = process.platform === 'win32'
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
    // Plateforme courante : macOS (comme avant `--mac`), Windows, Linux.
    expect(pkg.scripts['app:build']).toBe(
      'node scripts/build-launcher.mjs && electron-builder --dir',
    )
    expect(pkg.scripts.app).toContain('electron .')
  })

  it('app:install : macOS inchangé (app:build + install-mac.mjs), Windows → install.ps1', () => {
    expect(pkg.scripts['app:install']).toBe('node scripts/app-install.mjs')
    const dispatcher = readRoot('scripts/app-install.mjs')
    expect(dispatcher).toContain("'app:build'")
    expect(dispatcher).toContain("'install-mac.mjs'")
    expect(dispatcher).toContain("'install.ps1'")
    expect(dispatcher).toContain("'-ExecutionPolicy',\n    'Bypass'")
  })

  it('Windows : dossier (pas d’installateur), icône .ico, serveur MCP .cmd + .cjs', () => {
    expect(pkg.build.win).toEqual({
      target: ['dir'],
      icon: 'build/icon.ico',
      extraResources: [
        { from: 'desktop/bin/atelier-mcp.cmd', to: 'atelier-mcp.cmd' },
        { from: 'desktop/bin/atelier-mcp.cjs', to: 'atelier-mcp.cjs' },
        { from: 'build/icon.ico', to: 'icon.ico' },
      ],
    })
    for (const r of pkg.build.win?.extraResources ?? []) {
      expect(fs.existsSync(path.join(root, r.from)), r.from).toBe(true)
    }
    // Icône Windows : plusieurs tailles (en-tête ICO : réservé 0, type 1, nombre d'images).
    const ico = fs.readFileSync(path.join(root, 'build', 'icon.ico'))
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1])
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(5)
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

describe.skipIf(WIN)('serveur MCP livré dans l’app (Contents/Resources/atelier-mcp)', () => {
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

describe('serveur MCP livré dans l’app Windows (resources\\atelier-mcp.cmd / .cjs)', () => {
  let tmp = ''
  afterEach(() => {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  })

  /** Fausses ressources : `atelier-mcp.cjs` et `atelier-repo` (dépôt avec ou sans serveur compilé). */
  function fakeResources(repo: string | null) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-mcp-win-'))
    const resources = path.join(tmp, 'Atelier_Tab', 'resources')
    fs.mkdirSync(resources, { recursive: true })
    const entry = path.join(resources, 'atelier-mcp.cjs')
    fs.copyFileSync(path.join(root, 'desktop', 'bin', 'atelier-mcp.cjs'), entry)
    if (repo !== null) fs.writeFileSync(path.join(resources, 'atelier-repo'), `${repo}\n`)
    return entry
  }

  it('charge dist-desktop/atelier-mcp.mjs du dépôt (chemin avec espace et accent)', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dépôt atelier '))
    try {
      fs.mkdirSync(path.join(repoDir, 'dist-desktop'))
      fs.writeFileSync(
        path.join(repoDir, 'dist-desktop', 'atelier-mcp.mjs'),
        "process.stdout.write('serveur ' + process.argv.slice(2).join(' '))\n",
      )
      // Comme Atelier_Tab.exe avec ELECTRON_RUN_AS_NODE=1 : un simple Node.js.
      const res = spawnSync(process.execPath, [fakeResources(repoDir), '--option'], {
        encoding: 'utf8',
      })
      expect(res.stderr).toBe('')
      expect(res.status).toBe(0)
      expect(res.stdout).toBe('serveur --option')
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true })
    }
  })

  it('pas compilé → message clair, code 1', () => {
    const res = spawnSync(process.execPath, [fakeResources(path.join(os.tmpdir(), 'nulle-part'))], {
      encoding: 'utf8',
    })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('le serveur MCP n')
    expect(res.stderr).toContain('npm run app:update')
  })

  it('chemin du dépôt absent → message clair, code 1', () => {
    const res = spawnSync(process.execPath, [fakeResources(null)], { encoding: 'utf8' })
    expect(res.status).toBe(1)
    expect(res.stderr).toContain('npm run app:install')
  })

  it('atelier-mcp.cmd : CRLF, Node.js d’Electron, aucune donnée lue par cmd.exe', () => {
    const cmd = readRoot('desktop/bin/atelier-mcp.cmd')
    expect(cmd).toMatch(/\r\n/)
    expect(cmd.replace(/\r\n/g, '')).not.toMatch(/\n/)
    expect(cmd).toContain('set "ELECTRON_RUN_AS_NODE=1"')
    expect(cmd).toContain('"%~dp0..\\Atelier_Tab.exe" "%~dp0atelier-mcp.cjs" %*')
    expect(cmd).not.toContain('set /p')
  })
})

describe('installation Windows (scripts/windows/install.ps1, §9.1)', () => {
  const raw = fs.readFileSync(path.join(root, 'scripts', 'windows', 'install.ps1'))
  const ps1 = raw.toString('utf8')

  it('UTF-8 avec BOM (accents lus par Windows PowerShell 5.1) et CRLF', () => {
    expect([...raw.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(ps1.replace(/\r\n/g, '')).not.toMatch(/\n/)
  })

  it('options, emplacements et enregistrement du contrat', () => {
    expect(ps1).toContain('[switch]$SansBureau')
    expect(ps1).toContain('[switch]$Desinstaller')
    expect(ps1).toContain("Join-Path $env:LOCALAPPDATA 'Programs'")
    expect(ps1).toContain("'Microsoft\\Windows\\Start Menu\\Programs\\Atelier'")
    expect(ps1).toContain("$CleRegistre = 'HKCU:\\Software\\Atelier\\Apps\\tab'")
    // §9.6 : Lanceur = raccourci .lnk du menu Démarrer, jamais l'exécutable.
    expect(ps1).toContain("-Name 'Lanceur' -Value $RaccourciMenu")
    expect(ps1).toContain("-Name 'Nom'")
    expect(ps1).toContain('icon.ico')
    expect(ps1).toContain('desktop\\launcher\\cli.cjs')
  })

  it('prérequis vérifiés avec les commandes winget, jamais installés', () => {
    expect(ps1).toContain('winget install --id Git.Git -e')
    expect(ps1).toContain('winget install --id OpenJS.NodeJS.LTS -e')
    expect(ps1).toContain("[version]'22.12.0'")
    expect(ps1).not.toMatch(/^\s*(?:&\s*)?winget /m)
  })

  it('npm lancé par node.exe (npm-cli.js), jamais npm.cmd ni Invoke-Expression', () => {
    expect(ps1).toContain("'node_modules\\npm\\bin\\npm-cli.js'")
    expect(ps1).not.toMatch(/npm\.cmd['"\s]*@/)
    expect(ps1).not.toMatch(/Invoke-Expression|iex /i)
  })

  it('jamais de suppression des données (dossier Atelier_Tab du profil, préférences)', () => {
    for (const line of ps1.split('\r\n').filter((l) => /Remove-(?:Item|Dossier)/.test(l))) {
      expect(line).not.toMatch(/USERPROFILE|APPDATA\b(?!.*Start Menu)/)
    }
  })
})
