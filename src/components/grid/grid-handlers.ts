import type { DragEvent, MouseEvent } from 'react'
import type { CellPosition } from '@/store'

/**
 * Gestionnaires de la grille passés aux lignes et aux cellules. L'objet est stable (créé une
 * fois par la grille) : il ne provoque aucun nouveau rendu des lignes mémorisées.
 */
export interface GridHandlers {
  cellMouseDown(cell: CellPosition, e: MouseEvent): void
  cellMouseEnter(cell: CellPosition): void
  cellDoubleClick(cell: CellPosition): void
  cellContextMenu(cell: CellPosition, e: MouseEvent): void
  toggleCheckbox(cell: CellPosition): void
  fillHandleMouseDown(e: MouseEvent): void
  rowHeaderMouseDown(recordId: string, e: MouseEvent): void
  rowHeaderMouseEnter(recordId: string): void
  expandRecord(recordId: string): void
  rowDragStart(recordId: string, e: DragEvent): void
  rowDragEnd(): void
  focusGrid(): void
}
