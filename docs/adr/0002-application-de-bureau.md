# ADR 0002 — Application de bureau macOS

**Statut** : accepté · **Date** : 2026-10-18

## Contexte

Atelier_Tab doit pouvoir s'ouvrir comme une application Mac, d'un double-clic, sans lancer de serveur ni de terminal.

## Options

|                    | Electron                                | Tauri                                   |
| ------------------ | --------------------------------------- | --------------------------------------- |
| Outils à installer | Aucun en plus de Node                   | Rust (rustup, ~1 Go) + Xcode CLT        |
| Moteur de rendu    | Chromium embarqué : identique aux tests | WebKit de macOS : différences possibles |
| Taille de l'app    | ~250 Mo                                 | ~10 Mo                                  |
| Code ajouté        | Un fichier (`electron/main.cjs`)        | Projet Rust `src-tauri/`                |

## Décision

**Electron**, avec electron-builder :

- construit avec les outils déjà présents (Node / npm) ;
- même moteur que Chromium, dans lequel l'interface est testée ;
- l'interface est servie par un protocole privé `app://atelier/` plutôt que `file://` : l'origine est stable, donc les données IndexedDB survivent aux mises à jour ;
- sécurité : `contextIsolation`, `sandbox`, pas d'accès Node dans l'interface, liens externes ouverts dans le navigateur ;
- pas de certificat Apple : signature ad hoc (`codesign --sign -`) dans un hook `afterPack`, suffisante pour une app construite et utilisée sur le même Mac.

## Conséquences

- L'app pèse ~250 Mo ; acceptable pour un outil personnel.
- Pour distribuer l'app à d'autres personnes : compte Apple Developer, signature Developer ID et notarisation (configuration electron-builder à compléter).
- Si la taille devient un problème, la migration vers Tauri ne touche que `electron/` et les scripts : l'interface reste la même.
