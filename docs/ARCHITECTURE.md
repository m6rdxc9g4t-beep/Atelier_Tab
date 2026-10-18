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

`StorageAdapter` (getItem / setItem) est branché sur le middleware `persist` de Zustand.

- **App de bureau** : `desktopAdapter` envoie l'état au processus principal, qui l'écrit dans `~/Atelier_Tab` via `desktop/file-store.ts` (un fichier par table, écritures atomiques, seuls les fichiers modifiés). Le dossier est surveillé : une modification faite par Claude Code ou un éditeur est relue et poussée à l'interface (`data:external`). Un fichier invalide est signalé et n'est pas écrasé tant que l'app ne modifie pas cette table.
- **Navigateur** : IndexedDB (`idb-keyval`).
- Le format des fichiers est défini et validé dans `src/storage/format.ts` (pur, testé). Le jeton du webhook est rangé à part, hors du dossier partagé.

## IA

`src/ai/tools.ts` définit 14 outils (schémas Zod convertis en JSON Schema) qui agissent sur un `DataStore` à travers ses actions : mêmes conversions de saisie, mêmes réécritures de formules, même moteur que l'interface.

```text
Claude Code ──stdio──▶ atelier-mcp (desktop/mcp-server.ts)
                        └─ relit ~/Atelier_Tab ─▶ store + moteur en mémoire ─▶ outils ─▶ écrit les fichiers modifiés
                                                                                         │
App (ouverte) ◀──────── surveillance du dossier ◀────────────────────────────────────────┘

Ollama ◀──/api/chat── processus principal ◀──IPC── panneau Assistant
                                                    └─ boucle d'outils (src/ai/agent.ts) sur le store de l'app
```

Le serveur MCP est livré dans l'app (`Contents/Resources/atelier-mcp`) et s'exécute avec le Node.js d'Electron (`ELECTRON_RUN_AS_NODE`) : rien à installer. Voir [ADR 0003](adr/0003-acces-ia.md).

## Décisions

Les choix structurants sont consignés dans [`adr/`](adr/).
