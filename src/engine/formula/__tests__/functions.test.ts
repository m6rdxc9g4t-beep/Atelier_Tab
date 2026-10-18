import { describe, expect, it } from 'vitest'
import { listFunctionNames } from '../functions'
import { calc, show } from './helpers'

const DATA = {
  C1: 45000,
  C2: 28500,
  C3: 15000,
  D1: 'texte',
  D2: true,
  D3: null,
  E1: '=1/0',
}

describe('SUM', () => {
  it('additionne une plage', () => {
    expect(show(calc('=SUM(C1:C3)', DATA))).toBe(88500)
  })

  it('reproduit le total TTC de la spécification', () => {
    expect(show(calc('=SUM(C1:C3) * 1.20', DATA))).toBe(106200)
  })

  it('ignore texte, booléens et vides dans une plage', () => {
    expect(show(calc('=SUM(C1:D3)', DATA))).toBe(88500)
  })

  it('ignore le texte d’une référence seule, mais convertit les littéraux', () => {
    expect(show(calc('=SUM(D1)', DATA))).toBe(0)
    expect(show(calc('=SUM("3", TRUE, 1)'))).toBe(5)
    expect(show(calc('=SUM("abc")'))).toBe('#VALUE!')
  })

  it('propage une erreur de la plage', () => {
    expect(show(calc('=SUM(C1:E1)', DATA))).toBe('#DIV/0!')
  })

  it('accepte plusieurs arguments et des plages inversées', () => {
    expect(show(calc('=SUM(C3:C1, 500, C1)', DATA))).toBe(134000)
  })
})

describe('AVERAGE / AVG / MIN / MAX / COUNT', () => {
  it('moyenne, avec l’alias AVG de la spécification', () => {
    expect(show(calc('=AVERAGE(C1:C3)', DATA))).toBe(29500)
    expect(show(calc('=AVG(C1:C3)', DATA))).toBe(29500)
  })

  it('moyenne sans nombre : #DIV/0!', () => {
    expect(show(calc('=AVERAGE(D1:D3)', DATA))).toBe('#DIV/0!')
  })

  it('min et max', () => {
    expect(show(calc('=MIN(C1:C3)', DATA))).toBe(15000)
    expect(show(calc('=MAX(C1:C3, 99999)', DATA))).toBe(99999)
    expect(show(calc('=MAX(D1:D3)', DATA))).toBe(0)
  })

  it('COUNT compte les nombres, COUNTA les non-vides', () => {
    expect(show(calc('=COUNT(C1:D3)', DATA))).toBe(3)
    expect(show(calc('=COUNTA(C1:D3)', DATA))).toBe(5)
  })
})

describe('IF / IFERROR', () => {
  it('reproduit l’exemple de la spécification', () => {
    expect(show(calc('=IF(C1>10000, "Dépassement", "OK")', DATA))).toBe('Dépassement')
    expect(show(calc('=IF(C3>20000, "Dépassement", "OK")', DATA))).toBe('OK')
  })

  it('sans branche sinon, renvoie FALSE', () => {
    expect(show(calc('=IF(FALSE, 1)'))).toBe(false)
  })

  it('n’évalue pas la branche non retenue', () => {
    expect(show(calc('=IF(TRUE, 1, 1/0)'))).toBe(1)
  })

  it('valide le nombre d’arguments', () => {
    expect(show(calc('=IF(TRUE)'))).toBe('#VALUE!')
  })

  it('IFERROR remplace une erreur', () => {
    expect(show(calc('=IFERROR(1/0, 0)'))).toBe(0)
    expect(show(calc('=IFERROR(E1, "n/a")', DATA))).toBe('n/a')
    expect(show(calc('=IFERROR(5, 0)'))).toBe(5)
  })
})

describe('autres fonctions', () => {
  it.each([
    ['=ROUND(2.345, 2)', 2.35],
    ['=ROUND(1.005, 2)', 1.01],
    ['=ROUND(-2.5)', -3],
    ['=ROUND(1234, -2)', 1200],
    ['=ABS(-4)', 4],
    ['=AND(TRUE, 1)', true],
    ['=AND(TRUE, 0)', false],
    ['=OR(FALSE, 0, 1)', true],
    ['=NOT(TRUE)', false],
    ['=CONCAT("a", 1, TRUE)', 'a1TRUE'],
  ])('%s = %s', (formula, expected) => {
    expect(show(calc(formula))).toBe(expected)
  })

  it('vérifie le nombre d’arguments', () => {
    expect(show(calc('=ABS(1, 2)'))).toBe('#VALUE!')
    expect(show(calc('=SUM()'))).toBe('#VALUE!')
  })
})

describe('noms français (Excel FR)', () => {
  it.each([
    ['=SOMME(C1:C3)', 88500],
    ['=MOYENNE(C1:C3)', 29500],
    ['=SI(C1>10000; "Dépassement"; "OK")', 'Dépassement'],
    ['=SIERREUR(1/0; 0)', 0],
    ['=NB(C1:D3)', 3],
    ['=ARRONDI(2.345; 2)', 2.35],
    ['=ET(VRAI; FAUX)', false],
  ])('%s = %s', (formula, expected) => {
    expect(show(calc(formula, DATA))).toBe(expected)
  })

  it('liste les noms disponibles pour l’autocomplétion', () => {
    expect(listFunctionNames()).toEqual(expect.arrayContaining(['SUM', 'AVG', 'IF', 'SOMME', 'SI']))
  })
})
