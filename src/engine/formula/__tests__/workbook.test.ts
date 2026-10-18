import { describe, expect, it } from 'vitest'
import { Workbook } from '../workbook'
import { sheet, show } from './helpers'

describe('Workbook : recalcul', () => {
  it('reconstruit le tableau de la spécification', () => {
    const wb = sheet({
      A1: 'Gros œuvre',
      C1: 45000,
      A2: 'Charpente bois',
      C2: 28500,
      A3: 'Isolation thermique',
      C3: 15000,
      A4: 'TOTAL TTC (20%)',
      C4: '=SUM(C1:C3)*1.20',
    })
    expect(wb.getValue('C4')).toBe(106200)
    expect(wb.getInput('C4')).toBe('=SUM(C1:C3)*1.20')
  })

  it('propage une modification le long d’une chaîne', () => {
    const wb = sheet({ A1: 1, A2: '=A1*2', A3: '=A2+1', A4: '=A3*10' })
    expect(wb.getValue('A4')).toBe(30)
    const changed = wb.setCell('A1', 5)
    expect(wb.getValue('A4')).toBe(110)
    expect([...changed].sort()).toEqual(['A1', 'A2', 'A3', 'A4'])
  })

  it('recalcule les formules qui lisent une plage', () => {
    const wb = sheet({ C1: 1, C2: 2, D1: '=SUM(C1:C10)' })
    wb.setCell('C9', 100)
    expect(wb.getValue('D1')).toBe(103)
  })

  it('ne signale que les cellules dont la valeur change', () => {
    const wb = sheet({ A1: 1, B1: '=IF(A1>0, "positif", "négatif")' })
    const changed = wb.setCell('A1', 2)
    expect([...changed]).toEqual(['A1'])
  })

  it('évalue un losange de dépendances une seule fois, dans le bon ordre', () => {
    const wb = sheet({ A1: 2, B1: '=A1*3', C1: '=A1+1', D1: '=B1+C1' })
    wb.setCell('A1', 10)
    expect(wb.getValue('D1')).toBe(41)
  })

  it('accepte des formules saisies avant leurs antécédents', () => {
    const wb = new Workbook()
    wb.setCell('B1', '=A1*2')
    expect(wb.getValue('B1')).toBe(0)
    wb.setCell('A1', 21)
    expect(wb.getValue('B1')).toBe(42)
  })

  it('vider une cellule la retire et met à jour les dépendants', () => {
    const wb = sheet({ A1: 4, B1: '=A1*2' })
    wb.setCell('A1', null)
    expect(wb.getValue('A1')).toBeNull()
    expect(wb.getValue('B1')).toBe(0)
    expect(wb.addresses()).toEqual(['B1'])
  })

  it('remplacer une formule supprime ses anciennes dépendances', () => {
    const wb = sheet({ A1: 1, B1: 10, C1: '=A1' })
    wb.setCell('C1', '=B1')
    expect(wb.getDependents('A1')).toEqual([])
    expect(wb.getDependents('B1')).toEqual(['C1'])
    wb.setCell('A1', 99)
    expect(wb.getValue('C1')).toBe(10)
  })

  it('normalise les adresses ($, minuscules)', () => {
    const wb = sheet({ a1: 3, B1: '=$A$1*2' })
    expect(wb.getValue('$A$1')).toBe(3)
    expect(wb.getValue('b1')).toBe(6)
  })

  it('expose les antécédents pour la mise en évidence', () => {
    const wb = sheet({ D1: '=C1*1.2+SUM(A1:A3)' })
    const p = wb.getPrecedents('D1')
    expect(p.cells).toEqual(['C1'])
    expect(p.ranges).toHaveLength(1)
  })

  it('conserve le message d’une erreur de syntaxe', () => {
    const wb = sheet({ A1: '=SUM(1' })
    expect(show(wb.getValue('A1'))).toBe('#ERROR!')
    expect(wb.getParseError('A1')).toMatch(/fermante|attendu/)
  })

  it('un "=" seul est du texte', () => {
    const wb = sheet({ A1: '=' })
    expect(wb.getValue('A1')).toBe('=')
  })
})

describe('Workbook : cycles', () => {
  it('auto-référence', () => {
    const wb = sheet({ A1: '=A1+1' })
    expect(show(wb.getValue('A1'))).toBe('#CYCLE!')
  })

  it('cycle à plusieurs cellules', () => {
    const wb = sheet({ A1: '=B1', B1: '=C1', C1: '=A1' })
    for (const a of ['A1', 'B1', 'C1']) expect(show(wb.getValue(a))).toBe('#CYCLE!')
  })

  it('cycle via une plage', () => {
    const wb = sheet({ C1: 1, C2: 2, C3: '=SUM(C1:C3)' })
    expect(show(wb.getValue('C3'))).toBe('#CYCLE!')
  })

  it('les cellules en aval d’un cycle sont évaluées (et IFERROR le rattrape)', () => {
    const wb = sheet({
      A1: '=B1',
      B1: '=A1',
      C1: '=A1*2',
      D1: '=IFERROR(A1, -1)',
      E1: 7,
      F1: '=E1+1',
    })
    expect(show(wb.getValue('C1'))).toBe('#CYCLE!')
    expect(wb.getValue('D1')).toBe(-1)
    expect(wb.getValue('F1')).toBe(8)
  })

  it('casser le cycle restaure les valeurs', () => {
    const wb = sheet({ A1: '=B1', B1: '=A1' })
    wb.setCell('B1', 5)
    expect(wb.getValue('A1')).toBe(5)
    expect(wb.getValue('B1')).toBe(5)
  })

  it('un cycle n’empêche pas le reste de la feuille de se mettre à jour', () => {
    const wb = sheet({ A1: '=A1', B1: 1, C1: '=B1*2' })
    wb.setCell('B1', 4)
    expect(wb.getValue('C1')).toBe(8)
  })
})

describe('Workbook : aperçu (barre de formules)', () => {
  it('évalue sans enregistrer', () => {
    const wb = sheet({ C1: 45000 })
    expect(wb.preview('=C1*1.2', 'D1')).toBe(54000)
    expect(wb.getInput('D1')).toBeNull()
  })

  it('détecte un cycle avant validation', () => {
    const wb = sheet({ B1: '=A1*2' })
    expect(show(wb.preview('=B1+1', 'A1'))).toBe('#CYCLE!')
    expect(show(wb.preview('=SUM(A1:A3)', 'A2'))).toBe('#CYCLE!')
  })

  it('signale une formule incomplète', () => {
    expect(show(new Workbook().preview('=SUM(A1:'))).toBe('#ERROR!')
  })
})

describe('Workbook : volume', () => {
  it('recalcule 5 000 lignes chaînées rapidement', () => {
    const wb = new Workbook()
    const entries: [string, string | number][] = [['A1', 1]]
    for (let r = 2; r <= 5000; r++) entries.push([`A${r}`, `=A${r - 1}+1`])
    wb.setCells(entries)
    expect(wb.getValue('A5000')).toBe(5000)

    const t0 = performance.now()
    wb.setCell('A1', 10)
    const elapsed = performance.now() - t0
    expect(wb.getValue('A5000')).toBe(5009)
    expect(elapsed).toBeLessThan(500)
  })
})
