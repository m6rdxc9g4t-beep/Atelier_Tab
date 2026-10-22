/**
 * Instantanés pour Atelier Viz (docs/SUITE.md §4.2) : écriture disque.
 *
 * À chaque enregistrement, `exports/<tableId>.json` reçoit l'enveloppe DataFlow de la table
 * (construite par `src/dataflow/snapshot.ts`, fonction pure, avec le moteur de formules).
 *
 * - Écriture atomique (fichier temporaire puis renommage) : Viz ne lit jamais un fichier à moitié écrit.
 * - Seules les tables qui ont changé sont recalculées et réécrites ; un instantané identique
 *   (horodatage mis à part) n'est pas réécrit, pour que `exported_at` reste la date du dernier
 *   changement réel.
 * - Une table supprimée voit son instantané supprimé. Les autres fichiers du dossier (exports
 *   manuels `atelier_projets_…`) ne sont jamais touchés.
 * - `schedule()` regroupe les enregistrements rapprochés (frappe dans la grille) ; `update()`
 *   écrit tout de suite (serveur MCP, fermeture de l'app).
 * - Nœud Atelier (docs/SUITE.md §7.3) : avec un `journal`, chaque publication met à jour
 *   `exports/_atelier/index.json` (révision par table, qui n'augmente que si l'empreinte du
 *   contenu change) et `events.jsonl` (`tab.table.changed` / `tab.table.deleted`). Le
 *   sous-dossier `_atelier/` n'est jamais pris pour un instantané.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  buildSnapshotPayload,
  isSnapshotOf,
  serializeSnapshot,
  SNAPSHOTS_DIR,
  snapshotFile,
  snapshotFingerprint,
} from '@/dataflow/snapshot'
import { isSafeId, tableFile } from '@/storage/format'
import type { AtelierPayload } from '@/dataflow/schema/atelier.v2_1'
import type { AppData } from '@/types/domain'
import type { NodeJournal } from './atelier-node'
import { resolveInside } from './safe-path'

export interface SnapshotWriterOptions {
  /** Dossier de données (~/Atelier_Tab). */
  dir: string
  /** Délai de regroupement des enregistrements (ms). */
  debounceMs?: number
  /** Horloge injectable (tests). */
  now?: () => Date
  /** Erreurs d'écriture (journal du processus principal). */
  onError?: (error: unknown) => void
  /** Index et événements du nœud Atelier (`exports/_atelier/`), mis à jour à chaque publication. */
  journal?: NodeJournal
}

/** Délai par défaut : une rafale de saisies produit une seule écriture. */
export const SNAPSHOT_DEBOUNCE_MS = 1000

const SNAPSHOT_NAME = /^([A-Za-z0-9_-]+)\.json$/

export class SnapshotWriter {
  readonly dir: string
  private readonly debounceMs: number
  private readonly now: () => Date
  private readonly onError: (error: unknown) => void
  private readonly journal: NodeJournal | undefined
  /**
   * Tables à reporter dans l'index du nœud : instantanés écrits ou supprimés par cet écrivain
   * (au premier passage, tous ceux qu'il connaît). Le journal relit l'instantané sur disque.
   */
  private readonly pendingSync = new Set<string>()
  /** Premier passage (ou échec précédent) : l'index est resynchronisé même sans écriture. */
  private needsSync = true
  /** Entrées de la dernière publication, par table (pour ne recalculer que ce qui change). */
  private readonly inputs = new Map<string, string>()
  /** Empreinte de l'instantané sur disque, par table. */
  private readonly published = new Map<string, string>()
  private scanned = false
  private pending: AppData | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(options: SnapshotWriterOptions) {
    this.dir = options.dir
    this.debounceMs = options.debounceMs ?? SNAPSHOT_DEBOUNCE_MS
    this.now = options.now ?? (() => new Date())
    this.onError = options.onError ?? (() => {})
    this.journal = options.journal
  }

  private abs(relative: string): string {
    return path.join(this.dir, relative)
  }

  /**
   * Chemin absolu d'un instantané, vérifié : il doit rester dans `exports/`, quel que soit
   * l'id de table reçu (interface, fichier édité à la main).
   */
  private snapshotPath(relative: string): string {
    return resolveInside(this.abs(SNAPSHOTS_DIR), path.relative(SNAPSHOTS_DIR, relative))
  }

  /** Programme une publication ; seul le dernier état reçu pendant le délai est publié. */
  schedule(data: AppData): void {
    this.pending = data
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.debounceMs)
  }

  /** Publie tout de suite l'état en attente (s'il y en a un). */
  flush(): string[] {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const data = this.pending
    this.pending = null
    if (!data) return []
    try {
      return this.update(data)
    } catch (e) {
      this.onError(e)
      return []
    }
  }

  /** Abandonne une publication programmée (tests, fermeture sans enregistrement). */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending = null
  }

  /**
   * Publie les instantanés de `data` : écrit ceux qui ont changé, supprime ceux des tables
   * disparues. Renvoie les chemins relatifs écrits ou supprimés.
   */
  update(data: AppData): string[] {
    const changed: string[] = []
    fs.mkdirSync(this.abs(SNAPSHOTS_DIR), { recursive: true })
    if (!this.scanned) this.scanDisk(data)

    for (const tableId of Object.keys(data.tables)) {
      if (!isSafeId(tableId)) {
        this.onError(new Error(`Instantané ignoré : id de table refusé "${tableId}"`))
        continue
      }
      const input = inputKey(data, tableId)
      if (input === null || this.inputs.get(tableId) === input) continue
      let payload
      try {
        payload = buildSnapshotPayload(data, tableId, { exportedAt: this.now() })
      } catch (e) {
        // Table orpheline (projet ou espace absent) : rien à publier.
        this.onError(e)
        continue
      }
      this.inputs.set(tableId, input)
      const fingerprint = snapshotFingerprint(payload)
      if (this.published.get(tableId) === fingerprint) continue
      const relative = snapshotFile(tableId)
      this.writeAtomic(relative, serializeSnapshot(payload))
      this.published.set(tableId, fingerprint)
      this.pendingSync.add(tableId)
      changed.push(relative)
    }

    for (const tableId of [...this.published.keys()]) {
      if (data.tables[tableId]) continue
      changed.push(...this.remove(tableId))
    }
    this.syncJournal()
    return changed
  }

  /**
   * Met à jour l'index et les événements du nœud Atelier. Un échec (verrou occupé…) est
   * signalé et repris à la publication suivante ; il n'empêche jamais l'instantané.
   */
  private syncJournal(): void {
    if (!this.journal) return
    if (!this.needsSync && this.pendingSync.size === 0) return
    try {
      this.journal.sync(this.pendingSync)
      this.pendingSync.clear()
      this.needsSync = false
    } catch (e) {
      // Repris à la prochaine publication (verrou occupé trop longtemps…).
      this.needsSync = true
      this.onError(e)
    }
  }

  /** Supprime l'instantané d'une table (s'il s'agit bien d'un instantané de cette table). */
  remove(tableId: string): string[] {
    this.inputs.delete(tableId)
    this.published.delete(tableId)
    if (!isSafeId(tableId)) return []
    const relative = snapshotFile(tableId)
    const target = this.snapshotPath(relative)
    const text = this.read(relative)
    if (text === null || !isSnapshotOf(text, tableId)) return []
    fs.rmSync(target, { force: true })
    this.pendingSync.add(tableId)
    return [relative]
  }

  /**
   * Premier passage : reprend les instantanés déjà sur disque (pour ne pas les réécrire
   * s'ils sont à jour) et note ceux des tables supprimées pendant que l'app était fermée.
   * Un instantané dont le fichier de table existe encore (table momentanément illisible)
   * est conservé.
   */
  private scanDisk(data: AppData): void {
    this.scanned = true
    let names: string[]
    try {
      names = fs.readdirSync(this.abs(SNAPSHOTS_DIR))
    } catch {
      return
    }
    for (const name of names) {
      const tableId = SNAPSHOT_NAME.exec(name)?.[1]
      if (!tableId) continue
      const text = this.read(snapshotFile(tableId))
      if (text === null || !isSnapshotOf(text, tableId)) continue
      if (!data.tables[tableId] && fs.existsSync(this.abs(tableFile(tableId)))) continue
      try {
        this.published.set(tableId, snapshotFingerprint(JSON.parse(text) as AtelierPayload))
        // Premier passage : l'index reprend les instantanés déjà sur disque (sans nouvelle
        // révision si leur contenu n'a pas changé depuis la dernière synchronisation).
        this.pendingSync.add(tableId)
      } catch {
        /* illisible : sera réécrit */
      }
    }
  }

  private read(relative: string): string | null {
    try {
      return fs.readFileSync(this.abs(relative), 'utf8')
    } catch {
      return null
    }
  }

  private writeAtomic(relative: string, content: string): void {
    const target = this.snapshotPath(relative)
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`)
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, target)
  }
}

/**
 * Tout ce dont dépend l'instantané d'une table : la table, ses projet et espace (noms),
 * les collaborateurs (affichés par leur nom). null si la table n'est pas rattachée.
 */
function inputKey(data: AppData, tableId: string): string | null {
  const table = data.tables[tableId]
  const project = table ? data.projects[table.projectId] : undefined
  const workspace = project ? data.workspaces[project.workspaceId] : undefined
  if (!table || !project || !workspace) return null
  return JSON.stringify([
    table,
    project.id,
    project.name,
    workspace.id,
    workspace.name,
    data.collaborators,
  ])
}
