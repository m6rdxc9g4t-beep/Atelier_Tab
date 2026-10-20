/**
 * Données de démonstration, reprises de la spécification fonctionnelle
 * (projet « Rénovation Urbaine 2026 »). Chargées au premier lancement.
 *
 * Écart volontaire avec la maquette d'origine : le coût TTC est une colonne-formule
 * distincte (D = C × 1,2) et la ligne TOTAL est une ligne de synthèse, exclue des
 * agrégats. Voir docs/DATAFLOW_SPEC.md.
 *
 * Les statuts du planning sont les 8 statuts communs de la Suite Atelier (docs/SUITE.md
 * §1.4) : ils s'affichent avec les couleurs officielles et sont reconnus tels quels par
 * Atelier Projets à l'import.
 */
import { mergeAtelierStatuses } from '@/engine/field-types'
import { buildTable, createView, DEFAULT_STATUS_CHOICES } from '@/store/factories'
import type { AppData, Collaborator, Field, TableRecord } from '@/types/domain'

const collaborators: Collaborator[] = [
  { id: 'usr_md', name: 'Marie Dubois', initials: 'MD', color: 'violet' },
  { id: 'usr_kb', name: 'Karim Benali', initials: 'KB', color: 'teal' },
  { id: 'usr_sl', name: 'Sophie Laurent', initials: 'SL', color: 'amber' },
]

const rec = (
  id: string,
  cells: TableRecord['cells'],
  kind: TableRecord['kind'] = 'data',
): TableRecord => ({
  id,
  kind,
  cells,
})

// --- Rénovation Urbaine 2026 › Planning & Lots ---------------------------------

const planningFields: Field[] = [
  {
    id: 'task_name',
    label: 'Lot / Tâche',
    type: 'text',
    atelierMapping: 'entity_title',
    width: 220,
  },
  {
    id: 'status',
    label: 'Statut',
    type: 'select',
    atelierMapping: 'workflow_state',
    // Ids des statuts par défaut conservés (opt_todo, opt_doing…), libellés officiels.
    options: { choices: mergeAtelierStatuses(DEFAULT_STATUS_CHOICES) },
  },
  {
    id: 'cost_ht',
    label: 'Coût HT',
    type: 'currency',
    atelierMapping: 'financial_ht',
    options: { currency: 'EUR' },
  },
  {
    id: 'cost_ttc',
    label: 'Coût TTC',
    type: 'formula',
    columnFormula: '=C1*1.2',
    atelierMapping: 'financial_ttc',
    options: { resultFormat: 'currency', currency: 'EUR' },
  },
  { id: 'owner', label: 'Responsable', type: 'owner', atelierMapping: 'assignee' },
  { id: 'due_date', label: 'Échéance', type: 'date', atelierMapping: 'due_date' },
]

const planning = buildTable({
  id: 'tbl_planning_lots',
  projectId: 'proj_renovation_2026',
  name: 'Planning & Lots',
  fields: planningFields,
  records: [
    rec('rec_01', {
      task_name: 'Gros œuvre',
      status: 'opt_doing',
      cost_ht: 45000,
      owner: 'usr_md',
      due_date: '2026-11-30',
    }),
    rec('rec_02', {
      task_name: 'Charpente bois',
      status: 'opt_done',
      cost_ht: 28500,
      owner: 'usr_kb',
      due_date: '2026-12-15',
    }),
    rec('rec_03', {
      task_name: 'Isolation thermique',
      status: 'opt_todo',
      cost_ht: 15000,
      owner: 'usr_sl',
      due_date: '2027-01-20',
    }),
    rec(
      'rec_total',
      { task_name: 'TOTAL', cost_ht: '=SUM(C1:C3)', cost_ttc: '=SUM(D1:D3)' },
      'summary',
    ),
  ],
  views: [
    createView('hybrid', { id: 'view_planning_grid' }),
    createView('kanban', { id: 'view_planning_kanban', groupByFieldId: 'status' }),
    createView('sheet', { id: 'view_planning_sheet' }),
  ],
})

// --- Rénovation Urbaine 2026 › Budget Global -----------------------------------

const budget = buildTable({
  id: 'tbl_budget_global',
  projectId: 'proj_renovation_2026',
  name: 'Budget Global',
  fields: [
    { id: 'bg_item', label: 'Poste', type: 'text', atelierMapping: 'entity_title', width: 220 },
    { id: 'bg_ht', label: 'Montant HT', type: 'currency', atelierMapping: 'financial_ht' },
    { id: 'bg_vat', label: 'TVA', type: 'percent' },
    {
      id: 'bg_ttc',
      label: 'Montant TTC',
      type: 'formula',
      columnFormula: '=B1*(1+C1)',
      atelierMapping: 'financial_ttc',
      options: { resultFormat: 'currency' },
    },
  ],
  records: [
    rec('rec_bg_1', { bg_item: 'Études & honoraires', bg_ht: 18000, bg_vat: 0.2 }),
    rec('rec_bg_2', { bg_item: 'Travaux (lots)', bg_ht: 88500, bg_vat: 0.2 }),
    rec('rec_bg_3', { bg_item: 'Aléas (5 %)', bg_ht: '=B2*5%', bg_vat: 0.2 }),
    rec(
      'rec_bg_total',
      { bg_item: 'TOTAL', bg_ht: '=SUM(B1:B3)', bg_ttc: '=SUM(D1:D3)' },
      'summary',
    ),
  ],
  views: [createView('hybrid', { id: 'view_budget_grid' })],
})

// --- Rénovation Urbaine 2026 › Calculs Surfaces --------------------------------

const surfaces = buildTable({
  id: 'tbl_calculs_surfaces',
  projectId: 'proj_renovation_2026',
  name: 'Calculs Surfaces',
  fields: [
    { id: 'sf_room', label: 'Pièce', type: 'text', atelierMapping: 'entity_title', width: 200 },
    { id: 'sf_len', label: 'Longueur (m)', type: 'number', options: { decimals: 2 } },
    { id: 'sf_wid', label: 'Largeur (m)', type: 'number', options: { decimals: 2 } },
    {
      id: 'sf_area',
      label: 'Surface (m²)',
      type: 'formula',
      columnFormula: '=ROUND(B1*C1, 2)',
      atelierMapping: 'quantity',
      options: { resultFormat: 'number', decimals: 2 },
    },
  ],
  records: [
    rec('rec_sf_1', { sf_room: 'Hall d’accueil', sf_len: 8.4, sf_wid: 6.2 }),
    rec('rec_sf_2', { sf_room: 'Salle polyvalente', sf_len: 14, sf_wid: 9.5 }),
    rec('rec_sf_3', { sf_room: 'Bureaux', sf_len: 11.2, sf_wid: 7.8 }),
    rec('rec_sf_total', { sf_room: 'TOTAL', sf_area: '=SUM(D1:D3)' }, 'summary'),
  ],
  views: [createView('hybrid', { id: 'view_surfaces_grid' })],
})

// --- Espace Ingénierie › Chiffrage Matériaux -----------------------------------

const materials = buildTable({
  id: 'tbl_materiaux',
  projectId: 'proj_chiffrage_materiaux',
  name: 'Matériaux',
  fields: [
    { id: 'mt_name', label: 'Matériau', type: 'text', atelierMapping: 'entity_title', width: 220 },
    { id: 'mt_qty', label: 'Quantité', type: 'number', atelierMapping: 'quantity' },
    { id: 'mt_unit', label: 'Prix unitaire', type: 'currency', options: { decimals: 2 } },
    {
      id: 'mt_total',
      label: 'Total HT',
      type: 'formula',
      columnFormula: '=B1*C1',
      atelierMapping: 'financial_ht',
      options: { resultFormat: 'currency', decimals: 2 },
    },
    { id: 'mt_ordered', label: 'Commandé', type: 'checkbox', atelierMapping: 'flag' },
  ],
  records: [
    rec('rec_mt_1', { mt_name: 'Béton C25/30 (m³)', mt_qty: 42, mt_unit: 118.5, mt_ordered: true }),
    rec('rec_mt_2', {
      mt_name: 'Poutres lamellé-collé (ml)',
      mt_qty: 96,
      mt_unit: 64.9,
      mt_ordered: false,
    }),
    rec('rec_mt_3', {
      mt_name: 'Laine de bois 160 mm (m²)',
      mt_qty: 310,
      mt_unit: 21.4,
      mt_ordered: false,
    }),
  ],
  views: [createView('hybrid', { id: 'view_materiaux_grid' })],
})

export function createDemoData(): AppData {
  return {
    schemaVersion: 1,
    // Hors ligne par défaut (docs/SUITE.md §5.1).
    preferences: { onlineMode: false },
    workspaceOrder: ['ws_arch_01', 'ws_inge_01'],
    workspaces: {
      ws_arch_01: {
        id: 'ws_arch_01',
        name: 'Espace Architecture',
        projectIds: ['proj_renovation_2026'],
      },
      ws_inge_01: {
        id: 'ws_inge_01',
        name: 'Espace Ingénierie',
        projectIds: ['proj_chiffrage_materiaux'],
      },
    },
    projects: {
      proj_renovation_2026: {
        id: 'proj_renovation_2026',
        workspaceId: 'ws_arch_01',
        name: 'Rénovation Urbaine 2026',
        tableIds: [budget.id, planning.id, surfaces.id],
      },
      proj_chiffrage_materiaux: {
        id: 'proj_chiffrage_materiaux',
        workspaceId: 'ws_inge_01',
        name: 'Chiffrage Matériaux',
        tableIds: [materials.id],
      },
    },
    tables: structuredClone({
      [budget.id]: budget,
      [planning.id]: planning,
      [surfaces.id]: surfaces,
      [materials.id]: materials,
    }),
    collaborators: Object.fromEntries(collaborators.map((c) => [c.id, c])),
    integrations: { atelierProjets: {} },
  }
}

/** Table ouverte par défaut au premier lancement. */
export const DEMO_DEFAULT_TABLE_ID = planning.id
