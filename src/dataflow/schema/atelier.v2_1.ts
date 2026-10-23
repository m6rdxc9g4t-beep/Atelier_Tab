/**
 * Contrat d'export vers `atelier_projets`, version de schéma 2.1.0.
 * Référence exécutable de docs/DATAFLOW_SPEC.md : tout payload produit par DataFlow
 * est validé par ce schéma avant d'être téléchargé ou envoyé.
 */
import { z } from 'zod'

export const ATELIER_SCHEMA_VERSION = '2.1.0'

export const atelierMappingSchema = z.enum([
  'entity_title',
  'workflow_state',
  'financial_ht',
  'financial_ttc',
  'assignee',
  'due_date',
  'start_date',
  'quantity',
  'description',
  'flag',
  'custom',
  'item_type',
  'time_spent',
])

export const columnTypeSchema = z.enum([
  'text',
  'number',
  'currency',
  'percent',
  'select',
  'date',
  'checkbox',
  'owner',
  'formula',
])

const colLetter = z.string().regex(/^[A-Z]{1,3}$/, 'Lettre de colonne attendue (A, B… AA)')

/** Valeur calculée : nombre, texte, booléen, vide, ou code d'erreur ("#DIV/0!"). */
export const computedValueSchema = z.union([z.number(), z.string(), z.boolean(), z.null()])

export const cellExportSchema = z.object({
  /** Saisie d'origine sous forme de texte, formule incluse ("=C1*1.2"). Vide : "". */
  raw: z.string(),
  computed: computedValueSchema,
})

export const columnSchema = z.object({
  col_letter: colLetter,
  id: z.string().min(1),
  label: z.string(),
  type: columnTypeSchema,
  atelier_mapping: atelierMappingSchema,
})

export const recordSchema = z.object({
  /** Numéro de ligne affiché dans Atelier_Tab (1 = première ligne). */
  row_index: z.number().int().positive(),
  record_id: z.string().min(1),
  values: z.record(colLetter, cellExportSchema),
})

export const atelierPayloadSchema = z.object({
  target_system: z.literal('atelier_projets'),
  schema_version: z.literal(ATELIER_SCHEMA_VERSION),
  exported_at: z.iso.datetime(),
  workspace: z.object({ id: z.string().min(1), name: z.string() }),
  project: z.object({
    id: z.string().min(1),
    name: z.string(),
    /** Extension Atelier_Tab : table d'origine dans le projet. */
    source_table: z.object({ id: z.string().min(1), name: z.string() }).optional(),
    summary_metrics: z.object({
      total_rows: z.number().int().nonnegative(),
      /** Somme des colonnes numériques, lignes de total exclues. */
      computed_totals: z.record(colLetter, z.number()),
    }),
    columns_schema: z.array(columnSchema).min(1),
    records: z.array(recordSchema),
    /** Extension Atelier_Tab : lignes de total, exportées à part des enregistrements. */
    summary_rows: z.array(recordSchema).optional(),
  }),
})

export type AtelierPayload = z.infer<typeof atelierPayloadSchema>
export type AtelierColumn = z.infer<typeof columnSchema>
export type AtelierRecord = z.infer<typeof recordSchema>
