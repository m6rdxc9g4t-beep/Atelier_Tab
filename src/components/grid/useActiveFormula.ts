import { useMemo } from 'react'
import { formulaReferences, isFormula, type ReferencedArea } from '@/engine/formula'
import { effectiveInputOf } from '@/store/grid-actions'
import { useComputed, useDataStore, useUIStore } from '@/store'

/**
 * Formule « active » : celle en cours de saisie, sinon celle de la cellule sélectionnée.
 * Renvoie les zones qu'elle lit, pour les colorer dans la grille.
 */
export function useActiveFormulaAreas(tableId: string): ReferencedArea[] {
  const draft = useUIStore((s) => s.editing?.draft)
  const selection = useUIStore((s) => s.selection)
  // Valeur stockée de la cellule sélectionnée (pour réagir à ses modifications).
  const stored = useDataStore((s) =>
    selection
      ? s.tables[tableId]?.records[selection.recordId]?.cells[selection.fieldId]
      : undefined,
  )
  // Les colonnes-formules dépendent aussi de la structure : on suit les révisions du moteur.
  const revision = useComputed((s) => s.revisions[tableId] ?? 0)

  return useMemo(() => {
    void stored
    void revision
    if (draft !== undefined) return isFormula(draft) ? formulaReferences(draft) : []
    if (!selection) return []
    const input = effectiveInputOf(tableId, selection)
    return isFormula(input) ? formulaReferences(input) : []
  }, [draft, selection, stored, revision, tableId])
}

/** Index de la première zone qui couvre la cellule (ligne, colonne), ou -1. */
export function areaIndexAt(areas: ReferencedArea[], row: number, col: number): number {
  return areas.findIndex((a) => row >= a.r0 && row <= a.r1 && col >= a.c0 && col <= a.c1)
}
