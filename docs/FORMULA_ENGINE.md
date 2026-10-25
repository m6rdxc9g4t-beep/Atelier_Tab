# Moteur de formules

Code : `src/engine/formula/` · Point d'entrée : `index.ts` · Tests : `__tests__/`

## Chaîne de traitement

```text
"=SUM(C1:C3)*1.2"
   │ tokenizer.ts   →  [ident SUM] [(] [ref C1] [:] [ref C3] [)] [*] [number 1.2]
   │ parser.ts      →  binary(*, call(SUM, [range C1:C3]), 1.2)
   │ evaluator.ts   →  106200
   └ workbook.ts    →  graphe de dépendances + recalcul incrémental
```

Aucun `eval()` : seuls les nœuds de l'AST et les fonctions de la liste blanche sont interprétés.

## Syntaxe

| Élément                | Exemples                                                    |
| ---------------------- | ----------------------------------------------------------- |
| Nombres                | `42`, `3.14`, `.5`, `1e3`                                   |
| Texte                  | `"Lot ""A"""` (guillemet doublé pour un guillemet littéral) |
| Booléens               | `TRUE`, `FALSE`, `VRAI`, `FAUX`                             |
| Références             | `C1`, `$C$1`, `C$1`, `$C1`                                  |
| Plages                 | `C1:C10`, `A1:D4` (coins inversés acceptés)                 |
| Séparateur d'arguments | `,` ou `;`                                                  |
| Opérateurs             | `+ - * / ^ %`, `&` (concaténation), `= <> < > <= >=`        |

Priorités, de la plus faible à la plus forte : comparaisons, `&`, `+ -`, `* /`, `^`, `%`, moins unaire, `:`.
Comme dans Excel, `-2^2` vaut **4** et `2^3^2` vaut **64**.

## Fonctions

Une centaine de fonctions, chacune acceptée sous son nom anglais **et** son nom Excel français
(`SUMIF` = `SOMME.SI`). Le catalogue (`catalog.ts`) donne la syntaxe et une description en
français de chacune : il alimente l'autocomplétion de la barre de formules, et un test vérifie
qu'il couvre toute la bibliothèque.

| Famille                | Fonctions (nom français entre parenthèses quand il diffère)                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Statistiques           | `SUM` (`SOMME`), `AVERAGE` (`MOYENNE`, `AVG`), `MIN`, `MAX`, `COUNT` (`NB`), `COUNTA` (`NBVAL`), `COUNTBLANK` (`NB.VIDE`), `MEDIAN` (`MEDIANE`), `LARGE` / `SMALL` (`GRANDE.VALEUR` / `PETITE.VALEUR`)                                                                                                                                                                                                            |
| Agrégats conditionnels | `SUMIF` / `SUMIFS` (`SOMME.SI` / `SOMME.SI.ENS`), `COUNTIF` / `COUNTIFS` (`NB.SI` / `NB.SI.ENS`), `AVERAGEIF` / `AVERAGEIFS` (`MOYENNE.SI` / `MOYENNE.SI.ENS`), `MAXIFS` / `MINIFS` (`MAX.SI.ENS` / `MIN.SI.ENS`)                                                                                                                                                                                                 |
| Mathématiques          | `ROUND` (`ARRONDI`), `ROUNDUP` / `ROUNDDOWN` (`ARRONDI.SUP` / `ARRONDI.INF`), `INT` (`ENT`), `TRUNC` (`TRONQUE`), `CEILING` / `FLOOR` (`PLAFOND` / `PLANCHER`), `ABS`, `SIGN` (`SIGNE`), `MOD`, `POWER` (`PUISSANCE`), `SQRT` (`RACINE`), `PRODUCT` (`PRODUIT`), `SUMPRODUCT` (`SOMMEPROD`), `PI`, `EXP`, `LN`, `LOG`, `LOG10`                                                                                    |
| Logique                | `IF` (`SI`), `IFS` (`SI.CONDITIONS`), `SWITCH` (`SI.MULTIPLE`), `IFERROR` (`SIERREUR`), `IFNA` (`SI.NON.DISP`), `AND` (`ET`), `OR` (`OU`), `XOR` (`OUX`), `NOT` (`NON`), `TRUE()` / `FALSE()` (`VRAI()` / `FAUX()`)                                                                                                                                                                                               |
| Texte                  | `CONCAT` (`CONCATENER`, `CONCATENATE`), `TEXTJOIN` (`JOINDRE.TEXTE`), `LEFT` / `RIGHT` / `MID` (`GAUCHE` / `DROITE` / `STXT`), `LEN` (`NBCAR`), `UPPER` / `LOWER` / `PROPER` (`MAJUSCULE` / `MINUSCULE` / `NOMPROPRE`), `TRIM` (`SUPPRESPACE`), `SUBSTITUTE` (`SUBSTITUE`), `REPLACE` (`REMPLACER`), `FIND` (`TROUVE`), `SEARCH` (`CHERCHE`), `REPT`, `EXACT`, `TEXT` (`TEXTE`), `VALUE` (`CNUM`), `CHAR` (`CAR`) |
| Dates                  | `TODAY` (`AUJOURDHUI`), `DATE`, `YEAR` / `MONTH` / `DAY` (`ANNEE` / `MOIS` / `JOUR`), `WEEKDAY` (`JOURSEM`), `ISOWEEKNUM` (`NO.SEMAINE.ISO`), `DATEDIF`, `DAYS` (`JOURS`), `EDATE` (`MOIS.DECALER`), `EOMONTH` (`FIN.MOIS`), `NETWORKDAYS` (`NB.JOURS.OUVRES`), `WORKDAY` (`SERIE.JOUR.OUVRE`)                                                                                                                    |
| Recherche              | `VLOOKUP` / `HLOOKUP` (`RECHERCHEV` / `RECHERCHEH`), `XLOOKUP` (`RECHERCHEX`), `INDEX`, `MATCH` (`EQUIV`), `CHOOSE` (`CHOISIR`)                                                                                                                                                                                                                                                                                   |
| Information            | `ISBLANK` (`ESTVIDE`), `ISNUMBER` (`ESTNUM`), `ISTEXT` (`ESTTEXTE`), `ISLOGICAL` (`ESTLOGIQUE`), `ISERROR` (`ESTERREUR`), `ISNA` (`ESTNA`), `NA`                                                                                                                                                                                                                                                                  |

Règles notables :

- `IF` et `IFERROR` sont évalués paresseusement ; `IFS`, `SWITCH` et `IFNA` ignorent l'erreur
  d'une branche qui n'est pas retenue.
- **Critères** (`SOMME.SI`, `NB.SI.ENS`…) : `5`, `">1000"`, `"<>Terminée"`, `"En*"` (jokers `*` et
  `?`, `~` pour échapper), `""` (vide), `"<>"` (non vide), `"<2026-12-31"` (date) ; texte insensible
  à la casse.
- **Recherche** : `RECHERCHEV(…; FAUX)` cherche la valeur exacte (jokers acceptés) ; sans quatrième
  argument, la valeur approchée (la plus grande inférieure ou égale, première colonne triée).
  `RECHERCHEX` : modes `0` exact, `-1` exact ou inférieur, `1` exact ou supérieur, `2` jokers ; sens
  `-1` pour chercher depuis la fin. Valeur absente : `#N/A`.
- **Dates** : une colonne Date stocke `AAAA-MM-JJ`. Les fonctions de date acceptent ce texte, une
  date `JJ/MM/AAAA` ou un numéro de série Excel, et renvoient une date `AAAA-MM-JJ`. En arithmétique,
  une date vaut son numéro de série : `=Échéance - AUJOURDHUI()` donne un nombre de jours, `=F1 + 7`
  un numéro de série affiché comme une date dans une colonne Date ou une formule au format `date`.
  `AUJOURDHUI()` est calculé à chaque recalcul de la cellule, pas à minuit.
- `TEXTE` reconnaît les formats courants : `0`, `0,00`, `# ##0,00 €`, `0 %`, `000`,
  `jj/mm/aaaa`, `jjjj j mmmm aaaa`, `mmm aa`.
- Les arguments omis (`;;`) ne sont pas encore acceptés : écrivez la valeur par défaut.

Ajouter une fonction : son implémentation dans le module de sa famille (`functions-*.ts`), son
alias français dans `ALIASES` (`functions.ts`), sa fiche dans `catalog.ts` et ses tests.

## Conversions

- Cellule vide : `0` en arithmétique, `""` en concaténation, `FALSE` en logique.
- Texte numérique (`"3"`) accepté en arithmétique ; texte non numérique → `#VALUE!`.
- Résultats arrondis à 15 chiffres significatifs (`0.1+0.2` → `0.3`).
- Comparaisons : nombres < textes < booléens ; textes insensibles à la casse.

## Erreurs

| Code      | Cause                                                         |
| --------- | ------------------------------------------------------------- |
| `#ERROR!` | Formule mal formée (message détaillé via `getParseError`)     |
| `#REF!`   | Référence supprimée ou hors grille                            |
| `#DIV/0!` | Division par zéro, moyenne vide                               |
| `#VALUE!` | Mauvais type, mauvais nombre d'arguments, plage hors fonction |
| `#NAME?`  | Fonction inconnue                                             |
| `#NUM!`   | Résultat infini, plage démesurée                              |
| `#CYCLE!` | Référence circulaire                                          |

Les erreurs se propagent, sauf dans `IFERROR`. Ce sont des instances de `FormulaError`, jamais des chaînes : une cellule contenant le texte `"#REF!"` reste du texte.

## Workbook

```ts
const wb = new Workbook()
wb.setCells([
  ['C1', 45000],
  ['C2', 28500],
  ['C3', 15000],
  ['C4', '=SUM(C1:C3)*1.2'],
])
wb.getValue('C4') // 106200
wb.setCell('C1', 50000) // → Set { 'C1', 'C4' } : cellules dont la valeur a changé
wb.preview('=C4/2', 'D1') // aperçu sans enregistrer
```

- **Recalcul incrémental** : seules la cellule modifiée et ses dépendants transitifs sont réévalués, dans l'ordre topologique.
- **Cycles** : les membres d'un cycle (composantes fortement connexes, algorithme de Tarjan) reçoivent `#CYCLE!` ; le reste de la feuille continue de se calculer.
- **Plages** : une formule qui lit `C1:C100` est recalculée quand n'importe quelle cellule de la plage change, y compris une cellule vide qui reçoit une valeur.

## Réécriture des références

- `translateFormula(f, dRow, dCol)` : recopie. Les références relatives bougent, les `$` restent. C'est aussi le mécanisme des **colonnes-formules** : le modèle `=C1*1.2` devient `=C2*1.2` en ligne 2.
- `shiftReferences(f, { axis, index, count })` : insertion (`count > 0`) ou suppression (`count < 0`) de lignes/colonnes. Références supprimées → `#REF!`, plages réduites ou agrandies.

## Limites connues

- La recherche des formules lisant une plage est linéaire en nombre de formules à plages : adapté à quelques milliers de lignes. Un index spatial pourra être ajouté si besoin.
- Pas encore de références entre tables.
- Pas de fonctions renvoyant un tableau (matrices dynamiques) : chaque formule donne une valeur.
