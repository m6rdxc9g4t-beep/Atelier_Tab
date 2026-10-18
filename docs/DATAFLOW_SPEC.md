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
