import { Workbook, type CellInput } from '../workbook'
import { isError, type CellValue } from '../values'

/** Crée une feuille à partir d'un objet { A1: 10, B1: '=A1*2' }. */
export function sheet(cells: Record<string, CellInput> = {}): Workbook {
  const wb = new Workbook()
  wb.setCells(Object.entries(cells))
  return wb
}

/** Évalue une formule isolée (dans une feuille éventuellement pré-remplie). */
export function calc(formula: string, cells: Record<string, CellInput> = {}): CellValue {
  const wb = sheet(cells)
  wb.setCell('Z999', formula)
  return wb.getValue('Z999')
}

/** Valeur lisible pour les assertions : erreurs ramenées à leur code. */
export function show(v: CellValue): string | number | boolean | null {
  return isError(v) ? v.code : v
}
