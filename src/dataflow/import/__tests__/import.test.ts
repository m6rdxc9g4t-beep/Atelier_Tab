import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { buildAtelierPayload, toEnrichedCsv } from '@/dataflow'
import { TableSheet } from '@/engine/table'
import { createDemoData } from '@/fixtures/demo'
import type { AppData, Table } from '@/types/domain'
import {
  analyzeCsv,
  applyImport,
  buildImport,
  CsvImportError,
  decodeCsvBytes,
  detectDelimiter,
  inferFieldType,
  parseCsv,
  suggestMappings,
  suggestPlan,
  type ColumnTarget,
} from '..'

const data = createDemoData()
const ctx = { collaborators: data.collaborators }

function computed(d: AppData, table: Table) {
  const sheet = new TableSheet()
  sheet.sync(table, { collaborators: d.collaborators })
  return (recordId: string, fieldId: string) => sheet.value(recordId, fieldId)
}

function fieldByLabel(table: Table, label: string) {
  const f = Object.values(table.fields).find((x) => x.label === label)
  if (!f) throw new Error(`champ absent : ${label}`)
  return f
}

describe('decodeCsvBytes', () => {
  it('UTF-8 avec ou sans BOM', () => {
    const bytes = new TextEncoder().encode('﻿Coût;Statut')
    expect(decodeCsvBytes(bytes)).toEqual({ text: 'Coût;Statut', encoding: 'utf-8' })
    expect(decodeCsvBytes(new TextEncoder().encode('Coût')).text).toBe('Coût')
  })

  it('Windows-1252 (export Excel) : les accents sont conservés', () => {
    // « Coût;Échéance » en Windows-1252 : û = 0xFB, É = 0xC9, é = 0xE9.
    const bytes = new Uint8Array([
      0x43, 0x6f, 0xfb, 0x74, 0x3b, 0xc9, 0x63, 0x68, 0xe9, 0x61, 0x6e, 0x63, 0x65,
    ])
    expect(decodeCsvBytes(bytes)).toEqual({ text: 'Coût;Échéance', encoding: 'windows-1252' })
  })

  it('UTF-16 LE avec BOM', () => {
    const text = 'Nom;Prix'
    const bytes = new Uint8Array(2 + text.length * 2)
    bytes.set([0xff, 0xfe])
    for (let i = 0; i < text.length; i++) bytes[2 + i * 2] = text.charCodeAt(i)
    expect(decodeCsvBytes(bytes)).toEqual({ text, encoding: 'utf-16le' })
  })
})

describe('parseCsv', () => {
  it('guillemets, guillemets doublés, séparateur et retour à la ligne dans une cellule', () => {
    const csv = 'a;b;c\r\n"x;y";"il a dit ""oui""";"ligne 1\nligne 2"\r\n'
    expect(parseCsv(csv, ';')).toEqual([
      ['a', 'b', 'c'],
      ['x;y', 'il a dit "oui"', 'ligne 1\nligne 2'],
    ])
  })

  it('ignore les lignes vides et la ligne « sep= » d’Excel', () => {
    expect(parseCsv('sep=,\na,b\n\n1,2\n', ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('cellules vides et dernière ligne sans retour', () => {
    expect(parseCsv('a;;c\n;;', ';')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
    ])
  })

  it('maxRows arrête la lecture', () => {
    expect(parseCsv('1\n2\n3\n4', ';', 2)).toEqual([['1'], ['2']])
  })
})

describe('detectDelimiter', () => {
  it('point-virgule malgré les virgules décimales (Excel français)', () => {
    expect(detectDelimiter('Nom;Montant\nA;1,5\nB;2,25\n')).toBe(';')
  })

  it('virgule, tabulation, barre verticale', () => {
    expect(detectDelimiter('name,price,qty\n"a; b",1.5,2\nc,2,3\n')).toBe(',')
    expect(detectDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t')
    expect(detectDelimiter('a|b\n1|2\n')).toBe('|')
  })

  it('point en dernier recours (export OpenProject), jamais devant un séparateur usuel', () => {
    const openProject = [
      'id.Sujet.Type.Assigné à.Statut.Temps passé.Date de début',
      '1056.Corrections du module.Epic.Marie Dubois.Closed."79.0".""',
      '1057.   US-001 : Afficher les trigrammes.Story.Marie Dubois.Closed."3.37".09/02/2026',
      '1058.Créer une colonne calculée.Feature.Karim Benali.In progress."0.25".10/02/2026',
    ].join('\n')
    expect(detectDelimiter(openProject)).toBe('.')
    const a = analyzeCsv(openProject)
    expect(a.columns.map((c) => c.header)).toEqual([
      'id',
      'Sujet',
      'Type',
      'Assigné à',
      'Statut',
      'Temps passé',
      'Date de début',
    ])
    expect(a.rows[1]?.[5]).toBe('3.37')
    // Des nombres à point décimal ne font pas du point le séparateur.
    expect(detectDelimiter('Nom,Prix\nA,1.5\nB,2.25\n')).toBe(',')
    expect(detectDelimiter('Nom;Prix\nA;1.5\nB;2.25\n')).toBe(';')
    // Une seule colonne de texte avec des points : pas de découpage hasardeux.
    expect(detectDelimiter('Note\nVoir p. 3\nFin.\n')).toBe(';')
  })

  it('ligne « sep= » prioritaire', () => {
    expect(detectDelimiter('sep=,\na;b,c\n')).toBe(',')
  })
})

describe('analyzeCsv', () => {
  it('en-têtes vides ou en double, lignes complétées', () => {
    const a = analyzeCsv('Nom;;Nom\nA;1\nB;2;3\n')
    expect(a.delimiter).toBe(';')
    expect(a.enriched).toBe(false)
    expect(a.columns.map((c) => c.header)).toEqual(['Nom', 'Colonne 2', 'Nom (2)'])
    expect(a.rows).toEqual([
      ['A', '1', ''],
      ['B', '2', '3'],
    ])
  })

  it('sans ligne d’en-tête', () => {
    const a = analyzeCsv('A;1\nB;2\n', { hasHeader: false })
    expect(a.columns.map((c) => c.header)).toEqual(['Colonne 1', 'Colonne 2'])
    expect(a.rows).toHaveLength(2)
  })

  it('fichier vide : erreur explicite', () => {
    expect(() => analyzeCsv('\n\n')).toThrow(CsvImportError)
  })

  it('reconnaît le CSV enrichi d’Atelier Tab', () => {
    const csv = toEnrichedCsv(
      buildAtelierPayload(data, 'tbl_planning_lots', sheetOf('tbl_planning_lots'), {
        exportedAt: new Date('2026-10-18T12:00:00Z'),
      }),
    )
    const a = analyzeCsv(csv)
    expect(a.enriched).toBe(true)
    expect(a.idIndex).toBe(1)
    expect(a.columns.map((c) => c.header)).toEqual([
      'Lot / Tâche',
      'Statut',
      'Coût HT',
      'Coût TTC',
      'Responsable',
      'Échéance',
    ])
    expect(a.columns[3]?.formulaIndex).toBeDefined()
  })
})

function sheetOf(tableId: string) {
  const sheet = new TableSheet()
  sheet.sync(data.tables[tableId]!, { collaborators: data.collaborators })
  return sheet
}

describe('inferFieldType', () => {
  const infer = (header: string, values: string[]) => inferFieldType(header, values, ctx)

  it('formats français', () => {
    expect(infer('Date', ['18/10/2026', '2026-11-30'])).toEqual({ type: 'date' })
    expect(infer('Montant', ['45 000,50 €', '1 200 €'])).toEqual({
      type: 'currency',
      currency: 'EUR',
    })
    expect(infer('TVA', ['20 %', '5,5 %'])).toEqual({ type: 'percent' })
    expect(infer('Payé', ['Oui', 'Non', 'oui'])).toEqual({ type: 'checkbox' })
    expect(infer('Quantité', ['12', '3,5', '-1'])).toEqual({ type: 'number' })
  })

  it('quelques coquilles sur un grand échantillon : type conservé, valeurs signalées ensuite', () => {
    const amounts = [...Array.from({ length: 19 }, (_, i) => `${i + 1} 000 €`), 'à voir']
    expect(infer('Montant', amounts)).toEqual({ type: 'currency', currency: 'EUR' })
    // Échantillon trop petit : aucune tolérance.
    expect(infer('Montant', ['1 000 €', '2 000 €', 'à voir'])).toEqual({ type: 'text' })
    const dates = [...Array.from({ length: 9 }, (_, i) => `0${i + 1}/10/2026`), 'fin octobre']
    expect(infer('Date', dates)).toEqual({ type: 'date' })
  })

  it('un en-tête de montant fait d’un nombre une devise', () => {
    expect(infer('Coût HT', ['45000', '28500'])).toEqual({ type: 'currency', currency: 'EUR' })
  })

  it('0 / 1 restent des nombres', () => {
    expect(infer('Flag', ['0', '1', '1'])).toEqual({ type: 'number' })
  })

  it('statuts de workflow et texte répétitif → select ; texte libre → text', () => {
    expect(infer('Statut', ['En cours', 'Terminé'])).toEqual({ type: 'select' })
    expect(infer('Lot', ['A', 'B', 'A', 'B', 'A'])).toEqual({ type: 'select' })
    expect(infer('Nom', ['Gros œuvre', 'Charpente', 'Isolation'])).toEqual({ type: 'text' })
  })

  it('collaborateurs connus → owner', () => {
    expect(infer('Qui', ['Marie Dubois', 'KB'])).toEqual({ type: 'owner' })
  })

  it('colonne vide → text', () => {
    expect(infer('X', [])).toEqual({ type: 'text' })
  })
})

describe('suggestMappings', () => {
  it('propose chaque rôle au plus une fois', () => {
    expect(
      suggestMappings([
        { header: 'Lot', type: 'text' },
        { header: 'État', type: 'select' },
        { header: 'Montant HT', type: 'currency' },
        { header: 'Montant TTC', type: 'currency' },
        { header: 'Fin prévue', type: 'date' },
        { header: 'Commentaires', type: 'text' },
        { header: 'Autre', type: 'text' },
      ]),
    ).toEqual([
      'entity_title',
      'workflow_state',
      'financial_ht',
      'financial_ttc',
      'due_date',
      'description',
      undefined,
    ])
  })

  it('export OpenProject : Type → type d’élément, Temps passé → temps passé (heures)', () => {
    expect(
      suggestMappings([
        { header: 'Sujet', type: 'text' },
        { header: 'Type', type: 'select' },
        { header: 'Statut', type: 'select' },
        { header: 'Temps passé', type: 'number' },
        { header: 'Quantité', type: 'number' },
      ]),
    ).toEqual(['entity_title', 'item_type', 'workflow_state', 'time_spent', 'quantity'])
  })

  it('rôles déjà pris exclus ; repli sur le premier texte', () => {
    expect(
      suggestMappings(
        [
          { header: 'Référence', type: 'text' },
          { header: 'Statut', type: 'select' },
        ],
        new Set(['workflow_state']),
      ),
    ).toEqual(['entity_title', undefined])
  })
})

const SAMPLE = [
  'Lot;Statut;Montant HT;Responsable;Échéance;Payé',
  'Électricité;En cours;12 500,00 €;Marie Dubois;30/11/2026;Non',
  'Plomberie;À faire;8 200 €;KB;15/12/2026;Oui',
  'Peinture;Terminé;4 000 €;;;Non',
  'Ravalement;En cours;19 000 €;SL;20/01/2027;Non',
].join('\r\n')

describe('import dans une nouvelle table', () => {
  const analysis = analyzeCsv(SAMPLE)
  const plan = suggestPlan(analysis, null, ctx)

  it('plan : types et rôles inférés', () => {
    expect(plan.mode).toBe('append')
    expect(plan.targets).toEqual([
      { kind: 'new', label: 'Lot', type: 'text', mapping: 'entity_title' },
      { kind: 'new', label: 'Statut', type: 'select', mapping: 'workflow_state' },
      {
        kind: 'new',
        label: 'Montant HT',
        type: 'currency',
        currency: 'EUR',
        mapping: 'financial_ht',
      },
      { kind: 'new', label: 'Responsable', type: 'owner', mapping: 'assignee' },
      { kind: 'new', label: 'Échéance', type: 'date', mapping: 'due_date' },
      { kind: 'new', label: 'Payé', type: 'checkbox', mapping: 'flag' },
    ])
  })

  it('valeurs converties ; statuts dans l’ordre du workflow', () => {
    const result = buildImport(analysis, plan, null, ctx)
    expect(result).toMatchObject({ inserted: 4, updated: 0, skipped: 0, issueCount: 0 })
    const [lot, statut, montant, resp, ech, paye] = result.changes.newFields
    expect(statut?.options?.choices?.map((c) => c.label)).toEqual([
      'À faire',
      'En cours',
      'Terminé',
    ])
    const first = result.changes.inserts[0]!.cells
    expect(first[lot!.id]).toBe('Électricité')
    expect(first[montant!.id]).toBe(12500)
    expect(first[resp!.id]).toBe('usr_md')
    expect(first[ech!.id]).toBe('2026-11-30')
    expect(first[paye!.id]).toBe(false)
    expect(result.changes.inserts[2]!.cells[resp!.id]).toBeUndefined()
  })

  it('valeur refusée : signalée, cellule laissée vide', () => {
    const bad = analyzeCsv('Nom;Montant\nA;12 €\nB;douze\n')
    const r = buildImport(bad, suggestPlan(bad, null, ctx), null, ctx)
    // « douze » n'est pas un nombre : la colonne est inférée en texte, rien n'est refusé.
    expect(r.issueCount).toBe(0)
    const forced = buildImport(
      bad,
      {
        mode: 'append',
        targets: [
          { kind: 'new', label: 'Nom', type: 'text' },
          { kind: 'new', label: 'Montant', type: 'currency' },
        ],
      },
      null,
      ctx,
    )
    expect(forced.issueCount).toBe(1)
    expect(forced.issues[0]).toMatchObject({ row: 2, column: 'Montant', value: 'douze' })
    expect(forced.inserted).toBe(2)
  })

  it('colonnes ignorées et lignes sans valeur', () => {
    const a = analyzeCsv('Nom;Note\nA;x\n;y\n')
    const r = buildImport(
      a,
      { mode: 'append', targets: [{ kind: 'new', label: 'Nom', type: 'text' }, { kind: 'skip' }] },
      null,
      ctx,
    )
    expect(r.changes.newFields).toHaveLength(1)
    expect(r).toMatchObject({ inserted: 1, skipped: 1 })
  })
})

describe('aller-retour du CSV enrichi', () => {
  it('nouvelle table : mêmes ids, mêmes formules, mêmes valeurs calculées', () => {
    const source = data.tables.tbl_planning_lots!
    const csv = toEnrichedCsv(
      buildAtelierPayload(data, source.id, sheetOf(source.id), { exportedAt: new Date() }),
    )
    const analysis = analyzeCsv(csv)
    const result = buildImport(analysis, suggestPlan(analysis, null, ctx), null, ctx)
    expect(result.issueCount).toBe(0)
    expect(result.formulas).toBe(3)
    const table = produce(
      { ...source, id: 'tbl_copy', fieldOrder: [], rowOrder: [], fields: {}, records: {} } as Table,
      (t) => {
        applyImport(t, result.changes)
      },
    )
    expect(table.rowOrder).toEqual(['rec_01', 'rec_02', 'rec_03'])
    const ttc = fieldByLabel(table, 'Coût TTC')
    expect(table.records.rec_02?.cells[ttc.id]).toBe('=C2*1.2')
    const value = computed(data, table)
    expect(value('rec_02', ttc.id)).toBe(34200)
    expect(value('rec_01', fieldByLabel(table, 'Statut').id)).toBe('En cours')
    expect(value('rec_01', fieldByLabel(table, 'Responsable').id)).toBe('Marie Dubois')
  })

  it('même table : mise à jour par identifiant, sans doublon', () => {
    const source = data.tables.tbl_planning_lots!
    const csv = toEnrichedCsv(
      buildAtelierPayload(data, source.id, sheetOf(source.id), { exportedAt: new Date() }),
    ).replace('45000', '47000')
    const analysis = analyzeCsv(csv)
    const plan = suggestPlan(analysis, source, ctx)
    expect(plan).toMatchObject({ mode: 'upsert', key: 'id' })
    expect(plan.targets.every((t) => t.kind === 'field' || t.kind === 'new')).toBe(true)
    const result = buildImport(analysis, plan, source, ctx)
    expect(result).toMatchObject({ inserted: 0, updated: 3, issueCount: 0 })
    const table = produce(source, (t) => {
      applyImport(t, result.changes)
    })
    expect(table.rowOrder).toEqual(source.rowOrder)
    expect(table.records.rec_01?.cells.cost_ht).toBe(47000)
    expect(computed(data, table)('rec_total', 'cost_ht')).toBe(90500)
  })
})

describe('import dans une table existante', () => {
  const planning = data.tables.tbl_planning_lots!

  it('ajout au-dessus du total : sommes étendues, formules décalées comme un copier-coller', () => {
    const a = analyzeCsv(
      'Lot / Tâche;Coût HT;Marge\nMenuiseries;10 000;=B1*0,1\nToiture;5 000;=B2*0,1\n',
    )
    const plan = suggestPlan(a, planning, ctx)
    expect(plan.targets.slice(0, 2)).toEqual([
      { kind: 'field', fieldId: 'task_name' },
      { kind: 'field', fieldId: 'cost_ht' },
    ])
    expect(plan.targets[2]).toMatchObject({ kind: 'new', label: 'Marge' })
    const result = buildImport(a, plan, planning, ctx)
    const table = produce(planning, (t) => {
      applyImport(t, result.changes)
    })
    expect(table.rowOrder).toHaveLength(6)
    expect(table.rowOrder.at(-1)).toBe('rec_total')
    const [r4, r5] = table.rowOrder.slice(3, 5) as [string, string]
    const marge = fieldByLabel(table, 'Marge')
    // Ligne 1 du CSV → ligne 4 de la table : B1 devient B4.
    expect(table.records[r4]?.cells[marge.id]).toBe('=B4*0,1')
    expect(table.records[r5]?.cells[marge.id]).toBe('=B5*0,1')
    expect(computed(data, table)('rec_total', 'cost_ht')).toBe(103500)
  })

  it('mise à jour par colonne clé : les cellules vides n’effacent rien', () => {
    const a = analyzeCsv(
      'Lot / Tâche;Coût HT;Échéance\ncharpente bois;30 000;\nCouverture;7 000;01/02/2027\n',
    )
    const plan = { ...suggestPlan(a, planning, ctx), mode: 'upsert' as const, key: 0 }
    const result = buildImport(a, plan, planning, ctx)
    expect(result).toMatchObject({ updated: 1, inserted: 1 })
    const table = produce(planning, (t) => {
      applyImport(t, result.changes)
    })
    expect(table.records.rec_02?.cells.cost_ht).toBe(30000)
    expect(table.records.rec_02?.cells.due_date).toBe('2026-12-15')
    expect(table.rowOrder).toHaveLength(5)
  })

  it('statut inconnu : ajouté aux choix au lieu d’être refusé', () => {
    const a = analyzeCsv('Lot / Tâche;Statut\nVRD;En cours\nClôture;Reporté\n')
    const result = buildImport(a, suggestPlan(a, planning, ctx), planning, ctx)
    expect(result.issueCount).toBe(0)
    expect(result.changes.addedChoices.status?.map((c) => c.label)).toEqual(['Reporté'])
    const table = produce(planning, (t) => {
      applyImport(t, result.changes)
    })
    const added = table.fields.status?.options?.choices?.at(-1)
    expect(added?.label).toBe('Reporté')
    const rid = table.rowOrder.at(-2) as string
    expect(table.records[rid]?.cells.status).toBe(added?.id)
  })

  it('cible inexistante ou ignorée : rien n’est écrit', () => {
    const a = analyzeCsv('X;Y\n1;2\n')
    const targets: ColumnTarget[] = [{ kind: 'field', fieldId: 'nope' }, { kind: 'skip' }]
    const r = buildImport(a, { mode: 'append', targets }, planning, ctx)
    expect(r).toMatchObject({ inserted: 0, skipped: 1 })
  })
})
