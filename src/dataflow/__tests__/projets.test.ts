import { describe, expect, it, vi } from 'vitest'
import { TableSheet } from '@/engine/table'
import { createDemoData } from '@/fixtures/demo'
import { isLocalHttpUrl, isLocalProjetsImportUrl } from '@/lib/local-url'
import {
  buildAtelierPayload,
  defaultWebhookUrl,
  describeProjetsSummary,
  isProjetsImportUrl,
  isValidWebhookUrl,
  parseProjetsSummary,
  PROJETS_LOCAL_IMPORT_URL,
  sendToWebhook,
  WEBHOOK_PRESETS,
  withProjetsParams,
  type WebhookFetch,
} from '..'

const data = createDemoData()
const sheet = new TableSheet()
sheet.sync(data.tables.tbl_planning_lots!, { collaborators: data.collaborators })
const payload = buildAtelierPayload(data, 'tbl_planning_lots', sheet)

describe('préréglage « Atelier Projets (local) » (SUITE.md §4.1)', () => {
  it('vise la route d’import locale d’Atelier Projets', () => {
    expect(WEBHOOK_PRESETS).toEqual([
      {
        id: 'atelier-projets-local',
        label: 'Atelier Projets (local)',
        url: 'http://127.0.0.1:3000/api/imports/atelier-tab',
      },
    ])
    expect(PROJETS_LOCAL_IMPORT_URL).toBe('http://127.0.0.1:3000/api/imports/atelier-tab')
    // L'exception http pour cette machine est conservée.
    expect(isValidWebhookUrl(PROJETS_LOCAL_IMPORT_URL)).toBe(true)
    expect(isValidWebhookUrl('http://localhost:3000/api/imports/atelier-tab')).toBe(true)
    expect(isValidWebhookUrl('http://192.168.1.2:3000/api/imports/atelier-tab')).toBe(false)
  })

  it('est proposé par défaut sans écraser une adresse enregistrée', () => {
    expect(defaultWebhookUrl(undefined)).toBe(PROJETS_LOCAL_IMPORT_URL)
    expect(defaultWebhookUrl('')).toBe(PROJETS_LOCAL_IMPORT_URL)
    expect(defaultWebhookUrl('   ')).toBe(PROJETS_LOCAL_IMPORT_URL)
    expect(defaultWebhookUrl('https://atelier.example/api/import')).toBe(
      'https://atelier.example/api/import',
    )
  })

  it('reconnaît une adresse d’import Atelier Projets', () => {
    expect(isProjetsImportUrl(PROJETS_LOCAL_IMPORT_URL)).toBe(true)
    expect(isProjetsImportUrl('https://projets.example/api/imports/atelier-tab/')).toBe(true)
    expect(isProjetsImportUrl('https://hook.example/api/import')).toBe(false)
    expect(isProjetsImportUrl('pas une url')).toBe(false)
  })

  it('ajoute le projet cible uniquement pour Atelier Projets', () => {
    expect(withProjetsParams(PROJETS_LOCAL_IMPORT_URL, { projectId: ' 3 ' })).toBe(
      'http://127.0.0.1:3000/api/imports/atelier-tab?projectId=3',
    )
    expect(withProjetsParams(PROJETS_LOCAL_IMPORT_URL, { projectId: '' })).toBe(
      PROJETS_LOCAL_IMPORT_URL,
    )
    expect(withProjetsParams('https://hook.example/x', { projectId: '3' })).toBe(
      'https://hook.example/x',
    )
  })

  it('limite le relais de l’app de bureau aux routes d’import locales', () => {
    expect(isLocalProjetsImportUrl(PROJETS_LOCAL_IMPORT_URL)).toBe(true)
    expect(isLocalProjetsImportUrl(`${PROJETS_LOCAL_IMPORT_URL}/preview?projectId=2`)).toBe(true)
    expect(isLocalProjetsImportUrl('http://localhost:3000/api/imports/atelier-tab')).toBe(true)
    expect(isLocalProjetsImportUrl('http://127.0.0.1:3000/api/projects')).toBe(false)
    expect(isLocalProjetsImportUrl('https://projets.example/api/imports/atelier-tab')).toBe(false)
    expect(isLocalProjetsImportUrl('http://user:pw@127.0.0.1:3000/api/imports/atelier-tab')).toBe(
      false,
    )
    expect(isLocalHttpUrl('http://127.0.0.1:8000')).toBe(true)
    expect(isLocalHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isLocalHttpUrl('http://127.0.0.1.evil.example')).toBe(false)
    expect(isLocalHttpUrl(42)).toBe(false)
  })
})

describe('résumé renvoyé par Atelier Projets', () => {
  const response = {
    projectId: 3,
    storyId: 12,
    created: 2,
    updated: 1,
    unchanged: 0,
    skipped: 1,
    warnings: ['Ligne 4 : titre vide, ignorée'],
    items: [],
  }

  it('lit les compteurs et les avertissements', () => {
    expect(parseProjetsSummary(response)).toEqual({
      projectId: 3,
      created: 2,
      updated: 1,
      unchanged: 0,
      skipped: 1,
      warnings: ['Ligne 4 : titre vide, ignorée'],
    })
    expect(parseProjetsSummary({ ok: true })).toBeNull()
    expect(parseProjetsSummary(null)).toBeNull()
  })

  it('se décrit en une phrase', () => {
    expect(describeProjetsSummary(parseProjetsSummary(response)!)).toBe(
      '2 créés, 1 mis à jour, 1 ignoré',
    )
    expect(
      describeProjetsSummary({
        projectId: null,
        created: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        warnings: [],
      }),
    ).toBe('aucun élément importé')
  })

  it('l’envoi renvoie le résumé et les en-têtes du contrat', async () => {
    const fetch = vi.fn<WebhookFetch>(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response),
    }))
    const res = await sendToWebhook(
      payload,
      { url: withProjetsParams(PROJETS_LOCAL_IMPORT_URL, { projectId: '3' }), online: false },
      { fetch, idempotencyKey: 'k1' },
    )
    expect(res).toMatchObject({ ok: true, status: 200, attempts: 1 })
    expect(res.message).toBe('Atelier Projets : 2 créés, 1 mis à jour, 1 ignoré')
    expect(res.summary?.warnings).toEqual(['Ligne 4 : titre vide, ignorée'])
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe('http://127.0.0.1:3000/api/imports/atelier-tab?projectId=3')
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      'Idempotency-Key': 'k1',
      'X-Atelier-Schema-Version': '2.1.0',
    })
  })

  it('rapporte le message d’erreur d’Atelier Projets', async () => {
    const fetch = vi.fn<WebhookFetch>(async () => ({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ message: 'Version de schéma 2.0.0 non prise en charge' }),
    }))
    const res = await sendToWebhook(
      payload,
      { url: PROJETS_LOCAL_IMPORT_URL, online: false },
      { fetch },
    )
    expect(res).toMatchObject({ ok: false, status: 422, attempts: 1 })
    expect(res.message).toMatch(/\(422\) — Version de schéma 2.0.0 non prise en charge$/)
  })
})
