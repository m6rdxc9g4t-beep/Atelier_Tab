import { describe, expect, it } from 'vitest'
import { moveReferences } from '../references'

const rows = (from: number, to: number, count = 1) => ({ axis: 'row' as const, from, count, to })

describe('moveReferences', () => {
  it('une référence suit la cellule déplacée', () => {
    // Ligne 3 (index 2) déplacée tout en haut.
    expect(moveReferences('=C3*2', rows(2, 0))).toBe('=C1*2')
    expect(moveReferences('=C1+C2', rows(2, 0))).toBe('=C2+C3')
    expect(moveReferences('=$C$3', rows(2, 0))).toBe('=$C$1')
  })

  it('réordonner les lignes d’une plage ne la change pas', () => {
    expect(moveReferences('=SUM(C1:C3)', rows(2, 0))).toBe('=SUM(C1:C3)')
    expect(moveReferences('=SUM(C1:C3)', rows(0, 3))).toBe('=SUM(C1:C3)')
  })

  it('une ligne qui sort d’une plage la réduit', () => {
    // Ligne 2 déposée après la ligne 4 (le total) : SUM(C1:C3) → SUM(C1:C2).
    expect(moveReferences('=SUM(C1:C3)', rows(1, 4))).toBe('=SUM(C1:C2)')
  })

  it('une ligne déposée au milieu d’une plage l’agrandit', () => {
    // Ligne 5 déposée avant la ligne 2.
    expect(moveReferences('=SUM(C1:C3)', rows(4, 1))).toBe('=SUM(C1:C4)')
  })

  it('colonnes : bloc déplacé vers la droite', () => {
    const cols = { axis: 'col' as const, from: 0, count: 1, to: 3 }
    expect(moveReferences('=A1+B1+C1+D1', cols)).toBe('=C1+A1+B1+D1')
  })

  it('déplacement sans effet', () => {
    expect(moveReferences('=C3', rows(2, 2))).toBe('=C3')
    expect(moveReferences('=C3', rows(2, 3))).toBe('=C3')
  })
})
