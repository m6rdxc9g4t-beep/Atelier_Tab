/**
 * Presse-papiers au format d'Excel et de Google Sheets : cellules séparées par des
 * tabulations, lignes par des retours à la ligne ; une cellule qui contient une tabulation,
 * un retour à la ligne ou un guillemet est entourée de guillemets (guillemets doublés).
 *
 * Module pur.
 */

/** Matrice de textes → texte TSV (lignes terminées par CRLF, comme Excel). */
export function toTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map((cell) => (/[\t\r\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join('\t'))
    .join('\r\n')
}

/**
 * Texte TSV → matrice de textes. Le dernier retour à la ligne (ajouté par Excel) est ignoré ;
 * toutes les lignes sont complétées à la même largeur.
 */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let i = 0
  let quoted = false
  const input = text.replace(/\r\n?/g, '\n')

  while (i < input.length) {
    const ch = input[i] as string
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"' && cell === '') {
      quoted = true
      i++
    } else if (ch === '\t') {
      row.push(cell)
      cell = ''
      i++
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i++
    } else {
      cell += ch
      i++
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  const width = Math.max(0, ...rows.map((r) => r.length))
  return rows.map((r) => (r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r))
}

/**
 * Étend un bloc copié à la zone de destination, comme Excel : une seule cellule copiée remplit
 * toute la sélection ; un bloc dont la sélection est un multiple exact est répété.
 * Sinon le bloc est collé tel quel à partir du coin supérieur gauche.
 */
export function tileToSelection<T>(block: T[][], rows: number, cols: number): T[][] {
  const h = block.length
  const w = block[0]?.length ?? 0
  if (h === 0 || w === 0) return block
  const fits = rows >= h && cols >= w && rows % h === 0 && cols % w === 0
  if (!fits || (rows === h && cols === w)) return block
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => block[r % h]?.[c % w] as T),
  )
}
