/**
 * CSV enrichi : une colonne par champ avec la valeur calculée, plus une colonne
 * « (formule) » pour chaque champ contenant des formules, afin de garder la trace
 * du calcul. Séparateur `;` et BOM UTF-8 : s'ouvre correctement dans Excel en français.
 */
import type { AtelierPayload } from '../schema/atelier.v2_1'

const SEP = ';'
const BOM = '﻿'

function cell(value: string | number | boolean | null): string {
  if (value === null) return ''
  const text = typeof value === 'number' ? String(value).replace('.', ',') : String(value)
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toEnrichedCsv(payload: AtelierPayload): string {
  const { columns_schema: columns, records } = payload.project
  const formulaColumns = new Set(
    columns
      .filter((c) => records.some((r) => r.values[c.col_letter]?.raw.startsWith('=')))
      .map((c) => c.col_letter),
  )

  const header = ['Ligne', 'Identifiant']
  for (const c of columns) {
    header.push(`${c.col_letter} · ${c.label}`)
    if (formulaColumns.has(c.col_letter)) header.push(`${c.col_letter} · ${c.label} (formule)`)
  }

  const lines = [header.map(cell).join(SEP)]
  for (const r of records) {
    const row: (string | number | boolean | null)[] = [r.row_index, r.record_id]
    for (const c of columns) {
      const v = r.values[c.col_letter]
      row.push(v?.computed ?? null)
      if (formulaColumns.has(c.col_letter)) row.push(v?.raw.startsWith('=') ? v.raw : '')
    }
    lines.push(row.map(cell).join(SEP))
  }
  return BOM + lines.join('\r\n') + '\r\n'
}
