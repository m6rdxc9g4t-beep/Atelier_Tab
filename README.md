# Atelier_Tab

**Tableur et base de données dans un même espace de travail, avec un export natif vers `atelier_projets`.**

Atelier_Tab réunit la liberté de calcul d'Excel (formules, références `A1:C10`, recalcul instantané) et la rigueur d'Airtable (colonnes typées, statuts colorés, vues Kanban, fiches par ligne). Les données restent sur votre ordinateur, dans des fichiers lisibles que Claude Code et un modèle local Ollama peuvent manipuler ; le module **DataFlow** les transforme au format attendu par l'application de gestion de projet `atelier_projets`.

> Statut : en développement actif. Voir la [feuille de route](#feuille-de-route).

---

## Fonctionnalités

| Domaine                | Ce que ça fait                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Moteur de formules** | `SUM`, `AVG`/`AVERAGE`, `MIN`, `MAX`, `IF`, `COUNT`, `ROUND`, `ABS`, opérateurs `+ - * / ^ &`, comparaisons, références et plages. Recalcul incrémental, détection des cycles, erreurs Excel (`#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#CYCLE!`). Aucun `eval()`. |
| **Colonnes typées**    | Texte, nombre, devise, pourcentage, statut (badge), date, case à cocher, responsable, formule.                                                                                                                                                                     |
| **Vues**               | Grille hybride, tableur pur, Kanban groupé par statut, fiche détaillée.                                                                                                                                                                                            |
| **Navigation**         | Espaces de travail › Projets › Tables, recherche rapide `Ctrl/Cmd + K`.                                                                                                                                                                                            |
| **DataFlow**           | Export JSON normalisé (schéma `atelier_projets` v2.1.0), CSV enrichi, webhook. Validation avant envoi.                                                                                                                                                             |
| **Persistance**        | App de bureau : fichiers JSON dans `~/Atelier_Tab`, synchronisés en direct. Navigateur : IndexedDB.                                                                                                                                                                |
| **IA**                 | Serveur MCP pour Claude Code et assistant intégré branché sur Ollama : mêmes 14 outils, mêmes règles que la grille.                                                                                                                                                |

## Démarrage

Prérequis : **Node.js ≥ 20.19** (ou ≥ 22.12) et npm.

```bash
git clone https://github.com/m6rdxc9g4t-beep/atelier-tab.git
cd atelier-tab
npm install
npm run dev          # http://localhost:5173
```

### Application macOS

Atelier_Tab existe aussi en application de bureau, à ouvrir d'un double-clic.

```bash
npm install
npm run app:install
```

La commande construit `Atelier_Tab.app` puis la copie dans **Applications**. Elle est ensuite accessible depuis le Launchpad, Spotlight (⌘ Espace) ou le Dock. Relancer `npm run app:install` après un `git pull` met l'application à jour.

- Les données sont dans le dossier **`~/Atelier_Tab`** (menu Fichier › Ouvrir le dossier des données) : un fichier `atelier.json` et un fichier par table dans `tables/`. Au premier lancement, les données d'une version précédente sont reprises automatiquement.
- L'app est signée localement (« ad hoc »), sans compte développeur Apple. Elle s'ouvre normalement sur le Mac qui l'a construite ; pour la donner à quelqu'un d'autre, une signature Apple sera nécessaire.
- `npm run app` lance l'application sans l'installer, pour essayer une modification.

### Claude Code et Ollama

Claude Code et un modèle local peuvent lire et modifier toutes les données : tables, lignes, colonnes, formules, export.

**Claude Code** — `npm run app:install` le connecte automatiquement s'il est installé (sinon `npm run ai:connect`, ou menu Fichier › Connecter Claude Code…). Le serveur MCP `atelier-tab` est livré dans l'app ; dans n'importe quelle session :

> « Ajoute une ligne Menuiseries à 12 000 € HT dans Planning & Lots »
> « Quel est le total TTC du budget ? »
> « Exporte Planning & Lots en JSON pour atelier_projets »

Si l'app est ouverte, elle se met à jour en direct. Le dossier `~/Atelier_Tab` contient aussi un `CLAUDE.md` qui décrit le format des fichiers.

**Ollama** — bouton **Assistant** (⌘J) dans l'app. Il faut un modèle qui sait appeler des outils :

```bash
ollama pull qwen3:8b
```

L'assistant voit la table ouverte et la cellule sélectionnée, et chaque action apparaît dans le panneau. Le modèle tourne sur votre Mac : rien ne sort de l'ordinateur.

| Outil                                          | Rôle                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| `list_tables`, `read_table`                    | Lire espaces, projets, tables, valeurs calculées       |
| `set_cells`, `add_rows`, `delete_rows`         | Modifier les lignes (saisie à la française, formules)  |
| `add_column`, `update_column`, `delete_column` | Modifier les colonnes, y compris les colonnes-formules |
| `create_project`, `create_table`, `rename`     | Organiser                                              |
| `evaluate`                                     | Calculer une formule sans rien modifier                |
| `check_export`, `export_table`                 | Exporter vers `atelier_projets` (JSON, CSV, webhook)   |

### Scripts

| Commande             | Rôle                                                         |
| -------------------- | ------------------------------------------------------------ |
| `npm run dev`        | Serveur de développement Vite                                |
| `npm run build`      | Vérification des types puis build de production dans `dist/` |
| `npm run preview`    | Sert le build de production                                  |
| `npm test`           | Tests unitaires (Vitest)                                     |
| `npm run test:watch` | Tests en mode surveillance                                   |
| `npm run lint`       | ESLint                                                       |
| `npm run typecheck`  | TypeScript strict, sans émission                             |
| `npm run format`     | Prettier                                                     |
| `npm run ai:connect` | Enregistre le serveur MCP dans Claude Code                   |
| `npm run mcp`        | Lance le serveur MCP depuis le dépôt (développement)         |

## Architecture

```text
desktop/              App de bureau : processus principal, fichiers, serveur MCP
scripts/              Construction et installation de l'app macOS
build/                Icône de l'application
src/
├── app/              Point d'entrée React, coquille de l'application
├── types/            Modèle de domaine (Workspace, Project, Table, Field, Record)
├── engine/           ⚙️ Logique pure, sans React
│   ├── formula/      Tokenizer → parser (AST) → évaluateur, graphe de dépendances
│   └── field-types/  Conversion et formatage par type de colonne
├── store/            État global Zustand
├── storage/          Format des fichiers de données (lecture tolérante, validation)
├── ai/               Outils partagés par Claude Code (MCP) et Ollama, boucle de l'assistant
├── services/         Persistance (fichiers, IndexedDB, REST), pont vers l'app de bureau
├── dataflow/         Export vers atelier_projets (schéma, mapping, transports)
├── components/       Interface : layout, sidebar, grid, cells, formula-bar, kanban…
├── hooks/            Hooks React transverses
└── lib/              Utilitaires
```

Principe directeur : **`engine/` et `dataflow/` sont du TypeScript pur, testés sans navigateur.** React affiche l'état et déclenche des actions ; il ne calcule rien lui-même.

Détails : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Moteur : [`docs/FORMULA_ENGINE.md`](docs/FORMULA_ENGINE.md) · Export : [`docs/DATAFLOW_SPEC.md`](docs/DATAFLOW_SPEC.md)

### Stack

React 19 · TypeScript (strict) · Vite · Electron (app macOS) · Tailwind CSS v4 · Zustand · Zod · Lucide · TanStack Virtual · dnd-kit · cmdk · Vitest · Playwright

## Feuille de route

- [x] **Phase 0** — Socle : Tailwind v4, thème clair/sombre, CI
- [x] **Phase 1** — Modèle de domaine, store, persistance IndexedDB
- [x] **Phase 2** — Moteur de formules
- [x] **Phase 3** — Grille hybride et barre de formules
- [ ] **Phase 4** — Sidebar et navigation clavier
- [x] **Phase 5** — DataFlow → `atelier_projets`
- [x] **IA** — Données en fichiers, serveur MCP (Claude Code), assistant Ollama
- [ ] **Phase 6** — Kanban, fiche détaillée, filtres
- [ ] **Phase 7** — Undo/redo, copier-coller, accessibilité, tests e2e

## Contribuer

- Une branche par sujet (`feat/…`, `fix/…`, `chore/…`), PR vers `main`.
- Messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/fr/) : `feat(engine): …`.
- La CI (lint, types, tests, build) doit être verte avant fusion.
