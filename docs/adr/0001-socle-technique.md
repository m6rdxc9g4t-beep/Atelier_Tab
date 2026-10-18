# ADR 0001 — Socle technique

**Statut** : accepté · **Date** : 2026-10-18

## Contexte

Application locale d'abord, très interactive (grille éditable, recalcul instantané), qui doit pouvoir évoluer vers une synchronisation serveur.

## Décision

- **Vite + React 19 + TypeScript strict** plutôt que Next.js : pas de rendu serveur utile pour un outil local, démarrage et rechargement plus rapides.
- **Zustand** pour l'état : sélecteurs fins (une cellule ne se re-rend que si sa valeur change), pas de boilerplate.
- **Moteur de formules maison** plutôt qu'une bibliothèque (HyperFormula, formula.js) : périmètre de fonctions limité et maîtrisé, licence sans contrainte, intégration directe avec les types de colonnes Airtable.
- **Tailwind CSS v4** avec tokens sémantiques (`bg-surface`, `text-muted`…) pour un thème clair/sombre cohérent.
- **IndexedDB** comme stockage par défaut (capacité bien supérieure à `localStorage`).

## Conséquences

- Le moteur de formules doit être couvert par des tests exhaustifs ; c'est la pièce la plus risquée.
- Si le besoin de fonctions Excel s'élargit fortement (finance avancée, dates), réévaluer HyperFormula (licence GPLv3 ou commerciale).
