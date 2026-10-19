# Contrat d'export DataFlow → `atelier_projets`

Version de schéma visée : **2.1.0**. Le schéma de référence exécutable vivra dans `src/dataflow/schema/atelier.v2_1.ts` (Zod) ; ce document en est la description lisible.

## Enveloppe

```json
{
  "target_system": "atelier_projets",
  "schema_version": "2.1.0",
  "exported_at": "2026-10-18T12:57:00Z",
  "workspace": { "id": "ws_arch_01", "name": "Espace Architecture" },
  "project": {
    "id": "proj_renovation_2026",
    "name": "Rénovation Urbaine 2026",
    "summary_metrics": {
      "total_rows": 3,
      "computed_totals": { "C": 88500, "D": 106200 }
    },
    "columns_schema": [ … ],
    "records": [ … ]
  }
}
```

## Colonnes (`columns_schema`)

| Clé               | Contenu                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `col_letter`      | Lettre dérivée de la position (`A`, `B`…) au moment de l'export                                              |
| `id`              | Identifiant stable du champ (`cost_ht`)                                                                      |
| `label`           | Libellé affiché                                                                                              |
| `type`            | `text`, `select`, `currency`, `number`, `percent`, `date`, `checkbox`, `owner`, `formula`                    |
| `atelier_mapping` | Rôle côté cible : `entity_title`, `workflow_state`, `financial_ht`, `financial_ttc`, `assignee`, `due_date`… |

## Enregistrements (`records`)

Chaque valeur est exportée sous double forme :

- `raw` : saisie d'origine (chaîne), formule incluse (`"=C1*1.2"`)
- `computed` : valeur évaluée, typée (`54000`, `"En cours"`, `true`), ou chaîne d'erreur (`"#DIV/0!"`)

## Règles retenues

1. **Pas de double comptage.** Les lignes de synthèse (`kind: 'summary'`, ex. « TOTAL TTC ») ne figurent ni dans `records` ni dans `computed_totals`. Elles peuvent être exportées à part dans `project.summary_rows` (optionnel). _L'exemple de la spécification initiale (`computed_totals.C = 194700`) incluait la ligne de total ; la valeur correcte pour les trois lots est 88 500._
2. **HT et TTC en colonnes distinctes.** `C` = coût HT (`currency`), `D` = coût TTC (`formula`, `=C{n}*1.2` par ligne).
3. `row_index` est **1-based** et correspond au numéro de ligne affiché.
4. Une table contenant des erreurs de formule reste exportable, mais la validation le signale (pastille orange dans la sidebar).

## Implémentation (`src/dataflow/`)

| Fichier                       | Rôle                                                                                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema/atelier.v2_1.ts`      | Schéma Zod : tout payload est validé avant téléchargement ou envoi                                                                                                   |
| `mappers/toAtelierPayload.ts` | Table → payload. Lit les valeurs via le moteur (`SheetReader`), jamais via le store                                                                                  |
| `validate.ts`                 | Contrôles : bloquants (schéma, pas de colonne `entity_title`, aucune ligne) et avertissements (cellules en erreur, titres vides, rôle attribué à plusieurs colonnes) |
| `transports/csv.ts`           | CSV enrichi                                                                                                                                                          |
| `transports/webhook.ts`       | Envoi HTTP                                                                                                                                                           |
| `transports/projets.ts`       | Atelier Projets : préréglage d'adresse, `projectId`, lecture du résumé d'import                                                                                      |
| `snapshot.ts`                 | Instantanés pour Atelier Viz : payload sans contrôle bloquant, chemin, empreinte                                                                                     |

### Extensions au schéma 2.1.0

Deux clés facultatives sont ajoutées, ignorables par la cible :

- `project.source_table` : `{ id, name }` de la table exportée (un projet Atelier_Tab peut en contenir plusieurs) ;
- `project.summary_rows` : les lignes de total, au même format que `records`, pour contrôle.

### Valeurs `raw`

`raw` est la saisie vue par le moteur, en texte : libellé du statut (`"En cours"`), nom du responsable, date ISO (`"2026-11-30"`), nombre (`"45000"`), booléen (`"true"`), formule recopiée pour une colonne-formule (`"=C2*1.2"`). Cellule vide : `""`.

### CSV enrichi

- Séparateur `;`, décimales avec virgule, encodage UTF-8 avec BOM : s'ouvre directement dans Excel en français.
- Colonnes : `Ligne`, `Identifiant`, puis une colonne par champ (`C · Coût HT`) avec la valeur calculée, et une colonne `(formule)` pour chaque champ qui contient des formules.
- Les lignes de total ne sont pas incluses.

### Webhook

- `POST` JSON vers l'adresse configurée (https obligatoire ; `http://localhost` et `http://127.0.0.1` acceptés pour cette machine).
- En-têtes : `Content-Type: application/json`, `Idempotency-Key` (identique pour toutes les tentatives d'un même envoi), `X-Atelier-Schema-Version: 2.1.0`, `Authorization: Bearer <jeton>` si un jeton est renseigné.
- 3 tentatives au plus, avec délai exponentiel (0,5 s puis 1 s), sur erreur réseau, `429` et `5xx`. Les autres erreurs (`4xx`) sont rapportées immédiatement avec un message explicite.
- L'adresse, le projet cible et le jeton sont enregistrés avec les données (navigateur : IndexedDB ; app de bureau : `atelier.json`, sauf le jeton, rangé à part).
- Réponse : un corps JSON d'erreur `{ message }` est ajouté au message affiché ; un résumé d'import d'Atelier Projets est lu (voir ci-dessous).

## Import dans Atelier Projets (Suite Atelier)

Atelier Projets importe l'enveloppe telle quelle (contrat complet : `docs/SUITE.md` §4.1).

- **Préréglage « Atelier Projets (local) »** : `http://127.0.0.1:3000/api/imports/atelier-tab` (bouton du dialogue d'export, ou outil IA `configure_export`, `preset: "atelier-projets-local"`).
- **Projet cible** facultatif : ajouté en `?projectId=<id>`. Sans lui, Projets range les éléments dans le projet dont le nom est `project.name` (créé au besoin), sous Phase « Imports Atelier Tab » › Epic `<workspace.name>` › Story `<source_table.name>`.
- **Correspondance** : `entity_title` → titre (ligne ignorée si vide), `workflow_state` → statut (libellés communs §1.4 de SUITE.md ; inconnu → `OPEN`), `start_date` / `due_date` → dates, `description` → description, autres rôles → tableau Markdown ajouté à la description. Utiliser les libellés « Statuts Atelier » garantit une correspondance exacte des statuts.
- **Identité** : `externalRef = "atelier-tab:<source_table.id>:<record_id>"` ; un réimport met à jour au lieu de dupliquer. L'en-tête `Idempotency-Key` rend un renvoi sans effet.
- **Résumé** : la réponse `{ projectId, storyId, created, updated, unchanged, skipped, warnings, items }` est affichée dans le dialogue (compteurs et avertissements) et renvoyée par l'outil `export_table` (`atelier_projets`).
- **Origine des requêtes** : Projets n'accepte en CORS que `http://127.0.0.1:*`, `http://localhost:*` et `null`.
  - Navigateur (`npm run dev` / `preview`, origine `http://127.0.0.1:5175` ou `:4175`) : `fetch` direct.
  - App de bureau : la page a l'origine `app://atelier` (protocole privé), refusée par Projets (403). Une adresse d'import Projets **locale** est donc envoyée par le processus principal (IPC `suite:post`), sans en-tête `Origin`, comme un script local. Le relais n'accepte que `http(s)://127.0.0.1|localhost/api/imports/atelier-tab[/preview]` et ne transmet que les en-têtes du contrat. Toute autre adresse reste un `fetch` de la page.

## Instantanés pour Atelier Viz

L'app de bureau publie dans `~/Atelier_Tab/exports/` un fichier par table, lu par le connecteur « Atelier Tab » de Viz (`docs/SUITE.md` §4.2).

| Point       | Règle                                                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fichier     | `exports/<tableId>.json`, enveloppe DataFlow v2.1.0 de la table entière (`summary_rows` inclus), valeurs `computed` évaluées par le moteur.                                                                                                                                                                                       |
| Contrôles   | Aucun contrôle bloquant de `validate.ts` : une table sans `entity_title`, ou vide, est publiée. Colonne sans rôle : `custom`.                                                                                                                                                                                                     |
| Quand       | Après chaque enregistrement (regroupé sur 1 s), au démarrage, après chaque outil MCP qui modifie des données, et à la fermeture de l'app.                                                                                                                                                                                         |
| Réécriture  | Seules les tables modifiées (table, noms du projet ou de l'espace, collaborateurs) sont recalculées ; un contenu identique n'est pas réécrit, `exported_at` date donc le dernier changement réel.                                                                                                                                 |
| Écriture    | Atomique (fichier temporaire puis renommage).                                                                                                                                                                                                                                                                                     |
| Suppression | Quand la table disparaît (dans l'app, par un autre programme, ou app fermée). Un instantané n'est supprimé que s'il appartient à cette table (`project.source_table.id`) ; les exports manuels `atelier_projets_<table>_<date>.*` du même dossier ne sont jamais touchés. Une table momentanément illisible garde son instantané. |

Architecture : la construction est pure (`src/dataflow/snapshot.ts`, qui crée un `TableSheet` du moteur à partir des données enregistrées) ; l'écriture disque est dans `desktop/snapshots.ts`, appelée par le processus principal (à la réception de `data:save` et des changements externes) et par le serveur MCP. Le rendu n'intervient pas : les valeurs calculées ne dépendent que des fichiers, comme pour le serveur MCP.
