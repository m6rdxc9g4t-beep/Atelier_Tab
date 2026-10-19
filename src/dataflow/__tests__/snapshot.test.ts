import { produce } from 'immer'
import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import {
  atelierPayloadSchema,
  buildSnapshotPayload,
  isSnapshotOf,
  serializeSnapshot,
  snapshotFile,
  snapshotFingerprint,
  validatePayload,
} from '..'

const AT = new Date('2026-10-19T08:00:00.000Z')

describe('instantané DataFlow pour Atelier Viz (SUITE.md §4.2)', () => {
  it('produit l’enveloppe complète, valeurs calculées par le moteur', () => {
    const p = buildSnapshotPayload(createDemoData(), 'tbl_planning_lots', { exportedAt: AT })
    expect(atelierPayloadSchema.safeParse(p).success).toBe(true)
    expect(p.exported_at).toBe('2026-10-19T08:00:00Z')
    expect(p.project.source_table).toEqual({ id: 'tbl_planning_lots', name: 'Planning & Lots' })
    expect(p.project.records).toHaveLength(3)
    // Colonne-formule évaluée, statut sous son libellé officiel.
    expect(p.project.records[0]?.values.D).toEqual({ raw: '=C1*1.2', computed: 54000 })
    expect(p.project.records[0]?.values.B).toEqual({ raw: 'En cours', computed: 'En cours' })
    expect(p.project.summary_metrics.computed_totals).toEqual({ C: 88500, D: 106200 })
  })

  it('publie une table sans colonne entity_title (aucun contrôle bloquant)', () => {
    const data = produce(createDemoData(), (d) => {
      const t = d.tables.tbl_calculs_surfaces!
      for (const f of Object.values(t.fields)) delete f.atelierMapping
    })
    const p = buildSnapshotPayload(data, 'tbl_calculs_surfaces', { exportedAt: AT })
    expect(validatePayload(p).status).toBe('blocked')
    expect(atelierPayloadSchema.safeParse(p).success).toBe(true)
    // Colonnes sans rôle : `custom`.
    expect(p.project.columns_schema.map((c) => c.atelier_mapping)).toEqual([
      'custom',
      'custom',
      'custom',
      'custom',
    ])
    expect(p.project.records.map((r) => r.values.D?.computed)).toEqual([52.08, 133, 87.36])
  })

  it('publie une table vide', () => {
    const data = produce(createDemoData(), (d) => {
      const t = d.tables.tbl_materiaux!
      t.records = {}
      t.rowOrder = []
    })
    const p = buildSnapshotPayload(data, 'tbl_materiaux', { exportedAt: AT })
    expect(p.project.records).toEqual([])
    expect(atelierPayloadSchema.safeParse(p).success).toBe(true)
  })

  it('a un chemin et une empreinte indépendante de l’horodatage', () => {
    const data = createDemoData()
    const a = buildSnapshotPayload(data, 'tbl_materiaux', { exportedAt: AT })
    const b = buildSnapshotPayload(data, 'tbl_materiaux', { exportedAt: new Date() })
    expect(snapshotFile('tbl_materiaux')).toBe('exports/tbl_materiaux.json')
    expect(snapshotFingerprint(a)).toBe(snapshotFingerprint(b))
    const c = buildSnapshotPayload(
      produce(data, (d) => {
        d.tables.tbl_materiaux!.records.rec_mt_1!.cells.mt_qty = 43
      }),
      'tbl_materiaux',
      { exportedAt: AT },
    )
    expect(snapshotFingerprint(c)).not.toBe(snapshotFingerprint(a))
  })

  it('reconnaît ses propres fichiers, pas les exports manuels', () => {
    const text = serializeSnapshot(
      buildSnapshotPayload(createDemoData(), 'tbl_materiaux', { exportedAt: AT }),
    )
    expect(text.endsWith('}\n')).toBe(true)
    expect(isSnapshotOf(text, 'tbl_materiaux')).toBe(true)
    expect(isSnapshotOf(text, 'tbl_autre')).toBe(false)
    expect(isSnapshotOf('{"notes": true}', 'tbl_materiaux')).toBe(false)
    expect(isSnapshotOf('pas du json', 'tbl_materiaux')).toBe(false)
  })
})
