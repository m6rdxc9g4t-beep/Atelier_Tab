import {
  ArrowDownToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eraser,
  Maximize2,
  Scissors,
  Sigma,
  Trash2,
  Rows3,
} from 'lucide-react'
import { useDataStore, useUIStore } from '@/store'
import {
  clearSelection,
  deleteRows,
  duplicateRows,
  fillSelection,
  getActiveTable,
  insertRows,
  selectedRecordIds,
  setRowsKind,
} from '@/store/grid-actions'
import { Floating } from '@/components/ui/Floating'
import { MenuItem, MenuSeparator } from '@/components/ui/Popover'
import { shortcut } from '@/lib/keys'
import { copyToClipboard, pasteFromClipboard } from './clipboard-actions'

/** Menu contextuel d'une cellule ou d'une ligne (clic droit, touche Menu, Maj+F10). */
export function GridContextMenu({
  position,
  onClose,
}: {
  position: { x: number; y: number } | null
  onClose: () => void
}) {
  const table = getActiveTable()
  const openRecord = useUIStore((s) => s.openRecord)
  const selection = useUIStore((s) => s.selection)
  const ids = position ? selectedRecordIds(table) : []
  const records = useDataStore((s) => (table ? s.tables[table.id]?.records : undefined))
  const allSummary = ids.length > 0 && ids.every((id) => records?.[id]?.kind === 'summary')
  const n = ids.length
  const lines = (one: string, many: string) => (n > 1 ? many.replace('#', String(n)) : one)
  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }

  return (
    <Floating
      open={position !== null}
      anchor={position}
      onClose={onClose}
      role="menu"
      className="min-w-60"
    >
      <MenuItem
        icon={<Copy size={13} />}
        shortcut={shortcut('C')}
        onSelect={run(() => void copyToClipboard())}
      >
        Copier
      </MenuItem>
      <MenuItem
        icon={<Scissors size={13} />}
        shortcut={shortcut('X')}
        onSelect={run(() => void copyToClipboard(true))}
      >
        Couper
      </MenuItem>
      <MenuItem
        icon={<ClipboardPaste size={13} />}
        shortcut={shortcut('V')}
        onSelect={run(() => void pasteFromClipboard())}
      >
        Coller
      </MenuItem>
      <MenuSeparator />
      <MenuItem icon={<ArrowUpToLine size={13} />} onSelect={run(() => insertRows('above'))}>
        {lines('Insérer une ligne au-dessus', 'Insérer # lignes au-dessus')}
      </MenuItem>
      <MenuItem icon={<ArrowDownToLine size={13} />} onSelect={run(() => insertRows('below'))}>
        {lines('Insérer une ligne en dessous', 'Insérer # lignes en dessous')}
      </MenuItem>
      <MenuItem icon={<CopyPlus size={13} />} onSelect={run(() => duplicateRows())}>
        {lines('Dupliquer la ligne', 'Dupliquer les # lignes')}
      </MenuItem>
      {selection && (
        <MenuItem
          icon={<Maximize2 size={13} />}
          shortcut="Espace"
          onSelect={run(() => openRecord(selection.recordId))}
        >
          Développer la ligne
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem
        icon={<Rows3 size={13} />}
        shortcut={shortcut('D')}
        onSelect={run(() => fillSelection('down'))}
      >
        Recopier vers le bas
      </MenuItem>
      <MenuItem icon={<Eraser size={13} />} shortcut="Suppr" onSelect={run(clearSelection)}>
        Effacer le contenu
      </MenuItem>
      <MenuItem
        icon={<Sigma size={13} />}
        onSelect={run(() => setRowsKind(allSummary ? 'data' : 'summary'))}
      >
        {allSummary
          ? lines('Redevenir une ligne de données', 'Redevenir des lignes de données')
          : lines('Marquer comme ligne de total', 'Marquer comme lignes de total')}
      </MenuItem>
      <MenuSeparator />
      <MenuItem danger icon={<Trash2 size={13} />} onSelect={run(() => deleteRows())}>
        {lines('Supprimer la ligne', 'Supprimer les # lignes')}
      </MenuItem>
    </Floating>
  )
}
