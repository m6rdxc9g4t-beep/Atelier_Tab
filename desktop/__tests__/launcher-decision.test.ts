/**
 * Mise à jour automatique (docs/SUITE.md §8, ADR 0005) : décisions pures du lanceur.
 */
import { describe, expect, it } from 'vitest'
import {
  BUILD_OUTPUTS,
  FLAG_AFTER_UPDATE,
  FLAG_SKIP_UPDATE,
  LOGIN_PATH_COMMAND,
  appDirs,
  candidateGitDirs,
  candidateNodeDirs,
  candidateNodeDirsWin32,
  cleanPathEntries,
  envPathValue,
  FLAG_UPDATE_ONLY,
  inheritedEnvToIgnore,
  npmBeside,
  splitPath,
  toolNames,
  withPath,
  decide,
  electronDrift,
  formatStamp,
  lockIsStale,
  logFilePath,
  meetsMinimum,
  nvmVersionsDescending,
  parseEngineMinimum,
  parseFlags,
  parseLock,
  parseLoginPath,
  parseNodeVersion,
  parseStamp,
  relaunchArgs,
  tailLines,
} from '../launcher/decision.cjs'

const state = { head: 'c1', local: '', code: 'code-c1', lock: 'lock-1' }
const stamp = { head: 'c1', code: 'code-c1', lock: 'lock-1' }
const ready = { depsInstalled: true, built: true }

describe('decide', () => {
  it('rien n’a changé → rien (lancement direct)', () => {
    expect(decide({ state, stamp, ...ready })).toEqual({ steps: [], reasons: [] })
  })

  it('commit changé → compilation seulement', () => {
    const plan = decide({ state: { ...state, head: 'c2', code: 'code-c2' }, stamp, ...ready })
    expect(plan.steps).toEqual(['build'])
    expect(plan.reasons).toEqual(['nouveau commit'])
  })

  it('lockfile changé → npm ci puis compilation', () => {
    const plan = decide({
      state: { ...state, head: 'c2', code: 'code-c2', lock: 'lock-2' },
      stamp,
      ...ready,
    })
    expect(plan.steps).toEqual(['install', 'build'])
    expect(plan.reasons).toContain('package-lock.json a changé')
  })

  it('lockfile modifié localement (même commit) → npm ci puis compilation', () => {
    const plan = decide({
      state: { ...state, local: 'x', code: 'code-x', lock: 'lock-2' },
      stamp,
      ...ready,
    })
    expect(plan.steps).toEqual(['install', 'build'])
  })

  it('modification locale non commitée → compilation', () => {
    const plan = decide({ state: { ...state, local: 'abc', code: 'code-abc' }, stamp, ...ready })
    expect(plan).toEqual({ steps: ['build'], reasons: ['modification locale non commitée'] })
  })

  it('modification locale annulée → compilation (retour au commit)', () => {
    const plan = decide({ state, stamp: { ...stamp, code: 'code-abc' }, ...ready })
    expect(plan).toEqual({ steps: ['build'], reasons: ['modification locale annulée'] })
  })

  it('dépendances absentes → npm ci et compilation, même si rien d’autre n’a changé', () => {
    const plan = decide({ state, stamp, depsInstalled: false, built: true })
    expect(plan.steps).toEqual(['install', 'build'])
  })

  it('compilation absente ou incomplète → compilation', () => {
    expect(decide({ state, stamp, depsInstalled: true, built: false }).steps).toEqual(['build'])
  })

  it('pas de tampon (première mise à jour) → compilation, sans npm ci si node_modules est là', () => {
    expect(decide({ state, stamp: null, ...ready })).toEqual({
      steps: ['build'],
      reasons: ['première mise à jour'],
    })
    expect(decide({ state, stamp: null, depsInstalled: false, built: false }).steps).toEqual([
      'install',
      'build',
    ])
  })

  it('les sorties attendues couvrent l’interface, le processus principal et le serveur MCP', () => {
    expect(BUILD_OUTPUTS).toEqual([
      'dist/index.html',
      'dist-desktop/main.cjs',
      'dist-desktop/preload.cjs',
      'dist-desktop/atelier-mcp.mjs',
    ])
  })
})

describe('tampon', () => {
  it('formatStamp → parseStamp : aller-retour de l’état mesuré avant la mise à jour', () => {
    const text = formatStamp(state, new Date('2026-10-22T10:00:00Z'))
    expect(parseStamp(text)).toEqual({
      head: 'c1',
      code: 'code-c1',
      lock: 'lock-1',
      builtAt: '2026-10-22T10:00:00.000Z',
    })
  })

  it('lecture tolérante : absent, abîmé ou incomplet → null (tout sera refait)', () => {
    expect(parseStamp(null)).toBeNull()
    expect(parseStamp('{')).toBeNull()
    expect(parseStamp('[]')).toBeNull()
    expect(parseStamp('{"head":"c1","code":"x"}')).toBeNull()
    expect(parseStamp('{"head":"c1","code":"x","lock":"l","builtAt":3}')).toEqual({
      head: 'c1',
      code: 'x',
      lock: 'l',
    })
  })
})

describe('verrou', () => {
  const now = Date.parse('2026-10-22T10:00:00Z')
  const holder = { pid: 4242, startedAt: '2026-10-22T09:59:00Z' }

  it('processus vivant et récent → respecté', () => {
    expect(lockIsStale(holder, { now, isAlive: () => true })).toBe(false)
  })

  it('processus disparu → repris', () => {
    expect(lockIsStale(holder, { now, isAlive: () => false })).toBe(true)
  })

  it('trop ancien (pid réattribué) → repris', () => {
    const old = { pid: 4242, startedAt: '2026-10-22T07:00:00Z' }
    expect(lockIsStale(old, { now, isAlive: () => true })).toBe(true)
  })

  it('illisible : respecté 10 s (écriture en cours), repris ensuite', () => {
    expect(lockIsStale(null, { now, isAlive: () => true, fileAgeMs: 2_000 })).toBe(false)
    expect(lockIsStale(null, { now, isAlive: () => true, fileAgeMs: 60_000 })).toBe(true)
  })

  it('parseLock valide le contenu', () => {
    expect(parseLock('{"pid":12,"startedAt":"x","by":"app"}')).toEqual({
      pid: 12,
      startedAt: 'x',
      by: 'app',
    })
    expect(parseLock('{"pid":-1,"startedAt":"x"}')).toBeNull()
    expect(parseLock('{"pid":"12","startedAt":"x"}')).toBeNull()
    expect(parseLock('')).toBeNull()
  })
})

describe('Node.js et git depuis le Finder', () => {
  const home = '/Users/francois'

  it('cleanPathEntries : absolus, sans node_modules/.bin ni node-gyp-bin, sans doublon', () => {
    expect(
      cleanPathEntries([
        'bin',
        './node_modules/.bin',
        '/repo/node_modules/.bin',
        '/usr/lib/node_modules/npm/bin/node-gyp-bin',
        '/opt/homebrew/bin/',
        '/opt/homebrew/bin',
        '',
        undefined,
        null,
        '/usr/bin',
      ]),
    ).toEqual(['/opt/homebrew/bin', '/usr/bin'])
  })

  it('ordre : dossier retenu, shell de connexion, PATH, ~/.homebrew, Homebrew, /usr/local, nvm, volta', () => {
    const dirs = candidateNodeDirs({
      cachedDir: '/cache/bin',
      envPath: '/usr/bin:/bin',
      loginPath: '/Users/francois/.homebrew/bin:/usr/bin:/bin',
      home,
      nvmDefault: '20',
      nvmVersions: ['v18.20.0', 'v22.12.0', 'v20.19.1', 'notes'],
    })
    expect(dirs).toEqual([
      '/cache/bin',
      '/Users/francois/.homebrew/bin',
      '/usr/bin',
      '/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/Users/francois/.nvm/versions/node/v20.19.1/bin',
      '/Users/francois/.nvm/versions/node/v22.12.0/bin',
      '/Users/francois/.nvm/versions/node/v18.20.0/bin',
      '/Users/francois/.volta/bin',
    ])
  })

  it('sans shell de connexion ni nvm : Homebrew de l’utilisateur avant ceux du système', () => {
    const dirs = candidateNodeDirs({ envPath: '/usr/bin:/bin:/usr/sbin:/sbin', home })
    expect(dirs.indexOf('/Users/francois/.homebrew/bin')).toBeLessThan(
      dirs.indexOf('/opt/homebrew/bin'),
    )
    expect(dirs).toContain('/usr/local/bin')
    expect(dirs.some((d) => d.includes('.nvm'))).toBe(false)
  })

  it('NVM_DIR personnalisé et dossiers usuels injectables', () => {
    const dirs = candidateNodeDirs({
      home,
      nvmDir: '/data/nvm',
      nvmVersions: ['v22.0.0'],
      commonDirs: [],
    })
    expect(dirs).toEqual([
      '/Users/francois/.homebrew/bin',
      '/data/nvm/versions/node/v22.0.0/bin',
      '/Users/francois/.volta/bin',
    ])
  })

  it('nvmVersionsDescending trie par version, pas par texte', () => {
    expect(nvmVersionsDescending(['v9.0.0', 'v22.1.0', 'v22.10.0', 'x'])).toEqual([
      'v22.10.0',
      'v22.1.0',
      'v9.0.0',
    ])
  })

  it('git : Homebrew avant /usr/bin (relais des outils Apple)', () => {
    expect(candidateGitDirs({ envPath: '/usr/bin:/bin', home })).toEqual([
      '/Users/francois/.homebrew/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ])
    expect(candidateGitDirs({ cachedGit: '/x/bin/git', home })[0]).toBe('/x/bin')
  })

  it('PATH du shell de connexion extrait malgré le bruit (.zshrc bavard)', () => {
    expect(LOGIN_PATH_COMMAND).toContain('"$PATH"')
    const out = 'Bienvenue !\nnvm: ok\n__ATELIER_TAB_PATH__/a/bin:/usr/bin__ATELIER_TAB_PATH__\n'
    expect(parseLoginPath(out)).toBe('/a/bin:/usr/bin')
    expect(parseLoginPath('rien')).toBeNull()
  })

  it('versions : lecture, minimum d’engines, comparaison', () => {
    expect(parseNodeVersion('v22.12.0\n')).toEqual([22, 12, 0])
    expect(parseNodeVersion('node')).toBeNull()
    expect(parseEngineMinimum('>=20.19')).toEqual([20, 19, 0])
    expect(parseEngineMinimum('>= 22.12.1')).toEqual([22, 12, 1])
    expect(parseEngineMinimum('^20 || ^22')).toEqual([20, 19, 0])
    expect(meetsMinimum([20, 19, 0], [20, 19, 0])).toBe(true)
    expect(meetsMinimum([20, 18, 9], [20, 19, 0])).toBe(false)
    expect(meetsMinimum([24, 0, 0], [20, 19, 0])).toBe(true)
  })
})

describe('Node.js et git sous Windows (§9.3)', () => {
  const env = {
    ProgramFiles: 'C:\\Program Files',
    ProgramW6432: 'C:\\Program Files',
    LOCALAPPDATA: 'C:\\Users\\François\\AppData\\Local',
    APPDATA: 'C:\\Users\\François\\AppData\\Roaming',
    NVM_SYMLINK: 'C:\\nvm4w\\nodejs',
  }

  it('cleanPathEntries : séparateur ;, guillemets, casse, lecteurs, node_modules\\.bin', () => {
    expect(splitPath('C:\\a;"C:\\Program Files\\nodejs\\";c:\\A\\', 'win32')).toHaveLength(3)
    expect(
      cleanPathEntries(
        [
          'C:\\a',
          '"C:\\Program Files\\nodejs\\"',
          'c:\\A\\',
          'relatif\\bin',
          'C:\\depot\\node_modules\\.bin',
          'C:\\',
          '\\\\serveur\\outils',
          '/usr/bin',
        ],
        'win32',
      ),
    ).toEqual(['C:\\a', 'C:\\Program Files\\nodejs', 'C:\\', '\\\\serveur\\outils'])
  })

  it('ordre : retenu, PATH, nvm-windows, Program Files, Programs, fnm, nvm, Volta', () => {
    const dirs = candidateNodeDirsWin32({
      cachedDir: 'D:\\node',
      envPath: 'C:\\Windows\\system32;C:\\Program Files\\nodejs\\',
      env,
      fnmVersions: ['v22.12.0', 'v24.1.0'],
      nvmVersions: ['v20.19.0', 'v22.14.0'],
      voltaVersions: ['22.12.0'],
    })
    expect(dirs).toEqual([
      'D:\\node',
      'C:\\Windows\\system32',
      'C:\\Program Files\\nodejs',
      'C:\\nvm4w\\nodejs',
      'C:\\Users\\François\\AppData\\Local\\Programs\\nodejs',
      'C:\\Users\\François\\AppData\\Roaming\\fnm\\aliases\\default',
      'C:\\Users\\François\\AppData\\Roaming\\fnm\\node-versions\\v24.1.0\\installation',
      'C:\\Users\\François\\AppData\\Roaming\\fnm\\node-versions\\v22.12.0\\installation',
      'C:\\Users\\François\\AppData\\Roaming\\nvm\\v22.14.0',
      'C:\\Users\\François\\AppData\\Roaming\\nvm\\v20.19.0',
      'C:\\Users\\François\\AppData\\Local\\Volta\\tools\\image\\node\\22.12.0',
    ])
  })

  it('npm : npm-cli.js à côté de node.exe (jamais npm.cmd) ; exécutables .exe', () => {
    expect(npmBeside('C:\\Program Files\\nodejs', 'win32')).toBe(
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    )
    expect(npmBeside('/usr/local/bin', 'darwin')).toBe('/usr/local/bin/npm')
    expect(toolNames('win32')).toEqual({ node: 'node.exe', git: 'git.exe' })
    expect(toolNames('darwin')).toEqual({ node: 'node', git: 'git' })
  })

  it('git : retenu, PATH, Git for Windows', () => {
    expect(
      candidateGitDirs({
        cachedGit: 'E:\\Git\\cmd\\git.exe',
        envPath: 'C:\\Windows',
        home: 'C:\\Users\\f',
        platform: 'win32',
        env,
      }),
    ).toEqual([
      'E:\\Git\\cmd',
      'C:\\Windows',
      'C:\\Program Files\\Git\\cmd',
      'C:\\Users\\François\\AppData\\Local\\Programs\\Git\\cmd',
    ])
  })

  it('PATH : clé Path de Windows lue et remplacée sans doublon de casse', () => {
    expect(envPathValue({ Path: 'C:\\a' })).toBe('C:\\a')
    expect(withPath({ Path: 'C:\\a', X: '1' }, 'C:\\b')).toEqual({ X: '1', PATH: 'C:\\b' })
  })
})

describe('divers', () => {
  it('drapeaux de relance : jamais cumulés', () => {
    expect(parseFlags(['/app', FLAG_SKIP_UPDATE])).toEqual({
      skipUpdate: true,
      afterUpdate: false,
      updateOnly: false,
    })
    expect(parseFlags(['/app', FLAG_UPDATE_ONLY]).updateOnly).toBe(true)
    expect(relaunchArgs(['/app', FLAG_UPDATE_ONLY, '--y'])).toEqual(['--y'])
    expect(relaunchArgs(['/app', '--x', FLAG_SKIP_UPDATE], FLAG_AFTER_UPDATE)).toEqual([
      '--x',
      FLAG_AFTER_UPDATE,
    ])
    expect(relaunchArgs(['/app', FLAG_AFTER_UPDATE])).toEqual([])
  })

  it('journal : ~/Library/Logs/Atelier_Tab/mise-a-jour.log sur macOS', () => {
    expect(logFilePath({ platform: 'darwin', home: '/Users/f', env: {} })).toBe(
      '/Users/f/Library/Logs/Atelier_Tab/mise-a-jour.log',
    )
    expect(logFilePath({ platform: 'linux', home: '/home/f', env: {} })).toBe(
      '/home/f/.local/state/Atelier_Tab/mise-a-jour.log',
    )
    expect(
      logFilePath({ platform: 'darwin', home: '/Users/f', env: { ATELIER_TAB_LOG_DIR: '/t/' } }),
    ).toBe('/t/mise-a-jour.log')
  })

  it('journal Windows : %LOCALAPPDATA%\\Atelier_Tab\\Logs (chemins avec espaces et accents)', () => {
    const env = {
      APPDATA: 'C:\\Users\\François Pichon\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\François Pichon\\AppData\\Local',
    }
    const home = 'C:\\Users\\François Pichon'
    expect(logFilePath({ platform: 'win32', home, env })).toBe(
      'C:\\Users\\François Pichon\\AppData\\Local\\Atelier_Tab\\Logs\\mise-a-jour.log',
    )
    expect(appDirs({ platform: 'win32', home, env }).config).toBe(
      'C:\\Users\\François Pichon\\AppData\\Roaming\\Atelier_Tab',
    )
    // Variables absentes : dossiers usuels sous le profil.
    expect(appDirs({ platform: 'win32', home, env: {} })).toEqual({
      config: 'C:\\Users\\François Pichon\\AppData\\Roaming\\Atelier_Tab',
      logs: 'C:\\Users\\François Pichon\\AppData\\Local\\Atelier_Tab\\Logs',
    })
  })

  it('dossiers de l’app : macOS et Linux inchangés', () => {
    expect(appDirs({ platform: 'darwin', home: '/Users/f', env: {} }).config).toBe(
      '/Users/f/Library/Application Support/Atelier_Tab',
    )
    expect(appDirs({ platform: 'linux', home: '/home/f', env: {} }).config).toBe(
      '/home/f/.config/Atelier_Tab',
    )
    expect(
      appDirs({ platform: 'linux', home: '/home/f', env: { XDG_CONFIG_HOME: '/x' } }).config,
    ).toBe('/x/Atelier_Tab')
  })

  it('variables héritées ignorées au lancement (§9.4), casse indifférente', () => {
    expect(
      inheritedEnvToIgnore({
        ELECTRON_RUN_AS_NODE: '1',
        Node_Options: '--require x.js',
        NODE_ENV: 'production',
        ELECTRON_NO_ASAR: '1',
        ATELIER_TAB_DATA: 'C:\\Données',
        PATH: '/usr/bin',
      }).sort(),
    ).toEqual(['ELECTRON_NO_ASAR', 'ELECTRON_RUN_AS_NODE', 'NODE_ENV', 'Node_Options'])
  })

  it('Electron différent entre l’app et le dépôt → conseil de réinstallation', () => {
    expect(electronDrift('44.9.0', '44.9.0')).toBeNull()
    expect(electronDrift('44.9.0', null)).toBeNull()
    expect(electronDrift('44.9.0', '45.0.0')).toContain('npm run app:install')
  })

  it('tailLines : dernières lignes non vides', () => {
    expect(tailLines('a\n\nb  \nc\n\n', 2)).toBe('b\nc')
  })
})
