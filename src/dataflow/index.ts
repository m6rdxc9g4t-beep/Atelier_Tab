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
  isLoopbackUrl,
  offlineSendMessage,
  tokenAllowedFor,
  urlHost,
  webhookBlockReason,
  type WebhookConfig,
  type WebhookDeps,
  type WebhookFetch,
  type WebhookResult,
} from './transports/webhook'
export {
  PROJETS_LOCAL_IMPORT_URL,
  PROJETS_PRESET_LABEL,
  WEBHOOK_PRESETS,
  defaultWebhookUrl,
  describeProjetsSummary,
  isProjetsImportUrl,
  parseProjetsSummary,
  withProjetsParams,
  type ProjetsImportSummary,
  type WebhookPreset,
} from './transports/projets'
export { downloadText, exportFilename, slugify } from './transports/download'
export {
  SNAPSHOTS_DIR,
  buildSnapshotPayload,
  isSnapshotOf,
  serializeSnapshot,
  sheetFor,
  snapshotFile,
  snapshotFingerprint,
} from './snapshot'
