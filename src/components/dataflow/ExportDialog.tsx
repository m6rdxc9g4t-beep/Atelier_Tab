import { useMemo, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  KanbanSquare,
  FileSpreadsheet,
  Loader2,
  OctagonX,
  Send,
  Webhook,
} from 'lucide-react'
import {
  ATELIER_SCHEMA_VERSION,
  isProjetsImportUrl,
  isValidWebhookUrl,
  PROJETS_PRESET_LABEL,
  WEBHOOK_PRESETS,
  type ProjetsImportSummary,
  type ValidationReport,
} from '@/dataflow'
import { prepareExport, runExport, type ExportOutcome } from '@/store/export-actions'
import { useComputed, useDataStore, useUIStore } from '@/store'
import type { AtelierMapping, ExportMethod, Table } from '@/types/domain'
import { Dialog } from '@/components/ui/Dialog'
import { MAPPING_LABELS } from './labels'
import { columnToLetters } from '@/engine/formula'
import { FIELD_ICONS } from '@/lib/field-icons'
import { cn } from '@/lib/cn'

const METHODS: { id: ExportMethod; title: string; detail: string; icon: typeof FileJson }[] = [
  {
    id: 'json',
    title: 'Fichier JSON',
    detail: `DataFlow ${ATELIER_SCHEMA_VERSION} pour Atelier Projets`,
    icon: FileJson,
  },
  {
    id: 'csv',
    title: 'CSV enrichi',
    detail: 'S’ouvre dans Excel, formules incluses',
    icon: FileSpreadsheet,
  },
  {
    id: 'webhook',
    title: 'Envoi direct',
    detail: 'POST vers Atelier Projets ou une autre API',
    icon: Webhook,
  },
]

const ACTION_LABELS: Record<ExportMethod, string> = {
  json: 'Télécharger le JSON',
  csv: 'Télécharger le CSV',
  webhook: 'Envoyer à Atelier Projets',
}

export function ExportDialog({
  table,
  open,
  onClose,
}: {
  table: Table
  open: boolean
  onClose: () => void
}) {
  return open ? <ExportDialogBody table={table} onClose={onClose} /> : null
}

function ExportDialogBody({ table, onClose }: { table: Table; onClose: () => void }) {
  const selection = useUIStore((s) => s.selection)
  const integration = useDataStore((s) => s.integrations.atelierProjets)
  const revision = useComputed((s) => s.revisions[table.id] ?? 0)

  const selectedRow = selection ? table.records[selection.recordId] : undefined
  const selectedIndex = selection ? table.rowOrder.indexOf(selection.recordId) : -1
  const canExportSelection = selectedRow?.kind === 'data'
  const dataRows = table.rowOrder.filter((id) => table.records[id]?.kind === 'data').length

  const [scope, setScope] = useState<'all' | 'selection'>('all')
  const [method, setMethod] = useState<ExportMethod>(integration.webhookUrl ? 'webhook' : 'json')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null)

  const recordIds = scope === 'selection' && selection ? [selection.recordId] : undefined
  const prepared = useMemo(() => {
    void revision
    void table
    return prepareExport(table.id, recordIds)
    // recordIds dérive de scope + selection
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, revision, scope, selection?.recordId])

  const webhookReady = method !== 'webhook' || isValidWebhookUrl(integration.webhookUrl ?? '')
  const blocked = !prepared || prepared.report.status === 'blocked'

  const run = async () => {
    setBusy(true)
    setOutcome(null)
    try {
      setOutcome(await runExport(table.id, method, recordIds))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Exporter vers Atelier Projets"
      description={
        <>
          Table <span className="font-medium text-ink">{table.name}</span>, schéma{' '}
          {ATELIER_SCHEMA_VERSION}. Les lignes de total ne sont pas exportées comme des entités.
        </>
      }
      footer={
        <>
          <div className="min-w-0 flex-1 text-[12px]">
            {outcome ? (
              <span
                role="status"
                className={cn(
                  'flex items-center gap-1.5',
                  outcome.ok ? 'text-success' : 'text-danger',
                )}
              >
                {outcome.ok ? <CheckCircle2 size={14} /> : <OctagonX size={14} />}
                {outcome.message}
              </span>
            ) : (
              <LastExport />
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-lg px-3 text-muted hover:bg-surface-hover hover:text-ink"
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={run}
            disabled={blocked || !webhookReady || busy}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 font-medium text-accent-ink disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : method === 'webhook' ? (
              <Send size={14} />
            ) : (
              <Download size={14} />
            )}
            {ACTION_LABELS[method]}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Section title="Lignes à exporter">
          <div className="flex flex-wrap gap-2">
            <Choice checked={scope === 'all'} onSelect={() => setScope('all')} name="scope">
              Toute la table{' '}
              <span className="text-muted">
                ({dataRows} ligne{dataRows > 1 ? 's' : ''})
              </span>
            </Choice>
            <Choice
              checked={scope === 'selection'}
              onSelect={() => setScope('selection')}
              disabled={!canExportSelection}
              name="scope"
            >
              Ligne sélectionnée{' '}
              <span className="text-muted">
                {canExportSelection ? `(ligne ${selectedIndex + 1})` : '(aucune)'}
              </span>
            </Choice>
          </div>
        </Section>

        <Section title="Format">
          <div className="grid gap-2 sm:grid-cols-3">
            {METHODS.map(({ id, title, detail, icon: Icon }) => (
              <label
                key={id}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3',
                  method === id
                    ? 'border-accent bg-accent-soft'
                    : 'border-line hover:border-line-strong',
                )}
              >
                <input
                  type="radio"
                  name="method"
                  checked={method === id}
                  onChange={() => setMethod(id)}
                  className="sr-only"
                />
                <Icon
                  size={16}
                  className={cn('mt-0.5 shrink-0', method === id ? 'text-accent' : 'text-muted')}
                />
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="block text-[12px] text-muted">{detail}</span>
                </span>
              </label>
            ))}
          </div>
          {method === 'webhook' && <WebhookSettings />}
        </Section>

        <Section title="Correspondance des colonnes">
          <ColumnMapping table={table} />
        </Section>

        {outcome?.summary && <ImportSummary summary={outcome.summary} />}

        <Section title="Vérifications">
          {prepared ? <Report report={prepared.report} /> : null}
        </Section>

        {prepared && (
          <details className="group rounded-lg border border-line">
            <summary className="cursor-pointer px-3 py-2 text-muted select-none hover:text-ink">
              Aperçu du JSON ({prepared.payload.project.records.length} enregistrement
              {prepared.payload.project.records.length > 1 ? 's' : ''})
            </summary>
            <pre className="max-h-72 overflow-auto border-t border-line bg-surface-sunken px-3 py-2 font-mono text-[11.5px] leading-relaxed">
              {JSON.stringify(prepared.payload, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-semibold">{title}</h3>
      {children}
    </section>
  )
}

function Choice({
  checked,
  onSelect,
  disabled,
  name,
  children,
}: {
  checked: boolean
  onSelect: () => void
  disabled?: boolean
  name: string
  children: ReactNode
}) {
  return (
    <label
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        checked ? 'border-accent bg-accent-soft' : 'border-line',
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="accent-[var(--accent)]"
      />
      <span>{children}</span>
    </label>
  )
}

function WebhookSettings() {
  const integration = useDataStore((s) => s.integrations.atelierProjets)
  const save = useDataStore((s) => s.setAtelierIntegration)
  const [url, setUrl] = useState(integration.webhookUrl ?? '')
  const [projectId, setProjectId] = useState(integration.projectId ?? '')
  const invalid = url !== '' && !isValidWebhookUrl(url)
  const projets = isProjetsImportUrl(url)

  const applyPreset = (presetUrl: string) => {
    setUrl(presetUrl)
    save({ webhookUrl: presetUrl })
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] text-muted">Préréglage</span>
        {WEBHOOK_PRESETS.map((preset) => {
          const active = url === preset.url
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              title={preset.url}
              onClick={() => applyPreset(preset.url)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md border px-2',
                active
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-line text-muted hover:border-line-strong hover:text-ink',
              )}
            >
              <KanbanSquare size={13} className={active ? 'text-accent' : undefined} />
              {preset.label}
            </button>
          )
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-muted">Adresse de l’API d’import</span>
          <input
            type="url"
            value={url}
            placeholder="https://atelier-projets.example/api/import"
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => save({ webhookUrl: url.trim() })}
            aria-invalid={invalid}
            className={cn(
              'h-8 rounded-md border bg-surface px-2 outline-none focus:border-accent',
              invalid ? 'border-danger' : 'border-line',
            )}
          />
          {invalid && (
            <span className="text-[12px] text-danger">
              Utilisez une adresse https:// (http://localhost ou http://127.0.0.1 en local)
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] text-muted">Jeton d’accès (facultatif)</span>
          <input
            type="password"
            defaultValue={integration.token ?? ''}
            onBlur={(e) => save({ token: e.target.value.trim() })}
            autoComplete="off"
            className="h-8 rounded-md border border-line bg-surface px-2 outline-none focus:border-accent"
          />
          <span className="text-[12px] text-muted">Conservé sur cet ordinateur uniquement</span>
        </label>
      </div>
      {projets && (
        <label className="flex flex-col gap-1 sm:max-w-[calc(100%-232px)]">
          <span className="text-[12px] text-muted">
            Projet cible dans Atelier Projets (facultatif)
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={projectId}
            placeholder="Identifiant du projet, ex. 3"
            onChange={(e) => setProjectId(e.target.value)}
            onBlur={() => save({ projectId: projectId.trim() })}
            className="h-8 rounded-md border border-line bg-surface px-2 outline-none placeholder:text-faint focus:border-accent"
          />
          <span className="text-[12px] text-muted">
            Vide : projet du même nom que ce projet Atelier Tab, créé au besoin. Réimporter met à
            jour les éléments déjà importés.
          </span>
        </label>
      )}
    </div>
  )
}

/** Résumé renvoyé par Atelier Projets après un envoi direct. */
function ImportSummary({ summary }: { summary: ProjetsImportSummary }) {
  const counts: [string, number][] = [
    ['Créés', summary.created],
    ['Mis à jour', summary.updated],
    ['Inchangés', summary.unchanged],
    ['Ignorés', summary.skipped],
  ]
  return (
    <section
      aria-label={`Résultat de l’import dans ${PROJETS_PRESET_LABEL.replace(' (local)', '')}`}
      className="rounded-lg border border-line bg-surface-sunken p-3"
    >
      <h3 className="mb-2 flex items-center gap-2 font-semibold">
        <KanbanSquare size={15} className="text-accent" />
        Import dans Atelier Projets
        {summary.projectId !== null && (
          <span className="font-normal text-muted">· projet {summary.projectId}</span>
        )}
      </h3>
      <dl className="grid grid-cols-4 gap-2">
        {counts.map(([label, value]) => (
          <div key={label} className="rounded-md border border-line bg-surface px-2.5 py-1.5">
            <dt className="text-[11.5px] text-muted">{label}</dt>
            <dd className="text-[15px] font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {summary.warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-[12px]">
          {summary.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" />
              {w}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function ColumnMapping({ table }: { table: Table }) {
  const updateField = useDataStore((s) => s.updateField)
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      {table.fieldOrder.map((fieldId, i) => {
        const field = table.fields[fieldId]
        if (!field) return null
        const Icon = FIELD_ICONS[field.type]
        return (
          <div
            key={fieldId}
            className="flex items-center gap-3 border-b border-line px-3 py-1.5 last:border-b-0"
          >
            <span className="w-6 text-[11px] font-semibold text-faint tabular-nums">
              {columnToLetters(i)}
            </span>
            <Icon size={13} className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{field.label}</span>
            <select
              value={field.atelierMapping ?? 'custom'}
              onChange={(e) =>
                updateField(table.id, fieldId, { atelierMapping: e.target.value as AtelierMapping })
              }
              aria-label={`Rôle de la colonne ${field.label} dans Atelier Projets`}
              className="h-7 w-48 rounded-md border border-line bg-surface px-1.5 outline-none focus:border-accent"
            >
              {Object.entries(MAPPING_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )
      })}
    </div>
  )
}

function Report({ report }: { report: ValidationReport }) {
  if (report.status === 'ready') {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-ink">
        <CheckCircle2 size={15} className="text-success" />
        Tout est conforme au schéma {ATELIER_SCHEMA_VERSION}.
      </p>
    )
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {report.issues.map((issue) => (
        <li
          key={issue.code}
          className={cn(
            'rounded-lg px-3 py-2',
            issue.level === 'error' ? 'bg-danger/10' : 'bg-warning/15',
          )}
        >
          <span className="flex items-center gap-2">
            {issue.level === 'error' ? (
              <OctagonX size={15} className="shrink-0 text-danger" />
            ) : (
              <AlertTriangle size={15} className="shrink-0 text-warning" />
            )}
            {issue.message}
          </span>
          {issue.details && (
            <span className="mt-0.5 block pl-[23px] text-[12px] text-muted">
              {issue.details.join(', ')}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

function LastExport() {
  const last = useDataStore((s) => s.integrations.atelierProjets.lastExport)
  if (!last) return <span className="text-muted">Aucun export pour l’instant</span>
  const when = new Date(last.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
  return (
    <span className="text-muted">
      Dernier export le {when} : {last.message}
    </span>
  )
}
