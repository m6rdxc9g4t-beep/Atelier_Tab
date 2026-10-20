# CLAUDE.md — Atelier Tab

Instructions pour les agents qui travaillent sur ce dépôt.

## Produit

Atelier Tab (nom technique `Atelier_Tab` / `atelier-tab`) combine :

1. **Un tableur** : grille réactive, barre de formules (`=SUM()`, `=AVG()`, `=MIN()`, `=MAX()`, `=IF()`, références `A1:B10`, arithmétique).
2. **Une base de données typée** : statut/badge, date, responsable, devise, case à cocher, formule ; vues grille hybride et Kanban ; fiche détaillée par ligne.
3. **Une navigation par projets** : Espaces de travail › Projets › Tables.
4. **Le pont DataFlow** : export d'une table ou d'une sélection vers Atelier Projets (`atelier_projets` : JSON v2.1.0, CSV enrichi, webhook) et instantanés pour Atelier Viz.

## Commandes

```bash
npm run dev          # serveur local, http://127.0.0.1:5175 (aperçu : 4175)
npm test             # Vitest
npm run lint && npm run typecheck && npm test && npm run build   # ce que fait la CI
```

Lancer les quatre vérifications avant tout commit.

## Règles d'architecture

- `src/engine/` et `src/dataflow/` n'importent **jamais** React ni le store. Ce sont des fonctions pures, testées dans `__tests__/` à côté du code.
- Les composants ne calculent rien : ils lisent le store (sélecteurs fins pour éviter les re-rendus) et appellent ses actions.
- **Identifiants stables, coordonnées dérivées.** Les champs et enregistrements ont des `id` permanents ; la lettre de colonne et le numéro de ligne se déduisent de `fieldOrder` / `rowOrder`. Toute insertion, suppression ou déplacement passe par `engine/formula/references.ts` pour réécrire les formules concernées.
- Les lignes `kind: 'summary'` (totaux) sont exclues des agrégats de pied de page et de `computed_totals` à l'export, pour éviter le double comptage.
- Jamais d'`eval()` ni de `new Function()` : les formules passent par le parser maison.
- Les couleurs viennent des tokens de `src/index.css` (`bg-surface`, `text-muted`, `border-line`, `text-accent-fg`…), jamais de couleurs Tailwind brutes. Tout écran doit fonctionner en clair et en sombre.

- **IA** : `src/ai/tools.ts` est la seule définition des outils, partagée par le serveur MCP (`desktop/mcp-server.ts`) et l'assistant intégré (Ollama ou Claude). Un outil passe toujours par les actions du store, jamais par une écriture directe des données. Toute nouvelle fonctionnalité de données doit être accessible par un outil.
- **Fichiers de données** : le format est défini dans `src/storage/format.ts`. Un changement de format exige une lecture tolérante de l'ancien (les fichiers peuvent être édités à la main ou par une IA) et un test.
- **Moteurs de l'assistant** (docs/SUITE.md §5) : `runAgent` passe par `ChatProvider` (`src/ai/provider.ts`), jamais par un moteur précis. Claude : CLI Claude Code lancée **isolée** par le processus principal (`desktop/claude-cli.ts`, drapeaux du contrat §5.3), **jamais d'outil de la CLI** (`--tools ""`) ; les outils sont exécutés par l'app (protocole JSON contraint, `src/ai/claude.ts`). L'interface n'envoie que conversation, contexte, prompt système, schéma et alias de modèle ; aucun argument de ligne de commande libre, **aucune donnée en argument** (le prompt système ne contient que des consignes ; contexte et tables passent par l'entrée standard). Environnement de la CLI en liste blanche exacte (§5.3).
- **Données ≠ consignes** (§5.4) : un résultat d'outil ou le contexte de l'app est toujours un bloc délimité de `src/ai/tool-data.ts` (rôle `tool`), jamais un message `user`. Ne jamais concaténer des données de table dans le prompt système.
- **Garde-fous** : tout outil qui envoie hors de cette machine ou détruit des données appelle `requireConfirmation` (assistant : carte « Autoriser / Refuser » ; MCP : confirmations de Claude Code). Tout envoi webhook passe par `sendToWebhook` (hors ligne : cette machine seulement ; jeton seulement vers Atelier Projets local ; `redirect: 'error'`) et, dans l'app de bureau, par le relais `webhook:post` qui revérifie. La CSP du renderer (`desktop/csp.ts`) limite `connect-src` à cette machine : ne pas l'élargir.
- **Mode en ligne** (§5.1) : `preferences.json` à côté du fichier de secrets, **hors** du dossier de données ; écrit seulement par le processus principal (IPC `prefs:set-online`, interrupteur de l'en-tête). Jamais dans `atelier.json` (une ancienne valeur y est ignorée). Aucun outil d'IA ne passe en ligne.
- Route de santé (`desktop/health-server.ts`) : `127.0.0.1` seulement, deux routes, aucune donnée ; la fenêtre revient par `show()` / `focus()` (`desktop/window-focus.ts`), jamais `app.focus({ steal: true })`.
- `desktop/` est du code Node (processus principal Electron, accès disque, serveur MCP), construit par `npm run build:desktop` dans `dist-desktop/`.

## Suite Atelier

Atelier Tab fait partie de la Suite Atelier (avec Atelier Viz et Atelier Projets). Le contrat commun — design system, statuts, thème, ports, sélecteur d'apps, import Projets, instantanés Viz — est **`docs/SUITE.md`**, identique dans les trois dépôts : ne le modifie pas seul.

- `src/styles/atelier-ds/` : copie verbatim du design system d'Atelier Projets ; ne pas modifier ni reformater (exclue de Prettier). Couleurs officielles (statuts, types) reprises telles quelles dans `src/index.css`, sans couleur littérale.
- Charte « néon monochrome » (docs/SUITE.md §1.7) : **toute l'app est dans le vert de Tab (#21A366)**, en clair comme en sombre. `src/styles/atelier-brand/atelier-brand.css` est une copie verbatim (ne pas modifier, exclue de Prettier) ; `<html data-atelier-app="tab">` y pose la signature, dont dérivent les jetons `--atelier-*` des deux thèmes. `src/index.css` branche les jetons de Tab dessus : fond `bg-page` (+ grille `--atelier-backdrop`), `bg-sidebar`, `bg-surface`, `bg-surface-hover`, `bg-field`, `text-ink` / `text-muted` / `text-accent-fg` (signature lisible en texte), traits `border-edge` (cartes, menus), `border-line-strong` (champs, boutons secondaires), `border-line` (séparateurs) ; halos `shadow-glow` (cartes), `shadow-glow-strong` (menus, modales), `shadow-focus` + `border-focus` (champs). Bouton principal : classe `atelier-btn-primary` du kit (plein en clair, contour néon en sombre) ; navigation active : `atelier-nav-active`. Les couleurs de statut, de type, de succès / danger / attention et des références de formules ne changent pas.
- Statuts : `src/engine/field-types/workflow-status.ts` (reconnaissance des libellés, préréglage « Statuts Atelier »).
- Adresses des apps : `src/lib/suite.ts`. Import Projets : `src/dataflow/transports/projets.ts`. Instantanés : `src/dataflow/snapshot.ts` (pur) et `desktop/snapshots.ts` (disque).
- Ports fixes : 5175 (dev) et 4175 (aperçu), `strictPort`.

## Conventions

- TypeScript strict avec `noUncheckedIndexedAccess` : gérer explicitement `undefined`.
- Alias d'import `@/` → `src/`.
- Interface en français ; identifiants de code en anglais.
- Commits : Conventional Commits (`feat(grid): …`, `fix(engine): …`). Une branche par phase ou sujet, PR vers `main`.

## Références

- `docs/ARCHITECTURE.md` — flux de données et choix techniques
- `docs/FORMULA_ENGINE.md` — grammaire, fonctions, erreurs
- `docs/DATAFLOW_SPEC.md` — contrat d'export `atelier_projets`, instantanés pour Viz
- `docs/SUITE.md` — contrat commun de la Suite Atelier
- `docs/adr/` — décisions d'architecture
