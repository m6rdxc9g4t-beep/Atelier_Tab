/**
 * Actions de la grille : sélection (cellule active et plage), édition, presse-papiers,
 * recopie, lignes. Elles orchestrent les stores et le moteur ; les composants se contentent
 * de les appeler.
 *
 * Coordonnées : celles de la vue (lignes filtrées et triées, colonnes visibles). Les formules
 * recopiées ou collées sont décalées selon les adresses A1 de la table, pas selon l'affichage.
 * Chaque action qui modifie une table passe par `undoable` : une action = une étape annulable.
 */
import {
  parseUserInput,
  toClipboardText,
  toEditText,
  type LookupContext,
} from '@/engine/field-types'
import { isFormula, translateFormula, type CellInput } from '@/engine/formula'
import { fillPlan, parseTsv, tileToSelection, toTsv } from '@/engine/table'
import type { Table, TableRecord } from '@/types/domain'
import type { CellWrite } from './data.store'
import { undo, undoable } from './history'
import { getSheet, useDataStore, useNotices } from './index'
import { useUIStore, type CellPosition } from './ui.store'
import { activeView, getViewRows, visibleFieldIds } from './view-rows'

export { visibleFieldIds }

export type Move = 'up' | 'down' | 'left' | 'right' | 'none'

function lookup(): LookupContext {
  return { collaborators: useDataStore.getState().collaborators }
}

export function getActiveTable(): Table | undefined {
  const id = useUIStore.getState().activeTableId
  const tables = useDataStore.getState().tables
  return (id ? tables[id] : undefined) ?? Object.values(tables)[0]
}

/**
 * Saisie à montrer pour une cellule : la valeur stockée, ou pour une colonne-formule
 * la formule recopiée sur la ligne (ex. `=C2*1.2`).
 */
export function effectiveInputOf(tableId: string, cell: CellPosition): CellInput {
  const table = useDataStore.getState().tables[tableId]
  const stored = table?.records[cell.recordId]?.cells[cell.fieldId] ?? null
  if (stored !== null) return stored
  return getSheet(tableId)?.input(cell.recordId, cell.fieldId) ?? null
}

/** Texte de départ de l'éditeur pour une cellule. */
export function editTextOf(tableId: string, cell: CellPosition): string {
  const table = useDataStore.getState().tables[tableId]
  const field = table?.fields[cell.fieldId]
  if (!field) return ''
  const input = effectiveInputOf(tableId, cell)
  return toEditText(field, input, lookup())
}

/** Garde visibles des lignes modifiées malgré les filtres de la vue (comme Airtable). */
function pinIfFiltered(table: Table, recordIds: string[]): void {
  if ((activeView(table)?.filters.length ?? 0) > 0 || useUIStore.getState().search.trim()) {
    useUIStore.getState().pin(recordIds)
  }
}

// ---------------------------------------------------------------------------
// Coordonnées et plage sélectionnée
// ---------------------------------------------------------------------------

export interface GridRect {
  /** Lignes de la vue (ids), dans l'ordre d'affichage. */
  rows: string[]
  /** Colonnes visibles (ids). */
  cols: string[]
  r0: number
  r1: number
  c0: number
  c1: number
}

/** Rectangle de la sélection dans les coordonnées de la vue, ou null sans sélection. */
export function selectionRect(table: Table | undefined = getActiveTable()): GridRect | null {
  const { selection, rangeEnd } = useUIStore.getState()
  if (!table || !selection) return null
  const rows = getViewRows(table)
  const cols = visibleFieldIds(table)
  const ar = rows.indexOf(selection.recordId)
  const ac = cols.indexOf(selection.fieldId)
  if (ar === -1 || ac === -1) return null
  const er = rangeEnd ? rows.indexOf(rangeEnd.recordId) : ar
  const ec = rangeEnd ? cols.indexOf(rangeEnd.fieldId) : ac
  const br = er === -1 ? ar : er
  const bc = ec === -1 ? ac : ec
  return {
    rows,
    cols,
    r0: Math.min(ar, br),
    r1: Math.max(ar, br),
    c0: Math.min(ac, bc),
    c1: Math.max(ac, bc),
  }
}

/** Cellules de la plage sélectionnée, ligne par ligne. */
export function selectedCells(table: Table | undefined = getActiveTable()): CellPosition[][] {
  const rect = selectionRect(table)
  if (!rect) return []
  const out: CellPosition[][] = []
  for (let r = rect.r0; r <= rect.r1; r++) {
    const recordId = rect.rows[r] as string
    const line: CellPosition[] = []
    for (let c = rect.c0; c <= rect.c1; c++)
      line.push({ recordId, fieldId: rect.cols[c] as string })
    out.push(line)
  }
  return out
}

/** Ids des lignes couvertes par la sélection (au moins la ligne de la cellule active). */
export function selectedRecordIds(table: Table | undefined = getActiveTable()): string[] {
  const rect = selectionRect(table)
  return rect ? rect.rows.slice(rect.r0, rect.r1 + 1) : []
}

// ---------------------------------------------------------------------------
// Édition
// ---------------------------------------------------------------------------

export function beginEdit(
  cell: CellPosition,
  initialText?: string,
  origin: 'cell' | 'bar' = 'cell',
): void {
  const table = getActiveTable()
  if (!table) return
  const field = table.fields[cell.fieldId]
  if (!field) return
  if (field.type === 'checkbox' && initialText === undefined) {
    toggleCheckbox(cell)
    return
  }
  useUIStore.getState().startEditing(cell, initialText ?? editTextOf(table.id, cell), origin)
}

export function cancelEdit(): void {
  const ui = useUIStore.getState()
  ui.stopEditing()
  ui.setInputError(null)
}

/** Valide la saisie en cours. Renvoie `false` (et garde l'édition ouverte) si elle est refusée. */
export function commitEdit(move: Move = 'none'): boolean {
  const ui = useUIStore.getState()
  const editing = ui.editing
  const table = getActiveTable()
  if (!editing || !table) return false
  const { cell, draft } = editing
  const field = table.fields[cell.fieldId]
  if (!field) {
    ui.stopEditing()
    return false
  }

  const unchanged = draft === editTextOf(table.id, cell)
  if (!unchanged) {
    const parsed = parseUserInput(field, draft, lookup())
    if (!parsed.ok) {
      ui.setInputError(parsed.reason)
      return false
    }
    pinIfFiltered(table, [cell.recordId])
    undoable(`Modifier ${addressOf(table, cell)}`, table.id, () =>
      useDataStore.getState().setCell(table.id, cell.recordId, cell.fieldId, parsed.input),
    )
  }
  ui.stopEditing()
  moveSelection(move)
  return true
}

/**
 * Valide une saisie de statut absente des choix en créant le choix (comme Airtable), ou un
 * responsable inconnu en l'ajoutant aux collaborateurs.
 */
export function commitWithNewOption(label: string): boolean {
  const ui = useUIStore.getState()
  const editing = ui.editing
  const table = getActiveTable()
  const field = editing ? table?.fields[editing.cell.fieldId] : undefined
  const clean = label.trim()
  if (!editing || !table || !field || !clean) return false
  const { cell } = editing
  undoable(`Ajouter « ${clean} »`, table.id, () => {
    const data = useDataStore.getState()
    const input =
      field.type === 'select'
        ? data.addChoice(table.id, field.id, clean)
        : field.type === 'owner'
          ? data.addCollaborator(clean)
          : null
    if (input) data.setCell(table.id, cell.recordId, cell.fieldId, input)
  })
  pinIfFiltered(table, [cell.recordId])
  ui.stopEditing()
  return true
}

function addressOf(table: Table, cell: CellPosition): string {
  return getSheet(table.id)?.address(cell.recordId, cell.fieldId) ?? 'la cellule'
}

// ---------------------------------------------------------------------------
// Navigation et sélection
// ---------------------------------------------------------------------------

function step(table: Table, from: CellPosition, move: Move, count: number): CellPosition | null {
  const rows = getViewRows(table)
  const cols = visibleFieldIds(table)
  let r = rows.indexOf(from.recordId)
  let c = cols.indexOf(from.fieldId)
  if (r === -1 || c === -1) return null
  if (move === 'up') r -= count
  if (move === 'down') r += count
  if (move === 'left') c -= count
  if (move === 'right') c += count
  r = Math.max(0, Math.min(rows.length - 1, r))
  c = Math.max(0, Math.min(cols.length - 1, c))
  const recordId = rows[r]
  const fieldId = cols[c]
  return recordId && fieldId ? { recordId, fieldId } : null
}

export function moveSelection(move: Move, count = 1): void {
  if (move === 'none') return
  const ui = useUIStore.getState()
  const table = getActiveTable()
  if (!table || !ui.selection) return
  const next = step(table, ui.selection, move, count)
  if (next) ui.select(next)
}

/** Maj + flèche : étend la plage depuis la cellule active. */
export function extendSelection(move: Move, count = 1): void {
  const ui = useUIStore.getState()
  const table = getActiveTable()
  if (!table || !ui.selection) return
  const next = step(table, ui.rangeEnd ?? ui.selection, move, count)
  if (next) ui.extendTo(next)
}

export function selectEdge(
  edge: 'rowStart' | 'rowEnd' | 'top' | 'bottom' | 'first' | 'last',
  extend = false,
): void {
  const ui = useUIStore.getState()
  const table = getActiveTable()
  const sel = extend ? (ui.rangeEnd ?? ui.selection) : ui.selection
  if (!table || !sel) return
  const rows = getViewRows(table)
  const fields = visibleFieldIds(table)
  const top = edge === 'top' || edge === 'first'
  const bottom = edge === 'bottom' || edge === 'last'
  const recordId = top ? rows[0] : bottom ? rows.at(-1) : sel.recordId
  const fieldId =
    edge === 'rowStart' || edge === 'first'
      ? fields[0]
      : edge === 'rowEnd' || edge === 'last'
        ? fields.at(-1)
        : sel.fieldId
  if (!recordId || !fieldId) return
  if (extend) ui.extendTo({ recordId, fieldId })
  else ui.select({ recordId, fieldId })
}

/** Ctrl+A : toute la vue. */
export function selectAll(): void {
  const table = getActiveTable()
  if (!table) return
  const rows = getViewRows(table)
  const cols = visibleFieldIds(table)
  const first = rows[0]
  const last = rows.at(-1)
  if (!first || !last || !cols[0]) return
  useUIStore
    .getState()
    .selectRange(
      { recordId: first, fieldId: cols[0] },
      { recordId: last, fieldId: cols.at(-1) as string },
    )
}

/** Clic sur des numéros de ligne : lignes entières. */
export function selectRows(fromRecordId: string, toRecordId: string = fromRecordId): void {
  const table = getActiveTable()
  if (!table) return
  const cols = visibleFieldIds(table)
  const first = cols[0]
  const last = cols.at(-1)
  if (!first || !last) return
  useUIStore
    .getState()
    .selectRange(
      { recordId: fromRecordId, fieldId: first },
      { recordId: toRecordId, fieldId: last },
    )
}

/** Clic sur des en-têtes de colonnes : colonnes entières. */
export function selectColumns(fromFieldId: string, toFieldId: string = fromFieldId): void {
  const table = getActiveTable()
  if (!table) return
  const rows = getViewRows(table)
  const first = rows[0]
  const last = rows.at(-1)
  if (!first || !last) return
  useUIStore
    .getState()
    .selectRange({ recordId: first, fieldId: fromFieldId }, { recordId: last, fieldId: toFieldId })
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

/** Suppr : vide la plage sélectionnée. */
export function clearSelection(): void {
  const table = getActiveTable()
  if (!table) return
  const writes: CellWrite[] = selectedCells(table)
    .flat()
    .filter((c) => (table.records[c.recordId]?.cells[c.fieldId] ?? null) !== null)
    .map((c) => ({ ...c, input: null }))
  if (writes.length === 0) return
  undoable(
    writes.length === 1 ? 'Effacer la cellule' : `Effacer ${writes.length} cellules`,
    table.id,
    () => useDataStore.getState().setCells(table.id, writes),
  )
}

export function clearCell(cell: CellPosition): void {
  const table = getActiveTable()
  if (!table) return
  undoable('Effacer la cellule', table.id, () =>
    useDataStore.getState().setCell(table.id, cell.recordId, cell.fieldId, null),
  )
}

export function toggleCheckbox(cell: CellPosition): void {
  const table = getActiveTable()
  if (!table) return
  const current = table.records[cell.recordId]?.cells[cell.fieldId] ?? null
  if (isFormula(current)) return
  pinIfFiltered(table, [cell.recordId])
  undoable(current === true ? 'Décocher' : 'Cocher', table.id, () =>
    useDataStore.getState().setCell(table.id, cell.recordId, cell.fieldId, current !== true),
  )
}

/** Espace sur une plage : coche (ou décoche) toutes les cases, selon la cellule active. */
export function toggleSelectedCheckboxes(): void {
  const table = getActiveTable()
  const active = useUIStore.getState().selection
  if (!table || !active) return
  const target = table.records[active.recordId]?.cells[active.fieldId] !== true
  const writes: CellWrite[] = selectedCells(table)
    .flat()
    .filter((c) => table.fields[c.fieldId]?.type === 'checkbox')
    .filter((c) => !isFormula(table.records[c.recordId]?.cells[c.fieldId] ?? null))
    .map((c) => ({ ...c, input: target }))
  if (writes.length === 0) return
  undoable(target ? 'Cocher' : 'Décocher', table.id, () =>
    useDataStore.getState().setCells(table.id, writes),
  )
}

/** Ajoute une ligne (au-dessus du total s'il y en a un) et la sélectionne. */
export function addRowAndSelect(cells: TableRecord['cells'] = {}): string | null {
  const table = getActiveTable()
  if (!table) return null
  const recordId = undoable('Ajouter une ligne', table.id, () =>
    useDataStore.getState().addRecord(table.id, { cells }),
  )
  pinIfFiltered(table, [recordId])
  const fieldId = visibleFieldIds(table)[0]
  if (fieldId) useUIStore.getState().select({ recordId, fieldId })
  return recordId
}

/** Insère autant de lignes vides que de lignes sélectionnées, au-dessus ou en dessous. */
export function insertRows(where: 'above' | 'below'): void {
  const table = getActiveTable()
  const selected = selectedRecordIds(table)
  if (!table || selected.length === 0) return
  const positions = selected.map((id) => table.rowOrder.indexOf(id)).filter((i) => i !== -1)
  const at = where === 'above' ? Math.min(...positions) : Math.max(...positions) + 1
  const count = selected.length
  const ids = undoable(
    count === 1 ? 'Insérer une ligne' : `Insérer ${count} lignes`,
    table.id,
    () =>
      useDataStore.getState().addRecords(
        table.id,
        Array.from({ length: count }, () => ({})),
        at,
      ),
  )
  pinIfFiltered(table, ids)
  const fieldId = useUIStore.getState().selection?.fieldId ?? visibleFieldIds(table)[0]
  if (ids[0] && fieldId) useUIStore.getState().select({ recordId: ids[0], fieldId })
}

export function duplicateRows(recordIds: string[] = selectedRecordIds()): void {
  const table = getActiveTable()
  if (!table || recordIds.length === 0) return
  const copies = undoable(
    recordIds.length === 1 ? 'Dupliquer la ligne' : `Dupliquer ${recordIds.length} lignes`,
    table.id,
    () =>
      [...recordIds]
        .reverse()
        .map((id) => useDataStore.getState().duplicateRecord(table.id, id))
        .filter((id): id is string => id !== null),
  )
  pinIfFiltered(table, copies)
}

/** Supprime des lignes, avec un message « Annuler ». */
export function deleteRows(recordIds: string[] = selectedRecordIds()): void {
  const table = getActiveTable()
  if (!table || recordIds.length === 0) return
  const label = recordIds.length === 1 ? 'Ligne supprimée' : `${recordIds.length} lignes supprimées`
  // Sélection : la ligne qui suit la première ligne supprimée.
  const rows = getViewRows(table)
  const firstIndex = Math.min(...recordIds.map((id) => rows.indexOf(id)).filter((i) => i >= 0))
  const after = rows.slice(firstIndex).find((id) => !recordIds.includes(id))
  undoable(label, table.id, () => useDataStore.getState().deleteRecords(table.id, recordIds))
  const ui = useUIStore.getState()
  const fieldId = ui.selection?.fieldId
  if (ui.expandedRecordId && recordIds.includes(ui.expandedRecordId)) ui.openRecord(null)
  ui.select(after && fieldId ? { recordId: after, fieldId } : null)
  useNotices
    .getState()
    .push({ tone: 'info', title: label, action: { label: 'Annuler', run: () => undo() } }, 8000)
}

export function setRowsKind(
  kind: TableRecord['kind'],
  recordIds: string[] = selectedRecordIds(),
): void {
  const table = getActiveTable()
  if (!table || recordIds.length === 0) return
  undoable(
    kind === 'summary' ? 'Marquer comme ligne de total' : 'Marquer comme ligne de données',
    table.id,
    () => {
      for (const id of recordIds) useDataStore.getState().setRecordKind(table.id, id, kind)
    },
  )
}

// ---------------------------------------------------------------------------
// Presse-papiers
// ---------------------------------------------------------------------------

interface InternalClipboard {
  text: string
  tableId: string
  /** Valeurs stockées des cellules copiées (null : vide ou formule de colonne). */
  inputs: CellInput[][]
  /** Cellules sources, pour décaler les formules et vider la source d'un couper. */
  cells: CellPosition[][]
  cut: boolean
}

let clipboard: InternalClipboard | null = null

const normalizeText = (t: string) => t.replace(/\r\n?/g, '\n').replace(/\n$/, '')

/**
 * Copie (ou coupe) la plage sélectionnée : texte TSV pour les autres applications, valeurs et
 * formules gardées en mémoire pour un collage dans l'app.
 */
export function copySelection(cut = false): string | null {
  const table = getActiveTable()
  if (!table) return null
  const cells = selectedCells(table)
  if (cells.length === 0) return null
  const sheet = getSheet(table.id)
  const text = toTsv(
    cells.map((line) =>
      line.map((c) => {
        const field = table.fields[c.fieldId]
        return field ? toClipboardText(field, sheet?.value(c.recordId, c.fieldId) ?? null) : ''
      }),
    ),
  )
  clipboard = {
    text,
    tableId: table.id,
    inputs: cells.map((line) =>
      line.map((c) => table.records[c.recordId]?.cells[c.fieldId] ?? null),
    ),
    cells,
    cut,
  }
  return text
}

export interface PasteReport {
  written: number
  /** Valeurs refusées par le type de la colonne. */
  skipped: number
  /** Lignes ajoutées à la fin pour recevoir le collage. */
  addedRows: number
}

/** Colle un texte (TSV d'Excel, ou ce que l'app vient de copier) à partir de la sélection. */
export function pasteText(text: string): PasteReport | null {
  const table = getActiveTable()
  const rect = selectionRect(table)
  if (!table || !rect) return null
  // Ce que l'app vient de copier dans cette table : valeurs et formules d'origine. Sinon (autre
  // table, autre application) : le texte, retapé dans le type de chaque colonne.
  const internal =
    clipboard &&
    clipboard.tableId === table.id &&
    normalizeText(clipboard.text) === normalizeText(text)
      ? clipboard
      : null
  const raw: (string | { input: CellInput; from: CellPosition })[][] = internal
    ? internal.inputs.map((line, r) =>
        line.map((input, c) => ({ input, from: internal.cells[r]?.[c] as CellPosition })),
      )
    : parseTsv(text)
  if (raw.length === 0) return null
  const block = tileToSelection(raw, rect.r1 - rect.r0 + 1, rect.c1 - rect.c0 + 1)

  // Lignes de destination : celles de la vue à partir de la sélection (les lignes de total sont
  // sautées, sauf si le collage commence sur l'une d'elles), puis de nouvelles lignes.
  const startsOnSummary = table.records[rect.rows[rect.r0] ?? '']?.kind === 'summary'
  const targets = rect.rows
    .slice(rect.r0)
    .filter((id) => startsOnSummary || table.records[id]?.kind === 'data')
    .slice(0, block.length)
  const missing = block.length - targets.length
  const cols = rect.cols.slice(rect.c0, rect.c0 + (block[0]?.length ?? 0))

  const report: PasteReport = { written: 0, skipped: 0, addedRows: Math.max(0, missing) }
  const label = `Coller ${block.length * cols.length > 1 ? `${block.length * cols.length} cellules` : 'la cellule'}`
  undoable(label, table.id, () => {
    const data = useDataStore.getState()
    if (missing > 0)
      targets.push(
        ...data.addRecords(
          table.id,
          Array.from({ length: missing }, () => ({})),
        ),
      )
    const fresh = useDataStore.getState().tables[table.id] as Table
    const ctx = lookup()
    const writes: CellWrite[] = []
    // Couper : cellules sources effectivement recopiées (à vider ensuite).
    const moved: CellPosition[] = []
    block.forEach((line, r) => {
      const recordId = targets[r]
      if (!recordId) return
      line.forEach((cell, c) => {
        const fieldId = cols[c]
        const field = fieldId
          ? useDataStore.getState().tables[table.id]?.fields[fieldId]
          : undefined
        if (!fieldId || !field) return
        let input: CellInput
        if (typeof cell === 'string') {
          const parsed = parseUserInput(field, cell, ctx)
          if (parsed.ok) input = parsed.input
          else if (field.type === 'select') input = data.addChoice(table.id, fieldId, cell)
          else {
            report.skipped++
            return
          }
        } else {
          const converted = convertCopied(
            fresh,
            cell.input,
            cell.from,
            { recordId, fieldId },
            internal?.cut ?? false,
          )
          if (converted === undefined) {
            report.skipped++
            return
          }
          input = converted
          moved.push(cell.from)
        }
        writes.push({ recordId, fieldId, input })
      })
    })
    // Couper : les sources recopiées sont vidées (sauf celles qui viennent d'être écrites).
    if (internal?.cut) {
      const written = new Set(writes.map((w) => `${w.recordId}:${w.fieldId}`))
      for (const c of moved) {
        if (!written.has(`${c.recordId}:${c.fieldId}`)) writes.unshift({ ...c, input: null })
      }
    }
    report.written = writes.length
    data.setCells(table.id, writes)
  })
  if (internal?.cut && report.written > 0) clipboard = null
  pinIfFiltered(table, targets)

  const first = targets[0]
  const last = targets.at(-1)
  if (first && last && cols[0]) {
    useUIStore
      .getState()
      .selectRange(
        { recordId: first, fieldId: cols[0] },
        { recordId: last, fieldId: cols.at(-1) as string },
      )
  }
  return report
}

/**
 * Valeur copiée dans l'app → valeur à écrire : même colonne, telle quelle ; formule, décalée
 * selon les adresses A1 (sauf après couper, comme Excel) ; autre colonne, retapée dans son type.
 * `undefined` : incompatible.
 */
function convertCopied(
  table: Table,
  input: CellInput,
  from: CellPosition,
  to: CellPosition,
  cut: boolean,
): CellInput | undefined {
  if (input === null) return null
  if (isFormula(input)) {
    if (cut) return input
    const dRow = table.rowOrder.indexOf(to.recordId) - table.rowOrder.indexOf(from.recordId)
    const dCol = table.fieldOrder.indexOf(to.fieldId) - table.fieldOrder.indexOf(from.fieldId)
    return translateFormula(input, dRow, dCol)
  }
  if (from.fieldId === to.fieldId) return input
  const source = table.fields[from.fieldId]
  const target = table.fields[to.fieldId]
  if (!target) return undefined
  const ctx = lookup()
  const text = source ? toEditText(source, input, ctx) : String(input)
  const parsed = parseUserInput(target, text, ctx)
  return parsed.ok ? parsed.input : undefined
}

// ---------------------------------------------------------------------------
// Recopie (poignée et Ctrl+D / Ctrl+R)
// ---------------------------------------------------------------------------

/**
 * Remplit des cellules à partir de cellules sources de la même colonne (ou ligne) : séries
 * ou recopie, formules décalées selon les adresses A1.
 */
function fillLine(
  table: Table,
  sources: CellPosition[],
  targets: CellPosition[],
  axis: 'row' | 'col',
  options: { backward: boolean; series: boolean },
): CellWrite[] {
  const first = sources[0] ?? targets[0]
  const field = first ? table.fields[first.fieldId] : undefined
  if (!field || sources.length === 0 || targets.length === 0) return []
  const inputs = sources.map((c) => table.records[c.recordId]?.cells[c.fieldId] ?? null)
  const plan = fillPlan(inputs, targets.length, {
    axis,
    backward: options.backward,
    series: options.series,
    fieldType: field.type,
  })
  return targets.map((target, i) => {
    const s = plan[i]
    if (!s) return { ...target, input: null }
    if (s.kind === 'value') return { ...target, input: s.input }
    const source = sources[s.source] as CellPosition
    const input = inputs[s.source] ?? null
    if (!isFormula(input)) return { ...target, input }
    const dRow = table.rowOrder.indexOf(target.recordId) - table.rowOrder.indexOf(source.recordId)
    const dCol = table.fieldOrder.indexOf(target.fieldId) - table.fieldOrder.indexOf(source.fieldId)
    return { ...target, input: translateFormula(input, dRow, dCol) }
  })
}

/** Lignes de données seulement : une recopie ne touche jamais une ligne de total. */
function dataRows(table: Table, ids: string[]): string[] {
  return ids.filter((id) => table.records[id]?.kind === 'data')
}

/**
 * Ctrl+D (vers le bas) / Ctrl+R (vers la droite) : recopie la première ligne (colonne) de la
 * plage sur les suivantes ; une seule ligne sélectionnée reçoit la ligne du dessus.
 */
export function fillSelection(direction: 'down' | 'right'): void {
  const table = getActiveTable()
  const rect = selectionRect(table)
  if (!table || !rect) return
  const writes: CellWrite[] = []
  if (direction === 'down') {
    const single = rect.r0 === rect.r1
    const sourceRow = single ? rect.rows[rect.r0 - 1] : rect.rows[rect.r0]
    const targetRows = dataRows(table, rect.rows.slice(single ? rect.r0 : rect.r0 + 1, rect.r1 + 1))
    if (!sourceRow) return
    for (let c = rect.c0; c <= rect.c1; c++) {
      const fieldId = rect.cols[c] as string
      writes.push(
        ...fillLine(
          table,
          [{ recordId: sourceRow, fieldId }],
          targetRows.map((recordId) => ({ recordId, fieldId })),
          'row',
          { backward: false, series: false },
        ),
      )
    }
  } else {
    const single = rect.c0 === rect.c1
    const sourceCol = single ? rect.cols[rect.c0 - 1] : rect.cols[rect.c0]
    const targetCols = rect.cols.slice(single ? rect.c0 : rect.c0 + 1, rect.c1 + 1)
    if (!sourceCol) return
    for (const recordId of dataRows(table, rect.rows.slice(rect.r0, rect.r1 + 1))) {
      writes.push(
        ...fillLine(
          table,
          [{ recordId, fieldId: sourceCol }],
          targetCols.map((fieldId) => ({ recordId, fieldId })),
          'col',
          { backward: false, series: false },
        ),
      )
    }
  }
  if (writes.length === 0) return
  undoable(direction === 'down' ? 'Recopier vers le bas' : 'Recopier à droite', table.id, () =>
    useDataStore.getState().setCells(table.id, writes),
  )
}

/**
 * Poignée de recopie : prolonge la plage sélectionnée jusqu'à `target` (verticalement ou
 * horizontalement, selon la direction la plus éloignée) avec des séries.
 */
export function fillTo(target: CellPosition): void {
  const table = getActiveTable()
  const rect = selectionRect(table)
  if (!table || !rect) return
  const tr = rect.rows.indexOf(target.recordId)
  const tc = rect.cols.indexOf(target.fieldId)
  if (tr === -1 || tc === -1) return
  const rowOut = tr < rect.r0 ? rect.r0 - tr : tr > rect.r1 ? tr - rect.r1 : 0
  const colOut = tc < rect.c0 ? rect.c0 - tc : tc > rect.c1 ? tc - rect.c1 : 0
  if (rowOut === 0 && colOut === 0) return
  const vertical = rowOut >= colOut
  const writes: CellWrite[] = []
  // Nouvelle plage : la plage d'origine prolongée jusqu'à la cible.
  let [nr0, nr1, nc0, nc1] = [rect.r0, rect.r1, rect.c0, rect.c1]

  if (vertical) {
    const backward = tr < rect.r0
    const sourceRows = dataRows(table, rect.rows.slice(rect.r0, rect.r1 + 1))
    // Cibles de la plus proche à la plus éloignée de la source.
    const targetRows = dataRows(
      table,
      backward ? rect.rows.slice(tr, rect.r0).reverse() : rect.rows.slice(rect.r1 + 1, tr + 1),
    )
    for (let c = rect.c0; c <= rect.c1; c++) {
      const fieldId = rect.cols[c] as string
      writes.push(
        ...fillLine(
          table,
          sourceRows.map((recordId) => ({ recordId, fieldId })),
          targetRows.map((recordId) => ({ recordId, fieldId })),
          'row',
          { backward, series: true },
        ),
      )
    }
    if (backward) nr0 = tr
    else nr1 = tr
  } else {
    const backward = tc < rect.c0
    const sourceCols = rect.cols.slice(rect.c0, rect.c1 + 1)
    const targetCols = backward
      ? rect.cols.slice(tc, rect.c0).reverse()
      : rect.cols.slice(rect.c1 + 1, tc + 1)
    for (const recordId of dataRows(table, rect.rows.slice(rect.r0, rect.r1 + 1))) {
      writes.push(
        ...fillLine(
          table,
          sourceCols.map((fieldId) => ({ recordId, fieldId })),
          targetCols.map((fieldId) => ({ recordId, fieldId })),
          'col',
          { backward, series: true },
        ),
      )
    }
    if (backward) nc0 = tc
    else nc1 = tc
  }

  if (writes.length > 0) {
    undoable('Recopier', table.id, () => useDataStore.getState().setCells(table.id, writes))
  }
  useUIStore
    .getState()
    .selectRange(
      { recordId: rect.rows[nr0] as string, fieldId: rect.cols[nc0] as string },
      { recordId: rect.rows[nr1] as string, fieldId: rect.cols[nc1] as string },
    )
}
