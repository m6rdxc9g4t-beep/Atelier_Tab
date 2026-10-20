import { describe, expect, it, vi } from 'vitest'
import { produce } from 'immer'
import { TableSheet } from '@/engine/table'
import { createDemoData } from '@/fixtures/demo'
import type { AppData } from '@/types/domain'
import {
  atelierPayloadSchema,
  buildAtelierPayload,
  exportFilename,
  isValidWebhookUrl,
  tokenAllowedFor,
  webhookBlockReason,
  sendToWebhook,
  slugify,
  toEnrichedCsv,
  validatePayload,
} from '..'

const AT = new Date('2026-10-18T12:57:00.000Z')

function exportOf(data: AppData, tableId = 'tbl_planning_lots', recordIds?: string[]) {
  const sheet = new TableSheet()
  const table = data.tables[tableId]
  if (!table) throw new Error('table absente')
  sheet.sync(table, { collaborators: data.collaborators })
  return buildAtelierPayload(data, tableId, sheet, { exportedAt: AT, recordIds })
}

describe('buildAtelierPayload — table « Planning & Lots »', () => {
  const payload = exportOf(createDemoData())

  it('produit l’enveloppe de la spécification', () => {
    expect(payload).toMatchObject({
      target_system: 'atelier_projets',
      schema_version: '2.1.0',
      exported_at: '2026-10-18T12:57:00Z',
      workspace: { id: 'ws_arch_01', name: 'Espace Architecture' },
      project: {
        id: 'proj_renovation_2026',
        name: 'Rénovation Urbaine 2026',
        source_table: { id: 'tbl_planning_lots', name: 'Planning & Lots' },
      },
    })
  })

  it('respecte le schéma Zod v2.1.0', () => {
    expect(atelierPayloadSchema.safeParse(payload).success).toBe(true)
  })

  it('décrit les colonnes avec leur lettre et leur rôle', () => {
    expect(payload.project.columns_schema.slice(0, 4)).toEqual([
      {
        col_letter: 'A',
        id: 'task_name',
        label: 'Lot / Tâche',
        type: 'text',
        atelier_mapping: 'entity_title',
      },
      {
        col_letter: 'B',
        id: 'status',
        label: 'Statut',
        type: 'select',
        atelier_mapping: 'workflow_state',
      },
      {
        col_letter: 'C',
        id: 'cost_ht',
        label: 'Coût HT',
        type: 'currency',
        atelier_mapping: 'financial_ht',
      },
      {
        col_letter: 'D',
        id: 'cost_ttc',
        label: 'Coût TTC',
        type: 'formula',
        atelier_mapping: 'financial_ttc',
      },
    ])
  })

  it('reproduit l’enregistrement d’exemple de la spécification', () => {
    const first = payload.project.records[0]
    expect(first?.row_index).toBe(1)
    expect(first?.record_id).toBe('rec_01')
    expect(first?.values).toMatchObject({
      A: { raw: 'Gros œuvre', computed: 'Gros œuvre' },
      B: { raw: 'En cours', computed: 'En cours' },
      C: { raw: '45000', computed: 45000 },
      D: { raw: '=C1*1.2', computed: 54000 },
      E: { raw: 'Marie Dubois', computed: 'Marie Dubois' },
      F: { raw: '2026-11-30', computed: '2026-11-30' },
    })
  })

  it('exclut la ligne de total des enregistrements et des totaux', () => {
    expect(payload.project.records.map((r) => r.record_id)).toEqual(['rec_01', 'rec_02', 'rec_03'])
    expect(payload.project.summary_metrics).toEqual({
      total_rows: 3,
      computed_totals: { C: 88500, D: 106200 },
    })
    expect(payload.project.summary_rows?.[0]).toMatchObject({
      row_index: 4,
      record_id: 'rec_total',
      values: { C: { raw: '=SUM(C1:C3)', computed: 88500 } },
    })
  })

  it('est prêt à l’export', () => {
    expect(validatePayload(payload)).toEqual({ status: 'ready', issues: [] })
  })
})

describe('export d’une sélection de lignes', () => {
  it('garde le numéro de ligne d’origine et recalcule les totaux', () => {
    const payload = exportOf(createDemoData(), 'tbl_planning_lots', ['rec_02'])
    expect(payload.project.records).toHaveLength(1)
    expect(payload.project.records[0]?.row_index).toBe(2)
    expect(payload.project.summary_metrics.computed_totals).toEqual({ C: 28500, D: 34200 })
  })
})

describe('validatePayload', () => {
  it('bloque sans colonne de titre', () => {
    const data = produce(createDemoData(), (d) => {
      const f = d.tables.tbl_planning_lots?.fields.task_name
      if (f) f.atelierMapping = 'custom'
    })
    const report = validatePayload(exportOf(data))
    expect(report.status).toBe('blocked')
    expect(report.issues.map((i) => i.code)).toContain('no_title_column')
  })

  it('bloque une sélection vide', () => {
    const report = validatePayload(exportOf(createDemoData(), 'tbl_planning_lots', []))
    expect(report.status).toBe('blocked')
    expect(report.issues.map((i) => i.code)).toContain('no_records')
  })

  it('avertit des erreurs de formule, titres vides et rôles en double', () => {
    const data = produce(createDemoData(), (d) => {
      const t = d.tables.tbl_planning_lots
      if (!t) return
      ;(t.records.rec_02 as (typeof t.records)[string]).cells.cost_ht = '=1/0'
      ;(t.records.rec_03 as (typeof t.records)[string]).cells.task_name = null
      ;(t.fields.due_date as (typeof t.fields)[string]).atelierMapping = 'workflow_state'
    })
    const report = validatePayload(exportOf(data))
    expect(report.status).toBe('warnings')
    const codes = report.issues.map((i) => i.code)
    expect(codes).toEqual(
      expect.arrayContaining(['formula_errors', 'empty_titles', 'duplicate_mapping']),
    )
    expect(report.issues.find((i) => i.code === 'formula_errors')?.details).toContain(
      'C2 (#DIV/0!)',
    )
  })

  it('signale un payload non conforme au schéma', () => {
    const payload = exportOf(createDemoData())
    const broken = { ...payload, schema_version: '1.0.0' } as unknown as typeof payload
    expect(validatePayload(broken).issues[0]?.code).toBe('schema')
  })
})

describe('CSV enrichi', () => {
  const csv = toEnrichedCsv(exportOf(createDemoData()))
  const lines = csv.replace('﻿', '').trim().split('\r\n')

  it('commence par un BOM et utilise ; comme séparateur', () => {
    expect(csv.startsWith('﻿')).toBe(true)
    expect(lines[0]).toBe(
      'Ligne;Identifiant;A · Lot / Tâche;B · Statut;C · Coût HT;D · Coût TTC;D · Coût TTC (formule);E · Responsable;F · Échéance',
    )
  })

  it('écrit les valeurs calculées et les formules', () => {
    expect(lines[1]).toBe(
      '1;rec_01;Gros œuvre;En cours;45000;54000;=C1*1.2;Marie Dubois;2026-11-30',
    )
    expect(lines).toHaveLength(4) // en-tête + 3 lignes, sans le total
  })

  it('protège les caractères spéciaux et note les décimales à la française', () => {
    const data = produce(createDemoData(), (d) => {
      const r = d.tables.tbl_planning_lots?.records.rec_01
      if (r) {
        r.cells.task_name = 'Lot "A"; phase 1'
        r.cells.cost_ht = 45000.5
      }
    })
    const line = toEnrichedCsv(exportOf(data)).split('\r\n')[1]
    expect(line).toContain('"Lot ""A""; phase 1"')
    expect(line).toContain(';45000,5;')
  })
})

describe('webhook', () => {
  const payload = exportOf(createDemoData())
  const ok = (status = 200) => new Response('{}', { status })
  const noSleep = () => Promise.resolve()

  it('envoie le JSON avec les en-têtes attendus, sans suivre de redirection', async () => {
    const fetch = vi.fn(async () => ok(202))
    const res = await sendToWebhook(
      payload,
      { url: 'http://127.0.0.1:3000/api/imports/atelier-tab', token: 'secret', online: false },
      { fetch, sleep: noSleep, idempotencyKey: 'key-1' },
    )
    expect(res).toMatchObject({ ok: true, status: 202, attempts: 1 })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:3000/api/imports/atelier-tab')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'key-1',
      Authorization: 'Bearer secret',
      'X-Atelier-Schema-Version': '2.1.0',
    })
    expect(JSON.parse(init.body as string).project.id).toBe('proj_renovation_2026')
  })

  it('le jeton ne part que vers la route d’import d’Atelier Projets locale (SUITE.md §5.4)', async () => {
    expect(tokenAllowedFor('http://127.0.0.1:3000/api/imports/atelier-tab')).toBe(true)
    expect(tokenAllowedFor('http://localhost:3000/api/imports/atelier-tab/preview')).toBe(true)
    expect(tokenAllowedFor('https://atelier.example/api/imports/atelier-tab')).toBe(false)
    expect(tokenAllowedFor('http://127.0.0.1:3000/api/autre')).toBe(false)
    const fetch = vi.fn(async () => ok(200))
    await sendToWebhook(
      payload,
      { url: 'https://atelier.example/api/import', token: 'secret', online: true },
      { fetch, sleep: noSleep },
    )
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('hors ligne : refuse toute adresse qui n’est pas cette machine (SUITE.md §5.4)', async () => {
    const fetch = vi.fn(async () => ok(200))
    const res = await sendToWebhook(
      payload,
      { url: 'https://atelier.example/api/import', online: false },
      { fetch, sleep: noSleep },
    )
    expect(res).toMatchObject({ ok: false, attempts: 0 })
    expect(res.message).toMatch(/^Mode hors ligne : envoi vers atelier\.example refusé/)
    expect(fetch).not.toHaveBeenCalled()
    expect(webhookBlockReason('http://localhost:3000/hook', false)).toBeNull()
    expect(webhookBlockReason('https://localhost/hook', false)).toBeNull()
    expect(webhookBlockReason('https://atelier.example/x', true)).toBeNull()
    expect(webhookBlockReason('https://127.0.0.1.evil.example/x', false)).toMatch(/hors ligne/)
  })

  it('réessaie sur erreur serveur avec la même clé d’idempotence', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(ok(503))
      .mockResolvedValueOnce(ok(200))
    const res = await sendToWebhook(
      payload,
      { url: 'https://a.example/hook', online: true },
      { fetch, sleep: noSleep },
    )
    expect(res).toMatchObject({ ok: true, attempts: 3 })
    const keys = fetch.mock.calls.map(
      (c) => (c[1] as RequestInit).headers as Record<string, string>,
    )
    expect(new Set(keys.map((h) => h['Idempotency-Key'])).size).toBe(1)
  })

  it('ne réessaie pas une erreur client', async () => {
    const fetch = vi.fn(async () => ok(401))
    const res = await sendToWebhook(
      payload,
      { url: 'https://a.example/hook', online: true },
      { fetch, sleep: noSleep },
    )
    expect(res).toMatchObject({ ok: false, status: 401, attempts: 1 })
    expect(res.message).toMatch(/jeton/)
  })

  it('refuse une adresse non sécurisée', async () => {
    expect(isValidWebhookUrl('http://atelier.example')).toBe(false)
    expect(isValidWebhookUrl('http://localhost:3000/hook')).toBe(true)
    const res = await sendToWebhook(payload, { url: 'ftp://x', online: true })
    expect(res).toMatchObject({ ok: false, attempts: 0 })
  })
})

describe('noms de fichiers', () => {
  it('produit un nom lisible et sûr', () => {
    expect(slugify('Planning & Lots')).toBe('planning-lots')
    expect(exportFilename('Calculs Surfaces', 'json', AT)).toBe(
      'atelier_projets_calculs-surfaces_2026-10-18.json',
    )
  })
})
