# ADR 0004 — Nœud Atelier : manifeste, événements et idempotence sans API HTTP

**Statut** : accepté · **Date** : 2026-10-21

## Contexte

Atelier Nexus enchaîne les applications de la suite dans des workflows (docs/SUITE.md §7, contrat `atelier-node/1`). Viz et Projets exposent des routes HTTP ; Tab n'a pas de serveur (hors route de santé) : Nexus lit déjà `~/Atelier_Tab/exports/*.json` et écrit par le serveur MCP stdio. Deux processus peuvent écrire en même temps dans le dossier de données : l'app de bureau et le serveur MCP (lancé par Claude Code ou Nexus).

## Décision

1. **Pas d'API HTTP** : le manifeste, les événements et les tables passent par le serveur MCP (`atelier_manifest`, `atelier_events`, `query_table`) et par des fichiers dans `exports/_atelier/`. Les outils sont ajoutés au jeu unique `src/ai/tools.ts`, donc aussi à l'assistant ; le manifeste réutilise leurs schémas JSON réels (`input_schema`), il ne peut donc pas diverger.
2. **Révision = changement réel du contenu publié** : branchée sur `SnapshotWriter`, qui compare déjà les empreintes. Le journal relit l'instantané sur disque sous le verrou, pour qu'une même publication par les deux écrivains ne compte qu'une fois.
3. **Verrou fichier inter-processus** (`.lock` en `wx`, reprise d'un verrou périmé par renommage) plutôt qu'une dépendance (`proper-lockfile`) : le serveur MCP est livré en un seul fichier et tourne avec le Node d'Electron ; le besoin est simple (sections courtes, deux écrivains). Compteurs (`seq`, `revision`) relus sous le verrou et persistés dans `state.json`.
4. **Idempotence par champ** (`idempotency_key`) sur les écritures qui créent (`add_rows`, `add_column`, `create_table`) ; registre `idempotency.json` sous le même verrou. Les autres écritures sont `natural` (`set_cells`, `update_column`, renvoi à Projets, qui dédoublonne par `externalRef`) ou `none` (`delete_rows`).
5. **Conversion `atelier-table/1`** dans `src/dataflow/atelier-table.ts`, alignée sur l'aplatissement de Viz (`backend/app/services/data/dataflow.py`) ; l'enveloppe DataFlow v2.1.0 n'est pas modifiée.

## Conséquences

- Un consommateur lit le journal sans verrou : chaque fichier est remplacé d'un bloc (écriture atomique).
- Le verrou est consultatif : un programme tiers qui écrit dans `_atelier/` sans le prendre peut perdre des événements ; le guide du dossier (`CLAUDE.md`) demande de ne pas y toucher.
- Un appel MCP avec clé attend le verrou (10 s au plus) ; au-delà, il échoue avec `CONFLICT` sans rien écrire.
- L'assistant de l'app garde ses clés en mémoire (perdues au redémarrage) : le contrat ne vise que les workflows Nexus, qui passent par MCP.
- Les événements ne sont émis que par une publication d'instantané : une modification qui ne change pas l'instantané (vue, largeur de colonne) n'en produit pas.
