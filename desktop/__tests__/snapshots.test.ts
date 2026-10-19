import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { produce } from 'immer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import type { AppData } from '@/types/domain'
import { FileStore } from '../file-store'
import { SnapshotWriter } from '../snapshots'

let dir: string
let clock: number
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-snap-'))
  clock = Date.parse('2026-10-19T08:00:00Z')
})
afterEach(() => {
  vi.useRealTimers()
  fs.rmSync(dir, { recursive: true, force: true })
})

const writer = (debounceMs = 1000) =>
  new SnapshotWriter({ dir, debounceMs, now: () => new Date((clock += 60_000)) })
const exportsDir = () => path.join(dir, 'exports')
const list = () => fs.readdirSync(exportsDir()).sort()
const readJson = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(exportsDir(), name), 'utf8'))
const edit = (data: AppData, fn: (d: AppData) => void) => produce(data, fn)

describe('instantanés pour Atelier Viz', () => {
  it('écrit un instantané par table, sans fichier temporaire', () => {
    const changed = writer().update(createDemoData())
    expect(changed.sort()).toEqual([
      'exports/tbl_budget_global.json',
      'exports/tbl_calculs_surfaces.json',
      'exports/tbl_materiaux.json',
      'exports/tbl_planning_lots.json',
    ])
    expect(list()).toEqual([
      'tbl_budget_global.json',
      'tbl_calculs_surfaces.json',
      'tbl_materiaux.json',
      'tbl_planning_lots.json',
    ])
    const planning = readJson('tbl_planning_lots.json')
    expect(planning).toMatchObject({
      target_system: 'atelier_projets',
      schema_version: '2.1.0',
      project: { source_table: { id: 'tbl_planning_lots' } },
    })
    expect(planning.project.records[0].values.D.computed).toBe(54000)
  })

  it('ne réécrit que les tables modifiées', () => {
    const w = writer()
    const data = createDemoData()
    w.update(data)
    const before = readJson('tbl_materiaux.json').exported_at
    expect(w.update(data)).toEqual([])
    const next = edit(data, (d) => {
      d.tables.tbl_planning_lots!.records.rec_01!.cells.cost_ht = 50000
    })
    expect(w.update(next)).toEqual(['exports/tbl_planning_lots.json'])
    expect(readJson('tbl_planning_lots.json').project.records[0].values.D.computed).toBe(60000)
    expect(readJson('tbl_materiaux.json').exported_at).toBe(before)
  })

  it('suit le renommage du projet (contexte de la table)', () => {
    const w = writer()
    const data = createDemoData()
    w.update(data)
    const renamed = edit(data, (d) => {
      d.projects.proj_chiffrage_materiaux!.name = 'Chiffrage 2027'
    })
    expect(w.update(renamed)).toEqual(['exports/tbl_materiaux.json'])
    expect(readJson('tbl_materiaux.json').project.name).toBe('Chiffrage 2027')
  })

  it('publie une table sans colonne de titre', () => {
    const data = edit(createDemoData(), (d) => {
      delete d.tables.tbl_materiaux!.fields.mt_name!.atelierMapping
    })
    writer().update(data)
    const json = readJson('tbl_materiaux.json')
    expect(json.project.columns_schema[0].atelier_mapping).toBe('custom')
    expect(json.project.records).toHaveLength(3)
  })

  it('supprime l’instantané d’une table supprimée, jamais les exports manuels', () => {
    const w = writer()
    const data = createDemoData()
    w.update(data)
    fs.writeFileSync(path.join(exportsDir(), 'atelier_projets_materiaux_2026-10-19.json'), '{}')
    const without = edit(data, (d) => {
      delete d.tables.tbl_materiaux
      d.projects.proj_chiffrage_materiaux!.tableIds = []
    })
    expect(w.update(without)).toEqual(['exports/tbl_materiaux.json'])
    expect(list()).toEqual([
      'atelier_projets_materiaux_2026-10-19.json',
      'tbl_budget_global.json',
      'tbl_calculs_surfaces.json',
      'tbl_planning_lots.json',
    ])
  })

  it('au démarrage, reprend les instantanés à jour et retire ceux des tables disparues', () => {
    const data = createDemoData()
    writer().update(data)
    const stamp = readJson('tbl_planning_lots.json').exported_at
    // Table supprimée pendant que l'app était fermée (son fichier tables/ n'existe plus).
    const without = edit(data, (d) => {
      delete d.tables.tbl_materiaux
      d.projects.proj_chiffrage_materiaux!.tableIds = []
    })
    const fresh = writer()
    expect(fresh.update(without)).toEqual(['exports/tbl_materiaux.json'])
    expect(readJson('tbl_planning_lots.json').exported_at).toBe(stamp)
  })

  it('garde l’instantané d’une table momentanément illisible', () => {
    const data = createDemoData()
    new FileStore({ dir }).save(data)
    writer().update(data)
    const unreadable = edit(data, (d) => {
      delete d.tables.tbl_materiaux
    })
    // Le fichier tables/tbl_materiaux.json existe encore : rien n'est supprimé.
    expect(writer().update(unreadable)).toEqual([])
    expect(list()).toContain('tbl_materiaux.json')
  })

  it('regroupe les enregistrements rapprochés (débounce)', () => {
    vi.useFakeTimers()
    const w = writer(500)
    const data = createDemoData()
    w.schedule(data)
    w.schedule(
      edit(data, (d) => {
        d.tables.tbl_planning_lots!.records.rec_01!.cells.cost_ht = 1000
      }),
    )
    expect(fs.existsSync(exportsDir())).toBe(false)
    vi.advanceTimersByTime(499)
    expect(fs.existsSync(exportsDir())).toBe(false)
    vi.advanceTimersByTime(1)
    expect(list()).toHaveLength(4)
    expect(readJson('tbl_planning_lots.json').project.records[0].values.C.computed).toBe(1000)
  })

  it('flush écrit tout de suite l’état en attente', () => {
    vi.useFakeTimers()
    const w = writer(10_000)
    w.schedule(createDemoData())
    expect(w.flush()).toHaveLength(4)
    expect(w.flush()).toEqual([])
    w.dispose()
  })
})
