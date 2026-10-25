/** Presse-papiers du système depuis un menu (sans raccourci clavier) et message après un collage. */
import { useNotices } from '@/store'
import { copySelection, pasteText } from '@/store/grid-actions'
import { shortcut } from '@/lib/keys'

/** Copie la sélection dans le presse-papiers du système (menu, sans raccourci clavier). */
export async function copyToClipboard(cut = false): Promise<void> {
  const text = copySelection(cut)
  if (text === null) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    useNotices.getState().push({ tone: 'warning', title: `Utilisez ${shortcut('C')} pour copier` })
  }
}

export async function pasteFromClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    reportPaste(pasteText(text))
  } catch {
    useNotices.getState().push({
      tone: 'warning',
      title: `Utilisez ${shortcut('V')} pour coller`,
      detail: 'Le navigateur n’autorise pas la lecture du presse-papiers depuis un menu.',
    })
  }
}

/** Message après un collage : lignes ajoutées, valeurs refusées par le type de colonne. */
export function reportPaste(report: ReturnType<typeof pasteText>): void {
  if (!report) return
  const parts: string[] = []
  if (report.addedRows > 0) {
    parts.push(report.addedRows === 1 ? '1 ligne ajoutée' : `${report.addedRows} lignes ajoutées`)
  }
  if (report.skipped > 0) {
    parts.push(
      report.skipped === 1
        ? '1 valeur ignorée (type de colonne incompatible)'
        : `${report.skipped} valeurs ignorées (type de colonne incompatible)`,
    )
  }
  if (parts.length) {
    useNotices.getState().push({
      tone: report.skipped ? 'warning' : 'info',
      title: 'Collage',
      detail: parts.join('\n'),
    })
  }
}
