import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { produce } from 'immer'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import { snapshotFile } from '@/dataflow/snapshot'
import { parseAppState, tableFile } from '@/storage/format'
import type { AppData, Table } from '@/types/domain'
import { FileStore, parseSaveRequest } from '../file-store'
import { isInside, resolveInside, UnsafePathError } from '../safe-path'
import { SnapshotWriter } from '../snapshots'

// I1 : un renderer compromis envoie un état dont une clé de table est un chemin.
const EVIL = '../../.config/x'

let root: string
let dir: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-traversal-'))
  dir = path.join(root, 'home', 'Atelier_Tab')
  fs.mkdirSync(dir, { recursive: true })
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

/** Tous les fichiers sous `root`, chemins relatifs. */
function allFiles(base = root): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(base, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(path.relative(root, path.join(entry.parentPath, entry.name)))
  }
  return out.sort()
}

function withEvilTable(data: AppData, id = EVIL): AppData {
  return produce(data, (d) => {
    const source = d.tables.tbl_materiaux as Table
    d.tables[id] = { ...(JSON.parse(JSON.stringify(source)) as Table), id }
    d.projects[source.projectId]?.tableIds.push(id)
  })
}

const saveRequest = (state: unknown) => JSON.stringify({ state, version: 1 })

describe('resolveInside', () => {
  it('accepte un chemin sous le dossier, refuse toute sortie', () => {
    expect(resolveInside(dir, 'tables/tbl_a.json')).toBe(path.join(dir, 'tables', 'tbl_a.json'))
    for (const bad of [EVIL, '../x.json', '/etc/passwd', '.', '', 'tables/../../x.json']) {
      expect(() => resolveInside(dir, bad), bad).toThrow(UnsafePathError)
    }
    expect(isInside(dir, path.join(dir, '..', 'Atelier_Tab2', 'x'))).toBe(false)
  })
})

describe('chemins dérivés des ids de table', () => {
  it('tableFile et snapshotFile refusent un id qui n’est pas un nom de fichier sûr', () => {
    expect(tableFile('tbl_a-1')).toBe('tables/tbl_a-1.json')
    expect(snapshotFile('tbl_a-1')).toBe('exports/tbl_a-1.json')
    for (const bad of [EVIL, '..', 'a/b', 'a\\b', 'a.b', '', '/abs']) {
      expect(() => tableFile(bad), bad).toThrow()
      expect(() => snapshotFile(bad), bad).toThrow()
    }
  })
})

describe('data:save : revalidation de l’état reçu de l’interface', () => {
  it('accepte l’état de l’app tel quel (jeton compris)', () => {
    const data = produce(createDemoData(), (d) => {
      d.integrations.atelierProjets.token = 'jeton'
      d.integrations.atelierProjets.webhookUrl = 'http://127.0.0.1:3000/api/imports/atelier-tab'
    })
    const state = parseSaveRequest(saveRequest(data))
    expect(state).toEqual(data)
    expect(parseSaveRequest(JSON.stringify({ version: 1 }))).toBeNull()
  })

  it('refuse une clé de table en forme de chemin, sans rien écrire', () => {
    const evil = withEvilTable(createDemoData())
    expect(() => parseSaveRequest(saveRequest(evil))).toThrow(/id de table refusé/)
    expect(allFiles()).toEqual([])
  })

  it('refuse une clé qui ne correspond pas à l’id de la table', () => {
    const data = produce(createDemoData(), (d) => {
      const t = d.tables.tbl_materiaux as Table
      d.tables.tbl_autre = JSON.parse(JSON.stringify(t)) as Table
    })
    expect(() => parseAppState(data)).toThrow(/id de table refusé/)
  })

  it('refuse un état qui ne respecte pas les schémas', () => {
    expect(() => parseSaveRequest('pas du json')).toThrow(/JSON invalide/)
    expect(() => parseSaveRequest(42)).toThrow(/message invalide/)
    expect(() => parseSaveRequest(saveRequest({ tables: 'x' }))).toThrow()
    const badField = produce(createDemoData(), (d) => {
      const f = Object.values((d.tables.tbl_materiaux as Table).fields)[0]
      if (f) (f as { type: string }).type = 'script'
    })
    expect(() => parseSaveRequest(saveRequest(badField))).toThrow()
  })
})

describe('FileStore : écriture des tables confinée à tables/', () => {
  it('une table à l’id hostile ne fait écrire aucun fichier hors du dossier', () => {
    const store = new FileStore({ dir })
    expect(() => store.save(withEvilTable(createDemoData()))).toThrow()
    expect(allFiles().every((f) => f.startsWith(path.join('home', 'Atelier_Tab')))).toBe(true)
    expect(fs.existsSync(path.join(root, 'home', '.config'))).toBe(false)
    expect(fs.existsSync(path.join(root, '.config'))).toBe(false)
  })

  it('les données ordinaires s’écrivent toujours', () => {
    expect(new FileStore({ dir }).save(createDemoData())).toHaveLength(5)
  })
})

describe('instantanés : écriture et suppression confinées à exports/', () => {
  it('ignore une table à l’id hostile et signale l’erreur', () => {
    const errors: unknown[] = []
    const writer = new SnapshotWriter({ dir, onError: (e) => errors.push(e) })
    const changed = writer.update(withEvilTable(createDemoData()))
    expect(changed).toHaveLength(4)
    expect(changed.every((f) => /^exports\/tbl_[a-z_]+\.json$/.test(f))).toBe(true)
    expect(errors.some((e) => String(e).includes('id de table refusé'))).toBe(true)
    expect(allFiles().every((f) => f.startsWith(path.join('home', 'Atelier_Tab', 'exports')))).toBe(
      true,
    )
  })

  it('remove() ne supprime rien hors de exports/', () => {
    // Fichier « victime » qui ressemble à un instantané de la table hostile.
    const victim = path.join(root, '.config', 'x.json')
    fs.mkdirSync(path.dirname(victim), { recursive: true })
    fs.writeFileSync(
      victim,
      JSON.stringify({ target_system: 'atelier_projets', project: { source_table: { id: EVIL } } }),
    )
    const writer = new SnapshotWriter({ dir })
    expect(writer.remove(EVIL)).toEqual([])
    expect(writer.remove('../../../.config/x')).toEqual([])
    expect(fs.existsSync(victim)).toBe(true)
  })
})
