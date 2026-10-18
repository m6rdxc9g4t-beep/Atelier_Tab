import { afterEach, describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import { createHeadlessSession, type HeadlessSession } from '../headless'
import { runTool, toolSchemas } from '../tools'

let session: HeadlessSession | null = null
const saved: { name: string; content: string; path?: string }[] = []

function open() {
  saved.length = 0
  session = createHeadlessSession(createDemoData(), async (name, content, _mime, path) => {
    saved.push({ name, content, path })
    return path ?? `/exports/${name}`
  })
  return session
}
afterEach(() => session?.dispose())

async function call(name: string, args: unknown = {}) {
  const res = await runTool(name, args, session!.host)
  return { ...res, json: res.ok ? JSON.parse(res.content) : undefined }
}

describe('définitions', () => {
  it('produit un schéma JSON pour chaque outil', () => {
    const schemas = toolSchemas()
    expect(schemas.map((s) => s.name)).toEqual([
      'list_tables',
      'read_table',
      'set_cells',
      'add_rows',
      'delete_rows',
      'add_column',
      'update_column',
      'delete_column',
      'create_project',
      'create_table',
      'rename',
      'evaluate',
      'check_export',
      'export_table',
    ])
    const setCells = schemas.find((s) => s.name === 'set_cells')!
    expect(setCells.parameters).toMatchObject({ type: 'object', required: ['table', 'cells'] })
    expect(JSON.stringify(schemas)).not.toContain('$schema')
  })
})

describe('lecture', () => {
  it('liste les espaces, projets et tables', async () => {
    open()
    const { json } = await call('list_tables')
    expect(json.workspaces[0].projects[0].tables.map((t: { name: string }) => t.name)).toEqual([
      'Budget Global',
      'Planning & Lots',
      'Calculs Surfaces',
    ])
    expect(json.collaborators).toHaveLength(3)
  })

  it('lit une table par son nom, avec valeurs calculées et formules', async () => {
    open()
    const { json } = await call('read_table', { table: 'planning & lots' })
    expect(json.columns[3]).toEqual({
      letter: 'D',
      id: 'cost_ttc',
      label: 'Coût TTC',
      type: 'formula',
      formula: '=C1*1.2',
      format: 'currency',
      mapping: 'financial_ttc',
    })
    expect(json.rows[0]).toEqual({
      row: 1,
      id: 'rec_01',
      cells: {
        A: 'Gros œuvre',
        B: 'En cours',
        C: 45000,
        D: 54000,
        E: 'Marie Dubois',
        F: '2026-11-30',
      },
    })
    expect(json.rows[3]).toMatchObject({ row: 4, total_row: true, formulas: { C: '=SUM(C1:C3)' } })
    expect(json.column_sums).toEqual({ C: 88500, D: 106200 })
  })

  it('aide l’IA à se corriger quand une référence est fausse', async () => {
    open()
    const res = await call('read_table', { table: 'Planning' })
    expect(res.ok).toBe(false)
    expect(res.content).toContain('« Planning & Lots » (tbl_planning_lots)')
  })

  it('calcule une formule sans rien modifier', async () => {
    open()
    const { json } = await call('evaluate', {
      table: 'tbl_planning_lots',
      formula: 'AVERAGE(C1:C3)',
    })
    expect(json).toEqual({ formula: '=AVERAGE(C1:C3)', value: 29500 })
  })
})

describe('modification', () => {
  it('modifie des cellules avec les règles de saisie de la grille', async () => {
    open()
    const { json } = await call('set_cells', {
      table: 'Planning & Lots',
      cells: [
        { row: 3, column: 'Coût HT', value: '20 000 €' },
        { row: 3, column: 'B', value: 'en cours' },
        { row: 'rec_02', column: 'Échéance', value: '01/02/2027' },
      ],
    })
    expect(json.updated).toEqual([
      { cell: 'C3', value: 20000 },
      { cell: 'B3', value: 'En cours' },
      { cell: 'F2', value: '2027-02-01' },
    ])
    const after = await call('read_table', { table: 'tbl_planning_lots' })
    expect(after.json.rows[3].cells.D).toBe(112200)
  })

  it('refuse une valeur invalide sans rien modifier', async () => {
    open()
    const res = await call('set_cells', {
      table: 'tbl_planning_lots',
      cells: [
        { row: 1, column: 'C', value: 1 },
        { row: 2, column: 'Statut', value: 'Terminé' },
      ],
    })
    expect(res.ok).toBe(false)
    expect(res.content).toContain('Choix possibles : À faire, En cours, Validé, Bloqué')
    const after = await call('read_table', { table: 'tbl_planning_lots' })
    expect(after.json.rows[0].cells.C).toBe(45000)
  })

  it('ajoute des lignes au-dessus du total', async () => {
    open()
    const { json } = await call('add_rows', {
      table: 'Planning & Lots',
      rows: [
        { 'Lot / Tâche': 'Menuiseries', C: 12000, Statut: 'À faire', Responsable: 'KB' },
        { A: 'Peintures', C: '8 500' },
      ],
    })
    expect(json.added.map((r: { row: number }) => r.row)).toEqual([4, 5])
    expect(json.added[0].cells).toMatchObject({ D: 14400, E: 'Karim Benali' })
    const after = await call('read_table', { table: 'Planning & Lots' })
    expect(after.json.rows[5]).toMatchObject({ total_row: true, formulas: { C: '=SUM(C1:C5)' } })
    expect(after.json.rows[5].cells.C).toBe(109000)
  })

  it('supprime des lignes', async () => {
    open()
    const { json } = await call('delete_rows', { table: 'Planning & Lots', rows: [1, 'rec_02'] })
    expect(json).toEqual({ deleted: 2, remaining_rows: 2 })
  })

  it('ajoute, modifie et supprime une colonne formule', async () => {
    open()
    const added = await call('add_column', {
      table: 'Planning & Lots',
      label: 'Marge',
      type: 'formula',
      formula: 'D1-C1',
      format: 'currency',
      position: 'E',
    })
    expect(added.json.added).toMatchObject({ letter: 'E', label: 'Marge', formula: '=D1-C1' })
    const read = await call('read_table', { table: 'Planning & Lots' })
    expect(read.json.rows[1].cells.E).toBe(5700)
    expect(read.json.columns[5].label).toBe('Responsable')

    const upd = await call('update_column', {
      table: 'Planning & Lots',
      column: 'Marge',
      label: 'Marge TVA',
      formula: '=ROUND(D1-C1, 0)',
    })
    expect(upd.json.updated).toMatchObject({ label: 'Marge TVA', formula: '=ROUND(D1-C1, 0)' })

    const del = await call('delete_column', { table: 'Planning & Lots', column: 'Marge TVA' })
    expect(del.json).toEqual({ deleted: 'Marge TVA' })
  })

  it('refuse une formule invalide', async () => {
    open()
    const res = await call('add_column', {
      table: 'Planning & Lots',
      label: 'X',
      type: 'formula',
      formula: '=SUM(C1',
    })
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/Formule invalide/)
  })

  it('met à jour les statuts en gardant ceux des lignes', async () => {
    open()
    await call('update_column', {
      table: 'Planning & Lots',
      column: 'Statut',
      choices: ['À faire', 'En cours', 'Validé', 'Réceptionné'],
    })
    const read = await call('read_table', { table: 'Planning & Lots' })
    expect(read.json.columns[1].choices).toEqual(['À faire', 'En cours', 'Validé', 'Réceptionné'])
    expect(read.json.rows[1].cells.B).toBe('Validé')
  })

  it('crée un projet et une table avec ses colonnes', async () => {
    open()
    const proj = await call('create_project', {
      workspace: 'Espace Ingénierie',
      name: 'Extension école',
    })
    expect(proj.json.project_id).toMatch(/^proj_/)
    const tbl = await call('create_table', {
      project: 'Extension école',
      name: 'Devis',
      columns: [
        { label: 'Poste', type: 'text' },
        { label: 'HT', type: 'currency', mapping: 'financial_ht' },
        {
          label: 'TTC',
          type: 'formula',
          formula: '=B1*1.2',
          format: 'currency',
          mapping: 'financial_ttc',
        },
      ],
    })
    expect(
      tbl.json.columns.map((c: { letter: string; label: string }) => `${c.letter} ${c.label}`),
    ).toEqual(['A Poste', 'B HT', 'C TTC'])
    expect(tbl.json.columns[0].mapping).toBe('entity_title')
    await call('add_rows', { table: 'Devis', rows: [{ Poste: 'Fondations', HT: 1000 }] })
    const read = await call('read_table', { table: 'Devis' })
    expect(read.json.rows).toEqual([
      { row: 1, id: expect.any(String), cells: { A: 'Fondations', B: 1000, C: 1200 } },
    ])
  })

  it('renomme', async () => {
    open()
    await call('rename', { kind: 'table', target: 'Budget Global', name: 'Budget 2026' })
    const { json } = await call('list_tables')
    expect(json.workspaces[0].projects[0].tables[0].name).toBe('Budget 2026')
  })

  it('valide les arguments', async () => {
    open()
    const res = await call('set_cells', { table: 'Planning & Lots' })
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/Arguments invalides pour set_cells : cells/)
    expect((await call('outil_bidon')).content).toMatch(/Outil inconnu/)
  })
})

describe('export', () => {
  it('vérifie une table', async () => {
    open()
    const { json } = await call('check_export', { table: 'Planning & Lots' })
    expect(json).toMatchObject({
      status: 'ready',
      records: 3,
      computed_totals: { C: 88500, D: 106200 },
    })
  })

  it('exporte en JSON et journalise l’export', async () => {
    open()
    const { json } = await call('export_table', {
      table: 'Planning & Lots',
      format: 'json',
      rows: [2],
    })
    expect(json.message).toBe('1 ligne(s) exportée(s) en JSON')
    expect(saved[0]?.name).toMatch(/^atelier_projets_planning-lots_\d{4}-\d{2}-\d{2}\.json$/)
    expect(JSON.parse(saved[0]!.content).project.records[0].record_id).toBe('rec_02')
    expect(session!.snapshot().integrations.atelierProjets.lastExport?.ok).toBe(true)
  })

  it('refuse un webhook non configuré', async () => {
    open()
    const res = await call('export_table', { table: 'Planning & Lots', format: 'webhook' })
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/Aucun webhook configuré/)
  })
})
