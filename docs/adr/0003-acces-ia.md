# ADR 0003 — Accès des IA aux données (Claude Code, Ollama)

**Statut** : accepté · **Date** : 2026-10-19

## Contexte

Claude Code et un modèle local (Ollama) doivent pouvoir tout faire dans Atelier_Tab : lire, modifier, organiser, exporter. Jusqu'ici, les données de l'app de bureau vivaient dans IndexedDB, un format interne illisible pour un outil extérieur.

## Décision

1. **Données en fichiers JSON** dans `~/Atelier_Tab` : `atelier.json` et un fichier par table. Ce dossier est dans le dossier personnel plutôt que dans Documents : macOS ne demande pas d'autorisation d'accès, ni à l'app ni au Terminal. Il est surveillé par l'app, qui se met à jour en direct. La lecture est tolérante (ligne absente de `rowOrder`, table non déclarée dans son projet), et un fichier invalide n'est jamais écrasé. Les données IndexedDB existantes sont migrées au premier lancement.
2. **Un seul jeu d'outils** (`src/ai/tools.ts`) qui passe par les actions du store. Une IA bénéficie donc des mêmes règles que la grille : saisie « 45 000 € », formules réécrites à l'insertion d'une ligne, totaux étendus, validation de l'export.
3. **Claude Code** : serveur MCP stdio, construit en un seul fichier et livré dans l'app. Il est exécuté par le binaire de l'app en mode Node (`ELECTRON_RUN_AS_NODE`) via un lanceur shell. Ce lanceur évite de dépendre d'un Node installé et de l'option `--env` de `claude mcp add`.
4. **Ollama** : Ollama ne parle pas MCP. L'app joue donc le rôle d'agent : panneau Assistant, boucle d'appels d'outils sur `/api/chat`, requêtes relayées par le processus principal (pas de contrainte CORS).

## Conséquences

- Les fichiers peuvent aussi être édités à la main ou par Claude Code sans MCP. Le `CLAUDE.md` écrit dans le dossier décrit le format.
- Écritures concurrentes : chaque écrivain ne réécrit que les tables modifiées et relit avant d'agir (MCP) ou dès qu'un fichier change (app). Une modification simultanée de la _même_ table par l'app et une IA garde la dernière écriture.
- Le jeton du webhook n'est pas dans le dossier partagé (`~/Library/Application Support/Atelier_Tab/secrets.json`, mode 600).
- La qualité de l'assistant Ollama dépend du modèle. Il faut un modèle avec la capacité « tools » (`qwen3:8b` recommandé) ; l'interface masque les autres.
