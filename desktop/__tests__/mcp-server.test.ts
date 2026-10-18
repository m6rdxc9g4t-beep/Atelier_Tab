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
  new FileStore({ dir }).save(createDemoData())
  client = new Client({ name: 'test', version: '1.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [server],
      env: {
        ...process.env,
        ATELIER_TAB_DATA: dir,
        ATELIER_TAB_SECRETS: `${dir}-secrets.json`,
      } as Record<string, string>,
    }),
  )
}, 60_000)

afterAll(async () => {
  await client?.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('serveur MCP', () => {
  it('se présente avec des instructions et 14 outils', async () => {
    expect(client.getServerVersion()?.name).toBe('atelier-tab')
    expect(client.getInstructions()).toMatch(/list_tables puis read_table/)
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(14)
    expect(tools.find((t) => t.name === 'set_cells')?.inputSchema.required).toEqual([
      'table',
      'cells',
    ])
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
})
