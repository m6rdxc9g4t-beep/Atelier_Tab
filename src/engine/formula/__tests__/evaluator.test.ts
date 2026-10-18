import { describe, expect, it } from 'vitest'
import { calc, show } from './helpers'

describe('arithmétique', () => {
  it.each([
    ['=1+2*3', 7],
    ['=(1+2)*3', 9],
    ['=10/4', 2.5],
    ['=2^10', 1024],
    ['=-2^2', 4], // Excel : la négation passe avant la puissance
    ['=2^3^2', 64], // Excel : ^ associatif à gauche
    ['=50%', 0.5],
    ['=200*10%', 20],
    ['=--3', 3],
    ['=0.1+0.2', 0.3], // arrondi à 15 chiffres significatifs
    ['=45000*1.2', 54000],
    ['=1e3+1', 1001],
  ])('%s = %s', (formula, expected) => {
    expect(show(calc(formula))).toBe(expected)
  })

  it('division par zéro', () => {
    expect(show(calc('=1/0'))).toBe('#DIV/0!')
    expect(show(calc('=1/A1'))).toBe('#DIV/0!') // cellule vide = 0
  })

  it('convertit texte numérique et booléens', () => {
    expect(show(calc('="3"+1'))).toBe(4)
    expect(show(calc('=TRUE+1'))).toBe(2)
  })

  it('refuse le texte non numérique', () => {
    expect(show(calc('="abc"+1'))).toBe('#VALUE!')
  })

  it('traite une cellule vide comme 0', () => {
    expect(show(calc('=A1+5'))).toBe(5)
  })

  it('refuse une plage seule hors fonction', () => {
    expect(show(calc('=A1:A3', { A1: 1 }))).toBe('#VALUE!')
  })
})

describe('texte et comparaisons', () => {
  it.each([
    ['="Lot "&3', 'Lot 3'],
    ['="a"&TRUE', 'aTRUE'],
    ['="x"&A1', 'x'],
    ['=1.5&""', '1.5'],
    ['=1<2', true],
    ['=2<=2', true],
    ['=1<>1', false],
    ['="abc"="ABC"', true], // insensible à la casse
    ['="b">"a"', true],
    ['=1<"a"', true], // nombres < textes
    ['="z"<TRUE', true], // textes < booléens
    ['=A1=0', true], // vide comparé à un nombre
    ['=A1=""', true], // vide comparé à un texte
  ])('%s → %s', (formula, expected) => {
    expect(show(calc(formula))).toBe(expected)
  })
})

describe('propagation des erreurs', () => {
  it('une erreur d’entrée se propage', () => {
    expect(show(calc('=A1+1', { A1: '=1/0' }))).toBe('#DIV/0!')
    expect(show(calc('=#REF!*2'))).toBe('#REF!')
  })

  it('fonction inconnue : #NAME?', () => {
    expect(show(calc('=BIDULE(1)'))).toBe('#NAME?')
  })

  it('formule mal formée : #ERROR!', () => {
    expect(show(calc('=1+'))).toBe('#ERROR!')
  })
})
