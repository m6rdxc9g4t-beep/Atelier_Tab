import { describe, expect, it } from 'vitest'
import { collectReferences, parseFormula } from '../parser'
import { tokenize } from '../tokenizer'

describe('tokenizer', () => {
  it('distingue référence, fonction et booléen', () => {
    const types = tokenize('SUM(A1:B2)+TRUE+LOG10(1)').map((t) => t.type)
    expect(types).toEqual([
      'ident',
      'lparen',
      'ref',
      'op',
      'ref',
      'rparen',
      'op',
      'bool',
      'op',
      'ident',
      'lparen',
      'number',
      'rparen',
      'eof',
    ])
  })

  it('lit les chaînes avec guillemets doublés', () => {
    const [t] = tokenize('"il a dit ""oui"""')
    expect(t).toMatchObject({ type: 'string', value: 'il a dit "oui"' })
  })

  it('accepte ; comme séparateur (Excel français)', () => {
    expect(tokenize('IF(A1;1;2)').filter((t) => t.type === 'sep')).toHaveLength(2)
  })

  it('reconnaît les littéraux d’erreur', () => {
    expect(tokenize('#DIV/0!+#REF!').map((t) => t.type)).toEqual(['error', 'op', 'error', 'eof'])
  })

  it('rejette un caractère inconnu', () => {
    expect(() => tokenize('A1 @ 2')).toThrow(/inattendu/)
  })

  it('rejette une chaîne non fermée', () => {
    expect(() => tokenize('"abc')).toThrow(/Guillemet/)
  })
})

describe('parser', () => {
  it('respecte les priorités usuelles', () => {
    expect(parseFormula('=1+2*3')).toEqual({
      type: 'binary',
      op: '+',
      left: { type: 'number', value: 1 },
      right: {
        type: 'binary',
        op: '*',
        left: { type: 'number', value: 2 },
        right: { type: 'number', value: 3 },
      },
    })
  })

  it('construit une plage', () => {
    expect(parseFormula('A1:B2')).toMatchObject({
      type: 'range',
      start: { col: 0, row: 0 },
      end: { col: 1, row: 1 },
    })
  })

  it('accepte les appels sans argument', () => {
    expect(parseFormula('=FOO()')).toEqual({ type: 'call', name: 'FOO', args: [] })
  })

  it.each([
    ['=', /vide/],
    ['=1+', /incomplète/],
    ['=(1+2', /fermante/],
    ['=SUM(1 2)', /attendu/],
    ['=1 2', /inattendu/],
    ['=A1:', /plage/i],
    ['=ABC', /Nom inconnu/],
  ])('signale une erreur de syntaxe pour %s', (formula, message) => {
    expect(() => parseFormula(formula)).toThrow(message)
  })

  it('collecte références et plages', () => {
    const refs = collectReferences(parseFormula('=IF(A1>0, SUM(B1:B3), C2)'))
    expect(refs.cells.map((r) => [r.col, r.row])).toEqual([
      [0, 0],
      [2, 1],
    ])
    expect(refs.ranges).toHaveLength(1)
  })
})

describe('formulaReferences', () => {
  it('liste les zones lues dans l’ordre', async () => {
    const { formulaReferences } = await import('../parser')
    expect(formulaReferences('=SUM(C1:C3)*1.2+D1')).toEqual([
      { c0: 2, c1: 2, r0: 0, r1: 2 },
      { c0: 3, c1: 3, r0: 0, r1: 0 },
    ])
  })

  it('reste utilisable pendant la frappe d’une formule incomplète', async () => {
    const { formulaReferences } = await import('../parser')
    expect(formulaReferences('=SUM(C1:C3')).toEqual([{ c0: 2, c1: 2, r0: 0, r1: 2 }])
    expect(formulaReferences('=SUM(C1:')).toEqual([{ c0: 2, c1: 2, r0: 0, r1: 0 }])
    expect(formulaReferences('="abc')).toEqual([])
  })

  it('découpe une formule pour l’affichage coloré', async () => {
    const { tokenizeForDisplay } = await import('../display')
    expect(tokenizeForDisplay('=SUM(C1:C3)*1.2+D1')).toEqual([
      { kind: 'text', text: '=' },
      { kind: 'function', text: 'SUM' },
      { kind: 'text', text: '(' },
      { kind: 'ref', text: 'C1:C3' },
      { kind: 'text', text: ')*1.2+' },
      { kind: 'ref', text: 'D1' },
    ])
    expect(tokenizeForDisplay('="abc')).toEqual([{ kind: 'text', text: '="abc' }])
  })
})
