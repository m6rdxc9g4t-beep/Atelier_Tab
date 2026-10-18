# Atelier_Tab

**Tableur et base de données dans un même espace de travail, avec un export natif vers `atelier_projets`.**

Atelier_Tab réunit la liberté de calcul d'Excel (formules, références `A1:C10`, recalcul instantané) et la rigueur d'Airtable (colonnes typées, statuts colorés, vues Kanban, fiches par ligne). Les données restent en local dans le navigateur ; le module **DataFlow** les transforme au format attendu par l'application de gestion de projet `atelier_projets`.

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
| **Persistance**        | IndexedDB par défaut, couche d'adaptateurs prête pour une API REST ou Supabase.                                                                                                                                                                                    |

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

- Les données sont enregistrées dans `~/Library/Application Support/Atelier_Tab`. Elles sont conservées lors des mises à jour et sont distinctes de celles de la version navigateur.
- L'app est signée localement (« ad hoc »), sans compte développeur Apple. Elle s'ouvre normalement sur le Mac qui l'a construite ; pour la donner à quelqu'un d'autre, une signature Apple sera nécessaire.
- `npm run app` lance l'application sans l'installer, pour essayer une modification.

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

## Architecture

```text
electron/             Processus principal de l'app de bureau
scripts/              Construction et installation de l'app macOS
build/                Icône de l'application
src/
├── app/              Point d'entrée React, coquille de l'application
├── types/            Modèle de domaine (Workspace, Project, Table, Field, Record)
├── engine/           ⚙️ Logique pure, sans React
│   ├── formula/      Tokenizer → parser (AST) → évaluateur, graphe de dépendances
│   └── field-types/  Conversion et formatage par type de colonne
├── store/            État global Zustand
├── services/         Persistance (IndexedDB, localStorage, REST)
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
- [ ] **Phase 6** — Kanban, fiche détaillée, filtres
- [ ] **Phase 7** — Undo/redo, copier-coller, accessibilité, tests e2e

## Contribuer

- Une branche par sujet (`feat/…`, `fix/…`, `chore/…`), PR vers `main`.
- Messages de commit au format [Conventional Commits](https://www.conventionalcommits.org/fr/) : `feat(engine): …`.
- La CI (lint, types, tests, build) doit être verte avant fusion.
