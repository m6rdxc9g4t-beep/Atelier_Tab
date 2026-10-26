import { afterEach, describe, expect, it } from 'vitest'
import { canonicalName, FUNCTION_CATALOG, functionDoc, suggestFunctions } from '../catalog'
import { clock } from '../functions-date'
import { listFunctionNames, resolveFunction } from '../functions'
import { Workbook } from '../workbook'
import { calc, show } from './helpers'

const v = (formula: string, cells: Parameters<typeof calc>[1] = {}) => show(calc(formula, cells))

describe('mathématiques', () => {
  it('ENT, TRONQUE, MOD (signe du diviseur), PUISSANCE, RACINE', () => {
    expect(v('=ENT(-2.5)')).toBe(-3)
    expect(v('=TRONQUE(-2.56; 1)')).toBe(-2.5)
    expect(v('=MOD(-3; 2)')).toBe(1)
    expect(v('=MOD(5; 0)')).toBe('#DIV/0!')
    expect(v('=PUISSANCE(2; 10)')).toBe(1024)
    expect(v('=RACINE(-1)')).toBe('#NUM!')
  })

  it('ARRONDI.SUP / ARRONDI.INF / PLAFOND / PLANCHER', () => {
    expect(v('=ARRONDI.SUP(1.231; 2)')).toBe(1.24)
    expect(v('=ARRONDI.SUP(-1.231; 2)')).toBe(-1.24)
    expect(v('=ARRONDI.INF(1.239; 2)')).toBe(1.23)
    expect(v('=ROUNDUP(1234; -2)')).toBe(1300)
    expect(v('=PLAFOND(23; 5)')).toBe(25)
    expect(v('=PLANCHER(23; 5)')).toBe(20)
    expect(v('=CEILING(0.21; 0.1)')).toBe(0.3)
  })

  it('PLAFOND / PLANCHER tiennent compte du signe du multiple, les versions .MATH non', () => {
    expect(v('=PLAFOND(-2.5; -2)')).toBe(-4)
    expect(v('=PLANCHER(-2.5; -2)')).toBe(-2)
    expect(v('=PLAFOND(-2.5; 2)')).toBe(-2)
    expect(v('=PLANCHER(-2.5; 2)')).toBe(-4)
    expect(v('=PLAFOND(2.5; -2)')).toBe('#NUM!')
    expect(v('=PLANCHER(2.5; -2)')).toBe('#NUM!')
    expect(v('=PLAFOND.MATH(-2.5; -2)')).toBe(-2)
    expect(v('=PLANCHER.MATH(-2.5; -2)')).toBe(-4)
    expect(v('=CEILING.MATH(2.5; -2)')).toBe(4)
    expect(v('=FLOOR.MATH(2.5; -2)')).toBe(2)
  })

  it('PRODUIT, MEDIANE, GRANDE.VALEUR, PETITE.VALEUR', () => {
    const cells = { A1: 4, A2: 1, A3: 3, A4: 'x' }
    expect(v('=PRODUIT(A1:A4)', cells)).toBe(12)
    expect(v('=MEDIANE(A1:A3)', cells)).toBe(3)
    expect(v('=MEDIANE(A1:A3; 10)', cells)).toBe(3.5)
    expect(v('=GRANDE.VALEUR(A1:A4; 1)', cells)).toBe(4)
    expect(v('=PETITE.VALEUR(A1:A4; 2)', cells)).toBe(3)
    expect(v('=LARGE(A1:A3; 4)', cells)).toBe('#NUM!')
  })

  it('SOMMEPROD : quantités × prix, plages de même taille', () => {
    const cells = { A1: 2, A2: 3, B1: 10, B2: 'n/a' }
    expect(v('=SOMMEPROD(A1:A2; B1:B2)', cells)).toBe(20)
    expect(v('=SUMPRODUCT(A1:A2; B1:B1)', cells)).toBe('#VALUE!')
  })

  it('NB.VIDE, LOG, LN, PI, SIGNE', () => {
    expect(v('=NB.VIDE(A1:A3)', { A2: 1 })).toBe(2)
    expect(v('=LOG(1000)')).toBe(3)
    expect(v('=LOG(8; 2)')).toBe(3)
    expect(v('=LN(0)')).toBe('#NUM!')
    expect(v('=ARRONDI(PI(); 4)')).toBe(3.1416)
    expect(v('=SIGNE(-7)')).toBe(-1)
  })
})

describe('texte', () => {
  it('GAUCHE, DROITE, STXT, NBCAR', () => {
    expect(v('=GAUCHE("Atelier"; 3)')).toBe('Ate')
    expect(v('=GAUCHE("Atelier")')).toBe('A')
    expect(v('=DROITE("Atelier"; 2)')).toBe('er')
    expect(v('=STXT("Atelier"; 2; 3)')).toBe('tel')
    expect(v('=STXT("Atelier"; 0; 3)')).toBe('#VALUE!')
    expect(v('=NBCAR("Été")')).toBe(3)
  })

  it('NBCAR compte comme les fonctions de position (un emoji = 2, comme Excel)', () => {
    const cells = { C1: '😀 Bonjour' }
    expect(v('=NBCAR("😀")')).toBe(2)
    expect(v('=DROITE(C1; NBCAR(C1)-TROUVE(" "; C1))', cells)).toBe('Bonjour')
  })

  it('MAJUSCULE, MINUSCULE, NOMPROPRE, SUPPRESPACE', () => {
    expect(v('=MAJUSCULE("élan")')).toBe('ÉLAN')
    expect(v('=MINUSCULE("ÉLAN")')).toBe('élan')
    expect(v('=NOMPROPRE("marie DUBOIS-laurent")')).toBe('Marie Dubois-Laurent')
    expect(v('=SUPPRESPACE("  lot   A  ")')).toBe('lot A')
  })

  it('SUBSTITUE (toutes les occurrences ou la n-ième), REMPLACER', () => {
    expect(v('=SUBSTITUE("a-b-c"; "-"; "/")')).toBe('a/b/c')
    expect(v('=SUBSTITUE("a-b-c"; "-"; "/"; 2)')).toBe('a-b/c')
    expect(v('=REMPLACER("2026-01"; 6; 2; "12")')).toBe('2026-12')
  })

  it('TROUVE (casse) et CHERCHE (jokers, sans casse)', () => {
    expect(v('=TROUVE("e"; "Atelier")')).toBe(3)
    expect(v('=TROUVE("E"; "Atelier")')).toBe('#VALUE!')
    expect(v('=CHERCHE("E"; "Atelier")')).toBe(3)
    expect(v('=CHERCHE("l?e"; "Atelier")')).toBe(4)
    expect(v('=CHERCHE("e"; "Atelier"; 5)')).toBe(6)
  })

  it('JOINDRE.TEXTE, REPT, EXACT, CAR', () => {
    const cells = { A1: 'Lot', A2: null, A3: 'A' }
    expect(v('=JOINDRE.TEXTE(" "; VRAI; A1:A3)', cells)).toBe('Lot A')
    expect(v('=JOINDRE.TEXTE(","; FAUX; A1:A3)', cells)).toBe('Lot,,A')
    expect(v('=REPT("-"; 3)')).toBe('---')
    expect(v('=EXACT("a"; "A")')).toBe(false)
    expect(v('=CAR(65)')).toBe('A')
  })

  it('CNUM lit les nombres à la française et les dates', () => {
    expect(v('=CNUM("1 234,5")')).toBe(1234.5)
    expect(v('=CNUM("12 %")')).toBe(0.12)
    expect(v('=CNUM("abc")')).toBe('#VALUE!')
    expect(v('=CNUM("2026-01-01")')).toBe(46023)
  })

  it('TEXTE : nombres, pourcentages et dates', () => {
    expect(v('=TEXTE(1234.5; "0,00")')).toBe('1234,50')
    expect(v('=TEXTE(1234.5; "# ##0,00 €")')).toBe('1\u202f234,50 €')
    expect(v('=TEXTE(0.256; "0,0%")')).toBe('25,6%')
    expect(v('=TEXTE(7; "000")')).toBe('007')
    expect(v('=TEXTE("2026-11-30"; "jj/mm/aaaa")')).toBe('30/11/2026')
    expect(v('=TEXTE("2026-11-30"; "jjjj j mmmm aaaa")')).toBe('lundi 30 novembre 2026')
    expect(v('=TEXTE("2026-02-03"; "mmm aa")')).toBe('févr. 26')
  })

  it('TEXTE : « 0,000 » donne trois décimales, « #,##0 » groupe les milliers', () => {
    expect(v('=TEXTE(1.5; "0,000")')).toBe('1,500')
    expect(v('=TEXTE(1.5; "0,000 kg")')).toBe('1,500 kg')
    expect(v('=TEXTE(1234.5; "# ##0,000")')).toBe('1\u202f234,500')
    expect(v('=TEXTE(1234.5; "#,##0")')).toBe('1\u202f235')
    expect(v('=TEXTE(1234567; "#,###,##0")')).toBe('1\u202f234\u202f567')
    expect(v('=TEXTE(1234.5; "#,##0.00")')).toBe('1\u202f234,50')
  })

  it('TEXTE : un format démesuré donne #VALUE! au lieu de bloquer le calcul', () => {
    expect(v('=TEXTE(1; "000000000000000000000")')).toBe('000000000000000000001')
    expect(v('=TEXTE(1; "0000000000000000000000")')).toBe('#VALUE!')
    expect(v(`=TEXTE(1; "0,${'0'.repeat(101)}")`)).toBe('#VALUE!')
    expect(show(new Workbook().preview('=TEXTE(1; "0000000000000000000000")'))).toBe('#VALUE!')
  })
})

describe('dates', () => {
  afterEach(() => {
    clock.now = () => new Date()
  })

  it('AUJOURDHUI renvoie la date du jour au format AAAA-MM-JJ', () => {
    clock.now = () => new Date(2026, 9, 25, 15, 30)
    expect(v('=AUJOURDHUI()')).toBe('2026-10-25')
  })

  it('DATE reporte les mois et jours qui débordent', () => {
    expect(v('=DATE(2026; 11; 30)')).toBe('2026-11-30')
    expect(v('=DATE(2026; 13; 1)')).toBe('2027-01-01')
    expect(v('=DATE(2026; 3; 0)')).toBe('2026-02-28')
  })

  it('ANNEE, MOIS, JOUR, JOURSEM, NO.SEMAINE.ISO', () => {
    const cells = { A1: '2026-11-30' }
    expect(v('=ANNEE(A1)', cells)).toBe(2026)
    expect(v('=MOIS(A1)', cells)).toBe(11)
    expect(v('=JOUR(A1)', cells)).toBe(30)
    expect(v('=JOURSEM(A1)', cells)).toBe(2) // lundi, type 1 : dimanche = 1
    expect(v('=JOURSEM(A1; 2)', cells)).toBe(1)
    expect(v('=NO.SEMAINE.ISO("2026-01-01")')).toBe(1)
    expect(v('=NO.SEMAINE.ISO("2027-01-01")')).toBe(53)
    expect(v('=ANNEE("pas une date")')).toBe('#VALUE!')
  })

  it('accepte une date JJ/MM/AAAA tapée en texte', () => {
    expect(v('=MOIS("30/11/2026")')).toBe(11)
  })

  it('arithmétique sur les dates : différence en jours, ajout de jours', () => {
    const cells = { A1: '2026-11-30', A2: '2026-12-15' }
    expect(v('=A2-A1', cells)).toBe(15)
    expect(v('=TEXTE(A1+7; "jj/mm/aaaa")', cells)).toBe('07/12/2026')
    expect(v('=A1+7>A1', cells)).toBe(true)
    expect(v('=A2>A1', cells)).toBe(true)
  })

  it('DATEDIF dans toutes ses unités', () => {
    const cells = { A1: '2024-01-31', A2: '2026-03-15' }
    expect(v('=DATEDIF(A1; A2; "Y")', cells)).toBe(2)
    expect(v('=DATEDIF(A1; A2; "M")', cells)).toBe(25)
    expect(v('=DATEDIF(A1; A2; "D")', cells)).toBe(774)
    expect(v('=DATEDIF(A1; A2; "YM")', cells)).toBe(1)
    expect(v('=DATEDIF(A1; A2; "MD")', cells)).toBe(12)
    expect(v('=DATEDIF(A2; A1; "D")', cells)).toBe('#NUM!')
  })

  it('MOIS.DECALER et FIN.MOIS ramènent à la fin du mois', () => {
    expect(v('=MOIS.DECALER("2026-01-31"; 1)')).toBe('2026-02-28')
    expect(v('=MOIS.DECALER("2026-01-15"; -2)')).toBe('2025-11-15')
    expect(v('=FIN.MOIS("2026-02-10"; 0)')).toBe('2026-02-28')
    expect(v('=FIN.MOIS("2026-02-10"; 1)')).toBe('2026-03-31')
  })

  it('JOURS, NB.JOURS.OUVRES (avec fériés), SERIE.JOUR.OUVRE', () => {
    expect(v('=JOURS("2026-12-25"; "2026-12-01")')).toBe(24)
    // Du lundi 30/11 au vendredi 11/12 : 10 jours ouvrés, moins le 8/12 férié.
    expect(v('=NB.JOURS.OUVRES("2026-11-30"; "2026-12-11")')).toBe(10)
    expect(v('=NB.JOURS.OUVRES("2026-11-30"; "2026-12-11"; A1)', { A1: '2026-12-08' })).toBe(9)
    // Vendredi + 1 jour ouvré = lundi.
    expect(v('=SERIE.JOUR.OUVRE("2026-12-04"; 1)')).toBe('2026-12-07')
    expect(v('=WORKDAY("2026-12-07"; -1)')).toBe('2026-12-04')
  })
})

describe('agrégats conditionnels', () => {
  const lots = {
    A1: 'Gros œuvre',
    B1: 'En cours',
    C1: 45000,
    A2: 'Charpente',
    B2: 'Terminée',
    C2: 28500,
    A3: 'Isolation',
    B3: 'En cours',
    C3: 15000,
    A4: 'Peinture',
    B4: null,
    C4: 4000,
  }

  it('SOMME.SI avec un libellé, un opérateur ou des jokers', () => {
    expect(v('=SOMME.SI(B1:B4; "En cours"; C1:C4)', lots)).toBe(60000)
    expect(v('=SOMME.SI(C1:C4; ">20000")', lots)).toBe(73500)
    expect(v('=SOMME.SI(A1:A4; "*on"; C1:C4)', lots)).toBe(15000)
    expect(v('=SOMME.SI(B1:B4; "<>En cours"; C1:C4)', lots)).toBe(32500)
    expect(v('=SOMME.SI(B1:B4; ""; C1:C4)', lots)).toBe(4000)
  })

  it('NB.SI : texte insensible à la casse, nombres, non vides', () => {
    expect(v('=NB.SI(B1:B4; "en cours")', lots)).toBe(2)
    expect(v('=NB.SI(C1:C4; 15000)', lots)).toBe(1)
    expect(v('=NB.SI(B1:B4; "<>")', lots)).toBe(3)
    expect(v('=NB.SI(C1:C4; "<=15000")', lots)).toBe(2)
  })

  it('critère de date', () => {
    const cells = { A1: '2026-11-30', A2: '2026-12-15', A3: '2027-01-20' }
    expect(v('=NB.SI(A1:A3; "<2026-12-31")', cells)).toBe(2)
    expect(v('=NB.SI(A1:A3; ">=15/12/2026")', cells)).toBe(2)
  })

  it('critère numérique calculé à partir d’une date : comparé au numéro de série', () => {
    const cells = {
      A1: '2026-10-01',
      A2: '2026-10-20',
      A3: '2026-09-01',
      A4: null,
      C1: 10,
      C2: 20,
      C3: 30,
    }
    // `&` est moins prioritaire que `-` : le critère devient le texte ">=46290".
    expect(v('=NB.SI(A1:A4; ">="&DATE(2026; 10; 25)-30)', cells)).toBe(2)
    expect(v('=NB.SI.ENS(A1:A3; ">="&A3; A1:A3; "<="&(A3+30))', cells)).toBe(2)
    expect(v('=SOMME.SI(A1:A3; "<"&(A1+1); C1:C3)', cells)).toBe(40)
    expect(v('=NB.SI(A1:A4; DATE(2026; 10; 1)+0)', cells)).toBe(1)
    expect(v('=NB.SI(A1:A4; "<>"&(DATE(2026; 10; 1)+0))', cells)).toBe(3)
    // Le texte numérique reste hors des comparaisons <, >, comme dans Excel.
    expect(v('=NB.SI(B1:B2; ">5")', { B1: '10', B2: 10 })).toBe(1)
  })

  it('SOMME.SI.ENS, NB.SI.ENS, MOYENNE.SI(.ENS), MAX.SI.ENS, MIN.SI.ENS', () => {
    expect(v('=SOMME.SI.ENS(C1:C4; B1:B4; "En cours"; C1:C4; ">20000")', lots)).toBe(45000)
    expect(v('=NB.SI.ENS(B1:B4; "En cours"; C1:C4; "<20000")', lots)).toBe(1)
    expect(v('=MOYENNE.SI(B1:B4; "En cours"; C1:C4)', lots)).toBe(30000)
    expect(v('=MOYENNE.SI(B1:B4; "Bloquée"; C1:C4)', lots)).toBe('#DIV/0!')
    expect(v('=AVERAGEIFS(C1:C4; B1:B4; "En cours")', lots)).toBe(30000)
    expect(v('=MAX.SI.ENS(C1:C4; B1:B4; "En cours")', lots)).toBe(45000)
    expect(v('=MIN.SI.ENS(C1:C4; B1:B4; "En cours")', lots)).toBe(15000)
  })

  it('dates d’une colonne Date : MAX.SI.ENS, MIN.SI.ENS et agrégats renvoient une date', () => {
    const cells = {
      A1: '2026-10-01',
      A2: '2026-10-20',
      A3: '2026-09-01',
      B1: 'Alice',
      B2: 'Alice',
      B3: 'Bob',
      C1: 1,
      C2: 0,
      C3: 0,
    }
    const date = (f: string) => v(`=TEXTE(${f}; "jj/mm/aaaa")`, cells)
    expect(date('MAX.SI.ENS(A1:A3; B1:B3; "Alice")')).toBe('20/10/2026')
    expect(date('MIN.SI.ENS(A1:A3; B1:B3; "Alice")')).toBe('01/10/2026')
    expect(date('MOYENNE.SI(B1:B3; "Bob"; A1:A3)')).toBe('01/09/2026')
    expect(date('MAX(A1:A3)')).toBe('20/10/2026')
    expect(date('GRANDE.VALEUR(A1:A3; 1)')).toBe('20/10/2026')
    expect(date('PETITE.VALEUR(A1:A3; 1)')).toBe('01/09/2026')
    expect(date('MEDIANE(A1:A3)')).toBe('01/10/2026')
    expect(v('=SOMMEPROD(C1:C3; A1:A3)', cells)).toBe(46296)
    expect(v('=NB(A1:A3)', cells)).toBe(3)
    // Le texte numérique reste ignoré dans une plage, comme dans Excel.
    expect(v('=SOMME(D1:D2)', { D1: '12', D2: 3 })).toBe(3)
    expect(v('=MAX.SI.ENS(D1:D2; D1:D2; "<>")', { D1: '12', D2: 3 })).toBe(3)
  })

  it('plages de critères de tailles différentes : #VALUE!', () => {
    expect(v('=NB.SI.ENS(B1:B4; "En cours"; C1:C3; ">0")', lots)).toBe('#VALUE!')
    expect(v('=SOMME.SI.ENS(C1:C4; B1:B4)', lots)).toBe('#VALUE!')
  })
})

describe('recherche', () => {
  const tarifs = {
    A1: 'Béton',
    B1: 120,
    C1: 'm³',
    A2: 'Bois',
    B2: 850,
    C2: 'm³',
    A3: 'Plâtre',
    B3: 12,
    C3: 'sac',
  }
  const paliers = { A1: 0, B1: 'Petit', A2: 10000, B2: 'Moyen', A3: 50000, B3: 'Gros' }

  it('RECHERCHEV exacte (FAUX) et approchée (paliers triés)', () => {
    expect(v('=RECHERCHEV("Bois"; A1:C3; 2; FAUX)', tarifs)).toBe(850)
    expect(v('=RECHERCHEV("bois"; A1:C3; 3; 0)', tarifs)).toBe('m³')
    expect(v('=RECHERCHEV("Pl*"; A1:C3; 2; FAUX)', tarifs)).toBe(12)
    expect(v('=RECHERCHEV("Acier"; A1:C3; 2; FAUX)', tarifs)).toBe('#N/A')
    expect(v('=RECHERCHEV(28500; A1:B3; 2)', paliers)).toBe('Moyen')
    expect(v('=RECHERCHEV(60000; A1:B3; 2; VRAI)', paliers)).toBe('Gros')
    expect(v('=RECHERCHEV(-1; A1:B3; 2)', paliers)).toBe('#N/A')
    expect(v('=RECHERCHEV("Bois"; A1:C3; 4; FAUX)', tarifs)).toBe('#REF!')
  })

  it('RECHERCHEH', () => {
    const cells = { A1: 'T1', B1: 'T2', A2: 100, B2: 200 }
    expect(v('=RECHERCHEH("T2"; A1:B2; 2; FAUX)', cells)).toBe(200)
  })

  it('RECHERCHEV / RECHERCHEH : une cellule vide en quatrième argument vaut FAUX', () => {
    const cells = { B1: 10, C1: 'a', B2: 20, C2: 'b', B3: 30, C3: 'c' }
    expect(v('=RECHERCHEV(25; B1:C3; 2; D1)', cells)).toBe('#N/A')
    expect(v('=RECHERCHEV(20; B1:C3; 2; D1)', cells)).toBe('b')
    expect(v('=RECHERCHEV(25; B1:C3; 2; 1)', cells)).toBe('b')
    expect(v('=RECHERCHEV(25; B1:C3; 2; "FAUX")', cells)).toBe('#N/A')
    expect(v('=RECHERCHEV(25; B1:C3; 2; "abc")', cells)).toBe('#VALUE!')
    const row = { A1: 10, B1: 20, C1: 30, A2: 'a', B2: 'b', C2: 'c' }
    expect(v('=RECHERCHEH(25; A1:C2; 2; D1)', row)).toBe('#N/A')
    expect(v('=RECHERCHEH(25; A1:C2; 2)', row)).toBe('b')
  })

  it('INDEX et EQUIV', () => {
    expect(v('=INDEX(A1:C3; 2; 3)', tarifs)).toBe('m³')
    expect(v('=INDEX(B1:B3; 3)', tarifs)).toBe(12)
    expect(v('=INDEX(A1:C1; 2)', tarifs)).toBe(120)
    expect(v('=INDEX(A1:C3; 4; 1)', tarifs)).toBe('#REF!')
    expect(v('=EQUIV("Plâtre"; A1:A3; 0)', tarifs)).toBe(3)
    expect(v('=EQUIV(30000; A1:A3; 1)', paliers)).toBe(2)
    expect(v('=INDEX(B1:B3; EQUIV("Bois"; A1:A3; 0))', tarifs)).toBe(850)
    expect(v('=EQUIV("X"; A1:A3; 0)', tarifs)).toBe('#N/A')
  })

  it('RECHERCHEX : valeur absente, modes approchés, recherche depuis la fin', () => {
    expect(v('=RECHERCHEX("Bois"; A1:A3; B1:B3)', tarifs)).toBe(850)
    expect(v('=RECHERCHEX("Acier"; A1:A3; B1:B3; "—")', tarifs)).toBe('—')
    expect(v('=RECHERCHEX("Acier"; A1:A3; B1:B3)', tarifs)).toBe('#N/A')
    expect(v('=RECHERCHEX(28500; A1:A3; B1:B3; "—"; -1)', paliers)).toBe('Moyen')
    expect(v('=RECHERCHEX(28500; A1:A3; B1:B3; "—"; 1)', paliers)).toBe('Gros')
    expect(v('=RECHERCHEX(10000; A1:A3; B1:B3; "—"; 1)', paliers)).toBe('Moyen')
    expect(v('=RECHERCHEX("m³"; C1:C3; A1:A3; ""; 0; -1)', tarifs)).toBe('Bois')
    expect(v('=XLOOKUP("Bois"; A1:A3; B1:B2)', tarifs)).toBe('#VALUE!')
  })

  it('CHOISIR', () => {
    expect(v('=CHOISIR(2; "a"; "b"; "c")')).toBe('b')
    expect(v('=CHOISIR(4; "a"; "b")')).toBe('#VALUE!')
  })
})

describe('information et logique', () => {
  it('ESTVIDE, ESTNUM, ESTTEXTE, ESTLOGIQUE, ESTERREUR, ESTNA', () => {
    const cells = { A1: 5, A2: 'x', A3: true }
    expect(v('=ESTVIDE(B1)', cells)).toBe(true)
    expect(v('=ESTVIDE(A1)', cells)).toBe(false)
    expect(v('=ESTNUM(A1)', cells)).toBe(true)
    expect(v('=ESTTEXTE(A2)', cells)).toBe(true)
    expect(v('=ESTLOGIQUE(A3)', cells)).toBe(true)
    expect(v('=ESTERREUR(1/0)')).toBe(true)
    expect(v('=ESTNA(NA())')).toBe(true)
    expect(v('=ESTNA(1/0)')).toBe(false)
  })

  it('SI.NON.DISP, SI.CONDITIONS, SI.MULTIPLE, OUX', () => {
    expect(v('=SI.NON.DISP(NA(); "absent")')).toBe('absent')
    expect(v('=SI.NON.DISP(1/0; "absent")')).toBe('#DIV/0!')
    expect(v('=SI.CONDITIONS(A1>100; "gros"; A1>10; "moyen"; VRAI; "petit")', { A1: 50 })).toBe(
      'moyen',
    )
    expect(v('=SI.CONDITIONS(A1>100; "gros")', { A1: 5 })).toBe('#N/A')
    expect(v('=SI.MULTIPLE(A1; "T"; "Tâche"; "B"; "Bug"; "Autre")', { A1: 'B' })).toBe('Bug')
    expect(v('=SI.MULTIPLE(A1; "T"; "Tâche"; "Autre")', { A1: 'Z' })).toBe('Autre')
    expect(v('=SI.MULTIPLE(A1; "T"; "Tâche")', { A1: 'Z' })).toBe('#N/A')
    expect(v('=OUX(VRAI; VRAI; VRAI)')).toBe(true)
    expect(v('=VRAI()')).toBe(true)
  })

  it('SI.CONDITIONS ignore l’erreur d’une branche non retenue', () => {
    expect(v('=SI.CONDITIONS(A1=0; "zéro"; VRAI; 1/A1)', { A1: 0 })).toBe('zéro')
  })
})

describe('catalogue', () => {
  it('documente chaque fonction de la bibliothèque, et seulement elles', () => {
    for (const d of FUNCTION_CATALOG) {
      expect(canonicalName(d.name)).toBe(d.name)
      if (d.fr) expect(canonicalName(d.fr)).toBe(d.name)
    }
    const documented = new Set(FUNCTION_CATALOG.map((d) => d.name))
    for (const name of listFunctionNames()) {
      const canonical = canonicalName(name)
      expect(canonical).not.toBeNull()
      expect(documented.has(canonical as string)).toBe(true)
    }
  })

  it('aucun alias ne masque une fonction', () => {
    for (const d of FUNCTION_CATALOG) {
      if (d.fr && d.fr !== d.name) expect(resolveFunction(d.fr)).toBe(resolveFunction(d.name))
    }
  })

  it('suggère les noms français et anglais par préfixe', () => {
    const somme = suggestFunctions('somme').map((s) => s.insert)
    expect(somme).toEqual(['SOMME', 'SOMME.SI', 'SOMMEPROD', 'SOMME.SI.ENS'])
    expect(suggestFunctions('VLOO')[0]?.insert).toBe('VLOOKUP')
    expect(suggestFunctions('')).toEqual([])
    expect(functionDoc('recherchev')?.syntax).toBe(
      'RECHERCHEV(valeur; table; colonne; [approchée])',
    )
    expect(functionDoc('SI')?.name).toBe('IF')
  })
})
