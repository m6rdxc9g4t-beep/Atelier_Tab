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

| Fonction           | Alias                       | Notes                                                   |
| ------------------ | --------------------------- | ------------------------------------------------------- |
| `SUM`              | `SOMME`                     | Ignore texte, booléens et vides dans les plages         |
| `AVERAGE`          | `AVG`, `MOYENNE`            | `#DIV/0!` si aucun nombre                               |
| `MIN`, `MAX`       |                             | 0 si aucun nombre                                       |
| `COUNT`            | `NB`                        | Compte les nombres                                      |
| `COUNTA`           | `NBVAL`                     | Compte les cellules non vides                           |
| `IF`               | `SI`                        | Évaluation paresseuse ; `FALSE` si pas de branche sinon |
| `IFERROR`          | `SIERREUR`                  | Évaluation paresseuse                                   |
| `AND`, `OR`, `NOT` | `ET`, `OU`, `NON`           |                                                         |
| `ROUND`            | `ARRONDI`                   | Au plus loin de zéro, chiffres négatifs acceptés        |
| `ABS`              |                             |                                                         |
| `CONCAT`           | `CONCATENATE`, `CONCATENER` |                                                         |

Ajouter une fonction : une entrée dans `BASE` (`functions.ts`) + ses tests.

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
- Pas encore de références entre tables ni de fonctions de date.
