import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import {
  ATELIER_TABLE_FORMAT,
  columnKey,
  flattenPayload,
  queryAtelierTable,
  TableQueryError,
  toAtelierTable,
} from '../atelier-table'
import { buildSnapshotPayload } from '../snapshot'

const payload = (tableId = 'tbl_planning_lots', data = createDemoData()) =>
  buildSnapshotPayload(data, tableId, { exportedAt: new Date('2026-10-21T08:00:00Z') })

describe('atelier-table/1 (SUITE.md §7.2)', () => {
  it('clés snake_case sans accent', () => {
    expect(columnKey('Coût HT')).toBe('cout_ht')
    expect(columnKey('Échéance')).toBe('echeance')
    expect(columnKey('Lot / Tâche')).toBe('lot_tache')
    expect(columnKey('Surface (m²)')).toBe('surface_m2')
    expect(columnKey('Gros œuvre')).toBe('gros_oeuvre')
    expect(columnKey('2e trimestre')).toBe('c_2e_trimestre')
    expect(columnKey('€€', 'F')).toBe('f')
  })

  it('aplatit une enveloppe comme Viz : _ligne, _id, puis une colonne par champ, valeurs calculées', () => {
    const table = toAtelierTable(payload())
    expect(table).toMatchObject({
      format: ATELIER_TABLE_FORMAT,
      name: 'tbl_planning_lots',
      label: 'Planning & Lots',
      total: 3,
      truncated: false,
    })
    expect(table.columns).toEqual([
      { key: '_ligne', label: 'Ligne', type: 'number' },
      { key: '_id', label: 'Identifiant', type: 'string' },
      { key: 'lot_tache', label: 'Lot / Tâche', type: 'string' },
      { key: 'statut', label: 'Statut', type: 'string' },
      { key: 'cout_ht', label: 'Coût HT', type: 'number' },
      { key: 'cout_ttc', label: 'Coût TTC', type: 'number' },
      { key: 'responsable', label: 'Responsable', type: 'string' },
      { key: 'echeance', label: 'Échéance', type: 'date' },
    ])
    // Ligne de total exclue ; colonne-formule évaluée ; statut et responsable par libellé.
    expect(table.rows[0]).toEqual({
      _ligne: 1,
      _id: 'rec_01',
      lot_tache: 'Gros œuvre',
      statut: 'En cours',
      cout_ht: 45000,
      cout_ttc: 54000,
      responsable: 'Marie Dubois',
      echeance: '2026-11-30',
    })
  })

  it('clés uniques même pour des libellés identiques ou réservés', () => {
    const data = produce(createDemoData(), (d) => {
      const t = d.tables.tbl_planning_lots!
      t.fields.status!.label = 'Coût  HT'
      t.fields.owner!.label = '_id'
    })
    const keys = toAtelierTable(payload('tbl_planning_lots', data)).columns.map((c) => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).toEqual([
      '_ligne',
      '_id',
      'lot_tache',
      'cout_ht',
      'cout_ht_2',
      'cout_ttc',
      'id',
      'echeance',
    ])
    for (const key of keys) expect(key).toMatch(/^[a-z0-9_]+$/)
  })

  it('cases à cocher en booléen, erreurs de formule en null, formule texte en string', () => {
    const data = produce(createDemoData(), (d) => {
      const t = d.tables.tbl_materiaux!
      t.records.rec_mt_1!.cells.mt_qty = '=1/0'
    })
    const table = toAtelierTable(payload('tbl_materiaux', data))
    const types = Object.fromEntries(table.columns.map((c) => [c.key, c.type]))
    expect(types.commande).toBe('boolean')
    expect(types.total_ht).toBe('number')
    expect(table.rows[0]?.quantite).toBeNull()
    expect(table.rows[0]?.total_ht).toBeNull()
    expect(typeof table.rows[0]?.commande).toBe('boolean')
  })

  it('filtre, choisit les colonnes et pagine', () => {
    const { columns, rows } = flattenPayload(payload())
    const source = { name: 't', label: 'T', columns, rows }
    const gt = queryAtelierTable(source, {
      filters: [{ key: 'cout_ht', op: 'gt', value: '20 000' }],
    })
    expect(gt.rows.map((r) => r._id)).toEqual(['rec_01', 'rec_02'])
    const contains = queryAtelierTable(source, {
      filters: [{ key: 'lot_tache', op: 'contains', value: 'OEUVRE' }],
    })
    expect(contains.rows.map((r) => r._id)).toEqual(['rec_01'])
    const date = queryAtelierTable(source, {
      filters: [{ key: 'echeance', op: 'lt', value: '01/01/2027' }],
    })
    expect(date.total).toBe(2)
    const page = queryAtelierTable(source, { keys: ['cout_ht'], offset: 1, limit: 1 })
    expect(page.columns.map((c) => c.key)).toEqual(['_ligne', '_id', 'cout_ht'])
    expect(page.rows).toEqual([{ _ligne: 2, _id: 'rec_02', cout_ht: 28500 }])
    expect(page).toMatchObject({ total: 3, truncated: true })
    expect(() =>
      queryAtelierTable(source, { filters: [{ key: 'cout_ht', op: 'gt', value: 'beaucoup' }] }),
    ).toThrow(TableQueryError)
  })
})
