import { describe, expect, it } from 'vitest'
import { applySuggestion, formulaContext, syntaxParts } from '../formula-suggest'

describe('aide à la saisie des formules', () => {
  it('suggère des fonctions pour le nom en cours de frappe', () => {
    const ctx = formulaContext('=SOMME.S', 8)
    expect(ctx.prefix).toBe('SOMME.S')
    expect(ctx.suggestions.map((s) => s.insert)).toEqual(['SOMME.SI', 'SOMME.SI.ENS'])
  })

  it('aucune suggestion hors formule, dans un texte ou sur une référence', () => {
    expect(formulaContext('SOMME', 5).suggestions).toEqual([])
    expect(formulaContext('="som', 5).suggestions).toEqual([])
    expect(formulaContext('=C1', 3).suggestions).toEqual([])
  })

  it('repère la fonction englobante et l’argument courant', () => {
    const text = '=SOMME.SI(B1:B4; "En cours"; '
    const ctx = formulaContext(text, text.length)
    expect(ctx.call?.doc.name).toBe('SUMIF')
    expect(ctx.call?.arg).toBe(2)
    // Le point-virgule d'un texte ne compte pas.
    expect(formulaContext('=SI(A1="a;b"; ', 14).call?.arg).toBe(1)
    // Parenthèse refermée : plus de fonction englobante.
    expect(formulaContext('=SOMME(A1:A3)', 13).call).toBeNull()
  })

  it('insère le nom choisi avec sa parenthèse', () => {
    const ctx = formulaContext('=1+som', 6)
    expect(applySuggestion('=1+som', ctx, 'SOMME')).toEqual({ text: '=1+SOMME(', caret: 9 })
    const inner = formulaContext('=som(A1)', 4)
    expect(applySuggestion('=som(A1)', inner, 'SOMME')).toEqual({ text: '=SOMME(A1)', caret: 7 })
  })

  it('découpe la syntaxe en arguments', () => {
    const ctx = formulaContext('=RECHERCHEV(', 12)
    expect(syntaxParts(ctx.call!.doc)).toEqual({
      name: 'RECHERCHEV',
      args: ['valeur', 'table', 'colonne', '[approchée]'],
    })
  })
})
