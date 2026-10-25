import { describe, expect, it } from 'vitest'
import { fillValues, parseTsv, tileToSelection, toTsv } from '..'

describe('presse-papiers TSV', () => {
  it('écrit comme Excel : tabulations, CRLF, guillemets si besoin', () => {
    expect(toTsv([['a', 'b'], ['c', 'd']])).toBe('a\tb\r\nc\td')
    expect(toTsv([['ligne 1\nligne 2', 'dit "oui"']])).toBe('"ligne 1\nligne 2"\t"dit ""oui"""')
  })

  it('relit un collage d’Excel (dernier retour à la ligne ignoré)', () => {
    expect(parseTsv('Lot\tCoût\r\nGros œuvre\t45 000\r\n')).toEqual([
      ['Lot', 'Coût'],
      ['Gros œuvre', '45 000'],
    ])
  })

  it('cellules entre guillemets, lignes de largeurs différentes', () => {
    expect(parseTsv('"a\tb"\t"c\nd"\ne')).toEqual([
      ['a\tb', 'c\nd'],
      ['e', ''],
    ])
    expect(parseTsv('"dit ""oui"""')).toEqual([['dit "oui"']])
  })

  it('aller-retour sans perte', () => {
    const rows = [['x', 'y\tz'], ['"q"', '']]
    expect(parseTsv(toTsv(rows))).toEqual(rows)
  })

  it('texte vide : aucune ligne', () => {
    expect(parseTsv('')).toEqual([])
  })
})

describe('tileToSelection', () => {
  it('une cellule copiée remplit toute la sélection', () => {
    expect(tileToSelection([[1]], 2, 3)).toEqual([
      [1, 1, 1],
      [1, 1, 1],
    ])
  })

  it('répète un bloc si la sélection en est un multiple, sinon le garde tel quel', () => {
    expect(tileToSelection([[1], [2]], 4, 1)).toEqual([[1], [2], [1], [2]])
    expect(tileToSelection([[1], [2]], 3, 1)).toEqual([[1], [2]])
  })
})

describe('fillValues (poignée de recopie)', () => {
  const down = { axis: 'row' as const, fieldType: 'number' as const }

  it('série linéaire de nombres', () => {
    expect(fillValues([1, 2], 3, down)).toEqual([3, 4, 5])
    expect(fillValues([10, 20, 30], 2, down)).toEqual([40, 50])
    expect(fillValues([0.1, 0.2], 2, down)).toEqual([0.3, 0.4])
    expect(fillValues([5, 3], 2, { ...down, backward: true })).toEqual([7, 9])
  })

  it('un seul nombre est recopié', () => {
    expect(fillValues([7], 2, down)).toEqual([7, 7])
  })

  it('formules : références relatives décalées, absolues conservées', () => {
    expect(fillValues(['=C1*1.2'], 2, down)).toEqual(['=C2*1.2', '=C3*1.2'])
    expect(fillValues(['=$C$1+C1'], 1, down)).toEqual(['=$C$1+C2'])
    expect(fillValues(['=A1'], 2, { axis: 'col', fieldType: 'formula' })).toEqual(['=B1', '=C1'])
    expect(fillValues(['=A5'], 1, { ...down, backward: true })).toEqual(['=A4'])
  })

  it('dates : un jour de plus, ou le même écart', () => {
    const date = { axis: 'row' as const, fieldType: 'date' as const }
    expect(fillValues(['2026-12-30'], 3, date)).toEqual(['2026-12-31', '2027-01-01', '2027-01-02'])
    expect(fillValues(['2026-01-01', '2026-01-08'], 2, date)).toEqual(['2026-01-15', '2026-01-22'])
  })

  it('texte terminé par un nombre', () => {
    const text = { axis: 'row' as const, fieldType: 'text' as const }
    expect(fillValues(['Lot 1'], 2, text)).toEqual(['Lot 2', 'Lot 3'])
    expect(fillValues(['A08', 'A10'], 2, text)).toEqual(['A12', 'A14'])
    expect(fillValues(['Lot 1', 'Étape 2'], 3, text)).toEqual(['Lot 1', 'Étape 2', 'Lot 1'])
  })

  it('motif répété : statuts, cases, vides', () => {
    const select = { axis: 'row' as const, fieldType: 'select' as const }
    expect(fillValues(['opt_todo', 'opt_done'], 3, select)).toEqual([
      'opt_todo',
      'opt_done',
      'opt_todo',
    ])
    expect(fillValues([true, null], 2, { axis: 'row', fieldType: 'checkbox' })).toEqual([true, null])
  })
})
