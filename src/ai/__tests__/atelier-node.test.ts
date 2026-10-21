import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createDemoData } from '@/fixtures/demo'
import {
  ACTION_ID,
  buildManifest,
  canonicalJson,
  inputFingerprint,
  MANIFEST_TOOLS,
  MemoryLedger,
  NODE_CONTRACT,
  selectEvents,
  type NodeEvent,
} from '../atelier-node'
import { createHeadlessSession, type HeadlessOptions, type HeadlessSession } from '../headless'
import { IDEMPOTENT_TOOLS, runTool, toolSchemas, TOOLS } from '../tools'

let session: HeadlessSession | null = null
function open(options: HeadlessOptions = { caller: 'mcp' }) {
  session = createHeadlessSession(createDemoData(), async () => '/exports/x', options)
  return session
}
afterEach(() => session?.dispose())

async function call(name: string, args: unknown = {}) {
  const res = await runTool(name, args, session!.host)
  return { ...res, json: res.ok ? JSON.parse(res.content) : undefined }
}

describe('manifeste (SUITE.md §7.1)', () => {
  const manifest = buildManifest(toolSchemas())

  it('forme générale : contrat, app, un seul transport', () => {
    expect(manifest).toMatchObject({
      contract: NODE_CONTRACT,
      app: 'tab',
      name: 'Atelier Tab',
      transport: 'mcp',
    })
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    // Ni secret ni donnée utilisateur : aucun nom de la démonstration.
    expect(JSON.stringify(manifest)).not.toMatch(/Planning|Rénovation|Marie/)
  })

  it('id uniques au motif du contrat, un seul transport par action, outils existants', () => {
    const ids = manifest.actions.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    const names = new Set(TOOLS.map((t) => t.name))
    for (const action of manifest.actions) {
      expect(action.id).toMatch(ACTION_ID)
      expect(action.http).toBeNull()
      expect(typeof action.mcp_tool).toBe('string')
      expect(names.has(action.mcp_tool)).toBe(true)
      expect(['read', 'write', 'destructive']).toContain(action.kind)
      expect(['header', 'field', 'natural', 'none']).toContain(action.idempotency)
      expect(['json', 'atelier-table/1']).toContain(action.output.format)
    }
    for (const tool of MANIFEST_TOOLS) expect(names.has(tool)).toBe(true)
  })

  it('liste exacte des actions', () => {
    expect(
      manifest.actions.map((a) => [a.id, a.kind, a.mcp_tool, a.output.format, a.idempotency]),
    ).toEqual([
      ['tables.list', 'read', 'list_tables', 'json', 'natural'],
      ['tables.query', 'read', 'query_table', 'atelier-table/1', 'natural'],
      ['tables.create', 'write', 'create_table', 'json', 'field'],
      ['rows.add', 'write', 'add_rows', 'json', 'field'],
      ['cells.set', 'write', 'set_cells', 'json', 'natural'],
      ['rows.delete', 'destructive', 'delete_rows', 'json', 'none'],
      ['columns.add', 'write', 'add_column', 'json', 'field'],
      ['columns.update', 'write', 'update_column', 'json', 'natural'],
      ['formula.evaluate', 'read', 'evaluate', 'json', 'natural'],
      ['export.to_projets', 'write', 'export_table', 'json', 'natural'],
    ])
  })

  it('input_schema = schéma réel de l’outil (snake_case), valide en JSON Schema', () => {
    const schemas = new Map(toolSchemas().map((s) => [s.name, s.parameters]))
    for (const action of manifest.actions) {
      // Le schéma doit être lisible comme JSON Schema (draft 2020-12).
      expect(() => z.fromJSONSchema(action.input_schema as never)).not.toThrow()
      expect(() => z.fromJSONSchema(action.output.schema as never)).not.toThrow()
      const props = Object.keys((action.input_schema.properties as object) ?? {})
      for (const p of props) expect(p).toMatch(/^[a-z][a-z0-9_]*$/)
      if (action.id !== 'export.to_projets') {
        expect(action.input_schema).toEqual(schemas.get(action.mcp_tool))
      }
    }
    const add = manifest.actions.find((a) => a.id === 'rows.add')!
    expect(add.input_schema).toMatchObject({
      required: ['table', 'rows'],
      properties: { idempotency_key: { type: 'string', maxLength: 200 } },
    })
    const exp = manifest.actions.find((a) => a.id === 'export.to_projets')!
    expect(exp.input_schema.properties).toMatchObject({ format: { const: 'webhook' } })
    expect(exp.input_schema.properties).not.toHaveProperty('path')
  })

  it('les actions « field » sont exactement les outils qui acceptent idempotency_key', () => {
    const field = manifest.actions.filter((a) => a.idempotency === 'field').map((a) => a.mcp_tool)
    expect([...field].sort()).toEqual([...IDEMPOTENT_TOOLS].sort())
    expect(IDEMPOTENT_TOOLS).toEqual(expect.arrayContaining(['add_rows', 'create_table']))
  })

  it('événements déclarés avec data_schema', () => {
    expect(manifest.events.map((e) => e.type)).toEqual(['tab.table.changed', 'tab.table.deleted'])
    for (const e of manifest.events) expect(e.data_schema).toMatchObject({ type: 'object' })
    expect(manifest.events[0]?.data_schema).toMatchObject({
      required: ['revision', 'rows', 'project'],
    })
  })

  it('atelier_manifest renvoie le même manifeste, sans confirmation', async () => {
    open({ caller: 'assistant' }) // pas de `confirm` : une confirmation serait refusée
    const { ok, json } = await call('atelier_manifest')
    expect(ok).toBe(true)
    expect(json).toEqual(JSON.parse(JSON.stringify(buildManifest(toolSchemas()))))
  })
})

describe('atelier_events', () => {
  const ev = (seq: number, type = 'tab.table.changed'): NodeEvent => ({
    seq,
    type,
    at: '2026-10-21T10:00:00+02:00',
    subject: { kind: 'table', id: `t${seq}` },
    data: {},
  })

  it('page au format §7.3 : since exclusif, next, oldest, gap', () => {
    const all = [3, 4, 5, 6].map((n) => ev(n))
    expect(selectEvents(all, {})).toMatchObject({ next: 6, oldest: 3 })
    expect(selectEvents(all, { limit: 2 }).events.map((e) => e.seq)).toEqual([5, 6])
    expect(selectEvents(all, { since: 4 }).events.map((e) => e.seq)).toEqual([5, 6])
    expect(selectEvents(all, { since: 6 })).toEqual({ events: [], next: 6, oldest: 3 })
    expect(selectEvents(all, { since: 2 })).not.toHaveProperty('gap')
    expect(selectEvents(all, { since: 1 })).toMatchObject({ gap: true })
    // Journal remis à zéro ou remplacé : since au-delà du dernier seq connu.
    expect(selectEvents(all, { since: 7 })).toMatchObject({ events: [], gap: true })
    expect(selectEvents([], { since: 0 }, 0)).not.toHaveProperty('gap')
    expect(selectEvents([], {}, 9)).toEqual({ events: [], next: 9, oldest: 10 })
    const typed = selectEvents([ev(1), ev(2, 'tab.table.deleted')], {
      types: ['tab.table.deleted'],
    })
    expect(typed.events.map((e) => e.seq)).toEqual([2])
  })

  it('outil : lu par l’hôte ; sans journal (navigateur), erreur claire', async () => {
    open()
    const res = await call('atelier_events', { since: 0 })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('UNAVAILABLE')
    session!.dispose()
    open({ caller: 'assistant', readEvents: (q) => selectEvents([ev(1), ev(2)], q) })
    const ok = await call('atelier_events', { since: 1 })
    expect(ok.json).toEqual({ events: [ev(2)], next: 2, oldest: 1 })
    expect((await call('atelier_events', { limit: 501 })).code).toBe('VALIDATION')
  })
})

describe('query_table', () => {
  it('valeurs calculées au format atelier-table/1', async () => {
    open()
    const { json } = await call('query_table', { table: 'Planning & Lots' })
    expect(json).toMatchObject({ format: 'atelier-table/1', name: 'tbl_planning_lots', total: 3 })
    expect(json.rows.map((r: { cout_ttc: number }) => r.cout_ttc)).toEqual([54000, 34200, 18000])
  })

  it('suit une modification (formule recalculée)', async () => {
    open()
    await call('set_cells', {
      table: 'Planning & Lots',
      cells: [{ row: 1, column: 'C', value: '50 000' }],
    })
    const { json } = await call('query_table', {
      table: 'tbl_planning_lots',
      columns: ['C', 'Coût TTC'],
      filters: [{ column: 'cout_ht', op: 'gte', value: 50000 }],
    })
    expect(json.rows).toEqual([{ _ligne: 1, _id: 'rec_01', cout_ht: 50000, cout_ttc: 60000 }])
  })

  it('filtres sur statut, vide, case à cocher ; pagination bornée à 1000', async () => {
    open()
    const status = await call('query_table', {
      table: 'Planning & Lots',
      filters: [{ column: 'Statut', op: 'eq', value: 'en cours' }],
    })
    expect(status.json.rows.map((r: { _id: string }) => r._id)).toEqual(['rec_01'])
    const ordered = await call('query_table', {
      table: 'Matériaux',
      filters: [{ column: 'Commandé', op: 'eq', value: true }],
      columns: ['commande'],
    })
    expect(ordered.json.rows.every((r: { commande: boolean }) => r.commande === true)).toBe(true)
    const empty = await call('query_table', {
      table: 'Planning & Lots',
      filters: [{ column: 'Responsable', op: 'empty' }],
    })
    expect(empty.json.total).toBe(0)
    const page = await call('query_table', { table: 'Planning & Lots', offset: 2, limit: 1 })
    // `rows` ne contient pas tout (§7.2) : truncated, total = nombre complet.
    expect(page.json).toMatchObject({ total: 3, truncated: true })
    expect(page.json.rows.map((r: { _id: string }) => r._id)).toEqual(['rec_03'])
    const all = await call('query_table', { table: 'Planning & Lots', limit: 3 })
    expect(all.json).toMatchObject({ total: 3, truncated: false })
    expect((await call('query_table', { table: 'Planning & Lots', limit: 1001 })).code).toBe(
      'VALIDATION',
    )
  })

  it('erreurs lisibles : colonne inconnue, valeur incompatible', async () => {
    open()
    const unknown = await call('query_table', {
      table: 'Planning & Lots',
      filters: [{ column: 'Prix', op: 'eq', value: 1 }],
    })
    expect(unknown).toMatchObject({ ok: false, code: 'VALIDATION' })
    expect(unknown.content).toMatch(/cout_ht \(C, « Coût HT »\)/)
    const bad = await call('query_table', {
      table: 'Planning & Lots',
      filters: [{ column: 'C', op: 'gt', value: 'beaucoup' }],
    })
    expect(bad).toMatchObject({ ok: false, code: 'VALIDATION' })
  })

  it('lecture seule : aucune confirmation demandée à l’assistant', async () => {
    open({ caller: 'assistant' })
    expect((await call('query_table', { table: 'Matériaux' })).ok).toBe(true)
  })
})

describe('idempotence (SUITE.md §7.4)', () => {
  it('empreinte canonique : ordre des clés indifférent', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}')
    expect(inputFingerprint('add_rows', { a: 1, b: 2 })).toBe(
      inputFingerprint('add_rows', { b: 2, a: 1 }),
    )
    expect(inputFingerprint('add_rows', { a: 1 })).not.toBe(
      inputFingerprint('create_table', { a: 1 }),
    )
  })

  it('add_rows : même clé + même entrée → même réponse, sans nouvelle ligne', async () => {
    open()
    const args = {
      table: 'Planning & Lots',
      rows: [{ 'Lot / Tâche': 'Menuiseries', 'Coût HT': '12 000' }],
      idempotency_key: 'nexus:run-1:step-2',
    }
    const first = await call('add_rows', args)
    const again = await call('add_rows', {
      ...args,
      rows: [{ 'Coût HT': '12 000', 'Lot / Tâche': 'Menuiseries' }],
    })
    expect(again.ok).toBe(true)
    expect(again.replayed).toBe(true)
    expect(again.content).toBe(first.content)
    expect(session!.host.store.getState().tables.tbl_planning_lots!.rowOrder).toHaveLength(5)
  })

  it('même clé + autre entrée → IDEMPOTENCY_KEY_REUSED, rien n’est fait', async () => {
    open()
    const key = 'nexus:run-1:step-3'
    await call('add_rows', { table: 'Matériaux', rows: [{ A: 'Plâtre' }], idempotency_key: key })
    const other = await call('add_rows', {
      table: 'Matériaux',
      rows: [{ A: 'Ciment' }],
      idempotency_key: key,
    })
    expect(other).toMatchObject({ ok: false, code: 'IDEMPOTENCY_KEY_REUSED' })
    const names = await call('query_table', { table: 'Matériaux', columns: ['A'] })
    expect(names.json.rows.map((r: { materiau: string }) => r.materiau)).not.toContain('Ciment')
    // Même clé sur un autre outil : refusée aussi.
    const create = await call('create_table', {
      project: 'Rénovation Urbaine 2026',
      name: 'Doublon',
      idempotency_key: key,
    })
    expect(create.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('create_table : une seule table créée pour une clé rejouée ; sans clé, deux', async () => {
    open()
    const args = { project: 'Rénovation Urbaine 2026', name: 'Suivi', idempotency_key: 'k-1' }
    const a = await call('create_table', args)
    const b = await call('create_table', args)
    expect(b.json.table_id).toBe(a.json.table_id)
    const count = () =>
      Object.values(session!.host.store.getState().tables).filter((t) => t.name === 'Suivi').length
    expect(count()).toBe(1)
    await call('create_table', { project: 'Rénovation Urbaine 2026', name: 'Suivi' })
    await call('create_table', { project: 'Rénovation Urbaine 2026', name: 'Suivi' })
    expect(count()).toBe(3)
  })

  it('un échec n’enregistre pas la clé ; registre en mémoire avec rétention de 30 jours', async () => {
    open()
    const bad = await call('add_rows', {
      table: 'Planning & Lots',
      rows: [{ Statut: 'Inconnu' }],
      idempotency_key: 'k-2',
    })
    expect(bad.ok).toBe(false)
    const good = await call('add_rows', {
      table: 'Planning & Lots',
      rows: [{ Statut: 'En cours' }],
      idempotency_key: 'k-2',
    })
    expect(good.ok).toBe(true)

    let now = 0
    const ledger = new MemoryLedger(() => now)
    ledger.put('k', { fingerprint: 'f', content: '{}' })
    now = 29 * 24 * 3600 * 1000
    expect(ledger.get('k')).toBeDefined()
    now = 31 * 24 * 3600 * 1000
    expect(ledger.get('k')).toBeUndefined()
  })

  it('refuse une clé vide ou trop longue', async () => {
    open()
    for (const key of ['', 'x'.repeat(201)]) {
      const res = await call('add_rows', {
        table: 'Matériaux',
        rows: [{ A: 'x' }],
        idempotency_key: key,
      })
      expect(res.code).toBe('VALIDATION')
    }
  })
})
