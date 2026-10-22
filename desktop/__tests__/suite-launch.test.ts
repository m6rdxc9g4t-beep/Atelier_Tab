import { describe, expect, it, vi } from 'vitest'
import {
  minimalEnv,
  openSuiteOrExternal,
  REGISTRY_SCRIPT,
  suiteBundleFor,
  windowsLaunchCommand,
  type ExecFileFn,
  type SpawnDetachedFn,
} from '../suite-launch'

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

/** Environnement de l'app : variables de Tab, d'Electron, de Node.js et d'autres apps. */
const APP_ENV = {
  HOME: '/Users/f',
  USER: 'f',
  LANG: 'fr_FR.UTF-8',
  LC_ALL: 'fr_FR.UTF-8',
  TZ: 'Europe/Paris',
  PATH: '/repo/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin',
  ATELIER_TAB_DATA: '/Users/f/Atelier_Tab',
  ELECTRON_RUN_AS_NODE: '1',
  NODE_OPTIONS: '--inspect',
  DATABASE_URL: 'file:/x.db',
  PYTHONPATH: '/x',
  NEXUS_PORT: '8100',
  PORT: '4175',
}

function deps(platform: string, fails = false) {
  const calls: string[][] = []
  const envs: Record<string, string>[] = []
  const execFile: ExecFileFn = (file, args, options, callback) => {
    calls.push([file, ...args])
    envs.push(options.env)
    callback(fails ? new Error('introuvable') : null)
  }
  const openExternal = vi.fn(async () => undefined)
  return { calls, envs, openExternal, deps: { execFile, openExternal, platform, env: APP_ENV } }
}

describe('openSuiteOrExternal', () => {
  it("ouvre l'application installée sur macOS, avec un environnement minimal (§9.4)", async () => {
    const d = deps('darwin')
    expect(await openSuiteOrExternal('http://127.0.0.1:8000', d.deps)).toBe('app')
    expect(d.calls).toEqual([['/usr/bin/open', '-b', 'fr.atelier-viz.app']])
    expect(d.envs).toEqual([
      {
        HOME: '/Users/f',
        USER: 'f',
        LANG: 'fr_FR.UTF-8',
        LC_ALL: 'fr_FR.UTF-8',
        TZ: 'Europe/Paris',
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      },
    ])
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

  it('Linux : va directement au navigateur', async () => {
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

describe('environnement minimal (§9.4)', () => {
  it('Windows : profil, dossiers système, PATH nettoyé ; rien de Tab, Electron, Node, Python', () => {
    const env = minimalEnv(
      {
        USERPROFILE: 'C:\\Users\\François',
        USERNAME: 'François',
        APPDATA: 'C:\\Users\\François\\AppData\\Roaming',
        LOCALAPPDATA: 'C:\\Users\\François\\AppData\\Local',
        TEMP: 'C:\\Temp',
        SystemRoot: 'C:\\Windows',
        ComSpec: 'C:\\Windows\\system32\\cmd.exe',
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        'ProgramFiles(x86)': 'C:\\Program Files (x86)',
        Path: 'C:\\depot\\node_modules\\.bin;relatif;C:\\Windows\\system32;"C:\\Program Files\\Git\\cmd"',
        ATELIER_TAB_DATA: 'D:\\x',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: '--inspect',
        PYTHONHOME: 'C:\\Python',
        DATABASE_URL: 'file:x',
      },
      'win32',
    )
    expect(env).toEqual({
      USERPROFILE: 'C:\\Users\\François',
      USERNAME: 'François',
      APPDATA: 'C:\\Users\\François\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\François\\AppData\\Local',
      TEMP: 'C:\\Temp',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\system32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      PATH: 'C:\\Windows\\system32;C:\\Program Files\\Git\\cmd',
    })
  })
})

describe('Windows : lanceur enregistré dans HKCU\\Software\\Atelier\\Apps (§9.4)', () => {
  const WIN_ENV = {
    SystemRoot: 'C:\\Windows',
    USERPROFILE: 'C:\\Users\\François',
    Path: 'C:\\Windows\\system32',
    ATELIER_TAB_DATA: 'C:\\Users\\François\\Atelier_Tab',
    ELECTRON_RUN_AS_NODE: '1',
  }

  function winDeps(registry: Record<string, string | null>, spawnOk = true) {
    const reads: { file: string; args: readonly string[]; env: Record<string, string> }[] = []
    const spawned: {
      file: string
      args: readonly string[]
      env: Record<string, string>
      windowsHide: boolean
    }[] = []
    const execFile: ExecFileFn = (file, args, options, callback) => {
      reads.push({ file, args, env: options.env })
      const value = registry[options.env.ATELIER_CLE_APP ?? '']
      if (value === null || value === undefined) callback(new Error('clé absente'))
      else callback(null, `\uFEFF${value}\r\n`)
    }
    const spawnDetached: SpawnDetachedFn = async (file, args, options) => {
      spawned.push({ file, args, ...options })
      return spawnOk
    }
    const openExternal = vi.fn(async () => undefined)
    return {
      reads,
      spawned,
      openExternal,
      deps: { execFile, spawnDetached, openExternal, platform: 'win32', env: WIN_ENV },
    }
  }

  it('lit le lanceur par PowerShell (script fixe, clé en variable) et le démarre sans shell', async () => {
    const exe =
      'C:\\Users\\François Pichon\\AppData\\Local\\Programs\\Atelier_Projets\\Atelier_Projets.exe'
    const d = winDeps({ projets: exe })
    expect(await openSuiteOrExternal('http://127.0.0.1:4174/#/gantt', d.deps)).toBe('app')
    expect(d.reads).toHaveLength(1)
    const read = d.reads[0]!
    expect(read.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    const encoded = read.args[read.args.indexOf('-EncodedCommand') + 1] ?? ''
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe(REGISTRY_SCRIPT)
    expect(read.env.ATELIER_CLE_APP).toBe('projets')
    expect(read.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(d.spawned).toEqual([
      {
        file: exe,
        args: [],
        windowsHide: false,
        env: {
          SystemRoot: 'C:\\Windows',
          USERPROFILE: 'C:\\Users\\François',
          PATH: 'C:\\Windows\\system32',
        },
      },
    ])
    expect(d.openExternal).not.toHaveBeenCalled()
  })

  it('app non enregistrée, lanceur inutilisable ou échec du démarrage → navigateur', async () => {
    const registries: Record<string, string>[] = [
      {},
      { viz: 'lanceur.exe' },
      { viz: 'C:\\x\\viz.ps1' },
    ]
    for (const registry of registries) {
      const d = winDeps(registry)
      expect(await openSuiteOrExternal('http://127.0.0.1:8000', d.deps)).toBe('browser')
      expect(d.spawned).toEqual([])
      expect(d.openExternal).toHaveBeenCalledWith('http://127.0.0.1:8000')
    }
    const failing = winDeps({ viz: 'C:\\x\\viz.exe' }, false)
    expect(await openSuiteOrExternal('http://127.0.0.1:8000', failing.deps)).toBe('browser')
  })

  it('Atelier Cuisine (pas d’app Windows) et adresses hors suite : navigateur, registre jamais lu', async () => {
    const d = winDeps({})
    expect(await openSuiteOrExternal('https://atelier-cuisine-iota.vercel.app', d.deps)).toBe(
      'browser',
    )
    expect(await openSuiteOrExternal('https://github.com', d.deps)).toBe('browser')
    expect(d.reads).toEqual([])
  })

  it('commande de démarrage selon le type de lanceur', () => {
    const env = { SystemRoot: 'C:\\Windows' }
    expect(windowsLaunchCommand('C:\\A b\\viz.vbs', env)).toEqual({
      file: 'C:\\Windows\\System32\\wscript.exe',
      args: ['C:\\A b\\viz.vbs'],
      windowsHide: false,
    })
    expect(windowsLaunchCommand('C:\\Users\\Fr ançois\\nexus.cmd', env)).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/c', 'C:\\Users\\Fr ançois\\nexus.cmd'],
      windowsHide: true,
    })
    // cmd.exe interpréterait ces caractères : refusé.
    expect(windowsLaunchCommand('C:\\A&B\\x.cmd', env)).toBeNull()
    expect(windowsLaunchCommand('C:\\%PATH%\\x.bat', env)).toBeNull()
    expect(windowsLaunchCommand('C:\\x\\"y".exe', env)).toBeNull()
    expect(windowsLaunchCommand('relatif\\x.exe', env)).toBeNull()
    expect(windowsLaunchCommand('C:\\x\\y.lnk', env)).toBeNull()
  })
})
