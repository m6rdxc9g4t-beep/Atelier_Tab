import { describe, expect, it } from 'vitest'
import { FormulaError } from '@/engine/formula'
import type { Field } from '@/types/domain'
import {
  formatCompact,
  formatValue,
  parseDate,
  parseLocaleNumber,
  parseUserInput,
  toEditText,
  toEngineInput,
} from '..'

const ctx = {
  collaborators: {
    usr_md: { id: 'usr_md', name: 'Marie Dubois', initials: 'MD', color: 'violet' as const },
  },
}
const f = (type: Field['type'], extra: Partial<Field> = {}): Field => ({
  id: 'f',
  label: 'F',
  type,
  ...extra,
})
const status = f('select', {
  options: {
    choices: [
      { id: 'opt_doing', label: 'En cours', color: 'blue' },
      { id: 'opt_done', label: 'Validé', color: 'green' },
    ],
  },
})
// Les espaces fines insécables d'Intl rendent les comparaisons illisibles : on les normalise.
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ')

describe('parseLocaleNumber', () => {
  it.each([
    ['45000', 45000],
    ['45 000', 45000],
    ['45 000,50 €', 45000.5],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['-12,5 %', -12.5],
    ['3.5', 3.5],
  ])('%s → %s', (text, n) => expect(parseLocaleNumber(text)).toBe(n))

  it.each(['abc', '', '-', '12abc'])('rejette « %s »', (text) => {
    expect(parseLocaleNumber(text)).toBeNull()
  })
})

describe('parseDate', () => {
  it.each([
    ['30/11/2026', '2026-11-30'],
    ['5/1/27', '2027-01-05'],
    ['2026-11-30', '2026-11-30'],
    ['30-11-2026', '2026-11-30'],
  ])('%s → %s', (text, iso) => expect(parseDate(text)).toBe(iso))

  it('rejette une date impossible', () => {
    expect(parseDate('31/02/2026')).toBeNull()
  })
})

describe('parseUserInput', () => {
  it('garde les formules telles quelles, quel que soit le type', () => {
    expect(parseUserInput(f('currency'), '=C1*1.2', ctx)).toEqual({ ok: true, input: '=C1*1.2' })
  })

  it('vide → null', () => {
    expect(parseUserInput(f('text'), '  ', ctx)).toEqual({ ok: true, input: null })
  })

  it('devise et pourcentage', () => {
    expect(parseUserInput(f('currency'), '45 000 €', ctx)).toEqual({ ok: true, input: 45000 })
    expect(parseUserInput(f('percent'), '20 %', ctx)).toEqual({ ok: true, input: 0.2 })
    expect(parseUserInput(f('number'), 'beaucoup', ctx).ok).toBe(false)
  })

  it('statut : libellé insensible à la casse et aux accents → id', () => {
    expect(parseUserInput(status, 'valide', ctx)).toEqual({ ok: true, input: 'opt_done' })
    expect(parseUserInput(status, 'Inconnu', ctx).ok).toBe(false)
  })

  it('responsable : nom ou initiales → id', () => {
    expect(parseUserInput(f('owner'), 'md', ctx)).toEqual({ ok: true, input: 'usr_md' })
  })

  it('case à cocher et date', () => {
    expect(parseUserInput(f('checkbox'), 'oui', ctx)).toEqual({ ok: true, input: true })
    expect(parseUserInput(f('date'), '30/11/2026', ctx)).toEqual({ ok: true, input: '2026-11-30' })
  })
})

describe('toEngineInput / toEditText', () => {
  it('remplace les identifiants par des libellés pour le moteur', () => {
    expect(toEngineInput(status, 'opt_doing', ctx)).toBe('En cours')
    expect(toEngineInput(f('owner'), 'usr_md', ctx)).toBe('Marie Dubois')
    expect(toEngineInput(f('currency'), 45000, ctx)).toBe(45000)
  })

  it('prépare le texte de l’éditeur', () => {
    expect(toEditText(f('percent'), 0.2, ctx)).toBe('20')
    expect(toEditText(f('currency'), 45000.5, ctx)).toBe('45000,5')
    expect(toEditText(f('date'), '2026-11-30', ctx)).toBe('30/11/2026')
    expect(toEditText(status, 'opt_done', ctx)).toBe('Validé')
  })
})

describe('formatValue', () => {
  it('devise en euros, sans décimales pour un entier', () => {
    expect(plain(formatValue(f('currency'), 45000))).toBe('45 000 €')
    expect(plain(formatValue(f('currency'), 21.4))).toBe('21,40 €')
  })

  it('formule au format devise', () => {
    const ttc = f('formula', { options: { resultFormat: 'currency' } })
    expect(plain(formatValue(ttc, 106200))).toBe('106 200 €')
  })

  it('pourcentage, date, booléen, erreur', () => {
    expect(plain(formatValue(f('percent'), 0.2))).toBe('20 %')
    expect(formatValue(f('date'), '2026-11-30')).toBe('30/11/2026')
    expect(formatValue(f('checkbox'), true)).toBe('✓')
    expect(formatValue(f('number'), new FormulaError('#DIV/0!'))).toBe('#DIV/0!')
  })

  it('date : numéro de série (Date + 7) et formule au format date', () => {
    expect(formatValue(f('date'), 46356)).toBe('30/11/2026')
    const end = f('formula', { options: { resultFormat: 'date' } })
    expect(formatValue(end, '2026-12-07')).toBe('07/12/2026')
    expect(formatValue(end, 46363)).toBe('07/12/2026')
  })

  it('format compact du pied de grille', () => {
    expect(plain(formatCompact(194700))).toBe('194,7 k')
  })
})
