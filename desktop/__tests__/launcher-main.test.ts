/**
 * Lanceur de l'app installée (desktop/launcher/main.cjs, ADR 0005) avec un faux Electron :
 * lancement direct, écran de démarrage, relance, échec et choix de l'utilisateur, verrou d'instance.
 */
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FLAG_AFTER_UPDATE, FLAG_SKIP_UPDATE } from '../launcher/decision.cjs'
import { createLauncher } from '../launcher/main.cjs'
import { UpdateError } from '../launcher/update.cjs'

type Deps = Parameters<typeof createLauncher>[0]
type Plan = { steps: string[]; reasons: string[] }
type UpdateOptions = {
  onStatus?: (label: string, index: number, total: number) => void
  onChild?: (child: unknown) => void
  onPlan?: (reasons: string[]) => void
}

const REPO = '/depot/atelier-tab'
const LOG = '/journal/mise-a-jour.log'

class FakeApp {
  lock = true
  quits = 0
  exits: number[] = []
  relaunches: { args?: string[] }[] = []
  about: unknown = null
  listeners = new Map<string, (() => void)[]>()
  private resolveReady: () => void = () => undefined
  ready = new Promise<void>((resolve) => (this.resolveReady = resolve))
  requestSingleInstanceLock() {
    return this.lock
  }
  quit() {
    this.quits++
  }
  exit(code: number) {
    this.exits.push(code)
  }
  relaunch(options: { args?: string[] }) {
    this.relaunches.push(options)
  }
  whenReady() {
    return this.ready
  }
  setAboutPanelOptions(options: unknown) {
    this.about = options
  }
  on(event: string, fn: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn])
    return this
  }
  emit(event: string) {
    for (const fn of this.listeners.get(event) ?? []) fn()
  }
  makeReady() {
    this.resolveReady()
  }
}

class FakeWindow {
  static all: FakeWindow[] = []
  scripts: string[] = []
  file = ''
  focused = 0
  options: unknown
  webContents = {
    executeJavaScript: (script: string) => {
      this.scripts.push(script)
      return Promise.resolve()
    },
    setWindowOpenHandler: () => undefined,
    on: () => undefined,
  }
  constructor(options: unknown) {
    this.options = options
    FakeWindow.all.push(this)
  }
  once() {}
  on() {}
  loadFile(file: string) {
    this.file = file
    return Promise.resolve()
  }
  isDestroyed() {
    return false
  }
  isMinimized() {
    return false
  }
  restore() {}
  focus() {
    this.focused++
  }
  get text() {
    return this.scripts.join('\n')
  }
}

type BoxOptions = { buttons: string[]; detail: string; cancelId: number }

function setup(opts: { plan?: Plan; built?: boolean; argv?: string[]; responses?: number[] } = {}) {
  const app = new FakeApp()
  FakeWindow.all = []
  const boxes: BoxOptions[] = []
  const responses = [...(opts.responses ?? [])]
  const opened: string[] = []
  const logLines: string[] = []
  const updater = {
    openLog: (file: string) => ({ file, write: (line: string) => logLines.push(line) }),
    stopCommand: vi.fn(),
    invalidateStamp: vi.fn(),
    isBuilt: vi.fn(() => opts.built ?? true),
    repoVersion: () => '0.7.0',
    repoElectronVersion: () => null,
    findGit: () => '/usr/bin/git',
    planUpdate: vi.fn((): Plan => opts.plan ?? { steps: [], reasons: [] }),
    update: vi.fn(async (_repo: string, o: UpdateOptions): Promise<Plan> => {
      o.onPlan?.(['nouveau commit'])
      o.onStatus?.('Compilation de l’interface…', 1, 3)
      return { steps: ['build'], reasons: ['nouveau commit'] }
    }),
  }
  const requireMain = vi.fn()
  const electron = {
    app,
    BrowserWindow: FakeWindow,
    dialog: {
      showMessageBox: async (a: unknown, b?: unknown) => {
        const options = (b ?? a) as BoxOptions
        boxes.push(options)
        return { response: responses.shift() ?? options.cancelId }
      },
    },
    shell: {
      openPath: async (file: string) => {
        opened.push(file)
        return ''
      },
    },
    nativeTheme: { shouldUseDarkColors: false },
  }
  const launcher = createLauncher({
    electron: electron as unknown as Deps['electron'],
    repo: REPO,
    argv: opts.argv ?? ['/Applications/Atelier_Tab.app/Contents/MacOS/Atelier_Tab'],
    env: { ATELIER_TAB_LOG_DIR: path.dirname(LOG) },
    home: '/Users/f',
    platform: 'darwin',
    electronVersion: undefined,
    requireMain,
    updater: updater as unknown as Deps['updater'],
  })
  return { app, launcher, updater, requireMain, boxes, opened, logLines }
}

beforeEach(() => {
  FakeWindow.all = []
})

describe('lanceur : décision au démarrage', () => {
  it('rien n’a changé → main.cjs chargé tout de suite (avant ready), sans écran', () => {
    const { launcher, requireMain, app, logLines } = setup()
    expect(launcher.start()).toBe('main')
    expect(requireMain).toHaveBeenCalledWith(path.join(REPO, 'dist-desktop', 'main.cjs'))
    expect(FakeWindow.all).toHaveLength(0)
    expect(app.relaunches).toEqual([])
    expect(logLines).toContain('À jour : lancement direct.')
    expect(launcher.logFile).toBe(LOG)
  })

  it('version du dépôt dans « À propos »', () => {
    const { launcher, app } = setup()
    launcher.start()
    expect(app.about).toMatchObject({ applicationName: 'Atelier Tab', applicationVersion: '0.7.0' })
  })

  it('autre instance déjà ouverte → quitte sans rien mesurer', () => {
    const { launcher, app, updater, requireMain } = setup()
    app.lock = false
    expect(launcher.start()).toBe('second-instance')
    expect(app.quits).toBe(1)
    expect(updater.planUpdate).not.toHaveBeenCalled()
    expect(requireMain).not.toHaveBeenCalled()
  })

  it('« sans mise à jour » (après un échec) → compilation précédente ouverte directement', () => {
    const { launcher, updater, requireMain } = setup({
      argv: ['/app', FLAG_SKIP_UPDATE],
      plan: { steps: ['build'], reasons: ['nouveau commit'] },
    })
    expect(launcher.start()).toBe('main')
    expect(updater.planUpdate).not.toHaveBeenCalled()
    expect(requireMain).toHaveBeenCalled()
  })

  it('relance après mise à jour : jamais de seconde mise à jour d’affilée', () => {
    const { launcher, updater, requireMain } = setup({
      argv: ['/app', FLAG_AFTER_UPDATE],
      plan: { steps: ['build'], reasons: ['modification locale non commitée'] },
    })
    expect(launcher.start()).toBe('main')
    expect(updater.update).not.toHaveBeenCalled()
    expect(requireMain).toHaveBeenCalled()
  })

  it('main.cjs illisible → « Recompiler » oublie le tampon et relance normalement', async () => {
    const { launcher, app, requireMain, updater, boxes } = setup({ responses: [0] })
    requireMain.mockImplementation(() => {
      throw new Error('SyntaxError')
    })
    expect(launcher.start()).toBe('error')
    app.makeReady()
    await vi.waitFor(() => expect(app.relaunches).toHaveLength(1))
    expect(boxes[0]?.buttons).toEqual(['Recompiler', 'Quitter'])
    expect(updater.invalidateStamp).toHaveBeenCalledWith(REPO)
    expect(app.relaunches[0]?.args).toEqual([])
  })
})

describe('lanceur : mise à jour', () => {
  const plan = { steps: ['build'], reasons: ['nouveau commit'] }

  it('écran de démarrage avec l’étape, puis relance de l’app à jour', async () => {
    const { launcher, app, requireMain, updater } = setup({ plan })
    expect(launcher.start()).toBe('update')
    expect(requireMain).not.toHaveBeenCalled()
    expect(FakeWindow.all).toHaveLength(0) // rien avant ready
    app.makeReady()
    await vi.waitFor(() => expect(app.exits).toEqual([0]))
    expect(updater.update).toHaveBeenCalledTimes(1)
    const splash = FakeWindow.all[0]
    expect(splash?.file).toBe(path.resolve(import.meta.dirname, '..', 'launcher', 'splash.html'))
    expect(splash?.options).toMatchObject({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    expect(splash?.text).toContain('Étape 1 sur 3')
    expect(splash?.text).toContain('Compilation de l’interface…')
    expect(splash?.text).toContain('nouveau commit')
    expect(app.relaunches).toEqual([{ args: [FLAG_AFTER_UPDATE] }])
    expect(requireMain).not.toHaveBeenCalled()
  })

  it('échec → message, journal, « Ouvrir quand même avec la version précédente »', async () => {
    const { launcher, app, updater, boxes } = setup({ plan, responses: [0] })
    updater.update.mockRejectedValueOnce(
      new UpdateError('« npm run build » a échoué (code 2).', 'error TS2322: erreur simulée'),
    )
    launcher.start()
    app.makeReady()
    await vi.waitFor(() => expect(app.exits).toEqual([0]))
    expect(boxes[0]?.buttons).toEqual([
      'Ouvrir quand même avec la version précédente',
      'Réessayer',
      'Ouvrir le journal',
      'Quitter',
    ])
    expect(boxes[0]?.detail).toContain('« npm run build » a échoué')
    expect(boxes[0]?.detail).toContain(LOG)
    const splash = FakeWindow.all[0]
    expect(splash?.text).toContain('La mise à jour a échoué')
    expect(splash?.text).toContain('TS2322')
    expect(splash?.text).toContain('La version précédente reste utilisable')
    expect(app.relaunches).toEqual([{ args: [FLAG_SKIP_UPDATE] }])
  })

  it('échec sans compilation précédente → pas de version précédente proposée ; Quitter', async () => {
    const { launcher, app, updater, boxes } = setup({ plan, built: false, responses: [2] })
    updater.update.mockRejectedValueOnce(new UpdateError('Node.js introuvable.'))
    launcher.start()
    app.makeReady()
    await vi.waitFor(() => expect(app.quits).toBe(1))
    expect(boxes[0]?.buttons).toEqual(['Réessayer', 'Ouvrir le journal', 'Quitter'])
    expect(app.relaunches).toEqual([])
  })

  it('Réessayer → nouvelle mise à jour, puis relance', async () => {
    const { launcher, app, updater } = setup({ plan, responses: [1] })
    updater.update.mockRejectedValueOnce(new UpdateError('réseau'))
    launcher.start()
    app.makeReady()
    await vi.waitFor(() => expect(app.exits).toEqual([0]))
    expect(updater.update).toHaveBeenCalledTimes(2)
    expect(app.relaunches).toEqual([{ args: [FLAG_AFTER_UPDATE] }])
  })

  it('Ouvrir le journal → journal ouvert, puis la question revient', async () => {
    const { launcher, app, updater, opened, boxes } = setup({ plan, responses: [2, 3] })
    updater.update.mockRejectedValueOnce(new UpdateError('réseau'))
    launcher.start()
    app.makeReady()
    await vi.waitFor(() => expect(app.quits).toBe(1))
    expect(opened).toEqual([LOG])
    expect(boxes).toHaveLength(2)
  })

  it('fermer l’écran de démarrage arrête npm et quitte (compilation précédente intacte)', async () => {
    const { launcher, app, updater } = setup({ plan })
    const child = { once: () => undefined }
    updater.update.mockImplementationOnce((_repo: string, o: UpdateOptions) => {
      o.onChild?.(child)
      return new Promise<Plan>(() => undefined)
    })
    launcher.start()
    app.makeReady()
    await vi.waitFor(() => expect(updater.update).toHaveBeenCalled())
    app.emit('window-all-closed')
    expect(updater.stopCommand).toHaveBeenCalledWith(child)
    expect(app.quits).toBe(1)
    expect(app.relaunches).toEqual([])
  })

  it('seconde ouverture pendant la mise à jour → l’écran de démarrage revient au premier plan', async () => {
    const { launcher, app, updater } = setup({ plan })
    updater.update.mockImplementationOnce(() => new Promise<Plan>(() => undefined))
    launcher.start()
    app.makeReady()
    await vi.waitFor(() => expect(FakeWindow.all).toHaveLength(1))
    app.emit('second-instance')
    expect(FakeWindow.all[0]?.focused).toBe(1)
  })
})
