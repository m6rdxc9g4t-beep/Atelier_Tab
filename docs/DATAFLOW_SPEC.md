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
| `import/`                     | Import CSV : lecture, analyse, inférence des types, plan de correspondance, changements à appliquer (voir « Import CSV »)                                            |

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

- `POST` JSON vers l'adresse configurée (https obligatoire ; `http://localhost` et `http://127.0.0.1` acceptés pour cette machine). Redirections jamais suivies.
- **Hors ligne** (mode par défaut, SUITE.md §5.4) : seules les adresses de cette machine sont admises, quel que soit le chemin (dialogue, assistant, serveur MCP, relais du processus principal).
- En-têtes : `Content-Type: application/json`, `Idempotency-Key` (identique pour toutes les tentatives d'un même envoi), `X-Atelier-Schema-Version: 2.1.0`, `Authorization: Bearer <jeton>` si un jeton est renseigné **et** que l'adresse est la route d'import d'Atelier Projets locale (`http(s)://127.0.0.1|localhost/api/imports/atelier-tab[/preview]`) ; jamais vers une autre adresse.
- Demandé par l'assistant de l'app, un envoi (ou le réglage d'une adresse) hors de cette machine attend la confirmation de l'utilisateur dans le panneau.
- 3 tentatives au plus, avec délai exponentiel (0,5 s puis 1 s), sur erreur réseau, `429` et `5xx`. Les autres erreurs (`4xx`) sont rapportées immédiatement avec un message explicite.
- L'adresse, le projet cible et le jeton sont enregistrés avec les données (navigateur : IndexedDB ; app de bureau : `atelier.json`, sauf le jeton, rangé à part).
- Réponse : un corps JSON d'erreur `{ message }` est ajouté au message affiché ; un résumé d'import d'Atelier Projets est lu (voir ci-dessous).

## Import dans Atelier Projets (Suite Atelier)

Atelier Projets importe l'enveloppe telle quelle (contrat complet : `docs/SUITE.md` §4.1).

- **Préréglage « Atelier Projets (local) »** : `http://127.0.0.1:3000/api/imports/atelier-tab` (bouton du dialogue d'export, ou outil IA `configure_export`, `preset: "atelier-projets-local"`). Proposé par défaut : en mode « Envoi direct », si aucune adresse n'est enregistrée, le dialogue la pré-remplit et l'enregistre (préréglage actif) ; une adresse déjà enregistrée n'est jamais remplacée.
- **Projet cible** facultatif : ajouté en `?projectId=<id>`. Sans lui, Projets range les éléments dans le projet dont le nom est `project.name` (créé au besoin), sous Phase « Imports Atelier Tab » › Epic `<workspace.name>` › Story `<source_table.name>`.
- **Correspondance** : `entity_title` → titre (ligne ignorée si vide), `workflow_state` → statut (libellés communs §1.4 de SUITE.md ; inconnu → `OPEN`), `start_date` / `due_date` → dates, `description` → description, autres rôles → tableau Markdown ajouté à la description. Utiliser les libellés « Statuts Atelier » garantit une correspondance exacte des statuts.
- **Identité** : `externalRef = "atelier-tab:<source_table.id>:<record_id>"` ; un réimport met à jour au lieu de dupliquer. L'en-tête `Idempotency-Key` rend un renvoi sans effet.
- **Résumé** : la réponse `{ projectId, storyId, created, updated, unchanged, skipped, warnings, items }` est affichée dans le dialogue (compteurs et avertissements) et renvoyée par l'outil `export_table` (`atelier_projets`).
- **Origine des requêtes** : Projets n'accepte en CORS que `http://127.0.0.1:*` et `http://localhost:*`, plus les appels sans en-tête `Origin` (relais du processus principal, scripts locaux). L'origine `null` est refusée (n'importe quelle page peut l'envoyer : iframe sandbox, URL `data:`, fichier local) ; aucun chemin de Tab n'en dépend.
  - Navigateur (`npm run dev` / `preview`, origine `http://127.0.0.1:5175` ou `:4175`) : `fetch` direct.
  - App de bureau : la page a l'origine `app://atelier` (protocole privé), refusée par Projets (403), et sa politique de contenu n'admet que cette machine. Tout envoi webhook passe donc par le processus principal (IPC `webhook:post`), sans en-tête `Origin`, comme un script local. Le relais revérifie l'adresse (https, ou http vers cette machine ; sans identifiants), le mode hors ligne (fichier de préférences) et la règle du jeton, ne transmet que les en-têtes du contrat, ne suit aucune redirection et ne répond qu'à l'interface de l'app (cadre `app://atelier/…`, contrôlé par `desktop/ipc-guard.ts`).
  - Jeton : si Projets est configuré avec `ATELIER_IMPORT_TOKEN`, un appel relayé (sans `Origin`) est un appel externe et doit porter `Authorization: Bearer <jeton>` (champ « Jeton d'accès » du dialogue).

## Import CSV

Entrées : bouton **Importer** de l'en-tête (table ouverte ou nouvelle table), icône d'import d'un projet dans la sidebar (nouvelle table), fichier glissé sur la zone de travail, cellules collées depuis Excel dans l'assistant, outil IA `import_csv`.

### Lecture (`import/csv-parse.ts`, `import/analyze.ts`)

- **Encodage** : BOM UTF-8 ou UTF-16 ; sinon UTF-8 strict, et à défaut Windows-1252 (exports d'Excel sous Windows).
- **Séparateur** : ligne `sep=;` d'Excel si présente ; sinon celui qui donne le même nombre de colonnes (au moins deux) sur le plus de lignes de l'échantillon (64 Ko). Égalité : `;`, `,`, tabulation, `|`. Le point (exports OpenProject) n'est retenu qu'en dernier recours, si aucun séparateur usuel ne découpe le fichier et qu'il le découpe en au moins 3 colonnes sur 90 % des lignes. Modifiable dans l'assistant, qui prévient quand une seule colonne est détectée.
- **Découpage** RFC 4180 : guillemets doublés, séparateurs et retours à la ligne dans les cellules entre guillemets. Lignes vides ignorées ; lignes courtes complétées.
- **En-têtes** : vides → « Colonne N », doublons → « Montant (2) ». Option « sans ligne d'en-tête ».
- **Limites** : 20 Mo par fichier (interface), 10 millions de caractères (outil IA), 50 000 lignes, 200 colonnes.
- **CSV enrichi d'Atelier Tab** reconnu (`Ligne`, `Identifiant`, `C · Libellé`, `C · Libellé (formule)`) : libellés sans la lettre, formule à la place de la valeur calculée quand il y en a une, identifiants de lignes repris.

### Types et rôles (`import/infer.ts`)

Type le plus précis compatible avec les valeurs non vides : date (`18/10/2026`, ISO), case à cocher (`Oui/Non`, `Vrai/Faux`, `x` ; une colonne de `0/1` reste un nombre), pourcentage (majorité de `%`), devise (`€ $ £ CHF`, ou en-tête de montant : prix, coût, HT, TTC…), nombre (`45 000,50`, `1.234,56`), responsable (noms ou initiales des collaborateurs), statut (uniquement des statuts de workflow, ou au plus 24 libellés répétés de 80 caractères au plus), sinon texte. À partir de 10 valeurs, 90 % de nombres ou de dates suffisent : les autres valeurs sont signalées. Un statut ne contenant que des statuts de workflow suit l'ordre du workflow, avec les couleurs officielles.

Rôles `atelier_projets` proposés une fois chacun, d'après le type et l'en-tête (`Statut` → `workflow_state`, `Échéance` → `due_date`, `TTC` → `financial_ttc`…), sans reprendre un rôle déjà porté par la table ; repli : premier texte → `entity_title`, premier statut → `workflow_state`, première devise → `financial_ht`.

### Correspondance et application (`import/build.ts`, `import/apply.ts`)

- **Nouvelle table** : une colonne par colonne du fichier (renommable, type modifiable, ou ignorée). Vue Grille, et Kanban sur la colonne de statut.
- **Table existante** : une colonne au libellé identique (sans casse ni accents) est remplie, les autres deviennent de nouvelles colonnes. Les colonnes-formules ne sont jamais remplies par un import.
- **Ajout** : lignes insérées au-dessus de la première ligne de total, en une seule opération (`insertRecords`) : les plages des totaux s'étendent, une seule réécriture des formules.
- **Mise à jour** : par colonne clé (valeur convertie comparée sans casse ni accents) ou par `Identifiant` (CSV enrichi réimporté dans sa table, proposé d'office). Ligne reconnue : ses cellules sont remplacées, une cellule vide du fichier n'efface rien. Ligne non reconnue : ajoutée.
- **Conversion** : règles de saisie de la grille (`parseUserInput`). Valeur refusée : cellule laissée vide, signalée (ligne, colonne, raison) avant l'import et dans le bilan. Libellé inconnu d'un statut existant : ajouté à ses choix.
- **Formules** (`=…`) : recopiées comme un copier-coller Excel, les références relatives suivent l'écart entre la ligne du fichier et la ligne d'arrivée. Le moteur maison les évalue sans `eval()` ; elles ne peuvent lire que la table.
- **Une seule mise à jour du store** (`importIntoTable`, `createTableFromImport`) : un seul recalcul, un seul enregistrement.

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
