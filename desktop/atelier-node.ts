/**
 * Nœud Atelier sur disque (docs/SUITE.md §7) : `~/Atelier_Tab/exports/_atelier/`.
 *
 *   manifest.json      manifeste (`atelier_manifest`), réécrit au démarrage de l'app et du serveur MCP
 *   index.json         { contract, tables: [{ table_id, name, project, workspace, revision, rows, updated_at }] }
 *   events.jsonl       un événement par ligne (§7.3), `seq` croissant, 1 000 lignes au plus
 *   idempotency.json   clés `idempotency_key` des écritures (§7.4) : 30 jours, taille bornée
 *   state.json         interne : dernier `seq`, révision et empreinte de chaque table (jamais lu par un tiers)
 *   .lock              verrou inter-processus (app de bureau + serveur MCP)
 *
 * Écrivains : le processus principal de l'app et le serveur MCP, éventuellement en même temps.
 * - Toute écriture se fait sous un **verrou** : fichier `.lock` créé en exclusif (`wx`) avec
 *   `{ pid, host, at, token }`. Un verrou est **périmé** si son processus n'existe plus (même
 *   machine) ou s'il a plus de `staleMs` (30 s) : il est alors renommé (une seule reprise
 *   gagne), vérifié, puis supprimé. Libération : seulement si le jeton est le nôtre.
 * - Chaque fichier est écrit de façon **atomique** (temporaire puis renommage).
 * - `revision` (index) et `seq` (événements) sont relus du disque sous le verrou : ils ne
 *   reculent jamais et ne sont jamais réutilisés, quel que soit l'écrivain.
 * - Une révision n'augmente que si l'empreinte de l'instantané a changé (même contenu publié
 *   par l'app puis par le serveur MCP → une seule révision).
 *
 * Les lecteurs d'instantanés (Viz, Nexus) ne lisent que `exports/*.json` : rien ici n'est une
 * enveloppe DataFlow, et la surveillance du dossier de données (`FileStore.watch`) ignore ce
 * sous-dossier.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  EVENTS_RETENTION,
  IDEMPOTENCY_RETENTION_MS,
  isoWithOffset,
  NODE_CONTRACT,
  NODE_DIR,
  selectEvents,
  type AtelierManifest,
  type EventsQuery,
  type EventsResponse,
  type IdempotencyEntry,
  type IdempotencyLedger,
  type NodeEvent,
} from '@/ai/atelier-node'
import { isSnapshotOf, SNAPSHOTS_DIR, snapshotFile, snapshotFingerprint } from '@/dataflow/snapshot'
import type { AtelierPayload } from '@/dataflow/schema/atelier.v2_1'
import { isSafeId } from '@/storage/format'

export const MANIFEST_FILE = 'manifest.json'
export const NODE_INDEX_FILE = 'index.json'
export const EVENTS_FILE = 'events.jsonl'
export const IDEMPOTENCY_FILE = 'idempotency.json'
export const STATE_FILE = 'state.json'
export const LOCK_FILE = '.lock'

/** Clés d'idempotence gardées au plus, et taille maximale des réponses gardées. */
export const IDEMPOTENCY_MAX_ENTRIES = 1000
export const IDEMPOTENCY_MAX_BYTES = 4 * 1024 * 1024

export interface NodeIndexEntry {
  table_id: string
  name: string
  project: string
  workspace: string
  revision: number
  rows: number
  updated_at: string
}

export interface NodeIndex {
  contract: typeof NODE_CONTRACT
  tables: NodeIndexEntry[]
}

/** Instantané publié d'une table, relu sur disque. */
export interface PublishedTable {
  tableId: string
  name: string
  project: string
  workspace: string
  /** Lignes de données (lignes de total exclues). */
  rows: number
  /** Empreinte du contenu (`snapshotFingerprint`) : tout sauf l'horodatage. */
  fingerprint: string
}

function publishedTable(tableId: string, payload: AtelierPayload): PublishedTable {
  return {
    tableId,
    name: payload.project?.source_table?.name ?? payload.project?.name ?? tableId,
    project: payload.project?.name ?? '',
    workspace: payload.workspace?.name ?? '',
    rows: Array.isArray(payload.project?.records) ? payload.project.records.length : 0,
    fingerprint: snapshotFingerprint(payload),
  }
}

interface NodeState {
  last_seq: number
  /** Par table : dernière révision et empreinte (hachée). Gardé après suppression. */
  tables: Record<string, { revision: number; hash: string | null }>
}

export class NodeLockError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NodeLockError'
  }
}

export interface NodeJournalOptions {
  /** Dossier de données (~/Atelier_Tab). */
  dataDir: string
  now?: () => Date
  /** Attente maximale du verrou (ms). */
  lockTimeoutMs?: number
  /** Âge au-delà duquel un verrou est repris (ms). */
  staleMs?: number
}

const sleepCell = new Int32Array(new SharedArrayBuffer(4))
function sleepSync(ms: number): void {
  Atomics.wait(sleepCell, 0, 0, ms)
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

export class NodeJournal {
  /** `exports/_atelier`, absolu. */
  readonly dir: string
  private readonly now: () => Date
  private readonly lockTimeoutMs: number
  private readonly staleMs: number
  /** Profondeur du verrou tenu par ce journal (réentrant dans le même flux d'exécution). */
  private depth = 0
  private token: string | null = null
  /** File des sections asynchrones de ce processus (une seule à la fois). */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(options: NodeJournalOptions) {
    this.dir = path.join(options.dataDir, SNAPSHOTS_DIR, NODE_DIR)
    this.now = options.now ?? (() => new Date())
    this.lockTimeoutMs = options.lockTimeoutMs ?? 10_000
    this.staleMs = options.staleMs ?? 30_000
  }

  private file(name: string): string {
    return path.join(this.dir, name)
  }

  // -------------------------------------------------------------------------
  // Verrou
  // -------------------------------------------------------------------------

  /** Une tentative : vrai si le verrou est pris par ce journal. */
  private tryAcquire(): boolean {
    fs.mkdirSync(this.dir, { recursive: true })
    const lock = this.file(LOCK_FILE)
    const token = crypto.randomUUID()
    const body = JSON.stringify({ pid: process.pid, host: os.hostname(), at: Date.now(), token })
    try {
      const fd = fs.openSync(lock, 'wx')
      try {
        fs.writeSync(fd, body)
      } finally {
        fs.closeSync(fd)
      }
      this.token = token
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
    }
    this.breakIfStale(lock)
    return false
  }

  /** Reprend un verrou périmé (processus disparu, ou trop ancien). */
  private breakIfStale(lock: string): void {
    let text: string
    let mtime: number
    try {
      text = fs.readFileSync(lock, 'utf8')
      mtime = fs.statSync(lock).mtimeMs
    } catch {
      return // libéré entre-temps
    }
    let holder: { pid?: unknown; host?: unknown; at?: unknown } = {}
    try {
      holder = JSON.parse(text) as typeof holder
    } catch {
      // Verrou en cours d'écriture (ou abîmé) : jugé sur sa date.
    }
    const at = typeof holder.at === 'number' ? holder.at : mtime
    const dead =
      typeof holder.pid === 'number' &&
      holder.host === os.hostname() &&
      holder.pid !== process.pid &&
      !pidAlive(holder.pid)
    if (!dead && Date.now() - at < this.staleMs) return
    // Renommage : une seule reprise réussit, même si plusieurs processus la tentent.
    const aside = `${lock}.${process.pid}.${crypto.randomUUID()}.stale`
    try {
      fs.renameSync(lock, aside)
    } catch {
      return
    }
    try {
      if (fs.readFileSync(aside, 'utf8') !== text) {
        // Un autre écrivain avait repris et reposé un verrou neuf : on le lui rend.
        try {
          fs.linkSync(aside, lock)
        } catch {
          /* déjà repris par un troisième : il garde la main */
        }
      }
    } finally {
      fs.rmSync(aside, { force: true })
    }
  }

  private release(): void {
    const lock = this.file(LOCK_FILE)
    const token = this.token
    this.token = null
    try {
      const holder = JSON.parse(fs.readFileSync(lock, 'utf8')) as { token?: unknown }
      if (holder.token === token) fs.rmSync(lock, { force: true })
    } catch {
      /* déjà libéré ou repris */
    }
  }

  /** Exécute `fn` sous le verrou (attente active bornée). Réentrant. */
  withLock<T>(fn: () => T): T {
    if (this.depth > 0) {
      this.depth++
      try {
        return fn()
      } finally {
        this.depth--
      }
    }
    const deadline = Date.now() + this.lockTimeoutMs
    let wait = 5
    while (!this.tryAcquire()) {
      if (Date.now() > deadline) {
        throw new NodeLockError(
          `Verrou du nœud Atelier occupé (${this.file(LOCK_FILE)}) : réessayez dans un instant.`,
        )
      }
      sleepSync(wait + Math.random() * wait)
      wait = Math.min(wait * 2, 50)
    }
    this.depth = 1
    try {
      return fn()
    } finally {
      this.depth = 0
      this.release()
    }
  }

  /**
   * Exécute une section asynchrone sous le verrou (attente sans bloquer la boucle). Les sections
   * d'un même processus passent l'une après l'autre ; `withLock` y est réentrant.
   */
  withLockAsync<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const deadline = Date.now() + this.lockTimeoutMs
      let wait = 5
      while (!this.tryAcquire()) {
        if (Date.now() > deadline) {
          throw new NodeLockError(
            `Verrou du nœud Atelier occupé (${this.file(LOCK_FILE)}) : réessayez dans un instant.`,
          )
        }
        await new Promise((r) => setTimeout(r, wait + Math.random() * wait))
        wait = Math.min(wait * 2, 50)
      }
      this.depth = 1
      try {
        return await fn()
      } finally {
        this.depth = 0
        this.release()
      }
    }
    const result = this.queue.then(run, run)
    this.queue = result.catch(() => {})
    return result
  }

  // -------------------------------------------------------------------------
  // Fichiers
  // -------------------------------------------------------------------------

  private writeAtomic(name: string, content: string): void {
    fs.mkdirSync(this.dir, { recursive: true })
    const target = this.file(name)
    const tmp = this.file(`.${name}.${process.pid}.${crypto.randomUUID()}.tmp`)
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, target)
  }

  private readText(name: string): string | null {
    try {
      return fs.readFileSync(this.file(name), 'utf8')
    } catch {
      return null
    }
  }

  private readJson(name: string): unknown {
    const text = this.readText(name)
    if (text === null) return null
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }

  /** Réécrit le manifeste (démarrage de l'app et du serveur MCP). */
  writeManifest(manifest: AtelierManifest): void {
    const content = JSON.stringify(manifest, null, 2) + '\n'
    this.withLock(() => {
      if (this.readText(MANIFEST_FILE) !== content) this.writeAtomic(MANIFEST_FILE, content)
    })
  }

  /** Index des tables publiées (lecture tolérante : absent ou abîmé → vide). */
  readIndex(): NodeIndex {
    const json = this.readJson(NODE_INDEX_FILE) as { tables?: unknown } | null
    const tables = Array.isArray(json?.tables)
      ? (json.tables as unknown[]).filter(
          (t): t is NodeIndexEntry =>
            typeof t === 'object' &&
            t !== null &&
            typeof (t as NodeIndexEntry).table_id === 'string' &&
            typeof (t as NodeIndexEntry).revision === 'number',
        )
      : []
    return { contract: NODE_CONTRACT, tables }
  }

  /** Événements gardés, dans l'ordre (lignes illisibles ignorées). */
  readAllEvents(): NodeEvent[] {
    const text = this.readText(EVENTS_FILE)
    if (!text) return []
    const out: NodeEvent[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line) as NodeEvent
        if (typeof e.seq === 'number' && typeof e.type === 'string') out.push(e)
      } catch {
        /* ligne abîmée */
      }
    }
    return out.sort((a, b) => a.seq - b.seq)
  }

  /** Réponse de `atelier_events` (§7.3). Lecture sans verrou : les fichiers sont remplacés d'un bloc. */
  readEvents(query: EventsQuery = {}): EventsResponse {
    const all = this.readAllEvents()
    return selectEvents(all, query, Math.max(this.readState().last_seq, all.at(-1)?.seq ?? 0))
  }

  private readState(): NodeState {
    const json = this.readJson(STATE_FILE) as Partial<NodeState> | null
    const tables: NodeState['tables'] = {}
    if (json && typeof json.tables === 'object' && json.tables !== null) {
      for (const [id, t] of Object.entries(json.tables)) {
        if (t && typeof t.revision === 'number') {
          tables[id] = { revision: t.revision, hash: typeof t.hash === 'string' ? t.hash : null }
        }
      }
    }
    return { last_seq: typeof json?.last_seq === 'number' ? json.last_seq : 0, tables }
  }

  /**
   * Met l'index à jour pour les tables `candidates` (instantanés écrits ou supprimés par
   * l'appelant) et émet les événements : `tab.table.changed` pour une table nouvelle ou dont
   * le contenu a changé (révision + 1), `tab.table.deleted` pour une table retirée.
   *
   * L'instantané est **relu sur disque sous le verrou** : c'est lui qui fait foi, même si un
   * autre écrivain l'a remplacé entre-temps. Une table indexée dont l'instantané a disparu est
   * retirée aussi. Renvoie les événements émis.
   */
  sync(candidates: Iterable<string>): NodeEvent[] {
    return this.withLock(() => {
      const state = this.readState()
      const index = this.readIndex()
      const events = this.readAllEvents()
      let seq = Math.max(state.last_seq, events.at(-1)?.seq ?? 0)
      // Une révision ne recule jamais : reprise du maximum connu (état interne ou index).
      for (const entry of index.tables) {
        const known = state.tables[entry.table_id]
        if (!known || known.revision < entry.revision) {
          state.tables[entry.table_id] = { revision: entry.revision, hash: known?.hash ?? null }
        }
      }
      const entries = new Map(index.tables.map((t) => [t.table_id, t]))
      const emitted: NodeEvent[] = []
      const at = isoWithOffset(this.now())
      const removed = new Set<string>()

      for (const tableId of new Set(candidates)) {
        const table = this.readPublished(tableId)
        if (!table) {
          removed.add(tableId)
          continue
        }
        const digest = hash(table.fingerprint)
        const known = state.tables[tableId]
        const entry = entries.get(tableId)
        if (known && known.hash === digest) {
          // Contenu déjà indexé (publié aussi par l'autre écrivain) : pas de nouvelle révision.
          if (!entry) entries.set(tableId, toEntry(table, known.revision, at))
          continue
        }
        const revision = (known?.revision ?? 0) + 1
        state.tables[tableId] = { revision, hash: digest }
        entries.set(tableId, toEntry(table, revision, at))
        emitted.push({
          seq: ++seq,
          type: 'tab.table.changed',
          at,
          subject: { kind: 'table', id: tableId, label: table.name },
          data: { revision, rows: table.rows, project: table.project },
        })
      }

      // Tables indexées dont l'instantané a disparu (supprimées, éventuellement par l'autre
      // écrivain ou pendant que l'app était fermée).
      for (const tableId of entries.keys()) {
        if (!removed.has(tableId) && !fs.existsSync(this.snapshotPath(tableId)))
          removed.add(tableId)
      }
      for (const tableId of removed) {
        const entry = entries.get(tableId)
        if (!entry) continue
        entries.delete(tableId)
        const known = state.tables[tableId]
        if (known) known.hash = null
        emitted.push({
          seq: ++seq,
          type: 'tab.table.deleted',
          at,
          subject: { kind: 'table', id: tableId, label: entry.name },
          data: {},
        })
      }

      const nextIndex: NodeIndex = {
        contract: NODE_CONTRACT,
        tables: [...entries.values()].sort((a, b) =>
          a.table_id < b.table_id ? -1 : a.table_id > b.table_id ? 1 : 0,
        ),
      }
      const indexText = JSON.stringify(nextIndex, null, 2) + '\n'
      if (emitted.length > 0) {
        const kept = [...events, ...emitted].slice(-EVENTS_RETENTION)
        this.writeAtomic(EVENTS_FILE, kept.map((e) => JSON.stringify(e)).join('\n') + '\n')
        state.last_seq = seq
      }
      if (this.readText(NODE_INDEX_FILE) !== indexText) this.writeAtomic(NODE_INDEX_FILE, indexText)
      const stateText = JSON.stringify(state, null, 2) + '\n'
      if (this.readText(STATE_FILE) !== stateText) this.writeAtomic(STATE_FILE, stateText)
      return emitted
    })
  }

  /** `exports/<id>.json` (l'id vient de données : nom de fichier sûr exigé). */
  private snapshotPath(tableId: string): string {
    return path.join(this.dir, '..', path.basename(snapshotFile(tableId)))
  }

  /** Instantané publié d'une table, relu sur disque ; null s'il n'existe pas (ou pas à elle). */
  private readPublished(tableId: string): PublishedTable | null {
    if (!isSafeId(tableId)) return null
    let text: string
    try {
      text = fs.readFileSync(this.snapshotPath(tableId), 'utf8')
    } catch {
      return null
    }
    if (!isSnapshotOf(text, tableId)) return null
    try {
      return publishedTable(tableId, JSON.parse(text) as AtelierPayload)
    } catch {
      return null
    }
  }

  // -------------------------------------------------------------------------
  // Idempotence (§7.4)
  // -------------------------------------------------------------------------

  /**
   * Registre des clés d'idempotence, lu sur disque. À ouvrir **sous le verrou** (`withLockAsync`)
   * pour toute la durée de l'appel : l'écriture des données puis `commit()` gardent le tout
   * cohérent entre l'app et le serveur MCP.
   */
  openLedger(): DiskLedger {
    return new DiskLedger(this)
  }

  /** @internal Lecture/écriture du registre (DiskLedger). */
  readLedgerFile(): Record<string, IdempotencyEntry> {
    const json = this.readJson(IDEMPOTENCY_FILE) as { entries?: unknown } | null
    const out: Record<string, IdempotencyEntry> = {}
    if (json && typeof json.entries === 'object' && json.entries !== null) {
      for (const [key, e] of Object.entries(json.entries as Record<string, unknown>)) {
        const entry = e as Partial<IdempotencyEntry> | null
        if (
          entry &&
          typeof entry.fingerprint === 'string' &&
          typeof entry.content === 'string' &&
          typeof entry.at === 'number'
        ) {
          out[key] = { fingerprint: entry.fingerprint, content: entry.content, at: entry.at }
        }
      }
    }
    return out
  }

  /** @internal */
  writeLedgerFile(entries: Record<string, IdempotencyEntry>): void {
    this.withLock(() =>
      this.writeAtomic(IDEMPOTENCY_FILE, JSON.stringify({ version: 1, entries }, null, 2) + '\n'),
    )
  }

  /** @internal */
  nowMs(): number {
    return this.now().getTime()
  }
}

/**
 * Requête `atelier:events` venue de l'interface (processus moins fiable) : seuls `since`,
 * `limit` et `types` sont repris, s'ils ont le bon type.
 */
export function parseEventsQuery(raw: unknown): EventsQuery {
  const q = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const int = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined
  const since = int(q.since)
  const limit = int(q.limit)
  const types = Array.isArray(q.types)
    ? q.types.filter((t): t is string => typeof t === 'string').slice(0, 20)
    : undefined
  return {
    ...(since !== undefined ? { since } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(types?.length ? { types } : {}),
  }
}

function toEntry(table: PublishedTable, revision: number, at: string): NodeIndexEntry {
  return {
    table_id: table.tableId,
    name: table.name,
    project: table.project,
    workspace: table.workspace,
    revision,
    rows: table.rows,
    updated_at: at,
  }
}

/**
 * Registre d'idempotence sur disque : lu à l'ouverture, écrit par `commit()` (après
 * l'enregistrement des données). Rétention 30 jours, au plus 1 000 clés et 4 Mo de réponses.
 */
export class DiskLedger implements IdempotencyLedger {
  private readonly journal: NodeJournal
  private readonly entries: Record<string, IdempotencyEntry>
  private dirty = false

  constructor(journal: NodeJournal) {
    this.journal = journal
    this.entries = journal.readLedgerFile()
  }

  get(key: string): IdempotencyEntry | undefined {
    const e = this.entries[key]
    if (e && this.journal.nowMs() - e.at > IDEMPOTENCY_RETENTION_MS) return undefined
    return e
  }

  put(key: string, entry: Omit<IdempotencyEntry, 'at'>): void {
    this.entries[key] = { ...entry, at: this.journal.nowMs() }
    this.dirty = true
  }

  /** Enregistre les nouvelles clés (avec purge des anciennes). Sans effet si rien n'a changé. */
  commit(): void {
    if (!this.dirty) return
    const now = this.journal.nowMs()
    const kept = Object.entries(this.entries)
      .filter(([, e]) => now - e.at <= IDEMPOTENCY_RETENTION_MS)
      .sort(([, a], [, b]) => b.at - a.at)
    const out: Record<string, IdempotencyEntry> = {}
    let bytes = 0
    let count = 0
    for (const [key, e] of kept) {
      bytes += e.content.length + key.length + e.fingerprint.length
      if (count >= IDEMPOTENCY_MAX_ENTRIES || (count > 0 && bytes > IDEMPOTENCY_MAX_BYTES)) break
      out[key] = e
      count++
    }
    this.journal.writeLedgerFile(out)
    this.dirty = false
  }
}
