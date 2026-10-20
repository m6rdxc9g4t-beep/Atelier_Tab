import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { produce } from 'immer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import type { AppData } from '@/types/domain'
import {
  DATA_DIR_GUIDE,
  defaultPreferencesFile,
  defaultSecretsFile,
  ensureDataDirGuide,
  FileStore,
  readPreferencesFile,
  writePreferencesFile,
} from '../file-store'

let dir: string
let secrets: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-'))
  secrets = path.join(dir, '..', `${path.basename(dir)}-secrets.json`)
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(secrets, { force: true })
})

const store = () => new FileStore({ dir, secretsFile: secrets })
const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8')
const write = (rel: string, text: string) => fs.writeFileSync(path.join(dir, rel), text)
const edit = (data: AppData, fn: (d: AppData) => void) => produce(data, fn)

describe('FileStore', () => {
  it('dossier vide : pas de données', () => {
    expect(store().load()).toEqual({ data: null, errors: [] })
  })

  it('écrit puis relit les données, jeton à part', () => {
    const data = edit(createDemoData(), (d) => {
      d.integrations.atelierProjets.token = 'jeton'
    })
    expect(store().save(data)).toHaveLength(5)
    expect(fs.readdirSync(path.join(dir, 'tables'))).toHaveLength(4)
    expect(read('atelier.json')).not.toContain('jeton')
    expect(JSON.parse(fs.readFileSync(secrets, 'utf8'))).toEqual({
      atelierProjets: { token: 'jeton' },
    })
    if (process.platform !== 'win32') expect(fs.statSync(secrets).mode & 0o777).toBe(0o600)

    const { data: loaded, errors } = store().load()
    expect(errors).toEqual([])
    expect(loaded).toEqual(data)
  })

  it('n’écrit que les fichiers modifiés et supprime les tables supprimées', () => {
    const s = store()
    const data = createDemoData()
    s.save(data)
    const next = edit(data, (d) => {
      d.tables.tbl_planning_lots!.records.rec_01!.cells.cost_ht = 50000
    })
    expect(s.save(next)).toEqual(['tables/tbl_planning_lots.json'])
    expect(s.save(next)).toEqual([])

    const without = edit(next, (d) => {
      delete d.tables.tbl_materiaux
      d.projects.proj_chiffrage_materiaux!.tableIds = []
    })
    expect(s.save(without).sort()).toEqual(['atelier.json', 'tables/tbl_materiaux.json'])
    expect(fs.existsSync(path.join(dir, 'tables/tbl_materiaux.json'))).toBe(false)
  })

  it('relit une modification faite par un autre programme', () => {
    const s = store()
    s.save(createDemoData())
    expect(s.isExternalChange('tables/tbl_planning_lots.json')).toBe(false)
    const t = JSON.parse(read('tables/tbl_planning_lots.json'))
    t.records.rec_01.cells.cost_ht = 60000
    write('tables/tbl_planning_lots.json', JSON.stringify(t))
    expect(s.isExternalChange('tables/tbl_planning_lots.json')).toBe(true)
    expect(s.load().data?.tables.tbl_planning_lots?.records.rec_01?.cells.cost_ht).toBe(60000)
    expect(s.isExternalChange('tables/tbl_planning_lots.json')).toBe(false)
  })

  it('garde la dernière version valide d’un fichier cassé sans l’écraser', () => {
    const s = store()
    const data = createDemoData()
    s.save(data)
    s.load()
    write('tables/tbl_materiaux.json', '{ "id": "tbl_materiaux", ')

    const { data: loaded, errors } = s.load()
    expect(errors[0]).toMatch(/^tables\/tbl_materiaux\.json : JSON invalide/)
    expect(loaded?.tables.tbl_materiaux?.name).toBe('Matériaux')

    // L'app modifie une autre table : le fichier cassé n'est pas touché.
    const other = edit(loaded!, (d) => {
      d.tables.tbl_planning_lots!.name = 'Planning'
    })
    expect(s.save(other)).toEqual(['tables/tbl_planning_lots.json'])
    expect(read('tables/tbl_materiaux.json')).toBe('{ "id": "tbl_materiaux", ')

    // L'app modifie la table cassée elle-même : sa version gagne.
    const fixed = edit(other, (d) => {
      d.tables.tbl_materiaux!.name = 'Matériaux v2'
    })
    expect(s.save(fixed)).toEqual(['tables/tbl_materiaux.json'])
    expect(JSON.parse(read('tables/tbl_materiaux.json')).name).toBe('Matériaux v2')
  })

  it('prend en compte une table supprimée ou ajoutée à la main', () => {
    const s = store()
    s.save(createDemoData())
    s.load()
    fs.rmSync(path.join(dir, 'tables/tbl_calculs_surfaces.json'))
    const extra = { ...JSON.parse(read('tables/tbl_materiaux.json')), id: 'tbl_ia', name: 'Par IA' }
    write('tables/tbl_ia.json', JSON.stringify(extra))

    const { data } = s.load()
    expect(data?.projects.proj_renovation_2026?.tableIds).toEqual([
      'tbl_budget_global',
      'tbl_planning_lots',
    ])
    expect(data?.projects.proj_chiffrage_materiaux?.tableIds).toEqual(['tbl_materiaux', 'tbl_ia'])
  })

  it('surveille le dossier et ignore ses propres écritures', async () => {
    const s = store()
    s.save(createDemoData())
    s.load()
    const changes: AppData[] = []
    const stop = s.watch(
      (d) => changes.push(d),
      () => {},
    )
    try {
      s.save(
        edit(createDemoData(), (d) => {
          d.tables.tbl_materiaux!.name = 'Interne'
        }),
      )
      await new Promise((r) => setTimeout(r, 400))
      expect(changes).toHaveLength(0)

      const t = JSON.parse(read('tables/tbl_materiaux.json'))
      t.name = 'Externe'
      write('tables/tbl_materiaux.json', JSON.stringify(t))
      await new Promise((r) => setTimeout(r, 600))
      expect(changes.at(-1)?.tables.tbl_materiaux?.name).toBe('Externe')
    } finally {
      stop()
    }
  })
})

describe('mode « En ligne » hors du dossier de données (SUITE.md §5.1)', () => {
  const prefsFile = () => path.join(dir, '..', `${path.basename(dir)}-config`, 'preferences.json')
  afterEach(() => fs.rmSync(path.dirname(prefsFile()), { recursive: true, force: true }))

  it('à côté du fichier de secrets, hors du dossier de données', () => {
    const saved = { ...process.env }
    try {
      process.env.ATELIER_TAB_SECRETS = '/conf/Atelier_Tab/secrets.json'
      expect(defaultPreferencesFile()).toBe('/conf/Atelier_Tab/preferences.json')
      delete process.env.ATELIER_TAB_SECRETS
      expect(path.dirname(defaultPreferencesFile())).toBe(path.dirname(defaultSecretsFile()))
      expect(defaultPreferencesFile().startsWith(path.join(os.homedir(), 'Atelier_Tab'))).toBe(
        false,
      )
    } finally {
      process.env = saved
    }
  })

  it('lu par le FileStore, jamais écrit par lui ; atelier.json ne le contient plus', () => {
    const file = prefsFile()
    const withPrefs = () => new FileStore({ dir, secretsFile: secrets, preferencesFile: file })
    const data = edit(createDemoData(), (d) => {
      d.preferences = { onlineMode: true }
    })
    withPrefs().save(data)
    expect(JSON.parse(read('atelier.json'))).not.toHaveProperty('preferences')
    expect(fs.existsSync(file)).toBe(false)
    expect(withPrefs().load().data?.preferences).toEqual({ onlineMode: false })

    // Seul le processus principal l'écrit (action de l'utilisateur), en 0600.
    writePreferencesFile(file, { onlineMode: true })
    expect(withPrefs().load().data?.preferences).toEqual({ onlineMode: true })
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(readPreferencesFile(file)).toEqual({ onlineMode: true })
    expect(readPreferencesFile(undefined)).toEqual({ onlineMode: false })
    expect(readPreferencesFile(path.join(dir, 'absent.json'))).toEqual({ onlineMode: false })
  })

  it('migration : un ancien réglage d’atelier.json est ignoré, l’app repart hors ligne', () => {
    store().save(createDemoData())
    const index = JSON.parse(read('atelier.json'))
    write('atelier.json', JSON.stringify({ ...index, preferences: { onlineMode: true } }))
    const loaded = new FileStore({ dir, secretsFile: secrets, preferencesFile: prefsFile() }).load()
    expect(loaded.errors).toEqual([])
    expect(loaded.data?.preferences).toEqual({ onlineMode: false })
  })
})

describe('guide du dossier', () => {
  it('écrit le CLAUDE.md sans jamais remplacer celui de l’utilisateur', () => {
    ensureDataDirGuide(dir)
    expect(read('CLAUDE.md')).toBe(DATA_DIR_GUIDE)
    write('CLAUDE.md', '# Mes notes\n')
    ensureDataDirGuide(dir)
    expect(read('CLAUDE.md')).toBe('# Mes notes\n')
  })
})
