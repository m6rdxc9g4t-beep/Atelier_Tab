# Audit : fonctions « comme Excel » et « comme Airtable »

Audit d'Atelier Tab 0.6.0 (octobre 2026), avant et après la refonte de la branche
`claude/audit-visual-redesign-mu3mkb`. Méthode : lecture du code (composants, store, moteur),
comparaison avec le comportement d'Excel (saisie, plages, formules) et d'Airtable (vues, champs,
fiche, Kanban), puis vérification par les tests (moteur, store, interface jsdom).

Légende : ✅ fonctionne · ⚠️ partiel · ❌ absent.

## Excel

| Fonction                              | Avant | Après | Remarques                                                                                                        |
| ------------------------------------- | :---: | :---: | ---------------------------------------------------------------------------------------------------------------- |
| Saisie, Entrée / Tab, F2, Échap       |  ✅   |  ✅   | Un clic ailleurs pendant une saisie la valide (avant : l'éditeur restait ouvert).                                |
| Barre de formules, aperçu, références |  ✅   |  ✅   | + adresse de plage (`B2:D5`), autocomplétion des fonctions, aide sur la syntaxe et l'argument courant.           |
| Sélection de plage                    |  ❌   |  ✅   | Souris (glisser, Maj + clic), Maj + flèches, ⌘ + flèches, numéros de ligne, lettres de colonne, ⌘A.              |
| Copier / couper / coller              |  ❌   |  ✅   | TSV d'Excel et de Google Sheets ; formules décalées dans l'app ; lignes ajoutées ; une cellule remplit la plage. |
| Poignée de recopie, ⌘D / ⌘R           |  ❌   |  ✅   | Séries (1, 2 → 3 ; dates ; « Lot 1 »), formules décalées ; jamais sur une ligne de total.                        |
| Annuler / rétablir                    |  ❌   |  ✅   | Toute action, suppressions et changements de type compris ; bouton « Annuler » après une suppression.            |
| Suppr sur une plage                   |  ⚠️   |  ✅   | Avant : une seule cellule.                                                                                       |
| Insérer / supprimer des lignes        |  ⚠️   |  ✅   | Avant : corbeille au survol, suppression immédiate et définitive. Après : menu contextuel, annulable.            |
| Fonctions de formule                  |  ⚠️   |  ✅   | 14 → une centaine, noms anglais et français (SOMME.SI, NB.SI.ENS, RECHERCHEV/X, INDEX/EQUIV, texte, dates).      |
| Calcul sur les dates                  |  ❌   |  ✅   | `=Échéance - AUJOURDHUI()`, DATEDIF, MOIS.DECALER, NB.JOURS.OUVRES ; format de résultat « date ».                |
| Largeur des colonnes                  |  ❌   |  ✅   | Glisser le bord ; double-clic : ajustement au contenu.                                                           |
| Déplacer colonnes et lignes           |  ❌   |  ✅   | Glisser-déposer ; les formules suivent les cellules (`moveReferences`).                                          |
| Volet figé                            |  ⚠️   |  ✅   | Avant : numéros de ligne seulement. Après : première colonne figée, avec ombre au défilement.                    |
| Barre d'état (Moyenne, Nb, Somme)     |  ❌   |  ✅   | Sur la plage sélectionnée, dans le format de la colonne.                                                         |
| Menu contextuel                       |  ❌   |  ✅   | Clic droit, touche Menu, Maj+F10.                                                                                |
| Mode tableur pur                      |  ✅   |  ✅   |                                                                                                                  |
| Totaux sans double comptage           |  ✅   |  ✅   | Lignes de total exclues des agrégats ; marquer / démarquer une ligne de total depuis le menu.                    |

## Airtable

| Fonction                         | Avant | Après | Remarques                                                                                                         |
| -------------------------------- | :---: | :---: | ----------------------------------------------------------------------------------------------------------------- |
| Champs typés, badges, avatars    |  ✅   |  ✅   |                                                                                                                   |
| Éditeur de champ                 |  ❌   |  ✅   | Avant : renommer et supprimer seulement ; impossible de changer le type, les choix ou la formule d'une colonne.   |
| Changer le type d'un champ       |  ❌   |  ✅   | Valeurs retapées dans le nouveau type ; non convertibles gardées telles quelles ; annulable.                      |
| Choix colorés                    |  ⚠️   |  ✅   | Avant : fixés à la création. Après : ajout, couleur, ordre, préréglage « Statuts Atelier », création à la saisie. |
| Collaborateurs                   |  ⚠️   |  ✅   | Avant : impossible d'en ajouter depuis l'interface.                                                               |
| Champs masqués                   |  ❌   |  ✅   | Le modèle existait, sans interface ni effet.                                                                      |
| Filtres                          |  ❌   |  ✅   | Le modèle existait, sans interface ni effet. Conditions selon le type, cumulées (ET).                             |
| Tri                              |  ❌   |  ✅   | Multiple ; statuts dans l'ordre des choix ; n'affecte que l'affichage.                                            |
| Recherche dans la vue            |  ❌   |  ✅   | Sans accents ni casse, ⌘F.                                                                                        |
| Kanban                           |  ❌   |  ✅   | Écran « arrive bientôt » → colonnes par statut, glisser-déposer, cartes, total par colonne, nouvelle carte.       |
| Fiche détaillée (enregistrement) |  ❌   |  ✅   | Espace ou double-clic sur le numéro : tous les champs, ligne précédente / suivante, dupliquer, supprimer.         |
| Hauteur des lignes               |  ❌   |  ✅   | Compacte, standard, haute (texte sur plusieurs lignes).                                                           |
| Résumé de colonne                |  ⚠️   |  ✅   | Avant : somme seulement. Après : somme, moyenne, min, max, nombres, remplies, vides.                              |
| Recherche rapide ⌘K              |  ❌   |  ✅   | Annoncée dans le README mais absente ; palette de commandes (tables et actions).                                  |
| Renommer tables et projets       |  ❌   |  ✅   | Double-clic dans la barre latérale ou sur le titre.                                                               |

## Ce qui reste à faire

- **Regroupement en grille** (« Grouper par » d'Airtable dans la vue Grille) : seul le Kanban regroupe.
- **Vues multiples nommées** : une vue par mode (Grille, Tableur, Kanban) ; pas encore de vues
  personnalisées supplémentaires.
- **Filtres en OU** et groupes de conditions.
- **Champs liés** entre tables, pièces jointes, texte long riche, URL, e-mail.
- **Références entre tables** dans les formules ; arguments omis (`;;`) ; formules matricielles.
- **Tests de bout en bout** dans un vrai navigateur (Playwright est installé mais inutilisé) et
  captures d'écran clair / sombre de la nouvelle interface.

## Défauts corrigés au passage

- Clic sur une autre cellule pendant une saisie : l'éditeur restait ouvert sur l'ancienne cellule.
- Suppression d'une colonne sans confirmation ni retour possible.
- Suppression d'une ligne par la corbeille au survol, trop facile à déclencher, sans retour.
- La recherche ⌘K et la vue Kanban étaient annoncées dans le README sans exister.
