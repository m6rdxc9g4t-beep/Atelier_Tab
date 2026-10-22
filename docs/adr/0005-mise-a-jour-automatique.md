# ADR 0005 — Mise à jour automatique de l'app de bureau après un `git pull`

**Statut** : accepté · **Date** : 2026-10-22

## Contexte

Décision de l'utilisateur (docs/SUITE.md §8) : après un `git pull`, l'app de bureau est à jour à son lancement suivant, comme Atelier Projets, sans commande à retaper. Jusqu'ici, `npm run app:install` empaquetait une **copie figée** (interface, processus principal, serveur MCP) dans `/Applications/Atelier_Tab.app` : un `git pull` ne changeait rien sans relancer l'installation, et Nexus / Claude Code appelaient un serveur MCP périmé.

Contraintes propres à Tab :

- le processus principal (`desktop/main.ts`) est du TypeScript compilé par rolldown dans `dist-desktop/` : il ne peut pas se mettre à jour lui-même, et il doit être chargé **avant** l'événement `ready` d'Electron (`protocol.registerSchemesAsPrivileged` pour `app://atelier`) ;
- le serveur MCP est appelé par un chemin fixe, `Atelier_Tab.app/Contents/Resources/atelier-mcp`, enregistré dans Claude Code et Nexus ;
- l'app lancée depuis le Finder n'hérite que d'un PATH minimal (`/usr/bin:/bin:/usr/sbin:/sbin`) : ni `node`, ni `npm` (Homebrew dans `~/.homebrew` chez l'utilisateur, nvm…).

## Décision

1. **L'app installée est un lanceur.** electron-builder construit toujours `Atelier_Tab.app` (même identifiant `fr.atelier.tab`, même nom, icône, signature ad hoc, Electron du dépôt renommé), mais n'y met que `desktop/launcher/stub.cjs` et, dans `Contents/Resources/atelier-repo`, le chemin du dépôt. Le stub passe la main à `desktop/launcher/main.cjs` **lu dans le dépôt** : la logique de mise à jour elle-même suit donc les `git pull`. Le lanceur n'est à reconstruire que si le dépôt change de place ou si Electron change de version (le lanceur l'écrit alors dans le journal).
   - Electron vient du dépôt (`node_modules/electron`, version du lockfile) mais il est **copié** dans l'app, pas exécuté depuis `node_modules` : `npm ci` supprime `node_modules` pendant que l'app tourne, et une app qui exécuterait le binaire d'un autre bundle apparaîtrait sous le nom et l'icône d'« Electron » (Dock, `open -b`, AppleScript).
2. **Lanceur en CommonJS non compilé** (`desktop/launcher/*.cjs`), vérifié par TypeScript (`checkJs` dans `tsconfig.desktop.json`, JSDoc) et ESLint : il doit tourner avant toute compilation, puisque c'est lui qui la déclenche. Décisions pures dans `decision.cjs`, effets dans `update.cjs`, Electron injecté dans `main.cjs` : tout est testé sous Linux (Vitest), dont une mise à jour complète avec un faux dépôt git et un faux npm.
3. **Décision au lancement, synchrone et avant `ready`** (≈ 30 ms : deux commandes git et quelques empreintes). État = commit (`git rev-parse HEAD`) + contenu des fichiers modifiés localement (`git diff --name-only HEAD`, plus les fichiers nouveaux non ignorés) ; dépendances = empreinte de `package-lock.json`. Comparé au tampon `.mise-a-jour/tampon.json` :
   - rien n'a changé → `dist-desktop/main.cjs` est chargé aussitôt, comme une app empaquetée ;
   - lockfile changé ou `node_modules` absent → `npm ci` (avec `ELECTRON_SKIP_BINARY_DOWNLOAD=1` : réseau limité au registre npm) puis compilation ;
   - commit changé, modification locale (ou annulée), compilation absente → compilation.
4. **Compilation à côté, puis remplacement.** `npm run build` et `npm run build:desktop` écrivent dans `.mise-a-jour/compilation/` (variables `ATELIER_TAB_DIST_DIR`, `ATELIER_TAB_DESKTOP_DIR`), puis `dist/` et `dist-desktop/` sont remplacés chacun par un renommage (remis en place si le second échoue). La compilation précédente reste utilisable jusqu'au bout ; le tampon (état mesuré **avant** la mise à jour) n'est écrit qu'après un succès complet.
5. **Écran de démarrage puis relance.** Le processus principal devant être chargé avant `ready`, une mise à jour se fait dans une fenêtre « Mise à jour… » (étape en cours, raison), puis l'app se **relance** (`app.relaunch`) et prend le chemin direct. Une relance qui suit une mise à jour ne déclenche jamais de seconde mise à jour d'affilée. L'écran est une page locale sans pont ni IPC (`sandbox`, `contextIsolation`, CSP `default-src 'none'`) ; les choix passent par une boîte de dialogue native. Aucun nouveau canal IPC : la CSP et les garde-fous de l'interface sont inchangés.
6. **Échec** : message en français, extrait de la sortie de la commande en échec, journal `~/Library/Logs/Atelier_Tab/mise-a-jour.log` ; boutons « Ouvrir quand même avec la version précédente » (si une compilation existe : relance avec `--atelier-sans-mise-a-jour`), « Réessayer », « Ouvrir le journal », « Quitter ». Le lancement suivant réessaie.
7. **Verrou** `.mise-a-jour/verrou` (création exclusive, pid et date ; repris si le processus a disparu, après 2 h, ou s'il est illisible depuis 10 s) : une seule mise à jour à la fois, entre deux lancements de l'app comme entre l'app et le terminal (`npm run app:update`). L'état est remesuré sous le verrou. En plus, le verrou d'instance d'Electron ramène l'écran de démarrage au premier plan.
8. **Node.js depuis le Finder** : dossier retenu à la dernière mise à jour réussie (`.mise-a-jour/environnement.json`, écrit aussi par `npm run app:install` depuis le terminal), sinon PATH du shell de connexion (`zsh -l -i`, lit `.zprofile` et `.zshrc`), PATH du processus, `~/.homebrew/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, nvm (alias `default`, puis la plus récente), Volta ; `node` et `npm` dans le même dossier, version ≥ `engines.node`. Git : Homebrew avant `/usr/bin/git`.
9. **Serveur MCP** : `Contents/Resources/atelier-mcp` garde son chemin et lance `dist-desktop/atelier-mcp.mjs` **du dépôt** avec le Node.js d'Electron (`ELECTRON_RUN_AS_NODE`). Pas compilé → message clair et code 1. Il ne déclenche jamais de mise à jour (Claude Code ou Nexus peuvent le lancer à tout moment) ; le remplacement par renommage ne gêne pas un serveur déjà démarré.
10. **Jamais de `git pull` automatique**, jamais d'accès aux données : la mise à jour n'écrit que `node_modules/`, `dist/`, `dist-desktop/` et `.mise-a-jour/` dans le dépôt. `~/Atelier_Tab`, les préférences et les secrets ne bougent pas ; Tab n'a pas de migration (fichiers JSON lus de façon tolérante).

## Options écartées

- **Mise à jour dans `desktop/main.ts`** : code compilé, donc incapable de se recompiler lui-même avant d'avoir été compilé.
- **Enregistrer le protocole dans le lanceur puis charger `main.cjs` après `ready`** : la configuration du protocole serait dupliquée hors de `main.ts` ; la relance garde un seul chemin de démarrage.
- **Exécuter l'Electron de `node_modules` depuis un petit bundle** : voir le point 1.

## Conséquences

- Après un `git pull` : relancer l'app. Première ouverture après un changement : de 15 s à une minute (plus si `npm ci`).
- `npm run app:install` n'est à relancer que si le dépôt change de place ou si Electron change de version. `npm run app:update` fait la mise à jour depuis le terminal (même logique).
- L'app construite par la CI pointe vers le dépôt de la CI : elle ne se distribue plus (l'archive téléchargeable est retirée). La distribution à d'autres personnes demanderait un empaquetage complet et signé (ADR 0002).
- Si Electron change de version dans le lockfile, l'app continue avec la sienne jusqu'au prochain `npm run app:install` (avertissement dans le journal et sur l'écran de démarrage).
