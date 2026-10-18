import { describe, expect, it } from 'vitest'
import {
  columnToLetters,
  lettersToColumn,
  parseA1,
  shiftReferences,
  toA1,
  translateFormula,
} from '../references'

describe('conversions de colonnes', () => {
  it.each([
    [0, 'A'],
    [25, 'Z'],
    [26, 'AA'],
    [51, 'AZ'],
    [52, 'BA'],
    [701, 'ZZ'],
    [702, 'AAA'],
    [16383, 'XFD'],
  ])('%i ↔ %s', (col, letters) => {
    expect(columnToLetters(col)).toBe(letters)
    expect(lettersToColumn(letters)).toBe(col)
  })

  it('accepte les minuscules', () => {
    expect(lettersToColumn('ab')).toBe(27)
  })
})

describe('parseA1 / toA1', () => {
  it('lit une adresse simple et absolue', () => {
    expect(parseA1('C12')).toEqual({ col: 2, row: 11, absCol: false, absRow: false })
    expect(parseA1('$C$12')).toEqual({ col: 2, row: 11, absCol: true, absRow: true })
    expect(parseA1('c$1')).toEqual({ col: 2, row: 0, absCol: false, absRow: true })
  })

  it('rejette les adresses invalides', () => {
    expect(parseA1('A0')).toBeNull()
    expect(parseA1('12')).toBeNull()
    expect(parseA1('ABCD1')).toBeNull()
  })

  it('produit la clé canonique', () => {
    expect(toA1(3, 0)).toBe('D1')
  })
})

describe('translateFormula (recopie / colonnes-formules)', () => {
  it('décale les références relatives', () => {
    expect(translateFormula('=C1*1.2', 1, 0)).toBe('=C2*1.2')
    expect(translateFormula('=SUM(A1:A3)+B1', 2, 1)).toBe('=SUM(B3:B5)+C3')
  })

  it('garde fixes les parties absolues', () => {
    expect(translateFormula('=C1*$F$1', 4, 0)).toBe('=C5*$F$1')
    expect(translateFormula('=$C1+C$1', 1, 1)).toBe('=$C2+D$1')
  })

  it('produit #REF! hors de la grille', () => {
    expect(translateFormula('=A2+B1', -1, 0)).toBe('=A1+#REF!')
  })

  it('préserve la mise en forme et le texte', () => {
    expect(translateFormula('= sum( A1 ; "A1" )', 1, 0)).toBe('= sum( A2 ; "A1" )')
  })
})

describe('shiftReferences (insertion / suppression)', () => {
  it('insertion de lignes : décale ce qui est en dessous, y compris les absolus', () => {
    expect(shiftReferences('=A1+A5+$A$5', { axis: 'row', index: 2, count: 2 })).toBe('=A1+A7+$A$7')
  })

  it('insertion au milieu d’une plage : la plage s’agrandit', () => {
    expect(shiftReferences('=SUM(C1:C3)', { axis: 'row', index: 1, count: 1 })).toBe('=SUM(C1:C4)')
  })

  it('expandAdjacent : une ligne ajoutée au-dessus du total étend la somme', () => {
    const change = { axis: 'row', index: 3, count: 1 } as const
    expect(shiftReferences('=SUM(C1:C3)', change)).toBe('=SUM(C1:C3)')
    expect(shiftReferences('=SUM(C1:C3)', { ...change, expandAdjacent: true })).toBe('=SUM(C1:C4)')
    expect(shiftReferences('=C3', { ...change, expandAdjacent: true })).toBe('=C3')
  })

  it('suppression d’une ligne référencée : #REF!', () => {
    expect(shiftReferences('=A3*2', { axis: 'row', index: 2, count: -1 })).toBe('=#REF!*2')
  })

  it('suppression partielle d’une plage : la plage se réduit', () => {
    expect(shiftReferences('=SUM(C1:C5)', { axis: 'row', index: 3, count: -2 })).toBe('=SUM(C1:C3)')
    expect(shiftReferences('=SUM(C2:C5)', { axis: 'row', index: 0, count: -2 })).toBe('=SUM(C1:C3)')
  })

  it('suppression complète d’une plage : #REF!', () => {
    expect(shiftReferences('=SUM(C2:C3)', { axis: 'row', index: 1, count: -2 })).toBe('=SUM(#REF!)')
  })

  it('suppression de colonne', () => {
    expect(shiftReferences('=A1+C1+D1', { axis: 'col', index: 1, count: -1 })).toBe('=A1+B1+C1')
  })

  it('ne touche pas une formule non concernée', () => {
    expect(shiftReferences('=A1', { axis: 'row', index: 10, count: 3 })).toBe('=A1')
  })
})
