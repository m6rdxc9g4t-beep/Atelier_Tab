/**
 * Résolution des références écrites par une IA (ou un humain) : une table par son id
 * ou son nom, une colonne par sa lettre, son id ou son libellé, une ligne par son numéro
 * affiché ou son id. Les erreurs listent les possibilités pour que l'IA se corrige.
 */
import { columnToLetters, lettersToColumn } from '@/engine/formula'
import type { AppData, Field, Project, Table, Workspace } from '@/types/domain'

export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

/** Comparaison insensible à la casse et aux accents. */
export function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, 'fr', { sensitivity: 'base' }) === 0
}

function pick<T extends { id: string; name: string }>(items: T[], ref: string, kind: string): T {
  const byId = items.find((i) => i.id === ref)
  if (byId) return byId
  const byName = items.filter((i) => sameName(i.name, ref.trim()))
  if (byName.length === 1 && byName[0]) return byName[0]
  const list = items.map((i) => `« ${i.name} » (${i.id})`).join(', ')
  if (byName.length > 1) {
    throw new ToolError(`Plusieurs ${kind}s s'appellent « ${ref} » : précisez l'id parmi ${list}`)
  }
  throw new ToolError(`${kind} introuvable : « ${ref} ». Disponibles : ${list || 'aucun'}`)
}

export function resolveTable(data: AppData, ref: string): Table {
  return pick(Object.values(data.tables), ref, 'table')
}

export function resolveProject(data: AppData, ref: string): Project {
  return pick(Object.values(data.projects), ref, 'projet')
}

export function resolveWorkspace(data: AppData, ref: string): Workspace {
  return pick(Object.values(data.workspaces), ref, 'espace')
}

/** Lettre de colonne actuelle d'un champ. */
export function letterOf(table: Table, fieldId: string): string {
  return columnToLetters(table.fieldOrder.indexOf(fieldId))
}

export function resolveColumn(table: Table, ref: string): Field {
  const r = ref.trim()
  const direct = table.fields[r]
  if (direct) return direct
  const byLabel = table.fieldOrder
    .map((id) => table.fields[id])
    .filter((f): f is Field => f !== undefined && sameName(f.label, r))
  if (byLabel.length === 1 && byLabel[0]) return byLabel[0]
  if (/^[A-Za-z]{1,3}$/.test(r)) {
    const field = table.fields[table.fieldOrder[lettersToColumn(r)] ?? '']
    if (field) return field
  }
  const list = table.fieldOrder
    .map((id, i) => `${columnToLetters(i)} « ${table.fields[id]?.label ?? id} »`)
    .join(', ')
  throw new ToolError(`Colonne introuvable : « ${ref} ». Colonnes de « ${table.name} » : ${list}`)
}

/** Ligne par numéro affiché (1 = première ligne) ou par id d'enregistrement. */
export function resolveRow(table: Table, ref: string | number): string {
  if (typeof ref === 'string' && table.records[ref]) return ref
  const n = typeof ref === 'number' ? ref : /^\d+$/.test(ref.trim()) ? Number(ref) : NaN
  const id = Number.isInteger(n) ? table.rowOrder[n - 1] : undefined
  if (id) return id
  throw new ToolError(
    `Ligne introuvable : ${JSON.stringify(ref)}. « ${table.name} » a ${table.rowOrder.length} ligne(s), numérotées à partir de 1.`,
  )
}

export function rowNumberOf(table: Table, recordId: string): number {
  return table.rowOrder.indexOf(recordId) + 1
}
