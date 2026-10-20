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
- **Instantanés pour Atelier Viz** : après chaque enregistrement, le processus principal recalcule les tables modifiées avec le moteur (`src/dataflow/snapshot.ts`, pur) et écrit `exports/<tableId>.json` (`desktop/snapshots.ts`). Voir [`DATAFLOW_SPEC.md`](DATAFLOW_SPEC.md#instantanés-pour-atelier-viz).
- **Navigateur** : IndexedDB (`idb-keyval`).
- Le format des fichiers est défini et validé dans `src/storage/format.ts` (pur, testé). Le jeton du webhook est rangé à part, hors du dossier partagé.

## IA

`src/ai/tools.ts` définit 16 outils (schémas Zod convertis en JSON Schema) qui agissent sur un `DataStore` à travers ses actions : mêmes conversions de saisie, mêmes réécritures de formules, même moteur que l'interface.

```text
Claude Code ──stdio──▶ atelier-mcp (desktop/mcp-server.ts)
                        └─ relit ~/Atelier_Tab ─▶ store + moteur en mémoire ─▶ outils ─▶ écrit les fichiers modifiés
                                                                                         │
App (ouverte) ◀──────── surveillance du dossier ◀────────────────────────────────────────┘

Ollama ◀──/api/chat──────────── processus principal ◀──IPC ollama:*── ┐
claude -p (CLI isolée) ◀─stdin── processus principal ◀──IPC claude:*── panneau Assistant
                                  (desktop/claude-cli.ts)               └─ runAgent (src/ai/agent.ts) :
                                                                           outils exécutés sur le store de l'app
```

Moteurs de l'assistant (docs/SUITE.md §5) :

- `src/ai/provider.ts` : interface `ChatProvider` (un tour = `step`), fournisseur Ollama ; `runAgent` ne connaît que cette interface et l'historique commun (format Ollama), donc on peut changer de moteur en cours de conversation.
- `src/ai/claude.ts` : fournisseur Claude. La CLI n'a **aucun outil** (`--tools ""`) : Claude répond par un objet JSON contraint par `--json-schema` (`{"action":"tool","name","arguments"}` ou `{"action":"answer","text"}`), l'app exécute l'outil par `runTool` (les mêmes définitions que MCP et Ollama) et renvoie le résultat au tour suivant ; 8 tours au plus.
- `src/ai/engine.ts` : choix Auto · Ollama · Claude (Claude seulement dans l'app de bureau et en ligne), ligne bouclier. `src/store/ai-status.store.ts` : état des deux moteurs (pastilles de l'en-tête, panneau).
- `desktop/claude-cli.ts` (processus principal) : recherche de l'exécutable (`CLAUDE_CLI`, `PATH`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`), `claude auth status` + `--version` en cache 60 s, validation de la requête (conversation, prompt système, schéma, alias `sonnet|opus|haiku` ; rien d'autre), ligne de commande construite ici seulement, `spawn` sans shell, dossier temporaire vide, `ANTHROPIC_API_KEY` retirée, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, délai de 180 s, annulation. Exécutant injectable : testé avec un exécutant simulé et une fausse CLI (`desktop/__tests__/fixtures/fake-claude.mjs`).
- Mode « En ligne » : `preferences.onlineMode` dans `atelier.json` (`src/storage/format.ts`, lecture tolérante : absent ou abîmé → hors ligne). Le processus principal le relit sur disque à chaque appel (`readOnlineMode`) ; hors ligne, `claude:chat` est refusé et rien n'est lancé. Le serveur MCP le lit avec l'outil `get_settings` ; aucun outil ne peut le changer (choix de l'utilisateur, interrupteur de l'en-tête).

Le serveur MCP est livré dans l'app (`Contents/Resources/atelier-mcp`) et s'exécute avec le Node.js d'Electron (`ELECTRON_RUN_AS_NODE`) : rien à installer. Voir [ADR 0003](adr/0003-acces-ia.md).

## Suite Atelier

Contrat commun : [`SUITE.md`](SUITE.md). Côté Tab :

- thème : `src/styles/atelier-ds/` (copie verbatim) → jetons dérivés dans `src/index.css` ; `useTheme` pose `class="dark"` et `data-theme` ;
- sélecteur d'apps : `src/lib/suite.ts` + `components/layout/SuiteSwitcher.tsx` ; dans l'app de bureau, ouverture par `shell.openExternal` via l'IPC `suite:open` (http(s) vers 127.0.0.1 / localhost uniquement) ;
- envoi à Atelier Projets local depuis l'app de bureau : IPC `suite:post`, requête relayée sans en-tête `Origin` (Projets refuse l'origine `null` et `app://atelier`) ; voir `DATAFLOW_SPEC.md` ;
- route de santé : `desktop/health-server.ts`, `127.0.0.1:4175` uniquement, `GET /api/health` et `GET /` (ramène la fenêtre si c'est une navigation de premier niveau), tout le reste 404, en-tête `Host` vérifié ; port pris → journalisé. Même `/api/health` en dev et en aperçu par le greffon Vite `healthPlugin`. L'adresse de Tab lui-même (4175) ouverte depuis Tab ramène sa fenêtre (`suite-launch.ts`, option `self`) : ni `open -b`, ni navigateur ;
- IPC : chaque canal du processus principal n'accepte que les messages de l'interface (`event.senderFrame.url` sous `app://atelier/`, `desktop/ipc-guard.ts`) ; `data:save` revalide l'état reçu (`parseAppState` de `src/storage/format.ts`) et toute écriture disque est confinée à son dossier (`desktop/safe-path.ts`).

## Décisions

Les choix structurants sont consignés dans [`adr/`](adr/).
