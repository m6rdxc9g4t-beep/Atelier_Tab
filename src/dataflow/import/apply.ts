/**
 * Application des changements d'un import à une table. Pure (aucun store) mais conçue pour
 * un producteur Immer : la table reçue est modifiée sur place, en une seule mise à jour.
 */
import { insertField, insertRecords } from '@/engine/table'
import { newId } from '@/lib/ids'
import type { Table, TableRecord } from '@/types/domain'
import type { ImportChanges } from './build'

/** Applique l'import ; renvoie les ids des lignes ajoutées. */
export function applyImport(table: Table, changes: ImportChanges): string[] {
  for (const field of changes.newFields) {
    if (!table.fields[field.id]) insertField(table, structuredClone(field))
  }

  for (const [fieldId, added] of Object.entries(changes.addedChoices)) {
    const field = table.fields[fieldId]
    if (field?.type !== 'select') continue
    const choices = field.options?.choices ?? []
    const fresh = added.filter((c) => !choices.some((x) => x.id === c.id))
    field.options = { ...field.options, choices: [...choices, ...fresh] }
  }

  // Mises à jour avant les insertions : les formules mises à jour suivent ensuite le décalage.
  for (const { recordId, cells } of changes.updates) {
    const record = table.records[recordId]
    if (!record) continue
    for (const [fieldId, input] of Object.entries(cells)) {
      if (table.fields[fieldId] && input !== null && input !== '') record.cells[fieldId] = input
    }
  }

  const records: TableRecord[] = changes.inserts.map(({ id, cells }) => ({
    id: id && !table.records[id] ? id : newId('rec'),
    kind: 'data',
    cells: Object.fromEntries(
      Object.entries(cells).filter(
        ([fieldId, v]) => table.fields[fieldId] && v !== null && v !== '',
      ),
    ),
  }))
  // Deux lignes du même import ne peuvent pas partager un id.
  const seen = new Set<string>()
  for (const r of records) {
    if (seen.has(r.id)) r.id = newId('rec')
    seen.add(r.id)
  }
  insertRecords(table, records)
  return records.map((r) => r.id)
}
