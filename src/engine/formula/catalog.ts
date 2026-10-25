/**
 * Catalogue des fonctions pour l'interface : syntaxe et description en français, utilisés par
 * l'autocomplétion de la barre de formules et la documentation. Chaque fonction de la
 * bibliothèque y figure (vérifié par un test).
 *
 * `name` est le nom de référence (anglais, comme dans le code), `fr` le nom d'Excel en français.
 * Les deux sont acceptés dans une formule.
 */
import { ALIASES, LAZY_FUNCTIONS, resolveFunction } from './functions'

export type FunctionCategory = 'math' | 'stats' | 'logic' | 'text' | 'date' | 'lookup' | 'info'

export interface FunctionDoc {
  name: string
  fr?: string
  syntax: string
  description: string
  category: FunctionCategory
}

export const CATEGORY_LABELS: Record<FunctionCategory, string> = {
  math: 'Mathématiques',
  stats: 'Statistiques',
  logic: 'Logique',
  text: 'Texte',
  date: 'Dates',
  lookup: 'Recherche',
  info: 'Information',
}

const doc = (
  name: string,
  fr: string | undefined,
  category: FunctionCategory,
  args: string,
  description: string,
): FunctionDoc => ({
  name,
  ...(fr ? { fr } : {}),
  syntax: `${fr ?? name}(${args})`,
  description,
  category,
})

export const FUNCTION_CATALOG: readonly FunctionDoc[] = [
  // Statistiques
  doc('SUM', 'SOMME', 'stats', 'nombre1; [nombre2]; …', 'Additionne des nombres ou des plages.'),
  doc('AVERAGE', 'MOYENNE', 'stats', 'nombre1; [nombre2]; …', 'Moyenne des nombres.'),
  doc('MIN', undefined, 'stats', 'nombre1; [nombre2]; …', 'Plus petite valeur.'),
  doc('MAX', undefined, 'stats', 'nombre1; [nombre2]; …', 'Plus grande valeur.'),
  doc(
    'COUNT',
    'NB',
    'stats',
    'valeur1; [valeur2]; …',
    'Compte les cellules qui contiennent un nombre.',
  ),
  doc('COUNTA', 'NBVAL', 'stats', 'valeur1; [valeur2]; …', 'Compte les cellules non vides.'),
  doc('COUNTBLANK', 'NB.VIDE', 'stats', 'plage', 'Compte les cellules vides.'),
  doc('MEDIAN', 'MEDIANE', 'stats', 'nombre1; [nombre2]; …', 'Valeur médiane.'),
  doc('LARGE', 'GRANDE.VALEUR', 'stats', 'plage; k', 'k-ième plus grande valeur.'),
  doc('SMALL', 'PETITE.VALEUR', 'stats', 'plage; k', 'k-ième plus petite valeur.'),
  doc(
    'SUMIF',
    'SOMME.SI',
    'stats',
    'plage; critère; [plage_somme]',
    'Somme des cellules qui remplissent un critère, ex. ">1000" ou "En cours".',
  ),
  doc(
    'SUMIFS',
    'SOMME.SI.ENS',
    'stats',
    'plage_somme; plage1; critère1; …',
    'Somme avec plusieurs critères.',
  ),
  doc(
    'COUNTIF',
    'NB.SI',
    'stats',
    'plage; critère',
    'Compte les cellules qui remplissent un critère.',
  ),
  doc('COUNTIFS', 'NB.SI.ENS', 'stats', 'plage1; critère1; …', 'Compte avec plusieurs critères.'),
  doc(
    'AVERAGEIF',
    'MOYENNE.SI',
    'stats',
    'plage; critère; [plage_moyenne]',
    'Moyenne des cellules qui remplissent un critère.',
  ),
  doc(
    'AVERAGEIFS',
    'MOYENNE.SI.ENS',
    'stats',
    'plage_moyenne; plage1; critère1; …',
    'Moyenne avec plusieurs critères.',
  ),
  doc('MAXIFS', 'MAX.SI.ENS', 'stats', 'plage_max; plage1; critère1; …', 'Maximum avec critères.'),
  doc('MINIFS', 'MIN.SI.ENS', 'stats', 'plage_min; plage1; critère1; …', 'Minimum avec critères.'),
  // Mathématiques
  doc('ROUND', 'ARRONDI', 'math', 'nombre; [chiffres]', 'Arrondit au nombre de chiffres indiqué.'),
  doc('ROUNDUP', 'ARRONDI.SUP', 'math', 'nombre; [chiffres]', 'Arrondit en s’éloignant de zéro.'),
  doc('ROUNDDOWN', 'ARRONDI.INF', 'math', 'nombre; [chiffres]', 'Arrondit vers zéro.'),
  doc('INT', 'ENT', 'math', 'nombre', 'Partie entière (arrondi vers le bas).'),
  doc('TRUNC', 'TRONQUE', 'math', 'nombre; [chiffres]', 'Tronque les décimales.'),
  doc('CEILING', 'PLAFOND', 'math', 'nombre; [multiple]', 'Arrondit au multiple supérieur.'),
  doc('FLOOR', 'PLANCHER', 'math', 'nombre; [multiple]', 'Arrondit au multiple inférieur.'),
  doc('ABS', undefined, 'math', 'nombre', 'Valeur absolue.'),
  doc('SIGN', 'SIGNE', 'math', 'nombre', 'Signe : 1, 0 ou -1.'),
  doc('MOD', undefined, 'math', 'nombre; diviseur', 'Reste de la division.'),
  doc('POWER', 'PUISSANCE', 'math', 'nombre; puissance', 'Élève un nombre à une puissance.'),
  doc('SQRT', 'RACINE', 'math', 'nombre', 'Racine carrée.'),
  doc('PRODUCT', 'PRODUIT', 'math', 'nombre1; [nombre2]; …', 'Multiplie des nombres.'),
  doc(
    'SUMPRODUCT',
    'SOMMEPROD',
    'math',
    'plage1; [plage2]; …',
    'Somme des produits terme à terme (quantité × prix).',
  ),
  doc('PI', undefined, 'math', '', 'Le nombre π.'),
  doc('EXP', undefined, 'math', 'nombre', 'Exponentielle.'),
  doc('LN', undefined, 'math', 'nombre', 'Logarithme népérien.'),
  doc('LOG', undefined, 'math', 'nombre; [base]', 'Logarithme (base 10 par défaut).'),
  doc('LOG10', undefined, 'math', 'nombre', 'Logarithme en base 10.'),
  // Logique
  doc(
    'IF',
    'SI',
    'logic',
    'condition; si_vrai; [si_faux]',
    'Renvoie une valeur selon une condition.',
  ),
  doc(
    'IFS',
    'SI.CONDITIONS',
    'logic',
    'condition1; valeur1; …',
    'Première valeur dont la condition est vraie.',
  ),
  doc(
    'SWITCH',
    'SI.MULTIPLE',
    'logic',
    'expression; valeur1; résultat1; …; [défaut]',
    'Résultat associé à la valeur de l’expression.',
  ),
  doc(
    'IFERROR',
    'SIERREUR',
    'logic',
    'valeur; si_erreur',
    'Valeur de remplacement en cas d’erreur.',
  ),
  doc('IFNA', 'SI.NON.DISP', 'logic', 'valeur; si_na', 'Valeur de remplacement si #N/A.'),
  doc(
    'AND',
    'ET',
    'logic',
    'logique1; [logique2]; …',
    'VRAI si toutes les conditions sont vraies.',
  ),
  doc('OR', 'OU', 'logic', 'logique1; [logique2]; …', 'VRAI si une condition est vraie.'),
  doc(
    'XOR',
    'OUX',
    'logic',
    'logique1; [logique2]; …',
    'VRAI si un nombre impair de conditions sont vraies.',
  ),
  doc('NOT', 'NON', 'logic', 'logique', 'Inverse une valeur logique.'),
  doc('TRUE', 'VRAI', 'logic', '', 'La valeur VRAI.'),
  doc('FALSE', 'FAUX', 'logic', '', 'La valeur FAUX.'),
  // Texte
  doc('CONCAT', 'CONCATENER', 'text', 'texte1; [texte2]; …', 'Assemble des textes (aussi avec &).'),
  doc(
    'TEXTJOIN',
    'JOINDRE.TEXTE',
    'text',
    'séparateur; ignorer_vides; texte1; …',
    'Assemble des textes avec un séparateur.',
  ),
  doc('LEFT', 'GAUCHE', 'text', 'texte; [nb_car]', 'Premiers caractères.'),
  doc('RIGHT', 'DROITE', 'text', 'texte; [nb_car]', 'Derniers caractères.'),
  doc('MID', 'STXT', 'text', 'texte; début; nb_car', 'Caractères à partir d’une position.'),
  doc('LEN', 'NBCAR', 'text', 'texte', 'Nombre de caractères.'),
  doc('UPPER', 'MAJUSCULE', 'text', 'texte', 'Met en majuscules.'),
  doc('LOWER', 'MINUSCULE', 'text', 'texte', 'Met en minuscules.'),
  doc('PROPER', 'NOMPROPRE', 'text', 'texte', 'Majuscule au début de chaque mot.'),
  doc('TRIM', 'SUPPRESPACE', 'text', 'texte', 'Supprime les espaces en trop.'),
  doc(
    'SUBSTITUTE',
    'SUBSTITUE',
    'text',
    'texte; ancien; nouveau; [occurrence]',
    'Remplace un texte par un autre.',
  ),
  doc(
    'REPLACE',
    'REMPLACER',
    'text',
    'texte; début; nb_car; nouveau',
    'Remplace des caractères à une position.',
  ),
  doc(
    'FIND',
    'TROUVE',
    'text',
    'cherché; texte; [début]',
    'Position d’un texte (sensible à la casse).',
  ),
  doc(
    'SEARCH',
    'CHERCHE',
    'text',
    'cherché; texte; [début]',
    'Position d’un texte (jokers * et ?).',
  ),
  doc('REPT', undefined, 'text', 'texte; fois', 'Répète un texte.'),
  doc(
    'EXACT',
    undefined,
    'text',
    'texte1; texte2',
    'VRAI si les textes sont identiques (casse comprise).',
  ),
  doc(
    'TEXT',
    'TEXTE',
    'text',
    'valeur; format',
    'Met en forme un nombre ou une date, ex. "0,00 €" ou "jj/mm/aaaa".',
  ),
  doc('VALUE', 'CNUM', 'text', 'texte', 'Convertit un texte en nombre (« 1 234,5 »).'),
  doc('CHAR', 'CAR', 'text', 'code', 'Caractère d’un code Unicode.'),
  // Dates
  doc('TODAY', 'AUJOURDHUI', 'date', '', 'Date du jour.'),
  doc('DATE', undefined, 'date', 'année; mois; jour', 'Construit une date.'),
  doc('YEAR', 'ANNEE', 'date', 'date', 'Année d’une date.'),
  doc('MONTH', 'MOIS', 'date', 'date', 'Mois (1 à 12).'),
  doc('DAY', 'JOUR', 'date', 'date', 'Jour du mois.'),
  doc('WEEKDAY', 'JOURSEM', 'date', 'date; [type]', 'Jour de la semaine (type 2 : lundi = 1).'),
  doc('ISOWEEKNUM', 'NO.SEMAINE.ISO', 'date', 'date', 'Numéro de semaine ISO.'),
  doc(
    'DATEDIF',
    undefined,
    'date',
    'début; fin; unité',
    'Écart entre deux dates : "Y", "M", "D", "YM", "MD" ou "YD".',
  ),
  doc('DAYS', 'JOURS', 'date', 'fin; début', 'Nombre de jours entre deux dates.'),
  doc('EDATE', 'MOIS.DECALER', 'date', 'date; mois', 'Date décalée de quelques mois.'),
  doc(
    'EOMONTH',
    'FIN.MOIS',
    'date',
    'date; mois',
    'Dernier jour du mois, décalé de quelques mois.',
  ),
  doc(
    'NETWORKDAYS',
    'NB.JOURS.OUVRES',
    'date',
    'début; fin; [fériés]',
    'Jours ouvrés entre deux dates.',
  ),
  doc(
    'WORKDAY',
    'SERIE.JOUR.OUVRE',
    'date',
    'début; jours; [fériés]',
    'Date après un nombre de jours ouvrés.',
  ),
  // Recherche
  doc(
    'VLOOKUP',
    'RECHERCHEV',
    'lookup',
    'valeur; table; colonne; [approchée]',
    'Cherche dans la première colonne et renvoie une valeur de la même ligne (FAUX : valeur exacte).',
  ),
  doc(
    'HLOOKUP',
    'RECHERCHEH',
    'lookup',
    'valeur; table; ligne; [approchée]',
    'Cherche dans la première ligne et renvoie une valeur de la même colonne.',
  ),
  doc(
    'XLOOKUP',
    'RECHERCHEX',
    'lookup',
    'valeur; plage_recherche; plage_résultat; [si_absent]; [mode]; [sens]',
    'Cherche une valeur et renvoie celle de la même position.',
  ),
  doc(
    'INDEX',
    undefined,
    'lookup',
    'plage; ligne; [colonne]',
    'Valeur à une position de la plage.',
  ),
  doc('MATCH', 'EQUIV', 'lookup', 'valeur; plage; [type]', 'Position d’une valeur (0 : exacte).'),
  doc(
    'CHOOSE',
    'CHOISIR',
    'lookup',
    'index; valeur1; [valeur2]; …',
    'Valeur choisie par son numéro.',
  ),
  // Information
  doc('ISBLANK', 'ESTVIDE', 'info', 'valeur', 'VRAI si la cellule est vide.'),
  doc('ISNUMBER', 'ESTNUM', 'info', 'valeur', 'VRAI si la valeur est un nombre.'),
  doc('ISTEXT', 'ESTTEXTE', 'info', 'valeur', 'VRAI si la valeur est un texte.'),
  doc('ISLOGICAL', 'ESTLOGIQUE', 'info', 'valeur', 'VRAI si la valeur est VRAI ou FAUX.'),
  doc('ISERROR', 'ESTERREUR', 'info', 'valeur', 'VRAI si la valeur est une erreur.'),
  doc('ISNA', 'ESTNA', 'info', 'valeur', 'VRAI si la valeur est #N/A.'),
  doc('NA', undefined, 'info', '', 'Renvoie l’erreur #N/A.'),
]

/** Nom canonique (anglais) d'un nom saisi, ou null s'il est inconnu. */
export function canonicalName(name: string): string | null {
  const upper = name.toUpperCase()
  const canonical = ALIASES[upper] ?? LAZY_FUNCTIONS[upper] ?? upper
  return resolveFunction(canonical) || canonical in LAZY_FUNCTIONS ? canonical : null
}

const BY_NAME = new Map(FUNCTION_CATALOG.map((d) => [d.name, d]))

/** Fiche d'une fonction à partir de n'importe lequel de ses noms. */
export function functionDoc(name: string): FunctionDoc | undefined {
  const canonical = canonicalName(name)
  return canonical ? BY_NAME.get(canonical) : undefined
}

export interface FunctionSuggestion {
  /** Nom à insérer (celui que l'utilisateur a commencé à taper : français ou anglais). */
  insert: string
  doc: FunctionDoc
}

/**
 * Fonctions dont un nom commence par `prefix` (insensible à la casse), noms français d'abord
 * quand ils correspondent. `prefix` vide : rien.
 */
export function suggestFunctions(prefix: string, limit = 8): FunctionSuggestion[] {
  const p = prefix.toUpperCase()
  if (!p) return []
  const out: FunctionSuggestion[] = []
  for (const d of FUNCTION_CATALOG) {
    if (d.fr?.startsWith(p)) out.push({ insert: d.fr, doc: d })
    else if (d.name.startsWith(p)) out.push({ insert: d.name, doc: d })
  }
  out.sort((a, b) => a.insert.length - b.insert.length || a.insert.localeCompare(b.insert))
  return out.slice(0, limit)
}
