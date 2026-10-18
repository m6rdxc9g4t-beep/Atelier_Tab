# CLAUDE.md — Atelier_Tab

Instructions pour les agents qui travaillent sur ce dépôt.

## Produit

Atelier_Tab combine :

1. **Un tableur** : grille réactive, barre de formules (`=SUM()`, `=AVG()`, `=MIN()`, `=MAX()`, `=IF()`, références `A1:B10`, arithmétique).
2. **Une base de données typée** : statut/badge, date, responsable, devise, case à cocher, formule ; vues grille hybride et Kanban ; fiche détaillée par ligne.
3. **Une navigation par projets** : Espaces de travail › Projets › Tables.
4. **Le pont DataFlow** : export d'une table ou d'une sélection vers `atelier_projets` (JSON v2.1.0, CSV enrichi, webhook).

## Commandes

```bash
npm run dev          # serveur local
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
- Les couleurs viennent des tokens de `src/index.css` (`bg-surface`, `text-muted`, `border-line`, `text-accent`…), jamais de couleurs Tailwind brutes. Tout écran doit fonctionner en clair et en sombre.

- **IA** : `src/ai/tools.ts` est la seule définition des outils, partagée par le serveur MCP (`desktop/mcp-server.ts`) et l'assistant Ollama. Un outil passe toujours par les actions du store, jamais par une écriture directe des données. Toute nouvelle fonctionnalité de données doit être accessible par un outil.
- **Fichiers de données** : le format est défini dans `src/storage/format.ts`. Un changement de format exige une lecture tolérante de l'ancien (les fichiers peuvent être édités à la main ou par une IA) et un test.
- `desktop/` est du code Node (processus principal Electron, accès disque, serveur MCP), construit par `npm run build:desktop` dans `dist-desktop/`.

## Conventions

- TypeScript strict avec `noUncheckedIndexedAccess` : gérer explicitement `undefined`.
- Alias d'import `@/` → `src/`.
- Interface en français ; identifiants de code en anglais.
- Commits : Conventional Commits (`feat(grid): …`, `fix(engine): …`). Une branche par phase ou sujet, PR vers `main`.

## Références

- `docs/ARCHITECTURE.md` — flux de données et choix techniques
- `docs/FORMULA_ENGINE.md` — grammaire, fonctions, erreurs
- `docs/DATAFLOW_SPEC.md` — contrat d'export `atelier_projets`
- `docs/adr/` — décisions d'architecture
