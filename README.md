# Atelier Tab

**Tableur et base de données dans un même espace de travail, avec un export natif vers Atelier Projets.** Membre de la [Suite Atelier](#suite-atelier), avec Atelier Viz et Atelier Projets.

Atelier Tab réunit la liberté de calcul d'Excel (formules, références `A1:C10`, recalcul instantané) et la rigueur d'Airtable (colonnes typées, statuts colorés, vues Kanban, fiches par ligne). Les données restent sur votre ordinateur, dans des fichiers lisibles que Claude Code et un modèle local Ollama peuvent manipuler ; le module **DataFlow** les transforme au format attendu par l'application de gestion de projet Atelier Projets (`atelier_projets`).

> Statut : en développement actif. Voir la [feuille de route](#feuille-de-route).

---

## Fonctionnalités

| Domaine                | Ce que ça fait                                                                                                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Moteur de formules** | `SUM`, `AVG`/`AVERAGE`, `MIN`, `MAX`, `IF`, `COUNT`, `ROUND`, `ABS`, opérateurs `+ - * / ^ &`, comparaisons, références et plages. Recalcul incrémental, détection des cycles, erreurs Excel (`#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#CYCLE!`). Aucun `eval()`. |
| **Colonnes typées**    | Texte, nombre, devise, pourcentage, statut (badge aux couleurs officielles de la suite, préréglage « Statuts Atelier »), date, case à cocher, responsable, formule.                                                                                                |
| **Vues**               | Grille hybride, tableur pur, Kanban groupé par statut, fiche détaillée.                                                                                                                                                                                            |
| **Navigation**         | Espaces de travail › Projets › Tables, recherche rapide `Ctrl/Cmd + K`.                                                                                                                                                                                            |
| **DataFlow**           | Export JSON normalisé (schéma `atelier_projets` v2.1.0), CSV enrichi, envoi direct à Atelier Projets (préréglage local, résumé d'import). Instantanés pour Atelier Viz.                                                                                            |
| **Persistance**        | App de bureau : fichiers JSON dans `~/Atelier_Tab`, synchronisés en direct. Navigateur : IndexedDB.                                                                                                                                                                |
| **IA**                 | Serveur MCP pour Claude Code et assistant intégré (Ollama local, ou Claude en ligne) : mêmes 19 outils, mêmes règles que la grille. Nœud Atelier pour les workflows d'Atelier Nexus.                                                                               |

## Démarrage

Prérequis : **Node.js ≥ 20.19** (ou ≥ 22.12) et npm.

```bash
git clone https://github.com/m6rdxc9g4t-beep/atelier-tab.git
cd atelier-tab
npm install
npm run dev          # http://127.0.0.1:5175
```

Ports fixes de la Suite Atelier (`strictPort` : un port occupé fait échouer le lancement au lieu d'en prendre un autre) : `npm run dev` → **5175**, `npm run preview` → **4175**.

### Application macOS

Atelier Tab existe aussi en application de bureau, à ouvrir d'un double-clic.

```bash
npm install
npm run app:install
```

La commande construit `Atelier_Tab.app`, compile le dépôt puis copie l'app dans **Applications** (une ancienne version est d'abord quittée puis remplacée). Elle est ensuite accessible depuis le Launchpad, Spotlight (⌘ Espace) ou le Dock.

**Après un `git pull`, relancez simplement l'app** : elle se met à jour toute seule. L'app installée exécute le code du dépôt ; au lancement, si le dépôt a changé (nouveau commit, modification locale, `package-lock.json`), un écran « Mise à jour… » affiche l'étape en cours (`npm ci` si les dépendances ont changé, puis compilation), puis l'app s'ouvre. Sinon elle s'ouvre directement. Jamais de `git pull` automatique ; vos données ne sont pas touchées.

- En cas d'échec (réseau, erreur de compilation), l'écran l'explique, donne le journal (`~/Library/Logs/Atelier_Tab/mise-a-jour.log`) et propose **Ouvrir quand même avec la version précédente** : la compilation précédente n'est remplacée qu'après une compilation réussie. Le lancement suivant réessaie.
- `npm run app:install` n'est à relancer que si le dépôt change de place ou si Electron change de version. `npm run app:update` fait la même mise à jour depuis le terminal.
- Node.js et npm sont cherchés comme dans un terminal (PATH du shell de connexion, `~/.homebrew/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, nvm), en commençant par ceux utilisés pour `npm run app:install`. Détails : [ADR 0005](docs/adr/0005-mise-a-jour-automatique.md).

- Les données sont dans le dossier **`~/Atelier_Tab`** (menu Fichier › Ouvrir le dossier des données) : un fichier `atelier.json` et un fichier par table dans `tables/`. Au premier lancement, les données d'une version précédente sont reprises automatiquement.
- `~/Atelier_Tab/exports/` reçoit un instantané par table (`<id de table>.json`), lu par Atelier Viz ; voir [Suite Atelier](#suite-atelier).
- Le nom affiché est « Atelier Tab » ; les noms techniques restent `Atelier_Tab.app`, `~/Atelier_Tab` et le paquet `atelier-tab`.
- L'app est signée localement (« ad hoc »), sans compte développeur Apple. Elle s'ouvre normalement sur le Mac qui l'a construite ; pour la donner à quelqu'un d'autre, une signature Apple sera nécessaire.
- `npm run app` lance l'application sans l'installer, pour essayer une modification (développement).

### Installer sur Windows

Windows 10 (21H2 ou plus récent) et Windows 11, x64 et ARM64, pour l'utilisateur courant, **sans droits d'administrateur** (docs/SUITE.md §9).

**Prérequis** — la commande les vérifie et dit quoi installer, sans rien installer elle-même :

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e   # Node.js 22.12 ou plus récent, avec npm
```

**Installer** — dans PowerShell (Windows PowerShell 5.1 ou PowerShell 7), depuis le dépôt cloné :

```powershell
git clone https://github.com/m6rdxc9g4t-beep/atelier-tab.git
cd atelier-tab
powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1
```

(`npm run app:install` fait la même chose.) La commande compile le dépôt (`npm ci` si besoin), construit le lanceur `Atelier_Tab.exe`, le copie dans `%LOCALAPPDATA%\Programs\Atelier_Tab`, crée les raccourcis **menu Démarrer › Atelier › Atelier Tab** et **Bureau** (`-SansBureau` pour s'en passer), inscrit son raccourci du menu Démarrer pour les autres apps de la suite (`HKCU\Software\Atelier\Apps\tab`, ouvert par l'Explorateur) et connecte Claude Code s'il est installé. Aucune fenêtre de console ne s'ouvre au lancement de l'app.

**Mettre à jour** — `git pull`, puis relancez l'app : comme sur macOS, elle se met à jour toute seule (écran « Mise à jour… », puis ouverture). Journal : `%LOCALAPPDATA%\Atelier_Tab\Logs\mise-a-jour.log` ; en cas d'échec, **Ouvrir quand même avec la version précédente**. La commande d'installation n'est à relancer que si le dépôt change de place ou si Electron change de version ; la relancer **répare** l'installation sans toucher aux données.

**Désinstaller** — retire le lanceur, les raccourcis, l'enregistrement et la connexion à Claude Code, **jamais les données** :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\install.ps1 -Desinstaller
```

| Usage                                  | Windows                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| Données (tables, instantanés pour Viz) | `%USERPROFILE%\Atelier_Tab`                                     |
| Préférences (mode « En ligne »), jeton | `%APPDATA%\Atelier_Tab`                                         |
| Journal de mise à jour                 | `%LOCALAPPDATA%\Atelier_Tab\Logs\mise-a-jour.log`               |
| Lanceur                                | `%LOCALAPPDATA%\Programs\Atelier_Tab\Atelier_Tab.exe`           |
| Serveur MCP (chemin stable)            | `%LOCALAPPDATA%\Programs\Atelier_Tab\resources\atelier-mcp.cmd` |

Node.js est cherché dans le `PATH`, `%ProgramFiles%\nodejs`, nvm-windows, fnm, Volta et `%LOCALAPPDATA%\Programs\nodejs`, en commençant par celui qui a servi à l'installation. L'app étant construite sur votre PC (aucun fichier téléchargé), SmartScreen ne la bloque pas ; elle n'est pas signée.

### Claude Code et Ollama

Claude Code et un modèle local peuvent lire et modifier toutes les données : tables, lignes, colonnes, formules, export.

**Claude Code** — `npm run app:install` le connecte automatiquement s'il est installé (sinon `npm run ai:connect`, ou menu Fichier › Connecter Claude Code…). Le serveur MCP `atelier-tab` est livré dans l'app (macOS : `Contents/Resources/atelier-mcp` ; Windows : `resources\atelier-mcp.cmd`, Claude Code étant branché directement sur `Atelier_Tab.exe resources\atelier-mcp.cjs`) et exécute la version compilée du dépôt, à jour après chaque lancement de l'app ; dans n'importe quelle session :

> « Ajoute une ligne Menuiseries à 12 000 € HT dans Planning & Lots »
> « Quel est le total TTC du budget ? »
> « Exporte Planning & Lots en JSON pour atelier_projets »
> « Ajoute une colonne Avancement avec les statuts Atelier dans Matériaux »

Si l'app est ouverte, elle se met à jour en direct. Le dossier `~/Atelier_Tab` contient aussi un `CLAUDE.md` qui décrit le format des fichiers.

**Assistant intégré** — bouton **Assistant** (⌘J) dans l'app. Moteur au choix, comme dans Atelier Viz : **Auto · Ollama · Claude**.

- **Ollama** (local) : il faut un modèle qui sait appeler des outils :

  ```bash
  ollama pull qwen3:8b
  ```

- **Claude** (app de bureau seulement, mode **En ligne**) : la CLI Claude Code de l'ordinateur (votre abonnement), modèle Sonnet (défaut), Opus ou Haiku. Prérequis : Claude Code installé et `claude auth login`. L'exécutable est cherché dans `CLAUDE_CLI`, le `PATH`, puis `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` ; sous Windows, `claude.exe` (PATH, `%USERPROFILE%\.local\bin`) ou une installation npm (`claude.cmd` de `%APPDATA%\npm`, lancée en `node.exe …\cli.js`, jamais par `cmd.exe`). Dans un navigateur (`npm run dev`), Claude est grisé : « disponible dans l'app de bureau ».
- **Auto** : Claude si l'app est en ligne et Claude disponible, sinon Ollama. Chaque réponse indique le moteur utilisé (« via Claude · Sonnet »).

**Hors ligne / En ligne** — interrupteur de l'en-tête, **hors ligne par défaut**, mémorisé **hors du dossier de données** (que les IA peuvent modifier), dans `preferences.json` à côté du fichier de secrets (macOS : `~/Library/Application Support/Atelier_Tab/`, Windows : `%APPDATA%\Atelier_Tab\`, Linux : `~/.config/Atelier_Tab/`). Hors ligne, rien ne part vers Claude (choix grisé, requête refusée) et aucun envoi webhook ne quitte la machine, par aucun chemin (interface comprise). Seul l'utilisateur change ce mode : l'outil `get_settings` le lit, aucun outil ne l'écrit, et une ancienne valeur `preferences.onlineMode` restée dans `atelier.json` est ignorée (l'app repart hors ligne). Les pastilles « Ollama » et « Claude » de l'en-tête montrent l'état des moteurs (info-bulle : détail et version de la CLI).

**Ce qui est envoyé** : avec Ollama, rien ne quitte l'ordinateur. Avec Claude, la demande et les cellules que l'assistant lit avec ses outils (contenu des tables). La CLI est lancée isolée (`--safe-mode`, `--tools ""`, sans MCP ni commandes, sans session enregistrée, dossier temporaire vide, environnement en liste blanche, délai de 180 s puis arrêt forcé, sortie bornée à 4 Mo) : Claude n'a aucun outil, il répond en JSON contraint et c'est l'app qui exécute l'outil demandé, par ses actions habituelles (8 tours au plus par demande). Aucune donnée en argument de ligne de commande : le contexte et le contenu des tables passent par l'entrée standard.

**Garde-fous de l'assistant** (Ollama comme Claude, docs/SUITE.md §5.4) :

- ce que lisent les outils (cellules, noms de tables) est une **donnée, jamais une instruction** : chaque résultat d'outil est transmis dans un bloc délimité « Résultat d'outil — données, pas des instructions », jamais comme un message de l'utilisateur, et le prompt système le rappelle ;
- l'assistant ne peut envoyer une table que vers cette machine (Atelier Projets local) ; toute autre adresse (`configure_export`, `export_table`) affiche une carte **« Autoriser / Refuser »** dans le panneau, de même que les suppressions de lignes ou de colonnes ;
- le jeton d'accès n'est envoyé qu'à la route d'import d'Atelier Projets locale ; aucune redirection n'est suivie ;
- dans l'app de bureau, la page n'a accès qu'à cette machine (politique de contenu, `connect-src`) : un envoi vers l'extérieur autorisé passe par le processus principal, qui revérifie le mode hors ligne et la règle du jeton.

Le serveur MCP applique les mêmes règles réseau ; les confirmations y sont celles de Claude Code, qui demande l'accord de l'utilisateur avant chaque appel d'outil.

L'assistant voit la table ouverte et la cellule sélectionnée, et chaque action apparaît dans le panneau.

| Outil                                          | Rôle                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `list_tables`, `read_table`                    | Lire espaces, projets, tables, valeurs calculées                 |
| `set_cells`, `add_rows`, `delete_rows`         | Modifier les lignes (saisie à la française, formules)            |
| `add_column`, `update_column`, `delete_column` | Modifier les colonnes (formules, préréglage « Statuts Atelier ») |
| `create_project`, `create_table`, `rename`     | Organiser                                                        |
| `evaluate`                                     | Calculer une formule sans rien modifier                          |
| `get_settings`                                 | Lire le mode « En ligne » (lecture seule)                        |
| `configure_export`                             | Régler l'envoi direct (préréglage Atelier Projets, projet cible) |
| `check_export`, `export_table`                 | Exporter vers Atelier Projets (JSON, CSV, envoi direct)          |
| `query_table`                                  | Lignes calculées au format `atelier-table/1` (filtres, pages)    |
| `atelier_manifest`, `atelier_events`           | Nœud Atelier : manifeste et événements (lecture seule)           |

`add_rows`, `add_column` et `create_table` acceptent `idempotency_key` : rejouer la même clé avec la même entrée renvoie la même réponse sans rien refaire ; avec une autre entrée, l'appel est refusé (`IDEMPOTENCY_KEY_REUSED`).

### Scripts

| Commande              | Rôle                                                                              |
| --------------------- | --------------------------------------------------------------------------------- |
| `npm run dev`         | Serveur de développement Vite (http://127.0.0.1:5175)                             |
| `npm run build`       | Vérification des types puis build de production dans `dist/`                      |
| `npm run preview`     | Sert le build de production (http://127.0.0.1:4175)                               |
| `npm test`            | Tests unitaires (Vitest)                                                          |
| `npm run test:watch`  | Tests en mode surveillance                                                        |
| `npm run lint`        | ESLint                                                                            |
| `npm run typecheck`   | TypeScript strict, sans émission                                                  |
| `npm run format`      | Prettier                                                                          |
| `npm run ai:connect`  | Enregistre le serveur MCP dans Claude Code                                        |
| `npm run mcp`         | Lance le serveur MCP depuis le dépôt (développement)                              |
| `npm run app`         | Lance l'app de bureau depuis le dépôt (développement)                             |
| `npm run app:install` | Installe l'app (lanceur du dépôt) : Applications (macOS), `install.ps1` (Windows) |
| `npm run app:update`  | Met à jour la compilation de l'app depuis le terminal                             |

## Suite Atelier

Atelier Tab partage avec **Atelier Viz** (BI) et **Atelier Projets** (gestion de projet) une identité visuelle, des ports fixes et des échanges de données locaux. Le contrat commun est [`docs/SUITE.md`](docs/SUITE.md), identique dans les trois dépôts.

| Application     | Interface (dev)         | Interface (aperçu / app)               | API                         |
| --------------- | ----------------------- | -------------------------------------- | --------------------------- |
| Atelier Viz     | `http://127.0.0.1:5173` | `http://127.0.0.1:8000`                | `http://127.0.0.1:8000/api` |
| Atelier Projets | `http://127.0.0.1:5174` | `http://127.0.0.1:4174`                | `http://127.0.0.1:3000/api` |
| Atelier Tab     | `http://127.0.0.1:5175` | `http://127.0.0.1:4175` · app Electron | santé : `/api/health`       |

- **Design system** : copie verbatim des thèmes et couleurs d'Atelier Projets dans `src/styles/atelier-ds/` (ne pas modifier, ne pas reformater) ; charte « néon monochrome » (§1.7 du contrat) : toute l'interface est dans la couleur signature d'Atelier Tab, le vert #21A366 — fond teinté avec fine grille, surfaces, traits néon, textes et halos dérivés de `styles/atelier-brand/atelier-brand.css`, en clair comme en sombre ; les jetons de Tab (`--surface`, `--ink`, `--line`, `--accent`…) s'y branchent dans `src/index.css`. Les couleurs de statut et de type gardent leur sens. Polices système, rayons 6 / 10 / 16 px.
- **Thème** : Clair, Sombre ou Système (bouton en haut à droite) ; `<html>` porte la classe `dark` et `data-theme`.
- **Statuts** : un choix de statut dont le libellé est un statut commun (À faire, En cours, En revue, En attente, Bloquée, Résolue, Terminée, Rejetée, et synonymes : « Fait », « Terminé », « Bloqué »…) s'affiche dans la couleur officielle. Préréglage « Statuts Atelier » dans le menu ➕ d'ajout de colonne.
- **Sélecteur de suite** : icône grille en haut à gauche ; ouvre Atelier Viz, Atelier Projets et Atelier Cuisine (navigateur, ou app installée / navigateur par défaut depuis l'app de bureau) et indique si les apps locales sont en marche ; Tab y est toujours « en marche ». Atelier Cuisine est une app en ligne (`https://atelier-cuisine-iota.vercel.app`, app Mac `fr.ateliercuisine.app`) : jamais sondée, marquée « En ligne ». Pour que les autres apps le voient, l'app de bureau écoute sur `127.0.0.1:4175` (seulement `GET /api/health` → `{"status":"ok","app":"atelier-tab"}` et `GET /`, page « Atelier Tab est ouvert » qui ramène la fenêtre ; aucune donnée) ; `npm run dev` et `npm run preview` répondent aussi sur `/api/health`. Adresses surchargeables : `VITE_ATELIER_VIZ_URL`, `VITE_ATELIER_TAB_URL`, `VITE_ATELIER_PROJETS_URL`, `VITE_ATELIER_PROJETS_API_URL`, `VITE_ATELIER_CUISINE_URL`.
- **Tab → Projets** : dialogue d'export › Envoi direct › préréglage **Atelier Projets (local)** (`http://127.0.0.1:3000/api/imports/atelier-tab`), projet cible facultatif. Le résumé renvoyé (créés, mis à jour, ignorés, avertissements) s'affiche dans le dialogue. Un réimport met à jour les éléments déjà importés.
- **Tab → Viz** : l'app de bureau écrit `~/Atelier_Tab/exports/<id de table>.json` (enveloppe DataFlow, valeurs calculées) après chaque enregistrement, et le supprime avec la table. Le connecteur « Atelier Tab » de Viz lit ce dossier.
- **Nœud Atelier (Atelier Nexus)** — contrat `atelier-node/1` (§7) : Nexus enchaîne Tab dans ses workflows par le serveur MCP. `~/Atelier_Tab/exports/_atelier/` contient `manifest.json` (ce que Tab sait faire, réécrit au démarrage de l'app et du serveur MCP, identique à l'outil `atelier_manifest`), `index.json` (tables publiées et leur révision, qui n'augmente qu'à un vrai changement de contenu) et `events.jsonl` (`tab.table.changed` / `tab.table.deleted`, 1 000 derniers, lus par `atelier_events`). L'app et le serveur MCP y écrivent sous un verrou commun. Voir [ADR 0004](docs/adr/0004-noeud-atelier.md).

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
├── dataflow/         Export vers Atelier Projets (schéma, mapping, transports), instantanés pour Viz
├── styles/atelier-ds Copie verbatim du design system de la Suite Atelier
├── components/       Interface : layout, sidebar, grid, cells, formula-bar, kanban…
├── hooks/            Hooks React transverses (thème)
└── lib/              Utilitaires, adresses de la Suite Atelier (suite.ts)
```

Principe directeur : **`engine/` et `dataflow/` sont du TypeScript pur, testés sans navigateur.** React affiche l'état et déclenche des actions ; il ne calcule rien lui-même.

Détails : [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · Moteur : [`docs/FORMULA_ENGINE.md`](docs/FORMULA_ENGINE.md) · Export : [`docs/DATAFLOW_SPEC.md`](docs/DATAFLOW_SPEC.md)

### Stack

React 19 · TypeScript (strict) · Vite · Electron (app macOS) · Tailwind CSS v4 · Zustand · Zod · Lucide · TanStack Virtual · dnd-kit · cmdk · Vitest · Playwright

## Feuille de route

- [x] **Phase 0** — Socle : Tailwind v4, thème clair/sombre, CI
- [x] **Suite Atelier** — Design system commun, statuts officiels, sélecteur d'apps, import Projets, instantanés Viz
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
