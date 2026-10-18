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

## Persistance

`StorageAdapter` définit `load()` / `save()` pour l'état complet. IndexedDB (via `idb-keyval`) est l'adaptateur par défaut ; un adaptateur REST/Supabase pourra le remplacer sans toucher au store.

## Décisions

Les choix structurants sont consignés dans [`adr/`](adr/).
