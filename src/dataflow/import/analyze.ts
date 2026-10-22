/**
 * Analyse d'un CSV avant import : en-têtes, colonnes sources, lignes de données.
 *
 * Reconnaît le **CSV enrichi** produit par l'export d'Atelier Tab (`transports/csv.ts`) :
 * colonnes « Ligne » et « Identifiant », en-têtes « C · Coût HT » et colonnes
 * « C · Coût HT (formule) ». Réimporté, il redonne les libellés d'origine, les formules à
 * la place des valeurs calculées et les identifiants de lignes (aller-retour sans perte).
 */
import { detectDelimiter, parseCsv, type CsvDelimiter, type CsvEncoding } from './csv-parse'

/** Au-delà, l'import est refusé : la grille et le moteur de calcul resteraient lents. */
export const MAX_IMPORT_ROWS = 50_000
export const MAX_IMPORT_COLUMNS = 200

export interface SourceColumn {
  /** Libellé proposé pour la colonne (en-tête nettoyé, unique). */
  header: string
  /** Index de la cellule dans une ligne du CSV. */
  index: number
  /** CSV enrichi : index de la colonne « (formule) » associée. */
  formulaIndex?: number
}

export interface CsvAnalysis {
  delimiter: CsvDelimiter
  encoding?: CsvEncoding
  hasHeader: boolean
  /** CSV enrichi d'Atelier Tab reconnu. */
  enriched: boolean
  columns: SourceColumn[]
  /** CSV enrichi : index de la colonne « Identifiant » (id des lignes d'origine). */
  idIndex?: number
  /** Lignes de données (sans l'en-tête). */
  rows: string[][]
}

export class CsvImportError extends Error {}

export interface AnalyzeOptions {
  /** Séparateur imposé ; sinon détecté. */
  delimiter?: CsvDelimiter
  /** La première ligne contient les noms de colonnes (défaut : oui). */
  hasHeader?: boolean
  encoding?: CsvEncoding
}

const ENRICHED_HEADER = /^([A-Z]{1,3}) · (.+)$/
const FORMULA_SUFFIX = ' (formule)'

/** Lit le texte d'un CSV et prépare ses colonnes. Lève `CsvImportError` si le fichier est vide ou trop gros. */
export function analyzeCsv(text: string, options: AnalyzeOptions = {}): CsvAnalysis {
  const delimiter = options.delimiter ?? detectDelimiter(text)
  const hasHeader = options.hasHeader ?? true
  const all = parseCsv(text, delimiter, MAX_IMPORT_ROWS + 2).filter((r) =>
    r.some((c) => c.trim() !== ''),
  )
  if (all.length === 0) throw new CsvImportError('Le fichier ne contient aucune donnée')
  const dataCount = all.length - (hasHeader ? 1 : 0)
  if (dataCount > MAX_IMPORT_ROWS) {
    throw new CsvImportError(
      `Fichier trop volumineux : plus de ${MAX_IMPORT_ROWS.toLocaleString('fr-FR')} lignes`,
    )
  }
  const width = all.reduce((w, r) => Math.max(w, r.length), 0)
  if (width > MAX_IMPORT_COLUMNS) {
    throw new CsvImportError(`Trop de colonnes : ${width} (maximum ${MAX_IMPORT_COLUMNS})`)
  }

  const headerRow = hasHeader ? (all[0] ?? []) : []
  const rows = (hasHeader ? all.slice(1) : all).map((r) =>
    r.length < width ? [...r, ...Array<string>(width - r.length).fill('')] : r,
  )
  const rawHeaders = Array.from({ length: width }, (_, i) => (headerRow[i] ?? '').trim())

  const enriched =
    hasHeader &&
    rawHeaders[0] === 'Ligne' &&
    rawHeaders[1] === 'Identifiant' &&
    width > 2 &&
    rawHeaders.slice(2).every((h) => ENRICHED_HEADER.test(h))

  const columns: SourceColumn[] = []
  let idIndex: number | undefined
  if (enriched) {
    idIndex = 1
    const byHeader = new Map<string, SourceColumn>()
    rawHeaders.forEach((h, index) => {
      if (index < 2) return
      if (h.endsWith(FORMULA_SUFFIX)) {
        const base = byHeader.get(h.slice(0, -FORMULA_SUFFIX.length))
        if (base) {
          base.formulaIndex = index
          return
        }
      }
      const label = ENRICHED_HEADER.exec(h)?.[2] ?? h
      const col: SourceColumn = { header: label, index }
      byHeader.set(h, col)
      columns.push(col)
    })
  } else {
    rawHeaders.forEach((h, index) => columns.push({ header: h, index }))
  }

  // En-têtes vides ou en double : « Colonne 3 », « Montant (2) ».
  const seen = new Map<string, number>()
  for (const [i, col] of columns.entries()) {
    let label = col.header || `Colonne ${i + 1}`
    const key = label.toLocaleLowerCase('fr')
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    if (n > 1) label = `${label} (${n})`
    col.header = label
  }

  return {
    delimiter,
    ...(options.encoding ? { encoding: options.encoding } : {}),
    hasHeader,
    enriched,
    columns,
    ...(idIndex !== undefined ? { idIndex } : {}),
    rows,
  }
}

/**
 * Valeur d'une colonne source sur une ligne : la formule si le CSV enrichi en donne une,
 * sinon la valeur (espaces de début et de fin retirés).
 */
export function sourceValue(row: readonly string[], col: SourceColumn): string {
  if (col.formulaIndex !== undefined) {
    const f = (row[col.formulaIndex] ?? '').trim()
    if (f.startsWith('=') && f.length > 1) return f
  }
  return (row[col.index] ?? '').trim()
}

/** Valeurs non vides d'une colonne (formules exclues), pour l'inférence de type. */
export function columnSample(analysis: CsvAnalysis, col: SourceColumn, limit = 5000): string[] {
  const out: string[] = []
  for (const row of analysis.rows) {
    const v = sourceValue(row, col)
    if (v !== '' && !v.startsWith('=')) out.push(v)
    if (out.length >= limit) break
  }
  return out
}
