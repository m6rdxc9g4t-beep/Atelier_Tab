/** API publique de DataFlow : export d'une table vers `atelier_projets`. */
export {
  ATELIER_SCHEMA_VERSION,
  atelierPayloadSchema,
  atelierMappingSchema,
  type AtelierPayload,
  type AtelierColumn,
  type AtelierRecord,
} from './schema/atelier.v2_1'
export {
  buildAtelierPayload,
  buildColumns,
  rawText,
  type ExportOptions,
  type SheetReader,
} from './mappers/toAtelierPayload'
export {
  validatePayload,
  type ExportStatus,
  type ValidationIssue,
  type ValidationReport,
} from './validate'
export { toEnrichedCsv } from './transports/csv'
export {
  sendToWebhook,
  isValidWebhookUrl,
  type WebhookConfig,
  type WebhookResult,
} from './transports/webhook'
export { downloadText, exportFilename, slugify } from './transports/download'
