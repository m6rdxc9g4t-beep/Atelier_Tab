# Architecture

## Vue d'ensemble

```text
 Saisie utilisateur
        │
        ▼
┌──────────────┐  action   ┌──────────────────────┐  setRaw()   ┌─────────────────────┐
│  Composants  │ ────────▶ │  Store Zustand       │ ──────────▶ │  engine/formula     │
│  (React)     │           │  (valeurs brutes)    │             │  Workbook :         │
│              │ ◀──────── │                      │ ◀────────── │  graphe + cache     │
└──────────────┘ sélecteur └──────────┬───────────┘  valeurs    └─────────────────────┘
                                      │               calculées
                          persist     │      export
                    ┌─────────────────┴──┐   ┌────────────────────────┐
                    ▼                    │   ▼                        │
          services/persistence           │  dataflow/                 │
          (IndexedDB, REST…)             │  mapper → zod → transport  │
                                         │  (JSON, CSV, webhook)      │
```

## Modèle de données

- **Workspace** › **Project** › **Table**.
- Une table possède des `fields` (colonnes typées) et des `records` (lignes), indexés par identifiant stable. L'ordre d'affichage vit dans `fieldOrder` et `rowOrder`.
- Une cellule stocke sa **valeur brute** (ce que l'utilisateur a saisi : `"45000"`, `"=C1*1.2"`, `true`). La **valeur calculée** est dérivée par le moteur et n'est jamais persistée.
- Un champ de type `formula` porte une `columnFormula` qui s'applique à chaque ligne (style Airtable). Une cellule peut aussi contenir sa propre formule (style Excel).

## Moteur de formules

Le `Workbook` (`src/engine/formula/workbook.ts`) est la seule source des valeurs calculées :

1. `setCell(addr, raw)` parse la formule une fois et met à jour le graphe de dépendances.
2. Seules les cellules en aval sont recalculées, dans l'ordre topologique.
3. Un cycle produit `#CYCLE!` sur toutes les cellules concernées, sans bloquer l'application.

Voir [`FORMULA_ENGINE.md`](FORMULA_ENGINE.md).

## Du domaine au moteur

`engine/table/TableSheet` relie une table (identifiants stables) au `Workbook` (adresses A1) :

- la valeur stockée d'une cellule est convertie en entrée moteur (`toEngineInput`) : l'id d'un statut devient son libellé, l'id d'un collaborateur son nom ;
- une colonne-formule (`columnFormula`, écrite pour la ligne 1) est recopiée sur chaque ligne de données ; une valeur saisie dans la cellule la remplace ;
- `sync(table)` compare l'instantané reçu au précédent : changement de structure (ordre des lignes/colonnes, définition des champs) → reconstruction complète ; sinon seules les lignes dont la référence a changé sont repoussées au moteur.

`store/computed.store.ts` s'abonne au store de données et publie les valeurs calculées par clé `recordId:fieldId`. Seules les entrées dont la valeur a changé sont remplacées, donc `useCellValue()` ne re-rend que les cellules concernées.

Les opérations structurelles (`engine/table/table-ops.ts`) réécrivent les formules comme Excel. Une ligne ajoutée juste au-dessus d'une ligne de synthèse est incluse dans ses plages (`SUM(C1:C3)` → `SUM(C1:C4)`). Limite actuelle : les modèles de colonnes-formules ne suivent que les changements de colonnes (une référence absolue de ligne dans un modèle, ex. `$F$1`, n'est pas décalée par une insertion de ligne).

## Persistance

`StorageAdapter` définit `load()` / `save()` pour l'état complet. IndexedDB (via `idb-keyval`) est l'adaptateur par défaut ; un adaptateur REST/Supabase pourra le remplacer sans toucher au store.

## Décisions

Les choix structurants sont consignés dans [`adr/`](adr/).
