/**
 * Lecture d'un fichier CSV : encodage, séparateur et découpage RFC 4180.
 *
 * Pensé pour les fichiers produits par Excel en français : séparateur `;`, encodage
 * Windows-1252 (accents), ligne `sep=;` éventuelle, retours à la ligne dans les cellules
 * entre guillemets. Module pur, sans dépendance au DOM ni au store.
 */

export type CsvDelimiter = ';' | ',' | '\t' | '|' | '.'
export type CsvEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

/** Séparateurs usuels, par ordre de préférence en cas d'égalité : `;` d'abord (Excel français). */
const USUAL_DELIMITERS: readonly CsvDelimiter[] = [';', ',', '\t', '|']

/**
 * Le point, séparateur de certains exports (OpenProject…), n'est essayé qu'en dernier recours :
 * il apparaît aussi dans les nombres (`1.5`) et dans le texte.
 */
const FALLBACK_DELIMITERS: readonly CsvDelimiter[] = ['.']

export const CSV_DELIMITERS: readonly CsvDelimiter[] = [...USUAL_DELIMITERS, ...FALLBACK_DELIMITERS]

export const DELIMITER_LABELS: Record<CsvDelimiter, string> = {
  ';': 'Point-virgule (;)',
  ',': 'Virgule (,)',
  '\t': 'Tabulation',
  '|': 'Barre verticale (|)',
  '.': 'Point (.)',
}

/**
 * Décode les octets d'un fichier : BOM UTF-8 / UTF-16 s'il y en a un, sinon UTF-8 strict,
 * et à défaut Windows-1252 (exports d'Excel sur Windows, « Coût » mal lu en UTF-8 sinon).
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }
  try {
    // `fatal` : une séquence invalide (octet Windows-1252 isolé) lève une erreur.
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

const SEP_LINE = /^"?sep=(.)"?\r?\n/i

/** Ligne `sep=;` qu'Excel accepte en tête de fichier : séparateur imposé. */
export function explicitDelimiter(text: string): CsvDelimiter | null {
  const m = SEP_LINE.exec(stripBom(text))
  const d = m?.[1]
  return d && (CSV_DELIMITERS as readonly string[]).includes(d) ? (d as CsvDelimiter) : null
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Découpe un texte CSV en lignes de cellules (RFC 4180) : guillemets doublés, séparateurs
 * et retours à la ligne dans les cellules entre guillemets, fins de ligne `\r\n`, `\n` ou `\r`.
 * Les lignes entièrement vides sont ignorées. `maxRows` arrête la lecture au-delà.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter, maxRows = Infinity): string[][] {
  let src = stripBom(text)
  const sep = SEP_LINE.exec(src)
  if (sep) src = src.slice(sep[0].length)

  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const n = src.length

  const endRow = () => {
    row.push(cell)
    cell = ''
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  while (i < n && rows.length < maxRows) {
    const ch = src[i] as string
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
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
    if (ch === '"' && cell.trim() === '') {
      // Guillemet ouvrant (des espaces avant sont tolérés et ignorés).
      cell = ''
      quoted = true
      i++
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
      i++
    } else if (ch === '\r' || ch === '\n') {
      endRow()
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
    } else {
      cell += ch
      i++
    }
  }
  if (rows.length < maxRows && (cell !== '' || row.length > 0)) endRow()
  return rows
}

/** Taille de l'échantillon examiné pour deviner le séparateur. */
const SNIFF_CHARS = 64 * 1024
const SNIFF_ROWS = 40

/** Régularité (part des lignes au nombre de colonnes le plus fréquent) et nombre de colonnes. */
function shape(sample: string, d: CsvDelimiter): { regularity: number; width: number } | null {
  const rows = parseCsv(sample, d, SNIFF_ROWS)
  if (rows.length === 0) return null
  const counts = new Map<number, number>()
  for (const r of rows) counts.set(r.length, (counts.get(r.length) ?? 0) + 1)
  let width = 1
  let modeRows = 0
  for (const [w, k] of counts) {
    if (k > modeRows || (k === modeRows && w > width)) {
      width = w
      modeRows = k
    }
  }
  return width < 2 ? null : { regularity: modeRows / rows.length, width }
}

/** En dessous, aucun séparateur usuel ne découpe le fichier proprement. */
const GOOD_REGULARITY = 0.9

/**
 * Devine le séparateur : celui qui donne le même nombre de colonnes (au moins deux) sur le
 * plus de lignes de l'échantillon. Égalité : `;`, puis `,`, tabulation et `|`. Le point n'est
 * retenu que si aucun séparateur usuel ne convient et qu'il découpe très régulièrement.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const explicit = explicitDelimiter(text)
  if (explicit) return explicit
  let sample = text.length > SNIFF_CHARS ? text.slice(0, SNIFF_CHARS) : text
  if (sample.length < text.length) {
    // Dernière ligne coupée : on l'écarte.
    const cut = Math.max(sample.lastIndexOf('\n'), sample.lastIndexOf('\r'))
    if (cut > 0) sample = sample.slice(0, cut)
  }
  let best: CsvDelimiter = ';'
  let bestScore = 0
  let bestRegularity = 0
  for (const d of USUAL_DELIMITERS) {
    const s = shape(sample, d)
    if (!s) continue
    // Régularité d'abord, puis nombre de colonnes.
    const score = s.regularity * 1000 + Math.min(s.width, 999)
    if (score > bestScore) {
      best = d
      bestScore = score
      bestRegularity = s.regularity
    }
  }
  if (bestRegularity >= GOOD_REGULARITY) return best
  for (const d of FALLBACK_DELIMITERS) {
    const s = shape(sample, d)
    if (s && s.width >= 3 && s.regularity >= GOOD_REGULARITY && s.regularity > bestRegularity) {
      return d
    }
  }
  return best
}
