/**
 * Mise à jour automatique (docs/SUITE.md §8, ADR 0005) : simulation complète sous Linux.
 *
 * Faux dépôt git, faux `npm` (script shell qui écrit les sorties attendues dans les dossiers
 * temporaires indiqués par ATELIER_TAB_DIST_DIR / ATELIER_TAB_DESKTOP_DIR), vrai Node.js : la
 * mesure de l'état, le verrou, l'exécution, le remplacement et le tampon sont ceux de l'app.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { main as cliMain } from '../launcher/cli.cjs'
import {
  UpdateError,
  openLog,
  planUpdate,
  readStamp,
  repoState,
  swapBuild,
  tryLock,
  update,
  workPaths,
} from '../launcher/update.cjs'

const FAKE_NPM = `#!/bin/sh
echo "$*|skip=\${ELECTRON_SKIP_BINARY_DOWNLOAD:-}|node=\${ELECTRON_RUN_AS_NODE:-}" >> "$FAKE_NPM_CALLS"
case "$1 $2" in
  "ci --no-audit")
    [ -f .echec-ci ] && { echo "npm ERR! network ECONNREFUSED registry.npmjs.org" >&2; exit 1; }
    rm -rf node_modules && mkdir -p node_modules && echo '{}' > node_modules/.package-lock.json ;;
  "run build")
    [ -f .echec-build ] && { echo "src/x.ts(1,1): error TS2322: erreur simulée" >&2; exit 2; }
    mkdir -p "$ATELIER_TAB_DIST_DIR" && cat version.txt > "$ATELIER_TAB_DIST_DIR/index.html" ;;
  "run build:desktop")
    [ -f .echec-desktop ] && { echo "rolldown : erreur simulée" >&2; exit 3; }
    mkdir -p "$ATELIER_TAB_DESKTOP_DIR"
    for f in main.cjs preload.cjs atelier-mcp.mjs; do cat version.txt > "$ATELIER_TAB_DESKTOP_DIR/$f"; done ;;
  *) echo "commande inattendue : $*" >&2; exit 9 ;;
esac
`

let tmp: string
let repo: string
let bin: string
let home: string
let calls: string
let logFile: string
let env: NodeJS.ProcessEnv

function git(...args: string[]) {
  return execFileSync(
    'git',
    [
      '-C',
      repo,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim()
}

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true })
  fs.writeFileSync(path.join(repo, file), content)
}

function read(file: string) {
  return fs.readFileSync(path.join(repo, file), 'utf8')
}

function commit(file: string, content: string) {
  write(file, content)
  git('add', '-A')
  git('commit', '-q', '-m', `maj ${file}`)
}

function npmCalls(): string[] {
  return fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : []
}

function run(extra: Partial<Parameters<typeof update>[1]> = {}) {
  return update(repo, {
    by: 'terminal',
    log: openLog(logFile),
    env,
    home,
    preferDir: bin,
    probeLoginPath: () => null,
    commonDirs: [],
    ...extra,
  })
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-maj-'))
  repo = path.join(tmp, 'depot')
  bin = path.join(tmp, 'bin')
  home = path.join(tmp, 'home')
  calls = path.join(tmp, 'npm-calls.txt')
  logFile = path.join(tmp, 'logs', 'mise-a-jour.log')
  fs.mkdirSync(repo)
  fs.mkdirSync(bin)
  fs.mkdirSync(home)
  fs.symlinkSync(process.execPath, path.join(bin, 'node'))
  fs.writeFileSync(path.join(bin, 'npm'), FAKE_NPM, { mode: 0o755 })
  env = {
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: home,
    FAKE_NPM_CALLS: calls,
    // Variables d'Electron : jamais transmises à npm.
    ELECTRON_RUN_AS_NODE: '1',
  }
  git('init', '-q')
  write(
    'package.json',
    JSON.stringify({ name: 'faux', version: '1.2.3', engines: { node: '>=20.19' } }),
  )
  write('package-lock.json', '{"lockfileVersion":3,"v":1}\n')
  write('version.txt', 'v1')
  write('.gitignore', 'node_modules\ndist\ndist-desktop\n.mise-a-jour\n.echec-*\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'initial')
  // Dépendances déjà installées (comme après `npm install` avant `npm run app:install`).
  write('node_modules/.package-lock.json', '{}')
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('mise à jour complète simulée', () => {
  it('première mise à jour : compilation à part, remplacement, tampon, verrou libéré', async () => {
    const result = await run()
    expect(result.steps).toEqual(['build'])
    expect(result.reasons).toEqual(['première mise à jour', 'compilation absente ou incomplète'])
    expect(npmCalls()).toEqual(['run build|skip=|node=', 'run build:desktop|skip=|node='])
    expect(read('dist/index.html')).toBe('v1')
    expect(read('dist-desktop/atelier-mcp.mjs')).toBe('v1')
    const paths = workPaths(repo)
    expect(fs.existsSync(paths.staging)).toBe(false)
    expect(fs.existsSync(paths.previous)).toBe(false)
    expect(fs.existsSync(paths.lock)).toBe(false)
    expect(readStamp(repo)?.head).toBe(git('rev-parse', 'HEAD'))
    const toolchain = JSON.parse(fs.readFileSync(paths.toolchain, 'utf8'))
    expect(toolchain.nodeDir).toBe(bin)
    // Le dossier de travail est ignoré par git : la mise à jour ne « modifie » pas le dépôt.
    expect(git('status', '--porcelain')).toBe('')
    expect(fs.readFileSync(logFile, 'utf8')).toContain('Mise à jour réussie.')
  })

  it('rien n’a changé → rien (npm jamais lancé)', async () => {
    await run()
    fs.rmSync(calls)
    const result = await run()
    expect(result.steps).toEqual([])
    expect(npmCalls()).toEqual([])
    expect(planUpdate(repo).steps).toEqual([])
  })

  it('nouveau commit → compilation seulement', async () => {
    await run()
    fs.rmSync(calls)
    commit('version.txt', 'v2')
    const result = await run()
    expect(result).toMatchObject({ steps: ['build'], reasons: ['nouveau commit'] })
    expect(npmCalls().map((c) => c.split('|')[0])).toEqual(['run build', 'run build:desktop'])
    expect(read('dist/index.html')).toBe('v2')
    expect(read('dist-desktop/main.cjs')).toBe('v2')
  })

  it('lockfile changé → npm ci (sans téléchargement d’Electron) puis compilation', async () => {
    await run()
    fs.rmSync(calls)
    commit('package-lock.json', '{"lockfileVersion":3,"v":2}\n')
    const result = await run()
    expect(result.steps).toEqual(['install', 'build'])
    expect(npmCalls()).toEqual([
      'ci --no-audit --no-fund|skip=1|node=',
      'run build|skip=|node=',
      'run build:desktop|skip=|node=',
    ])
    expect(planUpdate(repo).steps).toEqual([])
  })

  it('dépendances absentes → npm ci puis compilation', async () => {
    await run()
    fs.rmSync(path.join(repo, 'node_modules'), { recursive: true })
    fs.rmSync(calls)
    expect((await run()).steps).toEqual(['install', 'build'])
    expect(fs.existsSync(path.join(repo, 'node_modules', '.package-lock.json'))).toBe(true)
  })

  it('modification locale → compilation ; inchangée ensuite → rien ; annulée → compilation', async () => {
    await run()
    write('version.txt', 'v1-local')
    expect((await run()).reasons).toEqual(['modification locale non commitée'])
    expect(read('dist/index.html')).toBe('v1-local')
    expect((await run()).steps).toEqual([])
    write('version.txt', 'v1-local-bis')
    expect((await run()).steps).toEqual(['build'])
    git('checkout', '--', 'version.txt')
    expect((await run()).reasons).toEqual(['modification locale annulée'])
    expect(read('dist/index.html')).toBe('v1')
  })

  it('fichier nouveau non ignoré : compte ; fichier ignoré : ne compte pas', () => {
    const before = repoState(repo)
    write('.echec-rien', 'ignoré')
    expect(repoState(repo)).toEqual(before)
    write('src/nouveau.ts', 'export {}')
    expect(repoState(repo).code).not.toBe(before.code)
    expect(repoState(repo).head).toBe(before.head)
  })

  it('compilation absente (dist supprimé) → compilation', async () => {
    await run()
    fs.rmSync(path.join(repo, 'dist'), { recursive: true })
    expect(planUpdate(repo).reasons).toEqual(['compilation absente ou incomplète'])
    await run()
    expect(read('dist/index.html')).toBe('v1')
  })
})

describe('échecs', () => {
  it('compilation en échec → tampon inchangé, ancienne compilation conservée, verrou libéré', async () => {
    await run()
    const stamp = readStamp(repo)
    commit('version.txt', 'v2')
    write('.echec-build', '')
    const failure = await run().catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(UpdateError)
    expect((failure as UpdateError).message).toMatch(/« npm run build » a échoué \(code 2\)/)
    // Extrait : la sortie de la commande en échec, pas la fin d'une mise à jour précédente.
    expect((failure as UpdateError).tail).toContain('TS2322')
    expect((failure as UpdateError).tail).not.toContain('Mise à jour réussie')
    expect(read('dist/index.html')).toBe('v1')
    expect(read('dist-desktop/main.cjs')).toBe('v1')
    expect(readStamp(repo)).toEqual(stamp)
    expect(fs.existsSync(workPaths(repo).lock)).toBe(false)
    expect(fs.readFileSync(logFile, 'utf8')).toContain('ÉCHEC')
    // Le lancement suivant réessaie.
    fs.rmSync(path.join(repo, '.echec-build'))
    expect((await run()).steps).toEqual(['build'])
    expect(read('dist/index.html')).toBe('v2')
  })

  it('échec du processus principal après l’interface → rien n’est remplacé', async () => {
    await run()
    commit('version.txt', 'v2')
    write('.echec-desktop', '')
    await expect(run()).rejects.toThrow(/build:desktop/)
    expect(read('dist/index.html')).toBe('v1')
    expect(read('dist-desktop/preload.cjs')).toBe('v1')
  })

  it('npm ci en échec (réseau) → message clair, compilation et tampon conservés', async () => {
    await run()
    const stamp = readStamp(repo)
    commit('package-lock.json', '{"lockfileVersion":3,"v":2}\n')
    write('.echec-ci', '')
    await expect(run()).rejects.toThrow(/installation des dépendances a échoué.*registre npm/)
    expect(readStamp(repo)).toEqual(stamp)
    expect(read('dist/index.html')).toBe('v1')
  })

  it('Node.js trop ancien → message clair (version trouvée et conseil)', async () => {
    const old = path.join(tmp, 'vieux')
    fs.mkdirSync(old)
    fs.writeFileSync(path.join(old, 'node'), '#!/bin/sh\necho v18.20.0\n', { mode: 0o755 })
    fs.writeFileSync(path.join(old, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const failure = run({ preferDir: old, env: { ...env, PATH: old } })
    await expect(failure).rejects.toThrow(/Node\.js 20\.19\.0 ou plus récent introuvable/)
    await expect(failure).rejects.toThrow(/trop anciennes.*v18\.20\.0/)
    expect(fs.existsSync(workPaths(repo).lock)).toBe(false)
  })

  it('swapBuild : un remplacement interrompu remet l’ancienne compilation en place', () => {
    write('dist/index.html', 'ancien')
    write('dist-desktop/main.cjs', 'ancien')
    const staging = path.join(tmp, 'compilation')
    fs.mkdirSync(path.join(staging, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(staging, 'dist', 'index.html'), 'nouveau')
    // dist-desktop manquant dans la compilation : le second renommage échoue.
    expect(() => swapBuild(repo, staging, path.join(tmp, 'precedente'))).toThrow()
    expect(read('dist/index.html')).toBe('ancien')
    expect(read('dist-desktop/main.cjs')).toBe('ancien')
    expect(fs.readFileSync(path.join(staging, 'dist', 'index.html'), 'utf8')).toBe('nouveau')
  })
})

describe('verrou', () => {
  it('tenu par un processus vivant → attente, puis abandon avec un message', async () => {
    const held = tryLock(repo, { by: 'app', pid: process.pid })
    expect(held.ok).toBe(true)
    let waited = 0
    await expect(
      run({ lock: { timeoutMs: 60, intervalMs: 10 }, onWait: () => waited++ }),
    ).rejects.toThrow(/autre mise à jour/)
    expect(waited).toBe(1)
    expect(npmCalls()).toEqual([])
    // Le verrou de l'autre processus n'a pas été retiré.
    expect(fs.existsSync(workPaths(repo).lock)).toBe(true)
  })

  it('libéré pendant l’attente → la mise à jour reprend', async () => {
    const held = tryLock(repo, { by: 'app', pid: process.pid })
    if (!held.ok) throw new Error('verrou attendu')
    setTimeout(() => held.release(), 50)
    const result = await run({ lock: { timeoutMs: 5000, intervalMs: 10 } })
    expect(result.steps).toEqual(['build'])
  })

  it('processus disparu → verrou repris', async () => {
    const dead = spawnSync(process.execPath, ['-e', '0']).pid
    fs.mkdirSync(workPaths(repo).dir, { recursive: true })
    fs.writeFileSync(
      workPaths(repo).lock,
      JSON.stringify({ pid: dead, startedAt: new Date().toISOString(), by: 'app' }),
    )
    expect((await run({ lock: { timeoutMs: 100, intervalMs: 10 } })).steps).toEqual(['build'])
  })

  it('deux lancements simultanés : une seule compilation', async () => {
    const [a, b] = await Promise.all([
      run({ lock: { intervalMs: 10 } }),
      run({ lock: { intervalMs: 10 } }),
    ])
    expect([a.steps, b.steps]).toContainEqual(['build'])
    expect([a.steps, b.steps]).toContainEqual([])
    expect(npmCalls()).toHaveLength(2)
  })
})

describe('terminal (npm run app:update)', () => {
  it('déjà à jour → code 0 et message', async () => {
    await run()
    const out: string[] = []
    const code = await cliMain({
      repo,
      env: { ...env, ATELIER_TAB_LOG_DIR: tmp },
      out: (l) => out.push(l),
    })
    expect(code).toBe(0)
    expect(out).toEqual(['✓ Atelier Tab était déjà à jour.'])
  })
})
