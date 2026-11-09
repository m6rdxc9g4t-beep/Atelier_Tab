import { afterEach, describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import { memoryAdapter } from '@/services/persistence'
import { connectComputed, selectCellValue, type ComputedEngine } from '@/store/computed.store'
import { createDataStore } from '@/store/data.store'
import { buildExampleTables, isExamplePart, type ExamplePart } from '../suite'

// Les fichiers livrés avec l'app, lus comme l'app les lit.
const FILES = import.meta.glob<unknown>('../../../exemples-suite/*.json', { eager: true, import: 'default' })
const read = (file: string): unknown => FILES[`../../../exemples-suite/${file}`]
const index = read('index.json') as { format: string; histoires: { id: string }[] }
const parts = index.histoires.map((h) => read(`${h.id}.json`) as ExamplePart)
const garance = parts.find((p) => p.histoire.id === 'studio-garance')!

let engine: ComputedEngine | null = null
afterEach(() => engine?.disconnect())

describe('exemples de la suite', () => {
  it('livre une part Tab valide pour chaque histoire de l’index', () => {
    expect(index.format).toBe('atelier-exemples/1')
    expect(index.histoires.length).toBeGreaterThanOrEqual(9)
    const files = Object.keys(FILES)
      .map((path) => path.split('/').pop()!)
      .filter((f) => f !== 'index.json')
    expect(files.sort()).toEqual(index.histoires.map((h) => `${h.id}.json`).sort())
    for (const part of parts) expect(isExamplePart(part)).toBe(true)
  })

  it('refuse un format inconnu ou un identifiant non sûr', () => {
    expect(isExamplePart(null)).toBe(false)
    expect(isExamplePart({ ...garance, format: 'autre/1' })).toBe(false)
    expect(isExamplePart({ ...garance, projet: { id: '../x', nom: 'x' } })).toBe(false)
    // Deux appels de suite : la validation ne garde aucun état entre eux.
    expect(isExamplePart({ ...garance, espace: { id: 'a b', nom: 'x' } })).toBe(false)
    expect(isExamplePart(garance)).toBe(true)
  })

  it('construit des tables aux identifiants stables, cellules et choix reconnus', () => {
    const tables = buildExampleTables(garance)
    expect(tables.map((t) => t.id)).toEqual(buildExampleTables(garance).map((t) => t.id))
    const ops = tables[0]!
    expect(ops.id).toBe('tbl_ex_studio-garance_0')
    expect(ops.projectId).toBe(garance.projet.id)
    expect(ops.rowOrder).toHaveLength(garance.tables[0]!.lignes.length)

    const cat = ops.fields[ops.fieldOrder.find((id) => ops.fields[id]!.label === 'Catégorie')!]!
    const first = ops.records[ops.rowOrder[0]!]!
    const choice = cat.options?.choices?.find((c) => c.id === first.cells[cat.id])
    expect(choice?.label).toBe(garance.tables[0]!.lignes[0]!['Catégorie'])

    // Statuts de la suite : identifiants officiels et vue Kanban.
    const factures = tables[1]!
    const statut = Object.values(factures.fields).find((f) => f.atelierMapping === 'workflow_state')
    expect(statut?.options?.choices?.map((c) => c.label)).toContain('Terminée')
    expect(Object.values(factures.views).some((v) => v.mode === 'kanban')).toBe(true)
  })

  it('évite toute collision d’identifiants entre histoires', () => {
    const ids = parts.flatMap((p) => buildExampleTables(p).flatMap((t) => [t.id, ...t.rowOrder]))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('s’installe dans le store, se recharge sans doublon et calcule ses formules', () => {
    const renovation = parts.find((p) => p.histoire.id === 'renovation-urbaine')!
    const data = createDataStore({ adapter: memoryAdapter(), initialData: createDemoData() })
    engine = connectComputed(data)
    const tables = buildExampleTables(renovation)
    const install = () =>
      data.getState().installProject(
        { id: renovation.espace.id, name: renovation.espace.nom },
        { id: renovation.projet.id, name: renovation.projet.nom },
        buildExampleTables(renovation),
      )
    install()
    install()
    const s = data.getState()
    expect(s.workspaces[renovation.espace.id]?.projectIds).toEqual([renovation.projet.id])
    expect(s.projects[renovation.projet.id]?.tableIds).toEqual(tables.map((t) => t.id))

    const planning = tables.find((t) => t.name === 'Planning & Lots')!
    const ht = planning.fieldOrder.find((id) => planning.fields[id]!.label === 'Coût HT')
    const ttc = planning.fieldOrder.find((id) => planning.fields[id]!.label === 'Coût TTC')!
    const row = planning.rowOrder[0]!
    const htValue = ht ? planning.records[row]!.cells[ht] : undefined
    expect(typeof htValue).toBe('number')
    expect(selectCellValue(planning.id, row, ttc)(engine.store.getState())).toBeCloseTo((htValue as number) * 1.2)

    s.deleteProject(renovation.projet.id)
    expect(data.getState().projects[renovation.projet.id]).toBeUndefined()
    expect(data.getState().tables[planning.id]).toBeUndefined()
  })
})
