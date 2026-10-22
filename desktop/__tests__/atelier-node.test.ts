import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { produce } from 'immer'
import { build } from 'rolldown'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildManifest, EVENTS_RETENTION } from '@/ai/atelier-node'
import { toolSchemas } from '@/ai/tools'
import { createDemoData } from '@/fixtures/demo'
import type { AppData } from '@/types/domain'
import {
  EVENTS_FILE,
  IDEMPOTENCY_FILE,
  LOCK_FILE,
  MANIFEST_FILE,
  NODE_INDEX_FILE,
  NodeJournal,
  NodeLockError,
  parseEventsQuery,
} from '../atelier-node'
import { FileStore } from '../file-store'
import { SnapshotWriter } from '../snapshots'

const root = path.resolve(import.meta.dirname, '..', '..')
let dir: string
let clock: number
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-node-'))
  clock = Date.parse('2026-10-21T08:00:00Z')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const now = () => new Date((clock += 1000))
const nodeDir = () => path.join(dir, 'exports', '_atelier')
const readNode = (name: string) => fs.readFileSync(path.join(nodeDir(), name), 'utf8')
const index = () => JSON.parse(readNode(NODE_INDEX_FILE))
const events = () =>
  readNode(EVENTS_FILE)
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
const edit = (data: AppData, fn: (d: AppData) => void) => produce(data, fn)
const journal = (options: Partial<ConstructorParameters<typeof NodeJournal>[0]> = {}) =>
  new NodeJournal({ dataDir: dir, now, ...options })
const writer = (j = journal()) => new SnapshotWriter({ dir, journal: j, now, debounceMs: 10 })
const revisionOf = (tableId: string) =>
  index().tables.find((t: { table_id: string }) => t.table_id === tableId)?.revision

describe('index.json et events.jsonl (SUITE.md §7.3)', () => {
  it('index au format du contrat, un événement tab.table.changed par table publiée', () => {
    writer().update(createDemoData())
    const idx = index()
    expect(idx.contract).toBe('atelier-node/1')
    expect(idx.tables.map((t: { table_id: string }) => t.table_id)).toEqual([
      'tbl_budget_global',
      'tbl_calculs_surfaces',
      'tbl_materiaux',
      'tbl_planning_lots',
    ])
    const planning = idx.tables.find(
      (t: { table_id: string }) => t.table_id === 'tbl_planning_lots',
    )
    expect(planning).toEqual({
      table_id: 'tbl_planning_lots',
      name: 'Planning & Lots',
      project: 'Rénovation Urbaine 2026',
      workspace: 'Espace Architecture',
      revision: 1,
      rows: 3,
      updated_at: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/),
    })
    const evs = events()
    expect(evs.map((e: { seq: number }) => e.seq)).toEqual([1, 2, 3, 4])
    expect(
      evs.find((e: { subject: { id: string } }) => e.subject.id === 'tbl_planning_lots'),
    ).toEqual({
      seq: expect.any(Number),
      type: 'tab.table.changed',
      at: planning.updated_at,
      subject: { kind: 'table', id: 'tbl_planning_lots', label: 'Planning & Lots' },
      data: { revision: 1, rows: 3, project: 'Rénovation Urbaine 2026' },
    })
  })

  it('la révision n’augmente que sur un vrai changement de contenu', () => {
    const w = writer()
    const data = createDemoData()
    w.update(data)
    // Même contenu, autre horodatage : rien.
    w.update(edit(data, (d) => void (d.tables.tbl_planning_lots!.views[0]!.name = 'Vue')))
    expect(revisionOf('tbl_planning_lots')).toBe(1)
    expect(events()).toHaveLength(4)
    // Un nouvel écrivain (redémarrage) qui republie le même contenu : rien non plus.
    writer().update(data)
    expect(revisionOf('tbl_planning_lots')).toBe(1)
    expect(events()).toHaveLength(4)
    // Vrai changement : +1 et un événement, pour cette table seulement.
    w.update(
      edit(data, (d) => void (d.tables.tbl_planning_lots!.records.rec_01!.cells.cost_ht = 1)),
    )
    expect(revisionOf('tbl_planning_lots')).toBe(2)
    expect(revisionOf('tbl_materiaux')).toBe(1)
    expect(events().at(-1)).toMatchObject({
      seq: 5,
      type: 'tab.table.changed',
      data: { revision: 2, rows: 3 },
    })
  })

  it('la révision ne recule jamais, même si index.json est effacé ou abîmé', () => {
    const w = writer()
    const data = createDemoData()
    w.update(data)
    const changed = edit(data, (d) => void (d.tables.tbl_materiaux!.name = 'Matériaux 2027'))
    w.update(changed)
    expect(revisionOf('tbl_materiaux')).toBe(2)
    fs.writeFileSync(path.join(nodeDir(), NODE_INDEX_FILE), '{ cassé')
    writer().update(changed)
    expect(revisionOf('tbl_materiaux')).toBe(2)
    expect(index().tables).toHaveLength(4)
    writer().update(edit(changed, (d) => void (d.tables.tbl_materiaux!.name = 'Matériaux 2028')))
    expect(revisionOf('tbl_materiaux')).toBe(3)
  })

  it('tab.table.deleted à la suppression ; seq persistant, jamais réutilisé', () => {
    const data = createDemoData()
    writer().update(data)
    const without = edit(data, (d) => {
      delete d.tables.tbl_materiaux
      d.projects.proj_chiffrage_materiaux!.tableIds = []
    })
    // Nouvel écrivain (redémarrage de l'app) : seq repris du disque.
    writer().update(without)
    expect(events().at(-1)).toEqual({
      seq: 5,
      type: 'tab.table.deleted',
      at: expect.any(String),
      subject: { kind: 'table', id: 'tbl_materiaux', label: 'Matériaux' },
      data: {},
    })
    expect(revisionOf('tbl_materiaux')).toBeUndefined()
    // La table revient (même id) : sa révision continue au-delà de la précédente.
    writer().update(data)
    expect(revisionOf('tbl_materiaux')).toBe(2)
    expect(events().at(-1)).toMatchObject({ seq: 6, type: 'tab.table.changed' })
    // Même si events.jsonl est effacé, seq ne repart pas de 1.
    fs.rmSync(path.join(nodeDir(), EVENTS_FILE))
    writer().update(edit(data, (d) => void (d.tables.tbl_materiaux!.name = 'M')))
    expect(events()).toEqual([expect.objectContaining({ seq: 7 })])
  })

  it(`garde ${EVENTS_RETENTION} événements au plus ; atelier_events signale le trou`, () => {
    // Journal déjà rempli : 998 événements (seq 103 à 1100).
    fs.mkdirSync(nodeDir(), { recursive: true })
    const old = Array.from({ length: 998 }, (_, i) => ({
      seq: 103 + i,
      type: 'tab.table.changed',
      at: '2026-10-20T08:00:00+02:00',
      subject: { kind: 'table', id: 'tbl_ancienne', label: 'Ancienne' },
      data: { revision: i + 1, rows: 0, project: 'P' },
    }))
    fs.writeFileSync(
      path.join(nodeDir(), EVENTS_FILE),
      old.map((e) => JSON.stringify(e)).join('\n') + '\n',
    )
    fs.writeFileSync(
      path.join(nodeDir(), 'state.json'),
      JSON.stringify({ last_seq: 1100, tables: {} }),
    )
    const j = journal()
    writer(j).update(createDemoData()) // + 4 événements
    const evs = events()
    expect(evs).toHaveLength(EVENTS_RETENTION)
    expect(evs[0].seq).toBe(105)
    expect(evs.at(-1).seq).toBe(1104)
    const page = j.readEvents({ since: 50, limit: 2 })
    expect(page).toMatchObject({ gap: true, oldest: 105, next: 106 })
    expect(page.events.map((e) => e.seq)).toEqual([105, 106])
    expect(j.readEvents({ since: 104 })).not.toHaveProperty('gap')
    expect(j.readEvents({ since: 1104 })).toEqual({ events: [], next: 1104, oldest: 105 })
    expect(
      j
        .readEvents({})
        .events.map((e) => e.seq)
        .at(-1),
    ).toBe(1104)
    expect(j.readEvents({}).events).toHaveLength(100)
    // Une ligne abîmée est ignorée, sans casser la lecture.
    fs.appendFileSync(path.join(nodeDir(), EVENTS_FILE), '{ cassé\n')
    expect(j.readEvents({ since: 1103 }).events.map((e) => e.seq)).toEqual([1104])
  })

  it('requête d’événements venue de l’interface : seuls les champs attendus', () => {
    expect(parseEventsQuery({ since: 3, limit: 2, types: ['a', 1], other: 'x' })).toEqual({
      since: 3,
      limit: 2,
      types: ['a'],
    })
    expect(parseEventsQuery('n’importe quoi')).toEqual({})
    expect(parseEventsQuery({ since: -1, limit: 1.5 })).toEqual({})
  })
})

describe('instantanés et sous-dossier _atelier', () => {
  it('le nettoyage des instantanés ne touche jamais _atelier/', () => {
    const data = createDemoData()
    writer().update(data)
    const without = edit(data, (d) => {
      d.tables = {}
      for (const p of Object.values(d.projects)) p.tableIds = []
    })
    writer().update(without)
    expect(fs.readdirSync(path.join(dir, 'exports'))).toEqual(['_atelier'])
    expect(index().tables).toEqual([])
    expect(events().filter((e: { type: string }) => e.type === 'tab.table.deleted')).toHaveLength(4)
  })

  it('la surveillance du dossier ignore _atelier/ (aucune boucle)', async () => {
    const store = new FileStore({ dir })
    const data = createDemoData()
    store.save(data)
    store.load()
    const changes: AppData[] = []
    const stop = store.watch(
      (d) => changes.push(d),
      () => {},
    )
    try {
      const w = writer()
      w.update(data)
      w.update(
        edit(data, (d) => void (d.tables.tbl_planning_lots!.records.rec_01!.cells.cost_ht = 7)),
      )
      journal().writeManifest(buildManifest(toolSchemas()))
      await new Promise((r) => setTimeout(r, 400))
      expect(changes).toHaveLength(0)
    } finally {
      stop()
    }
  })
})

describe('manifest.json', () => {
  it('même contenu que l’outil atelier_manifest ; réécrit seulement s’il change', () => {
    const manifest = buildManifest(toolSchemas())
    const j = journal()
    j.writeManifest(manifest)
    expect(JSON.parse(readNode(MANIFEST_FILE))).toEqual(JSON.parse(JSON.stringify(manifest)))
    const file = path.join(nodeDir(), MANIFEST_FILE)
    const before = fs.statSync(file).ino
    j.writeManifest(manifest)
    expect(fs.statSync(file).ino).toBe(before)
    expect(fs.readdirSync(nodeDir()).filter((f) => f.endsWith('.tmp'))).toEqual([])
  })
})

describe('verrou inter-processus', () => {
  it('exclusif ; réentrant ; libéré après usage, même en cas d’erreur', () => {
    const a = journal({ lockTimeoutMs: 100 })
    const b = journal({ lockTimeoutMs: 100 })
    a.withLock(() => {
      expect(fs.existsSync(path.join(nodeDir(), LOCK_FILE))).toBe(true)
      expect(() => b.withLock(() => 1)).toThrow(NodeLockError)
      expect(a.withLock(() => 2)).toBe(2)
    })
    expect(fs.existsSync(path.join(nodeDir(), LOCK_FILE))).toBe(false)
    expect(() =>
      a.withLock(() => {
        throw new Error('boum')
      }),
    ).toThrow('boum')
    expect(b.withLock(() => 3)).toBe(3)
  })

  it('reprend un verrou périmé : processus disparu, ou trop ancien', () => {
    fs.mkdirSync(nodeDir(), { recursive: true })
    const lock = path.join(nodeDir(), LOCK_FILE)
    // Processus mort sur cette machine.
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: 2 ** 22 + 12345, host: os.hostname(), at: Date.now(), token: 'x' }),
    )
    expect(journal({ lockTimeoutMs: 1000 }).withLock(() => 'pris')).toBe('pris')
    // Verrou vivant mais trop ancien (autre machine, ou processus bloqué).
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, host: 'ailleurs', at: Date.now() - 60_000, token: 'y' }),
    )
    expect(journal({ lockTimeoutMs: 1000 }).withLock(() => 'repris')).toBe('repris')
    // Verrou récent d'un processus vivant : attendu, puis abandon.
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, host: 'ailleurs', at: Date.now(), token: 'z' }),
    )
    expect(() => journal({ lockTimeoutMs: 100 }).withLock(() => 0)).toThrow(NodeLockError)
    expect(JSON.parse(fs.readFileSync(lock, 'utf8')).token).toBe('z')
  })

  it('un verrou occupé n’empêche pas l’instantané : l’index est rattrapé ensuite', () => {
    const errors: unknown[] = []
    const slow = journal({ lockTimeoutMs: 50 })
    const w = new SnapshotWriter({ dir, journal: slow, now, onError: (e) => errors.push(e) })
    const holder = journal()
    const data = createDemoData()
    holder.withLock(() => {
      expect(w.update(data)).toHaveLength(4)
    })
    expect(errors[0]).toBeInstanceOf(NodeLockError)
    expect(fs.existsSync(path.join(nodeDir(), NODE_INDEX_FILE))).toBe(false)
    w.update(data) // rien de neuf, mais l'index en retard est rattrapé
    expect(index().tables).toHaveLength(4)
    expect(events()).toHaveLength(4)
  })
})

describe('idempotence sur disque', () => {
  it('registre partagé entre écrivains, rétention de 30 jours, taille bornée', () => {
    let t = Date.parse('2026-10-21T08:00:00Z')
    const j = journal({ now: () => new Date(t) })
    j.withLock(() => {
      const ledger = j.openLedger()
      ledger.put('nexus:1:1', { fingerprint: 'f', content: '{"ok":1}' })
      ledger.commit()
    })
    expect(journal().openLedger().get('nexus:1:1')).toMatchObject({ content: '{"ok":1}' })
    t += 31 * 24 * 3600 * 1000
    const later = journal({ now: () => new Date(t) })
    expect(later.openLedger().get('nexus:1:1')).toBeUndefined()
    const ledger = later.openLedger()
    for (let i = 0; i < 1200; i++) ledger.put(`k${i}`, { fingerprint: 'f', content: 'x' })
    ledger.commit()
    const stored = JSON.parse(readNode(IDEMPOTENCY_FILE)).entries
    expect(Object.keys(stored)).toHaveLength(1000)
    expect(stored).not.toHaveProperty('nexus:1:1')
  })
})

describe('concurrence : app de bureau + serveur MCP (deux processus)', () => {
  let script: string
  beforeAll(async () => {
    script = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-writer-')), 'node-writer.mjs')
    await build({
      input: path.join(root, 'desktop/__tests__/fixtures/node-writer.ts'),
      platform: 'node',
      resolve: { alias: { '@': path.join(root, 'src') } },
      transform: { define: { 'process.env.NODE_ENV': '"production"' } },
      logLevel: 'silent',
      output: { file: script, format: 'esm' },
    })
  }, 60_000)

  it('aucune révision, aucun seq ni aucune clé perdus ; rien de cassé', async () => {
    new FileStore({ dir }).save(createDemoData())
    const run = (role: string) =>
      promisify(execFile)(process.execPath, [script, dir, role, '25'], { timeout: 60_000 })
    const [app, mcp] = await Promise.all([run('app'), run('mcp')])
    expect(app.stdout).toBe('ok')
    expect(mcp.stdout).toBe('ok')

    // Données : les deux modifications sont là (chaque tour relit sous le verrou).
    const data = new FileStore({ dir }).load().data!
    expect(data.tables.tbl_planning_lots!.records.rec_01!.cells.cost_ht).toBe(25_000)
    expect(data.tables.tbl_planning_lots!.records.rec_02!.cells.cost_ht).toBe(25_000)

    // Événements : seq strictement croissants et sans trou ; révisions strictement croissantes.
    const evs = events()
    expect(evs.map((e: { seq: number }) => e.seq)).toEqual(
      evs.map((_: unknown, i: number) => i + 1),
    )
    const revisions = evs
      .filter((e: { subject: { id: string } }) => e.subject.id === 'tbl_planning_lots')
      .map((e: { data: { revision: number } }) => e.data.revision)
    expect(revisions).toEqual(revisions.map((_: unknown, i: number) => i + 1))
    expect(revisions.length).toBeGreaterThanOrEqual(25)
    expect(revisionOf('tbl_planning_lots')).toBe(revisions.at(-1))

    // Clés d'idempotence : les 50 enregistrées.
    expect(Object.keys(JSON.parse(readNode(IDEMPOTENCY_FILE)).entries)).toHaveLength(50)
    // Ni verrou ni fichier temporaire oubliés ; JSON valides.
    expect(fs.readdirSync(nodeDir()).sort()).toEqual([
      EVENTS_FILE,
      IDEMPOTENCY_FILE,
      NODE_INDEX_FILE,
      'state.json',
    ])
    expect(fs.readdirSync(path.join(dir, 'exports')).filter((f) => f.endsWith('.tmp'))).toEqual([])
  }, 90_000)
})
