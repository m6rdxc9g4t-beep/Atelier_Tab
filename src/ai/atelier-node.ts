/**
 * Nœud Atelier (docs/SUITE.md §7, contrat `atelier-node/1`) : ce que Tab décrit à Atelier Nexus.
 *
 * Module pur, partagé par les outils (`tools.ts`), le serveur MCP et le processus principal :
 * - manifeste (`buildManifest`) construit à partir des schémas réels des outils ;
 * - forme des événements et sélection d'une page (`selectEvents`, même réponse que la route
 *   HTTP `GET /api/atelier/events` de Viz et Projets) ;
 * - idempotence des écritures (§7.4) : empreinte canonique de l'entrée et registre en mémoire
 *   (l'app de bureau et le serveur MCP utilisent un registre sur disque, `desktop/atelier-node.ts`).
 *
 * Le manifeste ne contient jamais de donnée utilisateur ni de secret.
 */
import { ATELIER_TABLE_SCHEMA } from '@/dataflow/atelier-table'
import { APP_VERSION } from '@/lib/version'

export const NODE_CONTRACT = 'atelier-node/1'

/** Sous-dossier des métadonnées du nœud, dans `exports/` (jamais une enveloppe DataFlow). */
export const NODE_DIR = '_atelier'

/** Événements gardés dans `events.jsonl`. */
export const EVENTS_RETENTION = 1000
/** Taille de page par défaut et maximale de `atelier_events` (comme la route HTTP, §7.3). */
export const EVENTS_DEFAULT_LIMIT = 100
export const EVENTS_MAX_LIMIT = 500

export type NodeEventType = 'tab.table.changed' | 'tab.table.deleted'

export interface NodeEvent {
  seq: number
  type: NodeEventType | string
  /** Horodatage ISO 8601 avec fuseau. */
  at: string
  subject: { kind: string; id: string; label?: string }
  data: Record<string, unknown>
}

export interface EventsQuery {
  /** Dernier `seq` déjà lu (exclusif). Absent : les plus récents. */
  since?: number
  limit?: number
  types?: string[]
}

export interface EventsResponse {
  events: NodeEvent[]
  next: number
  oldest: number
  gap?: true
}

/**
 * Page d'événements au format §7.3.
 * - `since` exclusif ; sans `since`, les `limit` plus récents (dans l'ordre croissant) ;
 * - `next` = dernier `seq` rendu, sinon `since` (ou le dernier `seq` connu sans `since`) ;
 * - `oldest` = plus ancien `seq` encore gardé (le suivant à venir si le journal est vide) ;
 * - `gap: true` si `since < oldest - 1` (des événements ont été retirés) ou `since > last`
 *   (journal remis à zéro ou remplacé) : relire l'état.
 */
export function selectEvents(
  all: readonly NodeEvent[],
  query: EventsQuery,
  lastSeq: number = all.at(-1)?.seq ?? 0,
): EventsResponse {
  const limit = Math.min(Math.max(1, query.limit ?? EVENTS_DEFAULT_LIMIT), EVENTS_MAX_LIMIT)
  const types = query.types?.length ? new Set(query.types) : null
  const last = Math.max(lastSeq, all.at(-1)?.seq ?? 0)
  const oldest = all[0]?.seq ?? last + 1
  const wanted = types ? all.filter((e) => types.has(e.type)) : all
  let events: NodeEvent[]
  if (query.since === undefined) {
    events = wanted.slice(-limit)
  } else {
    const since = query.since
    events = wanted.filter((e) => e.seq > since).slice(0, limit)
  }
  const next = events.at(-1)?.seq ?? query.since ?? last
  const response: EventsResponse = { events, next, oldest }
  if (query.since !== undefined && (query.since < oldest - 1 || query.since > last)) response.gap = true
  return response
}

/** Horodatage ISO 8601 avec le fuseau de la machine (« 2026-10-21T21:30:00+02:00 »). */
export function isoWithOffset(date: Date): string {
  const pad = (n: number) => String(Math.abs(Math.trunc(n))).padStart(2, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  )
}

// ---------------------------------------------------------------------------
// Idempotence (§7.4)
// ---------------------------------------------------------------------------

/** Rétention des clés d'idempotence (30 jours au moins, §7.4). */
export const IDEMPOTENCY_RETENTION_MS = 30 * 24 * 3600 * 1000

export interface IdempotencyEntry {
  /** Empreinte de l'outil et de l'entrée (sans la clé). */
  fingerprint: string
  /** Réponse rendue au premier appel, rejouée telle quelle. */
  content: string
  /** Date d'enregistrement (ms). */
  at: number
}

/** Registre des clés d'idempotence. Appelé sous le verrou du nœud quand il est sur disque. */
export interface IdempotencyLedger {
  get(key: string): IdempotencyEntry | undefined
  /** Enregistre la réponse d'une clé (la date est posée par le registre). */
  put(key: string, entry: Omit<IdempotencyEntry, 'at'>): void
}

/** JSON canonique : clés triées à tous les niveaux (deux entrées égales ont le même texte). */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/** Empreinte stable d'un appel (outil + entrée), sans module de chiffrement (pur, synchrone). */
export function inputFingerprint(tool: string, input: unknown): string {
  const text = `${tool}\u0000${canonicalJson(input)}`
  // Deux hachages 32 bits indépendants (FNV-1a et Murmur-like) + longueur.
  let h1 = 0x811c9dc5
  let h2 = 0x9747b28c
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193)
    h2 = Math.imul(h2 ^ c, 0x5bd1e995)
    h2 ^= h2 >>> 15
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0')
  return `${hex(h1)}${hex(h2)}-${text.length.toString(16)}`
}

/** Registre en mémoire (assistant de l'app, tests) : rétention de 30 jours, 500 clés au plus. */
export class MemoryLedger implements IdempotencyLedger {
  private readonly entries = new Map<string, IdempotencyEntry>()
  private readonly now: () => number

  constructor(now: () => number = Date.now) {
    this.now = now
  }

  get(key: string): IdempotencyEntry | undefined {
    const e = this.entries.get(key)
    if (e && this.now() - e.at > IDEMPOTENCY_RETENTION_MS) {
      this.entries.delete(key)
      return undefined
    }
    return e
  }

  put(key: string, entry: Omit<IdempotencyEntry, 'at'>): void {
    this.entries.delete(key)
    this.entries.set(key, { ...entry, at: this.now() })
    while (this.entries.size > 500) {
      const first = this.entries.keys().next().value
      if (first === undefined) break
      this.entries.delete(first)
    }
  }
}

// ---------------------------------------------------------------------------
// Manifeste (§7.1)
// ---------------------------------------------------------------------------

export type ActionKind = 'read' | 'write' | 'destructive'
export type Idempotency = 'header' | 'field' | 'natural' | 'none'

export interface ManifestAction {
  id: string
  label: string
  description: string
  kind: ActionKind
  http: null
  mcp_tool: string
  input_schema: Record<string, unknown>
  output: { format: 'atelier-table/1' | 'json'; schema: Record<string, unknown> }
  idempotency: Idempotency
}

export interface ManifestEvent {
  type: NodeEventType
  label: string
  data_schema: Record<string, unknown>
}

export interface AtelierManifest {
  contract: typeof NODE_CONTRACT
  app: 'tab'
  name: string
  version: string
  transport: 'mcp'
  actions: ManifestAction[]
  events: ManifestEvent[]
}

/** Schéma d'un outil, tel que le publie `toolSchemas()`. */
export interface ToolSchemaLike {
  name: string
  parameters: Record<string, unknown>
}

/** Motif des `id` d'action (§7.1). */
export const ACTION_ID = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

interface ActionSpec extends Omit<ManifestAction, 'http' | 'mcp_tool' | 'input_schema'> {
  tool: string
  /** Ajuste le schéma d'entrée de l'outil pour cette action (ex. format imposé). */
  input?: (schema: Record<string, unknown>) => Record<string, unknown>
}

const OBJECT = { type: 'object' } as const

const cellScalar = { type: ['string', 'number', 'boolean', 'null'] }

const ACTIONS: ActionSpec[] = [
  {
    id: 'tables.list',
    tool: 'list_tables',
    label: 'Lister les tables',
    description:
      'Espaces de travail, projets et tables (ids, nombre de colonnes et de lignes), et collaborateurs.',
    kind: 'read',
    output: {
      format: 'json',
      schema: {
        type: 'object',
        properties: {
          workspaces: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                projects: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      name: { type: 'string' },
                      tables: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            id: { type: 'string' },
                            name: { type: 'string' },
                            columns: { type: 'integer' },
                            rows: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          collaborators: { type: 'array', items: OBJECT },
        },
        required: ['workspaces', 'collaborators'],
      },
    },
    idempotency: 'natural',
  },
  {
    id: 'tables.query',
    tool: 'query_table',
    label: 'Interroger une table',
    description:
      'Lignes d’une table avec leurs valeurs calculées (formules évaluées), filtrées et paginées, au format atelier-table/1.',
    kind: 'read',
    output: {
      format: 'atelier-table/1',
      schema: ATELIER_TABLE_SCHEMA as unknown as Record<string, unknown>,
    },
    idempotency: 'natural',
  },
  {
    id: 'tables.create',
    tool: 'create_table',
    label: 'Créer une table',
    description: 'Crée une table dans un projet, avec ses colonnes typées.',
    kind: 'write',
    output: {
      format: 'json',
      schema: {
        type: 'object',
        properties: { table_id: { type: 'string' }, columns: { type: 'array', items: OBJECT } },
        required: ['table_id', 'columns'],
      },
    },
    idempotency: 'field',
  },
  {
    id: 'rows.add',
    tool: 'add_rows',
    label: 'Ajouter des lignes',
    description:
      'Ajoute des lignes à une table (valeurs saisies comme dans la grille), au-dessus de la ligne de total.',
    kind: 'write',
    output: {
      format: 'json',
      schema: {
        type: 'object',
        properties: {
          added: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                row: { type: 'integer' },
                id: { type: 'string' },
                cells: { type: 'object', additionalProperties: cellScalar },
              },
            },
          },
        },
        required: ['added'],
      },
    },
    idempotency: 'field',
  },
  {
    id: 'cells.set',
    tool: 'set_cells',
    label: 'Modifier des cellules',
    description:
      'Écrit des valeurs ou des formules dans des cellules ; renvoie les valeurs recalculées.',
    kind: 'write',
    output: {
      format: 'json',
      schema: {
        type: 'object',
        properties: { updated: { type: 'array', items: OBJECT } },
        required: ['updated'],
      },
    },
    idempotency: 'natural',
  },
  {
    id: 'rows.delete',
    tool: 'delete_rows',
    label: 'Supprimer des lignes',
    description:
      'Supprime des lignes (numéros affichés ou ids) ; les formules qui les lisaient sont ajustées.',
    kind: 'destructive',
    output: {
      format: 'json',
      schema: {
        type: 'object',
        properties: { deleted: { type: 'integer' }, remaining_rows: { type: 'integer' } },
        required: ['deleted', 'remaining_rows'],
      },
    },
    idempotency: 'none',
  },
  {
    id: 'columns.add',
    tool: 'add_column',
    label: 'Ajouter une colonne',
    description: 'Ajoute une colonne typée (texte, nombre, devise, statut, date, formule…).',
    kind: 'write',
    output: {
      format: 'json',
      schema: { type: 'object', properties: { added: OBJECT }, required: ['added'] },
    },
    idempotency: 'field',
  },
  {
    id: 'columns.update',
    tool: 'update_column',
    label: 'Modifier une colonne',
    description:
      'Change le libellé, la formule, les statuts, le format ou le rôle d’export d’une colonne.',
    kind: 'write',
    output: {
      format: 'json',
      schema: { type: 'object', properties: { updated: OBJECT }, required: ['updated'] },
    },
    idempotency: 'natural',
  },
  {
    id: 'formula.evaluate',
    tool: 'evaluate',
    label: 'Calculer une formule',
    description: 'Calcule une formule sur une table sans rien modifier (ex. =SUM(C1:C3)).',
    kind: 'read',
    output: {
      format: 'json',
      schema: {
        type: 'object',
        properties: {
          formula: { type: 'string' },
          value: cellScalar,
          error: { type: 'string' },
        },
        required: ['formula', 'value'],
      },
    },
    idempotency: 'natural',
  },
  {
    id: 'export.to_projets',
    tool: 'export_table',
    label: 'Envoyer à Atelier Projets',
    description:
      'Envoie une table (DataFlow v2.1.0) à l’adresse d’import configurée, Atelier Projets local par défaut ; un nouvel envoi met à jour les éléments déjà importés.',
    kind: 'write',
    input: (schema) => {
      const properties = { ...((schema.properties as Record<string, unknown>) ?? {}) }
      delete properties.path
      properties.format = {
        type: 'string',
        const: 'webhook',
        default: 'webhook',
        description: 'Toujours "webhook" : envoi direct au webhook configuré.',
      }
      return { ...schema, properties }
    },
    output: {
      format: 'json',
      schema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          atelier_projets: OBJECT,
          warnings: { type: 'array', items: { type: 'string' } },
        },
        required: ['message', 'warnings'],
      },
    },
    idempotency: 'natural',
  },
]

export const NODE_EVENTS: ManifestEvent[] = [
  {
    type: 'tab.table.changed',
    label: 'Table modifiée',
    data_schema: {
      type: 'object',
      properties: {
        revision: { type: 'integer', minimum: 1 },
        rows: { type: 'integer', minimum: 0 },
        project: { type: 'string', description: 'Nom du projet de la table' },
      },
      required: ['revision', 'rows', 'project'],
    },
  },
  {
    type: 'tab.table.deleted',
    label: 'Table supprimée',
    data_schema: { type: 'object', properties: {} },
  },
]

/** Outils cités par le manifeste (contrôlé par les tests : chacun existe dans `TOOLS`). */
export const MANIFEST_TOOLS = ACTIONS.map((a) => a.tool)

/**
 * Manifeste du nœud Tab. `schemas` : schémas JSON réels des outils (`toolSchemas()`), repris
 * tels quels comme `input_schema` (propriétés en snake_case).
 */
export function buildManifest(schemas: readonly ToolSchemaLike[]): AtelierManifest {
  const byName = new Map(schemas.map((s) => [s.name, s.parameters]))
  return {
    contract: NODE_CONTRACT,
    app: 'tab',
    name: 'Atelier Tab',
    version: APP_VERSION,
    transport: 'mcp',
    actions: ACTIONS.map(({ tool, input, ...action }) => {
      const schema = byName.get(tool)
      if (!schema) throw new Error(`Manifeste : outil inconnu ${tool}`)
      const copy = structuredClone(schema)
      return {
        ...action,
        http: null,
        mcp_tool: tool,
        input_schema: input ? input(copy) : copy,
      }
    }),
    events: structuredClone(NODE_EVENTS),
  }
}
