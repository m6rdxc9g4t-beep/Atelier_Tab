/**
 * Appel de Claude par la CLI Claude Code, dans le processus principal (docs/SUITE.md §5.3).
 *
 * Isolation de chaque appel, comme Atelier Viz (`backend/app/services/ai/claude_cli.py`) :
 * - `--safe-mode` : ignore CLAUDE.md, mémoire, hooks, plugins et MCP de l'utilisateur ;
 * - `--tools ""` : aucun outil (ni shell, ni fichiers, ni MCP) — Claude ne fait que répondre ;
 *   les outils de l'assistant sont exécutés par l'app (`src/ai/claude.ts`) ;
 * - `--strict-mcp-config`, `--disable-slash-commands`, `--no-session-persistence` ;
 * - `--system-prompt` remplace le prompt de Claude Code ; `--json-schema` contraint la sortie ;
 * - conversation sur l'entrée standard, dossier de travail temporaire vide,
 *   `ANTHROPIC_API_KEY` retirée (facturation par l'abonnement) et
 *   `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` ; délai maximal de 180 s.
 *
 * L'interface n'envoie que la conversation, le prompt système, le schéma et l'alias du modèle,
 * validés ici (`parseChatRequest`) : la ligne de commande est construite par ce module seul.
 * Hors ligne (`atelier.json`), rien n'est lancé. Module sans Electron : exécutant injectable.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type {
  ClaudeChatRequest,
  ClaudeChatResponse,
  ClaudeMessage,
  ClaudeModelAlias,
  ClaudeStatus,
} from '@/services/desktop'

export const CLAUDE_MODEL_ALIASES: readonly ClaudeModelAlias[] = ['sonnet', 'opus', 'haiku']
/** Délai maximal d'une réponse (contrat §5.3). */
export const CLAUDE_TIMEOUT_MS = 180_000
/** Durée de validité de `claude auth status` (contrat §5.3). */
export const CLAUDE_STATUS_TTL_MS = 60_000
const STATUS_TIMEOUT_MS = 15_000

/** Limites de la requête venue de l'interface. */
export const LIMITS = {
  system: 64_000,
  messages: 200,
  content: 2_000_000,
  schema: 64_000,
} as const

const DEFAULT_SYSTEM_PROMPT = 'Tu es l’assistant d’Atelier Tab. Réponds en français.'
const API_KEY_AUTH_METHODS = new Set(['api_key', 'api_key_helper'])
const ROLE_LABELS: Record<ClaudeMessage['role'], string> = {
  user: 'Utilisateur',
  assistant: 'Assistant',
}

export const OFFLINE_MESSAGE =
  'Mode hors ligne : rien n’est envoyé à Claude. Activez « En ligne » dans l’en-tête pour l’utiliser.'
export const MISSING_MESSAGE =
  'CLI `claude` introuvable : installez Claude Code puis lancez `claude auth login`.'

// ---------------------------------------------------------------------------
// Recherche de l'exécutable
// ---------------------------------------------------------------------------

export interface FindDeps {
  env: Record<string, string | undefined>
  homedir: string
  platform: string
  isExecutable(file: string): boolean
}

/**
 * `CLAUDE_CLI`, sinon le `PATH`, puis `~/.local/bin/claude`, `/opt/homebrew/bin/claude`,
 * `/usr/local/bin/claude` : une app lancée depuis le Finder n'hérite pas du `PATH` du terminal.
 */
export function findClaudeExecutable(deps: FindDeps): string | null {
  const explicit = deps.env.CLAUDE_CLI?.trim()
  if (explicit) return deps.isExecutable(explicit) ? explicit : null
  const names = deps.platform === 'win32' ? ['claude.exe', 'claude'] : ['claude']
  const delimiter = deps.platform === 'win32' ? ';' : ':'
  const dirs = (deps.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name)
      if (deps.isExecutable(file)) return file
    }
  }
  const fallbacks = [
    path.join(deps.homedir, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]
  return fallbacks.find((f) => deps.isExecutable(f)) ?? null
}

/** Fichier exécutable ordinaire (pas un dossier). */
export function isExecutableFile(file: string): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Requête, ligne de commande, transcription
// ---------------------------------------------------------------------------

export type ParsedRequest = { ok: true; request: ClaudeChatRequest } | { ok: false; error: string }

const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/

/** Valide la requête de l'interface. Toute clé hors contrat est ignorée. */
export function parseChatRequest(raw: unknown): ParsedRequest {
  const fail = (error: string): ParsedRequest => ({
    ok: false,
    error: `Requête refusée : ${error}`,
  })
  if (typeof raw !== 'object' || raw === null) return fail('format invalide')
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !REQUEST_ID.test(r.id)) return fail('identifiant invalide')
  if (!CLAUDE_MODEL_ALIASES.includes(r.model as ClaudeModelAlias))
    return fail('modèle inconnu (sonnet, opus ou haiku)')
  const system = r.system === undefined ? DEFAULT_SYSTEM_PROMPT : r.system
  if (typeof system !== 'string' || !system.trim() || system.length > LIMITS.system)
    return fail('prompt système invalide')
  // Une valeur d'option ne commence jamais par un tiret (lue comme une option).
  if (system.trimStart().startsWith('-')) return fail('prompt système invalide')
  if (!Array.isArray(r.messages) || r.messages.length === 0 || r.messages.length > LIMITS.messages)
    return fail('conversation invalide')
  const messages: ClaudeMessage[] = []
  let total = 0
  for (const m of r.messages as unknown[]) {
    if (typeof m !== 'object' || m === null) return fail('message invalide')
    const { role, content } = m as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string')
      return fail('message invalide')
    total += content.length
    messages.push({ role, content })
  }
  if (total > LIMITS.content) return fail('conversation trop longue')
  if (messages.at(-1)?.role !== 'user')
    return fail('le dernier message doit venir de l’utilisateur')
  const request: ClaudeChatRequest = {
    id: r.id,
    model: r.model as ClaudeModelAlias,
    system,
    messages,
  }
  if (r.schema !== undefined) {
    const schema = r.schema
    if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
      return fail('schéma invalide')
    if ((schema as Record<string, unknown>).type !== 'object') return fail('schéma invalide')
    let text: string
    try {
      text = JSON.stringify(schema)
    } catch {
      return fail('schéma invalide')
    }
    if (text.length > LIMITS.schema) return fail('schéma trop long')
    request.schema = JSON.parse(text) as Record<string, unknown>
  }
  return { ok: true, request }
}

/** Arguments de `claude` : exactement ceux du contrat §5.3. */
export function claudeArgs(request: ClaudeChatRequest): string[] {
  return [
    '-p',
    '--safe-mode',
    '--output-format',
    'json',
    '--tools',
    '',
    '--strict-mcp-config',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--max-turns',
    // La sortie structurée demande un tour de plus (outil interne de la CLI).
    request.schema ? '2' : '1',
    '--model',
    request.model,
    '--system-prompt',
    request.system,
    ...(request.schema ? ['--json-schema', JSON.stringify(request.schema)] : []),
  ]
}

/** `claude -p` reçoit un seul texte : l'historique est rendu sous forme de transcription. */
export function formatConversation(
  messages: readonly ClaudeMessage[],
  structured: boolean,
): string {
  const only = messages.length === 1 ? messages[0] : undefined
  if (only && !structured) return only.content
  const lines = messages.map((m) => `${ROLE_LABELS[m.role]} : ${m.content}`)
  return [
    'Voici la conversation jusqu’ici :',
    '',
    lines.join('\n\n'),
    '',
    structured
      ? 'Réponds au dernier message par un seul objet JSON conforme au schéma.'
      : 'Réponds au dernier message de l’utilisateur, sans préfixe.',
  ].join('\n')
}

/** Environnement du sous-processus : sans clé API, sans trafic non essentiel. */
export function isolatedEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (k === 'ANTHROPIC_API_KEY' || v === undefined) continue
    out[k] = v
  }
  out.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  return out
}

/** Objet JSON final (`type: result`) de la sortie standard. */
export function parseCliResult(stdout: string): Record<string, unknown> | null {
  const lines = stdout.trim().split(/\r?\n/).reverse()
  for (const line of lines) {
    try {
      const data = JSON.parse(line) as unknown
      if (
        typeof data === 'object' &&
        data !== null &&
        (data as { type?: unknown }).type === 'result'
      )
        return data as Record<string, unknown>
    } catch {
      /* ligne non JSON */
    }
  }
  // Sortie JSON sur plusieurs lignes.
  try {
    const data = JSON.parse(stdout) as unknown
    if (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === 'result')
      return data as Record<string, unknown>
  } catch {
    /* illisible */
  }
  return null
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

export interface RunOptions {
  input?: string
  cwd: string
  env: Record<string, string>
  timeoutMs: number
  signal?: AbortSignal
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
  /** Lancement impossible (ENOENT…). */
  error?: string
}

export type Runner = (
  file: string,
  args: readonly string[],
  options: RunOptions,
) => Promise<RunResult>

const MAX_OUTPUT = 20 * 1024 * 1024

/** Exécutant réel : `spawn` sans shell, entrée standard, délai et annulation. */
export const spawnRunner: Runner = (file, args, options) =>
  new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let settled = false
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    })
    const finish = (result: RunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, options.timeoutMs)
    const onAbort = () => {
      aborted = true
      child.kill('SIGTERM')
    }
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk
    })
    child.stdin.on('error', () => {
      /* processus terminé avant la fin de l'écriture */
    })
    child.on('error', (e) =>
      finish({ code: null, stdout, stderr, timedOut, aborted, error: e.message }),
    )
    child.on('close', (code) => finish({ code, stdout, stderr, timedOut, aborted }))
    child.stdin.end(options.input ?? '')
  })

export interface ClaudeCliOptions {
  runner: Runner
  /** Chemin de la CLI, ou null si introuvable (relu à chaque vérification). */
  findExecutable(): string | null
  /** Mode « En ligne » de l'app (relu dans atelier.json à chaque appel). */
  isOnline(): boolean
  env?: NodeJS.ProcessEnv
  now?(): number
  timeoutMs?: number
  /** Dossier parent des dossiers de travail temporaires. */
  tmpRoot?: string
}

interface CachedStatus {
  at: number
  executable: string | null
  available: boolean
  detail: string | null
  version?: string
}

export class ClaudeCli {
  private readonly opts: ClaudeCliOptions
  private cache: CachedStatus | null = null
  private readonly pending = new Map<string, AbortController>()

  constructor(options: ClaudeCliOptions) {
    this.opts = options
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now()
  }

  /** Lance la CLI isolée dans un dossier temporaire vide, supprimé ensuite. */
  private async run(
    executable: string,
    args: readonly string[],
    input: string | undefined,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<RunResult> {
    const cwd = fs.mkdtempSync(path.join(this.opts.tmpRoot ?? os.tmpdir(), 'atelier-tab-claude-'))
    try {
      return await this.opts.runner(executable, args, {
        ...(input !== undefined ? { input } : {}),
        cwd,
        env: isolatedEnv(this.opts.env ?? process.env),
        timeoutMs,
        ...(signal ? { signal } : {}),
      })
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  }

  /**
   * État de Claude. Hors ligne, rien n'est lancé (seule la présence de l'exécutable est
   * vérifiée). En ligne : `claude auth status` et `claude --version`, mis en cache 60 s.
   */
  async status(refresh = false): Promise<ClaudeStatus> {
    const online = this.opts.isOnline()
    if (!online) {
      return {
        online,
        found: this.opts.findExecutable() !== null,
        available: false,
        detail: 'Hors ligne : activez « En ligne » dans l’en-tête pour utiliser Claude.',
      }
    }
    const cached = this.cache
    if (!refresh && cached && this.now() - cached.at < CLAUDE_STATUS_TTL_MS) {
      return this.toStatus(cached)
    }
    const fresh = await this.check()
    this.cache = fresh
    return this.toStatus(fresh)
  }

  private toStatus(c: CachedStatus): ClaudeStatus {
    return {
      online: true,
      found: c.executable !== null,
      available: c.available,
      detail: c.detail,
      ...(c.version ? { version: c.version } : {}),
    }
  }

  private async check(): Promise<CachedStatus> {
    const at = this.now()
    const executable = this.opts.findExecutable()
    if (!executable) return { at, executable, available: false, detail: MISSING_MESSAGE }
    const [auth, version] = await Promise.all([
      this.run(executable, ['auth', 'status'], undefined, STATUS_TIMEOUT_MS),
      this.run(executable, ['--version'], undefined, STATUS_TIMEOUT_MS),
    ])
    const versionText = version.code === 0 ? version.stdout.trim().split(/\r?\n/)[0] : undefined
    const base = { at, executable, ...(versionText ? { version: versionText } : {}) }
    let info: Record<string, unknown>
    try {
      info = JSON.parse(auth.stdout || '{}') as Record<string, unknown>
    } catch {
      return {
        ...base,
        available: false,
        detail: 'Impossible de lire `claude auth status` (mettez la CLI à jour : `claude update`).',
      }
    }
    if (auth.error || info.loggedIn !== true) {
      return {
        ...base,
        available: false,
        detail: 'CLI non connectée : lancez `claude auth login`.',
      }
    }
    if (API_KEY_AUTH_METHODS.has(String(info.authMethod ?? ''))) {
      return {
        ...base,
        available: true,
        detail: 'Attention : la CLI utilise une clé API (facturation API, pas l’abonnement).',
      }
    }
    return { ...base, available: true, detail: null }
  }

  /** Un appel de Claude. Refusé hors ligne ; jamais d'argument venu de l'interface tel quel. */
  async chat(raw: unknown): Promise<ClaudeChatResponse> {
    const parsed = parseChatRequest(raw)
    if (!parsed.ok) return { ok: false, code: 'invalid', error: parsed.error }
    const request = parsed.request
    if (!this.opts.isOnline()) return { ok: false, code: 'offline', error: OFFLINE_MESSAGE }
    const executable = this.opts.findExecutable()
    if (!executable) return { ok: false, code: 'missing', error: MISSING_MESSAGE }

    const controller = new AbortController()
    this.pending.get(request.id)?.abort()
    this.pending.set(request.id, controller)
    const timeoutMs = this.opts.timeoutMs ?? CLAUDE_TIMEOUT_MS
    let result: RunResult
    try {
      result = await this.run(
        executable,
        claudeArgs(request),
        formatConversation(request.messages, request.schema !== undefined),
        timeoutMs,
        controller.signal,
      )
    } finally {
      if (this.pending.get(request.id) === controller) this.pending.delete(request.id)
    }

    if (result.aborted) return { ok: false, code: 'cancelled', error: 'Requête annulée' }
    if (result.timedOut)
      return {
        ok: false,
        code: 'timeout',
        error: `Claude (CLI) n’a pas répondu en ${Math.round(timeoutMs / 1000)} s.`,
      }
    if (result.error)
      return {
        ok: false,
        code: 'cli',
        error: `Impossible de lancer la CLI Claude : ${result.error}`,
      }
    const payload = parseCliResult(result.stdout)
    if (!payload) {
      let detail = (result.stderr || result.stdout).trim().slice(0, 300)
      if (/unknown option/i.test(detail)) detail += ' — mettez la CLI à jour : `claude update`'
      return { ok: false, code: 'cli', error: `Réponse illisible de la CLI Claude : ${detail}` }
    }
    const text = typeof payload.result === 'string' ? payload.result : ''
    if (payload.is_error === true || result.code !== 0) {
      return { ok: false, code: 'cli', error: `Claude (CLI) : ${text || 'erreur inconnue'}` }
    }
    const structured = payload.structured_output
    return {
      ok: true,
      text,
      ...(typeof structured === 'object' && structured !== null ? { output: structured } : {}),
    }
  }

  cancel(id: unknown): void {
    if (typeof id === 'string') this.pending.get(id)?.abort()
  }
}
