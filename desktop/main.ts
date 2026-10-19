/**
 * Processus principal de l'application de bureau Atelier Tab.
 *
 * - Interface : le build web (dist/) servi par le protocole privé `app://atelier/`.
 * - Données : dossier ~/Atelier_Tab (fichiers JSON), lu et écrit ici, surveillé pour
 *   refléter en direct les modifications faites par Claude Code ou un autre programme.
 * - Ollama : les requêtes de l'assistant passent par ici (pas de contrainte CORS).
 * - Suite Atelier : ouverture des autres applications et envoi vers Atelier Projets local
 *   (adresses 127.0.0.1 / localhost uniquement).
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  net,
  protocol,
  shell,
  type MenuItemConstructorOptions,
} from 'electron'
import { isLocalHttpUrl, isLocalProjetsImportUrl } from '@/lib/local-url'
import type {
  DesktopLoadResult,
  LocalPostRequest,
  LocalPostResponse,
  McpInfo,
  OllamaRequest,
  OllamaResponse,
} from '@/services/desktop'
import type { AppData } from '@/types/domain'
import { defaultDataDir, defaultSecretsFile, ensureDataDirGuide, FileStore } from './file-store'

/** Nom affiché (menus, titre, boîtes de dialogue). Le dossier de données reste ~/Atelier_Tab. */
const APP_NAME = 'Atelier Tab'
const SCHEME = 'app'
const HOST = 'atelier'
const DIST = path.join(__dirname, '..', 'dist')

app.setName(APP_NAME)

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
])

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------

const dataDir = defaultDataDir()
const store = new FileStore({ dir: dataDir, secretsFile: defaultSecretsFile() })
let stopWatching: (() => void) | null = null

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

function startWatching() {
  if (stopWatching) return
  stopWatching = store.watch(
    (data) => broadcast('data:external', data),
    (errors) => broadcast('data:errors', errors),
  )
}

ipcMain.handle('data:load', (): DesktopLoadResult => {
  fs.mkdirSync(dataDir, { recursive: true })
  ensureDataDirGuide(dataDir)
  const { data, errors } = store.load()
  if (data) startWatching()
  return { data, errors, dir: dataDir }
})

ipcMain.handle('data:save', (_event, json: string) => {
  const parsed = JSON.parse(json) as { state?: AppData }
  if (!parsed.state) return
  store.save(parsed.state)
  startWatching()
})

ipcMain.handle('data:reveal', async () => {
  await shell.openPath(dataDir)
})

ipcMain.handle('export:save', (_event, filename: string, content: string) => {
  const safe = path.basename(filename)
  const dir = path.join(dataDir, 'exports')
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, safe)
  fs.writeFileSync(target, content, 'utf8')
  return target
})

// ---------------------------------------------------------------------------
// Suite Atelier
// ---------------------------------------------------------------------------

// Ouvre une autre application de la suite dans le navigateur par défaut. Surface IPC
// volontairement étroite : http(s) vers 127.0.0.1 / localhost uniquement.
ipcMain.handle('suite:open', async (_event, url: unknown) => {
  if (!isLocalHttpUrl(url)) return false
  await shell.openExternal(url)
  return true
})

// Envoi vers la route d'import d'Atelier Projets local. La page de l'app a l'origine
// app://atelier, refusée par le CORS de Projets ; depuis ce processus, la requête part
// sans en-tête Origin, comme celle d'un script local.
ipcMain.handle('suite:post', async (_event, req: LocalPostRequest): Promise<LocalPostResponse> => {
  if (!req || !isLocalProjetsImportUrl(req.url) || typeof req.body !== 'string') {
    return { status: 0, body: '', error: 'Adresse non autorisée' }
  }
  const headers: Record<string, string> = {}
  for (const name of [
    'Content-Type',
    'Authorization',
    'Idempotency-Key',
    'X-Atelier-Schema-Version',
  ]) {
    const value = req.headers?.[name]
    if (typeof value === 'string') headers[name] = value
  }
  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers,
      body: req.body,
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    })
    return { status: res.status, body: await res.text() }
  } catch (e) {
    return { status: 0, body: '', error: e instanceof Error ? e.message : String(e) }
  }
})

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

const OLLAMA_PATHS = new Set(['/api/tags', '/api/show', '/api/chat', '/api/version'])
const pendingOllama = new Map<string, AbortController>()

function ollamaBase(): string {
  const host = process.env.OLLAMA_HOST?.trim()
  if (!host) return 'http://127.0.0.1:11434'
  const withScheme = /^https?:\/\//.test(host) ? host : `http://${host}`
  return withScheme.replace('0.0.0.0', '127.0.0.1').replace(/\/$/, '')
}

ipcMain.handle('ollama:request', async (_event, req: OllamaRequest): Promise<OllamaResponse> => {
  if (!OLLAMA_PATHS.has(req.path))
    return { ok: false, status: 400, data: null, error: 'Requête non autorisée' }
  const controller = new AbortController()
  pendingOllama.set(req.id, controller)
  // Une réponse de modèle peut être longue ; les autres requêtes doivent être rapides.
  const timeout = setTimeout(
    () => controller.abort(),
    req.path === '/api/chat' ? 10 * 60_000 : 8_000,
  )
  try {
    const res = await fetch(`${ollamaBase()}${req.path}`, {
      method: req.method ?? (req.body ? 'POST' : 'GET'),
      headers: { 'Content-Type': 'application/json' },
      body: req.body ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    let data: unknown = text
    try {
      data = JSON.parse(text)
    } catch {
      /* réponse texte */
    }
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    const aborted = controller.signal.aborted
    return {
      ok: false,
      status: 0,
      data: null,
      error: aborted
        ? 'Requête annulée'
        : `Ollama injoignable (${ollamaBase()}) : ${e instanceof Error ? e.message : e}`,
    }
  } finally {
    clearTimeout(timeout)
    pendingOllama.delete(req.id)
  }
})

ipcMain.handle('ollama:cancel', (_event, id: string) => {
  pendingOllama.get(id)?.abort()
})

// ---------------------------------------------------------------------------
// Serveur MCP (Claude Code)
// ---------------------------------------------------------------------------

function mcpInfo(): McpInfo {
  const launcher = app.isPackaged
    ? path.join(process.resourcesPath, 'atelier-mcp')
    : path.join(__dirname, '..', 'desktop', 'bin', 'atelier-mcp-dev')
  return {
    launcher,
    claudeCommand: `claude mcp add --scope user atelier-tab -- "${launcher}"`,
  }
}

ipcMain.handle('mcp:info', () => mcpInfo())

async function showClaudeConnection(win: BrowserWindow | null) {
  const info = mcpInfo()
  const options = {
    type: 'info' as const,
    title: 'Connecter Claude Code',
    message: `Donner à Claude Code l’accès à ${APP_NAME}`,
    detail:
      `Lancez cette commande une fois dans le Terminal :\n\n${info.claudeCommand}\n\n` +
      `Ensuite, dans Claude Code, demandez par exemple « Ajoute une ligne Menuiseries à 12 000 € dans Planning & Lots ».\n\n` +
      `Les données sont dans ${dataDir}.`,
    buttons: ['Copier la commande', 'Fermer'],
    defaultId: 0,
    cancelId: 1,
  }
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)
  if (response === 0) clipboard.writeText(info.claudeCommand)
}

// ---------------------------------------------------------------------------
// Fenêtre et menus
// ---------------------------------------------------------------------------

function serveDist() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
    const target = path.normalize(path.join(DIST, relative))
    if (!target.startsWith(DIST)) return new Response('Interdit', { status: 403 })
    const response = await net.fetch(pathToFileURL(target).toString()).catch(() => null)
    if (response && response.ok) return response
    return net.fetch(pathToFileURL(path.join(DIST, 'index.html')).toString())
  })
}

let mainWindow: BrowserWindow | null = null

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16181d' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  mainWindow = win
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) {
      event.preventDefault()
      if (/^https?:/.test(url)) void shell.openExternal(url)
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  void win.loadURL(`${SCHEME}://${HOST}/index.html`)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: APP_NAME,
            submenu: [
              { role: 'about', label: `À propos d’${APP_NAME}` },
              { type: 'separator' },
              { role: 'hide', label: `Masquer ${APP_NAME}` },
              { role: 'hideOthers', label: 'Masquer les autres' },
              { role: 'unhide', label: 'Tout afficher' },
              { type: 'separator' },
              { role: 'quit', label: `Quitter ${APP_NAME}` },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'Fichier',
      submenu: [
        { label: 'Ouvrir le dossier des données', click: () => void shell.openPath(dataDir) },
        { label: 'Connecter Claude Code…', click: () => void showClaudeConnection(mainWindow) },
        ...(isMac
          ? []
          : [{ type: 'separator' as const }, { role: 'quit' as const, label: 'Quitter' }]),
      ],
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'undo', label: 'Annuler' },
        { role: 'redo', label: 'Rétablir' },
        { type: 'separator' },
        { role: 'cut', label: 'Couper' },
        { role: 'copy', label: 'Copier' },
        { role: 'paste', label: 'Coller' },
        { role: 'selectAll', label: 'Tout sélectionner' },
      ],
    },
    {
      label: 'Présentation',
      submenu: [
        { role: 'reload', label: 'Recharger' },
        { role: 'toggleDevTools', label: 'Outils de développement' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Taille réelle' },
        { role: 'zoomIn', label: 'Agrandir' },
        { role: 'zoomOut', label: 'Réduire' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Plein écran' },
      ],
    },
    {
      label: 'Fenêtre',
      submenu: [
        { role: 'minimize', label: 'Placer dans le Dock' },
        { role: 'zoom', label: 'Zoom' },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const, label: 'Tout ramener au premier plan' },
            ]
          : []),
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    serveDist()
    buildMenu()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => stopWatching?.())
}
