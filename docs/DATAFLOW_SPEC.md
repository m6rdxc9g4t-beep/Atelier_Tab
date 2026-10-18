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

- `POST` JSON vers l'adresse configurée (https obligatoire, `http://localhost` accepté en développement).
- En-têtes : `Content-Type: application/json`, `Idempotency-Key` (identique pour toutes les tentatives d'un même envoi), `X-Atelier-Schema-Version: 2.1.0`, `Authorization: Bearer <jeton>` si un jeton est renseigné.
- 3 tentatives au plus, avec délai exponentiel (0,5 s puis 1 s), sur erreur réseau, `429` et `5xx`. Les autres erreurs (`4xx`) sont rapportées immédiatement avec un message explicite.
- L'adresse et le jeton sont enregistrés dans le navigateur (IndexedDB), avec les données.
