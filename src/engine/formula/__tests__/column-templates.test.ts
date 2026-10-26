import { describe, expect, it } from 'vitest'
import { moveReferences, retargetColumn, shiftReferences } from '../references'

const absoluteOnly = { absoluteOnly: true }
const insertRows = (index: number, count = 1, expandAdjacent = false) => ({
  axis: 'row' as const,
  index,
  count,
  expandAdjacent,
})
const moveRows = (from: number, to: number, count = 1) => ({
  axis: 'row' as const,
  from,
  count,
  to,
})

describe('modèles de colonnes-formules : seules les références absolues suivent les lignes', () => {
  it('insertion : $A$4 (le total) suit, A1 (la ligne courante) reste', () => {
    expect(shiftReferences('=A1/$A$4', insertRows(3), absoluteOnly)).toBe('=A1/$A$5')
    expect(shiftReferences('=A1/A$4', insertRows(0), absoluteOnly)).toBe('=A1/A$5')
    // Colonne absolue mais ligne relative : rien ne bouge sur l'axe des lignes.
    expect(shiftReferences('=$A1*2', insertRows(0), absoluteOnly)).toBe('=$A1*2')
  })

  it('insertion au-dessus du total : la plage absolue l’inclut', () => {
    expect(shiftReferences('=C1/SUM($C$1:$C$3)', insertRows(3, 1, true), absoluteOnly)).toBe(
      '=C1/SUM($C$1:$C$4)',
    )
  })

  it('suppression : la référence absolue remonte, ou devient #REF!', () => {
    expect(shiftReferences('=A1/$A$4', insertRows(1, -1), absoluteOnly)).toBe('=A1/$A$3')
    expect(shiftReferences('=A1/$A$4', insertRows(3, -1), absoluteOnly)).toBe('=A1/#REF!')
    // Référence relative : jamais #REF! pour le modèle.
    expect(shiftReferences('=A1*2', insertRows(0, -1), absoluteOnly)).toBe('=A1*2')
  })

  it('plage mixte (cumul) : seule la borne absolue bouge', () => {
    expect(shiftReferences('=SUM($C$2:C2)', insertRows(0), absoluteOnly)).toBe('=SUM($C$3:C2)')
    expect(shiftReferences('=SUM($C$1:C1)', insertRows(0, -1), absoluteOnly)).toBe('=SUM($C$1:C1)')
  })

  it('sans l’option, toutes les références bougent (formules de cellule)', () => {
    expect(shiftReferences('=A1/$A$4', insertRows(0))).toBe('=A2/$A$5')
  })

  it('déplacement : $G$1 suit la ligne déplacée, C1 reste', () => {
    expect(moveReferences('=C1*$G$1', moveRows(0, 3), absoluteOnly)).toBe('=C1*$G$3')
    expect(moveReferences('=C1*G$2', moveRows(0, 3), absoluteOnly)).toBe('=C1*G$1')
    expect(moveReferences('=C1*2', moveRows(0, 3), absoluteOnly)).toBe('=C1*2')
    // Total (plage absolue) : réordonner ses lignes ne la change pas.
    expect(moveReferences('=C1/SUM($C$1:$C$3)', moveRows(0, 3), absoluteOnly)).toBe(
      '=C1/SUM($C$1:$C$3)',
    )
  })

  it('déplacement, plage mixte : la borne absolue suit sa cellule', () => {
    expect(moveReferences('=SUM($C$1:C1)', moveRows(0, 3), absoluteOnly)).toBe('=SUM($C$3:C1)')
    expect(moveReferences('=SUM(C1:$C$1)', moveRows(1, 3), absoluteOnly)).toBe('=SUM(C1:$C$1)')
  })
})

describe('retargetColumn', () => {
  it('fait viser la copie aux références de la colonne d’origine', () => {
    expect(retargetColumn('=SUM(C1:C3)', 2, 3)).toBe('=SUM(D1:D3)')
    expect(retargetColumn('=C1+B2', 2, 3)).toBe('=D1+B2')
    expect(retargetColumn('=$C$1*2', 2, 3)).toBe('=$D$1*2')
  })

  it('laisse les autres colonnes et les plages sur plusieurs colonnes', () => {
    expect(retargetColumn('=E1/1000', 2, 3)).toBe('=E1/1000')
    expect(retargetColumn('=SUM(B1:C3)', 2, 3)).toBe('=SUM(B1:C3)')
    expect(retargetColumn('=C1', 2, 2)).toBe('=C1')
  })
})
