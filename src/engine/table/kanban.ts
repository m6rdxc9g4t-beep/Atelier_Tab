/**
 * Mise en page du Kanban : ce qu'une carte montre, et les lignes (« couloirs ») qui alignent
 * les cartes d'une même valeur d'une colonne à l'autre.
 *
 * Module pur : les valeurs calculées sont lues par la fonction `value` reçue.
 */
import { isError, type CellValue } from '@/engine/formula'
import { formatValue } from '@/engine/field-types'
import type { Field, Table, View } from '@/types/domain'
import { compareForSort, type ValueOf } from './view'

/** Nombre de champs d'une carte, en plus du titre (pastille comprise). */
export const KANBAN_CARD_FIELDS = 4

/** Nombre maximal de cartes posées côte à côte dans une case (colonne × ligne). */
export const KANBAN_MAX_ACROSS = 4

/** Une cellule sans rien à montrer sur une carte (une case décochée n'y dit rien non plus). */
export function isBlankOnCard(field: Field, value: CellValue): boolean {
  if (field.type === 'checkbox') return value !== true
  return value === null || value === '' || (typeof value === 'string' && value.trim() === '')
}

export interface KanbanCardLayout {
  /** Titre : la première colonne de la table. */
  primary: Field | undefined
  /** Liste de choix montrée en pastille, sur la ligne du titre. */
  badge: Field | undefined
  /** Champs suivants : une rangée chacun, la même sur toutes les cartes. */
  fields: Field[]
}

/**
 * Champs d'une carte : les premières colonnes visibles, hors titre, colonne de regroupement et
 * colonne des lignes. Une colonne vide sur toutes les lignes de la table n'occupe pas de rangée ;
 * les autres en ont une sur chaque carte, même vide, pour que la date et les montants tombent au
 * même endroit d'une carte à l'autre.
 */
export function kanbanCardLayout(
  table: Table,
  visibleFieldIds: readonly string[],
  excludedFieldIds: readonly (string | undefined)[],
  value: ValueOf,
  max = KANBAN_CARD_FIELDS,
): KanbanCardLayout {
  const primary = table.fields[table.fieldOrder[0] ?? '']
  const excluded = new Set([primary?.id, ...excludedFieldIds])
  const data = table.rowOrder.filter((id) => table.records[id]?.kind === 'data')
  const shown: Field[] = []
  for (const id of visibleFieldIds) {
    if (shown.length >= max) break
    const field = table.fields[id]
    if (!field || excluded.has(id)) continue
    if (data.some((recordId) => !isBlankOnCard(field, value(recordId, id)))) shown.push(field)
  }
  const badge = shown.find((f) => f.type === 'select')
  return { primary, badge, fields: shown.filter((f) => f !== badge) }
}

/**
 * Lignes proposées d'office : la première colonne date (hors colonne des colonnes) dont les
 * valeurs se répètent vraiment — au moins deux lignes par date en moyenne, comme une recette et
 * ses agences le même jour. Des échéances toutes différentes ne forment pas de lignes : une carte
 * par ligne ne s'aligne sur rien.
 */
export function kanbanDefaultLaneField(
  table: Table,
  groupField: Field | undefined,
): Field | undefined {
  const data = table.rowOrder.map((id) => table.records[id]).filter((r) => r?.kind === 'data')
  for (const id of table.fieldOrder) {
    const field = table.fields[id]
    if (field?.type !== 'date' || field.id === groupField?.id) continue
    const dated = data
      .map((r) => r?.cells[field.id])
      .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    if (dated.length >= 2 && new Set(dated.map(String)).size * 2 <= dated.length) return field
  }
  return undefined
}

/**
 * Colonne qui forme les lignes du Kanban : celle choisie pour la vue (toute colonne, sauf celle
 * des colonnes) ; chaîne vide = cartes empilées, choisi exprès ; sans choix enregistré, les
 * lignes proposées d'office (`kanbanDefaultLaneField`).
 */
export function kanbanLaneField(
  table: Table,
  view: View | undefined,
  groupField: Field | undefined,
): Field | undefined {
  const chosen = view?.laneByFieldId
  if (chosen === '') return undefined
  const field = chosen ? table.fields[chosen] : undefined
  if (!field) return kanbanDefaultLaneField(table, groupField)
  return field.id !== groupField?.id ? field : undefined
}

/** Une ligne du Kanban : les cartes d'une même valeur, toutes colonnes confondues. */
export interface KanbanLane {
  /** Valeur affichée (« 30/11/2026 »), ou chaîne vide pour les cartes sans valeur. */
  key: string
  /** Libellé de la ligne. */
  label: string
  recordIds: string[]
}

/** Libellé de la ligne des cartes sans valeur. */
export const KANBAN_NO_LANE = 'Sans valeur'

function laneKey(field: Field, value: CellValue): string {
  if (field.type === 'checkbox') return value === true ? 'Coché' : 'Non coché'
  if (isError(value) || isBlankOnCard(field, value)) return ''
  return formatValue(field, value)
}

/**
 * Lignes du Kanban : une par valeur affichée de `field`, dans l'ordre de la colonne (dates et
 * nombres croissants, choix dans leur ordre, texte alphabétique ; `desc` l'inverse), les cartes
 * sans valeur à la fin. Dans une ligne, les cartes gardent l'ordre de la vue.
 */
export function kanbanLanes(
  field: Field,
  recordIds: readonly string[],
  value: ValueOf,
  direction: 'asc' | 'desc' = 'asc',
): KanbanLane[] {
  const lanes = new Map<string, KanbanLane & { sample: CellValue }>()
  for (const recordId of recordIds) {
    const v = value(recordId, field.id)
    const key = laneKey(field, v)
    let lane = lanes.get(key)
    if (!lane) {
      lane = { key, label: key || KANBAN_NO_LANE, recordIds: [], sample: v }
      lanes.set(key, lane)
    }
    lane.recordIds.push(recordId)
  }
  const sign = direction === 'desc' ? -1 : 1
  return [...lanes.values()]
    .sort((a, b) => {
      if (a.key === '' || b.key === '') return a.key === '' ? (b.key === '' ? 0 : 1) : -1
      return sign * compareForSort(field, a.sample, b.sample)
    })
    .map(({ key, label, recordIds: ids }) => ({ key, label, recordIds: ids }))
}

/**
 * Cartes d'une colonne rangées par ligne : `cells[i]` répond à `lanes[i]`. `across` est le
 * nombre de cartes côte à côte, donc la largeur utile de la colonne : celui de la case remplie
 * la plus courante (à égalité, la plus large), plafonné. Une case plus remplie passe à la ligne
 * dans sa propre rangée plutôt que d'élargir la colonne pour toutes les dates ; la ligne des
 * cartes sans valeur ne compte que si elle est seule.
 */
export function kanbanCells(
  lanes: readonly KanbanLane[],
  columnRecordIds: readonly string[],
  maxAcross = KANBAN_MAX_ACROSS,
): { cells: string[][]; across: number } {
  const inColumn = new Set(columnRecordIds)
  const cells = lanes.map((lane) => lane.recordIds.filter((id) => inColumn.has(id)))
  const sizes = new Map<number, number>()
  const count = (cell: string[]) => {
    if (cell.length) sizes.set(cell.length, (sizes.get(cell.length) ?? 0) + 1)
  }
  cells.forEach((cell, i) => {
    if (lanes[i]?.key !== '') count(cell)
  })
  if (sizes.size === 0) cells.forEach(count)
  let across = 1
  let best = 0
  for (const [size, n] of sizes) {
    if (n > best || (n === best && size > across)) {
      across = size
      best = n
    }
  }
  return { cells, across: Math.max(1, Math.min(maxAcross, across)) }
}
