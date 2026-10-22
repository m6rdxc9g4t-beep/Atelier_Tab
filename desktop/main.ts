/**
 * Processus principal de l'application de bureau Atelier Tab.
 *
 * - Interface : le build web (dist/) servi par le protocole privé `app://atelier/`.
 * - Données : dossier ~/Atelier_Tab (fichiers JSON), lu et écrit ici, surveillé pour
 *   refléter en direct les modifications faites par Claude Code ou un autre programme.
 * - Instantanés pour Atelier Viz : ~/Atelier_Tab/exports/<tableId>.json, mis à jour après
 *   chaque enregistrement (docs/SUITE.md §4.2).
 * - Nœud Atelier (§7) : manifeste réécrit au démarrage, index des tables et événements tenus
 *   à chaque publication dans ~/Atelier_Tab/exports/_atelier/ (`atelier-node.ts`).
 * - Ollama : les requêtes de l'assistant passent par ici (pas de contrainte CORS).
 * - Claude : la CLI Claude Code est lancée ici, isolée, et seulement en ligne
 *   (docs/SUITE.md §5, `claude-cli.ts`) ; les outils restent exécutés par l'interface.
 * - Mode « En ligne » : fichier de préférences hors du dossier de données (à côté du fichier de
 *   secrets), écrit ici seulement, sur action de l'utilisateur (§5.1).
 * - Envois webhook : relayés ici (`webhook:post`), avec la politique réseau de §5.4 (hors ligne :
 *   cette machine seulement ; jeton seulement vers Atelier Projets local ; pas de redirection).
 * - Interface : politique de contenu (`connect-src` limité à cette machine, `csp.ts`).
 * - Suite Atelier : ouverture des autres applications ; route de santé sur 127.0.0.1:4175 (§3).
 */
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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
  session,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from 'electron'
import { isLocalHttpUrl } from '@/lib/local-url'
import type {
  DesktopLoadResult,
  McpInfo,
  OllamaRequest,
  OllamaResponse,
  WebhookPostResponse,
} from '@/services/desktop'
import type { AppData } from '@/types/domain'
import {
  defaultDataDir,
  defaultPreferencesFile,
  defaultSecretsFile,
  ensureDataDirGuide,
  FileStore,
  parseSaveRequest,
  readPreferencesFile,
  writePreferencesFile,
} from './file-store'
import { ClaudeCli, findClaudeExecutable, isExecutableFile, spawnRunner } from './claude-cli'
import { CSP_HEADER, rendererCsp } from './csp'
import { startHealthServer } from './health-server'
import { bringToFront } from './window-focus'
import { guardSender } from './ipc-guard'
import { resolveInside } from './safe-path'
import { SnapshotWriter } from './snapshots'
import { NodeJournal, parseEventsQuery } from './atelier-node'
import { buildManifest } from '@/ai/atelier-node'
import { toolSchemas } from '@/ai/tools'
import { cacheControlFor, uiBuildStamp, uiChangedSinceLastLaunch } from './ui-cache'
import { buildRelayRequest } from './suite-relay'
import { openSuiteOrExternal, SUITE_BUNDLES, suiteBundleFor } from './suite-launch'
import { claudeMcpAddCommand, mcpServerCommand } from './launcher/decision.cjs'

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
const preferencesFile = defaultPreferencesFile()
const store = new FileStore({ dir: dataDir, secretsFile: defaultSecretsFile(), preferencesFile })
const journal = new NodeJournal({ dataDir })
const snapshots = new SnapshotWriter({
  dir: dataDir,
  journal,
  onError: (e) => console.error('Instantané Atelier Viz :', e),
})

/** Manifeste du nœud Atelier (docs/SUITE.md §7.1), même contenu que l'outil `atelier_manifest`. */
function writeNodeManifest() {
  try {
    journal.writeManifest(buildManifest(toolSchemas()))
  } catch (e) {
    console.error('Manifeste du nœud Atelier :', e)
  }
}
let stopWatching: (() => void) | null = null

/**
 * Enregistre un gestionnaire IPC réservé à l'interface de l'app (`app://atelier/…`) :
 * un message venu d'un autre cadre est refusé sans être traité (M7).
 */
function handle<A extends unknown[], R>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: A) => R,
) {
  ipcMain.handle(
    channel,
    guardSender(channel, handler, (ch, url) =>
      console.error(`IPC ${ch} refusé : expéditeur ${String(url)}`),
    ) as (event: IpcMainInvokeEvent, ...args: unknown[]) => R,
  )
}

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

function startWatching() {
  if (stopWatching) return
  stopWatching = store.watch(
    (data) => {
      broadcast('data:external', data)
      snapshots.schedule(data)
    },
    (errors) => broadcast('data:errors', errors),
  )
}

handle('data:load', (): DesktopLoadResult => {
  fs.mkdirSync(dataDir, { recursive: true })
  ensureDataDirGuide(dataDir)
  const { data, errors } = store.load()
  if (data) {
    startWatching()
    // Publie (ou met à jour) les instantanés au démarrage : tables modifiées app fermée.
    snapshots.schedule(data)
  }
  return { data, errors, dir: dataDir }
})

// L'état vient de l'interface, donc d'un processus moins fiable : il est revalidé (schémas
// de src/storage/format.ts, ids de table utilisables comme noms de fichier) avant toute
// écriture. Un état invalide est refusé en bloc ; rien n'est écrit.
handle('data:save', (_event, json: unknown) => {
  let state: AppData | null
  try {
    state = parseSaveRequest(json)
  } catch (e) {
    console.error('Enregistrement refusé :', e instanceof Error ? e.message : e)
    throw e
  }
  if (!state) return
  store.save(state)
  snapshots.schedule(state)
  startWatching()
})

// Événements du nœud Atelier pour l'assistant de l'app (outil `atelier_events`, lecture seule).
handle('atelier:events', (_event, query: unknown) => journal.readEvents(parseEventsQuery(query)))

handle('data:reveal', async () => {
  await shell.openPath(dataDir)
})

handle('export:save', (_event, filename: unknown, content: unknown) => {
  if (typeof filename !== 'string' || typeof content !== 'string') {
    throw new Error('Export refusé : paramètres invalides')
  }
  const dir = path.join(dataDir, 'exports')
  fs.mkdirSync(dir, { recursive: true })
  const target = resolveInside(dir, path.basename(filename))
  fs.writeFileSync(target, content, 'utf8')
  return target
})

// ---------------------------------------------------------------------------
// Suite Atelier
// ---------------------------------------------------------------------------

// Ouvre une autre application de la suite : l'app de bureau installée (macOS `open -b` ; Windows :
// raccourci inscrit dans HKCU\Software\Atelier\Apps, ouvert par explorer.exe), sinon le navigateur par défaut
// (docs/SUITE.md §3, §9.4), avec un environnement minimal. Surface IPC volontairement étroite :
// http(s) vers 127.0.0.1 / localhost, ou une app en ligne de la suite reconnue par
// `suiteBundleFor` (Atelier Cuisine : https, hôte exact). Aucune requête n'y est faite.
// L'adresse de Tab lui-même (4175) ramène sa fenêtre : ni `open -b`, ni navigateur.
const openSuiteUrl = (url: string) =>
  openSuiteOrExternal(url, {
    execFile: (file, args, options, callback) =>
      execFile(file, args, { ...options, encoding: 'utf8' }, (error, stdout) =>
        callback(error, stdout),
      ),
    spawnDetached: (file, args, { env, windowsHide }) =>
      new Promise((resolve) => {
        try {
          // Console masquée (.cmd) : pas de processus détaché, qui ouvrirait une console à lui.
          const child = spawn(file, args, {
            env,
            windowsHide,
            detached: !windowsHide,
            stdio: 'ignore',
          })
          child.once('error', () => resolve(false))
          child.once('spawn', () => {
            child.unref()
            resolve(true)
          })
        } catch {
          resolve(false)
        }
      }),
    exists: (file) => fs.existsSync(file),
    openExternal: (u) => shell.openExternal(u),
    platform: process.platform,
    self: { bundleId: SUITE_BUNDLES['4175'] ?? 'fr.atelier.tab', focus: focusMainWindow },
  })

handle('suite:open', async (_event, url: unknown) => {
  if (typeof url !== 'string') return false
  if (!isLocalHttpUrl(url) && suiteBundleFor(url) === null) return false
  await openSuiteUrl(url)
  return true
})

// Envois webhook de l'interface (docs/SUITE.md §4.1, §5.4). La page de l'app a l'origine
// app://atelier, refusée par le CORS de Projets ; depuis ce processus, la requête part sans
// en-tête Origin, ce que Projets traite comme un appel local. La politique de contenu de
// l'interface n'admet que cette machine : un envoi https vers l'extérieur (autorisé par
// l'utilisateur) passe donc aussi par ici. Revérifié ici : mode hors ligne (fichier de
// préférences), jeton seulement vers Atelier Projets local, aucune redirection suivie.
handle('webhook:post', async (_event, raw: unknown): Promise<WebhookPostResponse> => {
  const decision = buildRelayRequest(raw, { online: isOnline() })
  if (!decision.ok) return { status: 0, body: '', error: decision.error }
  const req = decision.request
  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
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

handle('ollama:request', async (_event, req: OllamaRequest): Promise<OllamaResponse> => {
  if (!req || !OLLAMA_PATHS.has(req.path) || typeof req.id !== 'string')
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

handle('ollama:cancel', (_event, id: string) => {
  pendingOllama.get(id)?.abort()
})

// ---------------------------------------------------------------------------
// Claude (CLI Claude Code, docs/SUITE.md §5.3)
// ---------------------------------------------------------------------------

/**
 * Mode « En ligne », relu à chaque appel dans le fichier de préférences (hors du dossier de
 * données, docs/SUITE.md §5.1). Absent ou abîmé → hors ligne. Une ancienne valeur restée dans
 * atelier.json est ignorée.
 */
function isOnline(): boolean {
  return readPreferencesFile(preferencesFile).onlineMode
}

// Seul l'interrupteur de l'en-tête (action de l'utilisateur) appelle ce canal ; aucun outil
// d'IA n'y a accès (ni l'assistant, qui passe par les outils, ni le serveur MCP).
handle('prefs:set-online', (_event, online: unknown) => {
  if (typeof online !== 'boolean') throw new Error('Réglage refusé : valeur invalide')
  writePreferencesFile(preferencesFile, { onlineMode: online })
  return isOnline()
})

const claude = new ClaudeCli({
  runner: spawnRunner,
  isOnline,
  findExecutable: () =>
    findClaudeExecutable({
      env: process.env,
      homedir: os.homedir(),
      platform: process.platform,
      isExecutable: isExecutableFile,
    }),
})

// L'interface n'envoie que la conversation, le prompt système, le schéma et l'alias du
// modèle : `ClaudeCli.chat` les valide et construit seul la ligne de commande.
handle('claude:status', (_event, refresh: unknown) => claude.status(refresh === true))
handle('claude:chat', (_event, request: unknown) => claude.chat(request))
handle('claude:cancel', (_event, id: unknown) => claude.cancel(id))

// ---------------------------------------------------------------------------
// Serveur MCP (Claude Code)
// ---------------------------------------------------------------------------

function mcpInfo(): McpInfo {
  // App installée : serveur livré dans les ressources (macOS `atelier-mcp` ; Windows
  // `Atelier_Tab.exe resources\atelier-mcp.cjs`, chemin stable `resources\atelier-mcp.cmd`).
  // Développement : serveur compilé du dépôt.
  const server = app.isPackaged
    ? mcpServerCommand({
        platform: process.platform,
        resourcesPath: process.resourcesPath,
        exePath: process.execPath,
      })
    : process.platform === 'win32'
      ? {
          file: path.join(__dirname, 'atelier-mcp.mjs'),
          command: 'node',
          args: [path.join(__dirname, 'atelier-mcp.mjs')],
          env: {},
        }
      : (() => {
          const file = path.join(__dirname, '..', 'desktop', 'bin', 'atelier-mcp-dev')
          return { file, command: file, args: [], env: {} }
        })()
  return { launcher: server.file, claudeCommand: claudeMcpAddCommand(server) }
}

handle('mcp:info', () => mcpInfo())

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

/** Page HTML de l'interface, servie avec sa politique de contenu (`csp.ts`). */
function htmlResponse(file: string): Response {
  const html = fs.readFileSync(file, 'utf8')
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      [CSP_HEADER]: rendererCsp(html),
      'X-Content-Type-Options': 'nosniff',
      // Jamais de copie en cache : après une mise à jour, la fenêtre doit charger la nouvelle interface.
      'Cache-Control': cacheControlFor('index.html'),
    },
  })
}

/** Empreinte de l'interface livrée (`dist/index.html`), ou chaîne vide si elle est illisible. */
function currentUiStamp(): string {
  try {
    return uiBuildStamp(fs.readFileSync(path.join(DIST, 'index.html'), 'utf8'))
  } catch {
    return ''
  }
}

/**
 * Interface changée depuis le dernier lancement (mise à jour de l'app) : vide le cache HTTP et le
 * cache de code de Chromium, qui réaffichaient sinon l'ancienne interface.
 */
async function resetCachesIfUiChanged(stamp: string): Promise<void> {
  if (!stamp || !uiChangedSinceLastLaunch(app.getPath('userData'), stamp)) return
  try {
    await session.defaultSession.clearCache()
    await session.defaultSession.clearCodeCaches({})
  } catch (error) {
    console.error('Atelier Tab : impossible de vider le cache de l’interface', error)
  }
}

function serveDist() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url)
    const relative = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
    const target = path.normalize(path.join(DIST, relative))
    if (!target.startsWith(DIST)) return new Response('Interdit', { status: 403 })
    if (target.endsWith('.html') && fs.existsSync(target)) return htmlResponse(target)
    const response = await net.fetch(pathToFileURL(target).toString()).catch(() => null)
    if (response && response.ok) {
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', cacheControlFor(path.relative(DIST, target)))
      return new Response(response.body, { status: response.status, headers })
    }
    return htmlResponse(path.join(DIST, 'index.html'))
  })
}

let mainWindow: BrowserWindow | null = null
/** Empreinte de l'interface livrée, calculée une fois au démarrage. */
const uiStamp = currentUiStamp()

/**
 * Ramène la fenêtre (route `GET /` de santé, adresse de Tab lui-même) : `show()` / `focus()`
 * seulement, jamais de vol du premier plan (`bringToFront`).
 */
function focusMainWindow() {
  const win = mainWindow
  if (!win) {
    if (app.isReady()) createWindow()
    return
  }
  bringToFront(win)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: APP_NAME,
    show: false,
    // Fond = --atelier-bg de la charte « néon monochrome » pour le vert de Tab
    // (sombre : signature 6 % dans #07070A ; clair : 5 % dans #FBFBFD).
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0A0E0F' : '#F2F7F5',
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
    if (/^https?:/.test(url)) void openSuiteUrl(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) {
      event.preventDefault()
      if (/^https?:/.test(url)) void openSuiteUrl(url)
    }
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // L'empreinte dans l'adresse garantit qu'une nouvelle interface n'est jamais confondue avec l'ancienne.
  void win.loadURL(`${SCHEME}://${HOST}/index.html?v=${uiStamp}`)
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
        {
          label: 'Ouvrir le dossier des instantanés (Atelier Viz)',
          click: () => {
            const dir = path.join(dataDir, 'exports')
            fs.mkdirSync(dir, { recursive: true })
            void shell.openPath(dir)
          },
        },
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

  void app.whenReady().then(async () => {
    writeNodeManifest()
    serveDist()
    buildMenu()
    await resetCachesIfUiChanged(uiStamp)
    createWindow()
    // Indicateur « en marche » pour les autres apps de la suite (§3). Port pris : journalisé.
    void startHealthServer({ onFocus: focusMainWindow }).then((server) => {
      if (server) app.on('will-quit', () => server.close())
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    snapshots.flush()
    stopWatching?.()
  })
}
