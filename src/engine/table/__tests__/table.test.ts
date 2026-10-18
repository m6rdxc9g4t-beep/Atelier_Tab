import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { isError } from '@/engine/formula'
import { createDemoData } from '@/fixtures/demo'
import type { Table } from '@/types/domain'
import { insertField, insertRecord, removeField, removeRecords, TableSheet } from '..'

const data = createDemoData()
const ctx = { collaborators: data.collaborators }
const planning = data.tables.tbl_planning_lots as Table

function sheetOf(table: Table) {
  const s = new TableSheet()
  s.sync(table, ctx)
  return s
}

describe('TableSheet sur la table « Planning & Lots »', () => {
  const s = sheetOf(planning)

  it('associe identifiants et adresses A1', () => {
    expect(s.address('rec_01', 'task_name')).toBe('A1')
    expect(s.address('rec_total', 'cost_ttc')).toBe('D4')
    expect(s.locate('$C$2')).toEqual({ recordId: 'rec_02', fieldId: 'cost_ht' })
  })

  it('recopie la colonne-formule TTC sur chaque ligne de données', () => {
    expect(s.input('rec_02', 'cost_ttc')).toBe('=C2*1.2')
    expect(s.value('rec_01', 'cost_ttc')).toBe(54000)
    expect(s.value('rec_03', 'cost_ttc')).toBe(18000)
  })

  it('n’applique pas la colonne-formule à la ligne de synthèse', () => {
    expect(s.input('rec_total', 'cost_ttc')).toBe('=SUM(D1:D3)')
  })

  it('calcule les totaux de la spécification', () => {
    expect(s.value('rec_total', 'cost_ht')).toBe(88500)
    expect(s.value('rec_total', 'cost_ttc')).toBe(106200)
  })

  it('expose les libellés au moteur (statut, responsable)', () => {
    expect(s.value('rec_01', 'status')).toBe('En cours')
    expect(s.value('rec_02', 'owner')).toBe('Karim Benali')
  })

  it('exclut la ligne de total des agrégats (pas de double comptage)', () => {
    const sum = s.summarize('cost_ht')
    expect(sum.sum).toBe(88500)
    expect(sum.count).toBe(3)
    expect(sum.average).toBe(29500)
  })

  it('aperçu d’une formule dans la barre fx', () => {
    expect(s.preview('=C1*2', 'rec_01', 'task_name')).toBe(90000)
  })
})

describe('TableSheet : synchronisation incrémentale', () => {
  it('ne recalcule que les cellules touchées', () => {
    const s = new TableSheet()
    s.sync(planning, ctx)
    const next = produce(planning, (t) => {
      ;(t.records.rec_01 as Table['records'][string]).cells.cost_ht = 50000
    })
    const changed = s.sync(next, ctx)
    expect([...changed].sort()).toEqual(
      ['rec_01:cost_ht', 'rec_01:cost_ttc', 'rec_total:cost_ht', 'rec_total:cost_ttc'].sort(),
    )
    expect(s.value('rec_total', 'cost_ttc')).toBe(112200)
  })

  it('une valeur forcée remplace la colonne-formule sur sa ligne', () => {
    const next = produce(planning, (t) => {
      ;(t.records.rec_02 as Table['records'][string]).cells.cost_ttc = 30000
    })
    const s = sheetOf(next)
    expect(s.value('rec_02', 'cost_ttc')).toBe(30000)
    expect(s.value('rec_total', 'cost_ttc')).toBe(102000)
  })
})

describe('opérations structurelles', () => {
  it('ajouter une ligne avant le total l’inclut dans les sommes', () => {
    const next = produce(planning, (t) => {
      insertRecord(t, {
        id: 'rec_04',
        kind: 'data',
        cells: { task_name: 'Menuiseries', cost_ht: 10000 },
      })
    })
    expect(next.rowOrder).toEqual(['rec_01', 'rec_02', 'rec_03', 'rec_04', 'rec_total'])
    expect(next.records.rec_total?.cells.cost_ht).toBe('=SUM(C1:C4)')
    const s = sheetOf(next)
    expect(s.value('rec_04', 'cost_ttc')).toBe(12000)
    expect(s.value('rec_total', 'cost_ht')).toBe(98500)
    expect(s.value('rec_total', 'cost_ttc')).toBe(118200)
  })

  it('supprimer une ligne réduit les plages', () => {
    const next = produce(planning, (t) => removeRecords(t, ['rec_02']))
    expect(next.records.rec_total?.cells.cost_ht).toBe('=SUM(C1:C2)')
    expect(sheetOf(next).value('rec_total', 'cost_ht')).toBe(60000)
  })

  it('insérer une colonne décale les formules et le modèle de colonne', () => {
    const next = produce(planning, (t) =>
      insertField(t, { id: 'lot_code', label: 'Code', type: 'text' }, 1),
    )
    expect(next.fields.cost_ttc?.columnFormula).toBe('=D1*1.2')
    expect(next.records.rec_total?.cells.cost_ht).toBe('=SUM(D1:D3)')
    const s = sheetOf(next)
    expect(s.address('rec_01', 'cost_ht')).toBe('D1')
    expect(s.value('rec_total', 'cost_ttc')).toBe(106200)
  })

  it('supprimer une colonne référencée produit #REF!', () => {
    const next = produce(planning, (t) => removeField(t, 'cost_ht'))
    expect(next.fields.cost_ttc?.columnFormula).toBe('=#REF!*1.2')
    const v = sheetOf(next).value('rec_01', 'cost_ttc')
    expect(isError(v) && v.code).toBe('#REF!')
  })
})

describe('autres tables de démonstration', () => {
  it('Budget Global : aléas et TTC', () => {
    const s = sheetOf(data.tables.tbl_budget_global as Table)
    expect(s.value('rec_bg_3', 'bg_ht')).toBe(4425)
    expect(s.value('rec_bg_total', 'bg_ht')).toBe(110925)
    expect(s.value('rec_bg_total', 'bg_ttc')).toBe(133110)
  })

  it('Calculs Surfaces', () => {
    const s = sheetOf(data.tables.tbl_calculs_surfaces as Table)
    expect(s.value('rec_sf_1', 'sf_area')).toBe(52.08)
    expect(s.value('rec_sf_total', 'sf_area')).toBe(272.44)
  })

  it('Matériaux', () => {
    const s = sheetOf(data.tables.tbl_materiaux as Table)
    expect(s.value('rec_mt_2', 'mt_total')).toBe(6230.4)
    expect(s.summarize('mt_total').sum).toBe(17841.4)
  })
})
