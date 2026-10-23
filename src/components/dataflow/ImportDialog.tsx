import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileUp,
  Info,
  Loader2,
  OctagonX,
  RotateCcw,
  Upload,
} from 'lucide-react'
import {
  analyzeCsv,
  columnSample,
  CSV_DELIMITERS,
  CsvImportError,
  DELIMITER_LABELS,
  MAX_IMPORT_ROWS,
  suggestPlan,
  type ColumnTarget,
  type CsvAnalysis,
  type CsvDelimiter,
  type CsvEncoding,
  type ImportPlan,
} from '@/dataflow/import'
import { FIELD_TYPES } from '@/engine/field-types'
import {
  commitImport,
  describeImport,
  isCsvFile,
  lookupContext,
  previewImport,
  readCsvFile,
  tableNameFromFile,
} from '@/store/import-actions'
import { useDataStore, useUIStore } from '@/store'
import type { ImportRequest } from '@/store/ui.store'
import type { FieldType, Table } from '@/types/domain'
import { Dialog } from '@/components/ui/Dialog'
import { FIELD_ICONS } from '@/lib/field-icons'
import { cn } from '@/lib/cn'
import { MAPPING_LABELS } from './labels'

/** Types proposés pour une nouvelle colonne (une formule s'écrit ensuite dans la grille). */
const IMPORT_TYPES: FieldType[] = [
  'text',
  'number',
  'currency',
  'percent',
  'select',
  'date',
  'checkbox',
  'owner',
]

const ENCODING_LABELS: Record<CsvEncoding, string> = {
  'utf-8': 'UTF-8',
  'utf-16le': 'UTF-16',
  'utf-16be': 'UTF-16',
  'windows-1252': 'Windows-1252 (Excel)',
}

interface LoadedFile {
  name: string
  text: string
  encoding?: CsvEncoding
}

async function loadFile(f: File): Promise<LoadedFile | { error: string }> {
  if (!isCsvFile(f)) return { error: `« ${f.name} » n’est pas un fichier CSV (.csv, .tsv ou .txt)` }
  try {
    const { text, encoding } = await readCsvFile(f)
    return { name: f.name, text, encoding }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Lecture impossible' }
  }
}

const fieldClass =
  'h-7 rounded-md border border-line-strong bg-field px-1.5 outline-none focus:border-focus focus:shadow-focus'

/** Assistant d'import CSV, ouvert par `useUIStore.openImport`. */
export function ImportDialog() {
  const request = useUIStore((s) => s.importRequest)
  const close = useUIStore((s) => s.closeImport)
  return request ? <ImportDialogBody request={request} onClose={close} /> : null
}

function ImportDialogBody({ request, onClose }: { request: ImportRequest; onClose: () => void }) {
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [reading, setReading] = useState(Boolean(request.file))

  // Fichier déposé sur l'app : lu dès l'ouverture.
  useEffect(() => {
    const dropped = request.file
    if (!dropped) return
    let cancelled = false
    void loadFile(dropped).then((loaded) => {
      if (cancelled) return
      setReading(false)
      if ('error' in loaded) setReadError(loaded.error)
      else setFile(loaded)
    })
    return () => {
      cancelled = true
    }
  }, [request.file])

  const load = async (f: File) => {
    setReadError(null)
    setReading(true)
    const loaded = await loadFile(f)
    setReading(false)
    if ('error' in loaded) setReadError(loaded.error)
    else setFile(loaded)
  }

  return file ? (
    <MappingStep request={request} file={file} onBack={() => setFile(null)} onClose={onClose} />
  ) : (
    <Dialog
      open
      onClose={onClose}
      title="Importer un fichier CSV"
      description="Export Excel, Airtable, Google Sheets… ou CSV enrichi d’Atelier Tab."
      className="max-w-xl"
    >
      <FilePicker
        reading={reading}
        error={readError}
        onFile={load}
        onPaste={(text) => setFile({ name: 'Données collées', text })}
      />
    </Dialog>
  )
}

function FilePicker({
  reading,
  error,
  onFile,
  onPaste,
}: {
  reading: boolean
  error: string | null
  onFile: (file: File) => void
  onPaste: (text: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [pasted, setPasted] = useState('')

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const f = e.dataTransfer.files[0]
          if (f) onFile(f)
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center',
          over ? 'border-accent bg-accent-soft' : 'border-line-strong',
        )}
      >
        {reading ? (
          <Loader2 size={26} className="animate-spin text-accent-fg" />
        ) : (
          <FileUp size={26} className="text-accent-fg" />
        )}
        <p className="font-medium">Déposez un fichier CSV ici</p>
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-field px-3 hover:bg-surface-hover"
        >
          <Upload size={14} />
          Choisir un fichier…
        </button>
        <input
          ref={input}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          className="sr-only"
          aria-label="Fichier CSV à importer"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onFile(f)
            e.target.value = ''
          }}
        />
        <p className="text-[12px] text-muted">
          Séparateur et encodage détectés (; ou , · UTF-8 ou Windows-1252) · jusqu’à{' '}
          {MAX_IMPORT_ROWS.toLocaleString('fr-FR')} lignes
        </p>
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2">
          <OctagonX size={15} className="shrink-0 text-danger" />
          {error}
        </p>
      )}

      <details className="rounded-lg border border-line">
        <summary className="cursor-pointer px-3 py-2 text-muted select-none hover:text-ink">
          Ou coller des cellules copiées depuis Excel
        </summary>
        <div className="flex flex-col gap-2 border-t border-line p-3">
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            placeholder={'Nom\tMontant\nGros œuvre\t45 000 €'}
            aria-label="Données à importer"
            className="rounded-md border border-line-strong bg-field px-2 py-1.5 font-mono text-[12px] outline-none placeholder:text-faint focus:border-focus focus:shadow-focus"
          />
          <button
            type="button"
            disabled={pasted.trim() === ''}
            onClick={() => onPaste(pasted)}
            className="self-end atelier-btn-primary h-8 rounded-lg px-3 font-medium disabled:opacity-50"
          >
            Continuer
          </button>
        </div>
      </details>
    </div>
  )
}

function MappingStep({
  request,
  file,
  onBack,
  onClose,
}: {
  request: ImportRequest
  file: LoadedFile
  onBack: () => void
  onClose: () => void
}) {
  const table = useDataStore((s) => (request.tableId ? s.tables[request.tableId] : undefined))
  const project = useDataStore((s) => s.projects[request.projectId])
  const [delimiter, setDelimiter] = useState<CsvDelimiter | 'auto'>('auto')
  const [hasHeader, setHasHeader] = useState(true)
  const [destination, setDestination] = useState<'new' | 'table'>(table ? 'table' : 'new')
  const [name, setName] = useState(() => tableNameFromFile(file.name))
  const [busy, setBusy] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)

  const parsed = useMemo((): { analysis: CsvAnalysis } | { error: string } => {
    try {
      return {
        analysis: analyzeCsv(file.text, {
          ...(delimiter === 'auto' ? {} : { delimiter }),
          hasHeader,
          ...(file.encoding ? { encoding: file.encoding } : {}),
        }),
      }
    } catch (e) {
      return { error: e instanceof CsvImportError ? e.message : 'Fichier illisible' }
    }
  }, [file, delimiter, hasHeader])
  const analysis = 'analysis' in parsed ? parsed.analysis : null

  const target: Table | null = destination === 'table' && table ? table : null
  const suggested = useMemo(
    () => (analysis ? suggestPlan(analysis, target, lookupContext()) : null),
    [analysis, target],
  )
  // Plan modifié par l'utilisateur, valable tant que le fichier et la destination ne changent pas.
  const [edited, setEdited] = useState<{ base: ImportPlan; plan: ImportPlan } | null>(null)
  const plan = edited && edited.base === suggested ? edited.plan : suggested
  const updatePlan = (next: ImportPlan) => suggested && setEdited({ base: suggested, plan: next })
  const setTarget = (i: number, t: ColumnTarget) => {
    if (!plan) return
    const targets = plan.targets.map((x, k) => (k === i ? t : x))
    const keyStillValid = typeof plan.key !== 'number' || targets[plan.key]?.kind === 'field'
    updatePlan(keyStillValid ? { ...plan, targets } : { targets, mode: 'append' })
  }

  const deferredPlan = useDeferredValue(plan)
  const result = useMemo(
    () =>
      analysis && deferredPlan ? previewImport(analysis, deferredPlan, target?.id ?? null) : null,
    [analysis, deferredPlan, target],
  )

  const keyOptions = useMemo(() => {
    if (!analysis || !plan || !target) return []
    const opts: { value: string; label: string }[] = []
    if (analysis.idIndex !== undefined) {
      opts.push({ value: 'id', label: 'Identifiant (CSV Atelier Tab)' })
    }
    analysis.columns.forEach((col, i) => {
      const t = plan.targets[i]
      if (t?.kind === 'field') {
        opts.push({ value: String(i), label: target.fields[t.fieldId]?.label ?? col.header })
      }
    })
    return opts
  }, [analysis, plan, target])

  const total = result ? result.inserted + result.updated : 0
  const canImport = Boolean(analysis && plan && result && total > 0) && !busy

  const run = () => {
    if (!analysis || !plan) return
    setBusy(true)
    setCommitError(null)
    try {
      commitImport(
        analysis,
        plan,
        target
          ? { kind: 'table', tableId: target.id }
          : { kind: 'new', projectId: request.projectId, name },
      )
      onClose()
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'Import impossible')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Importer un fichier CSV"
      description={
        <>
          <span className="font-medium text-ink">{file.name}</span>
          {analysis && (
            <>
              {' '}
              · {analysis.rows.length.toLocaleString('fr-FR')} ligne
              {analysis.rows.length > 1 ? 's' : ''} · {analysis.columns.length} colonne
              {analysis.columns.length > 1 ? 's' : ''}
              {file.encoding && <> · {ENCODING_LABELS[file.encoding]}</>}
            </>
          )}
        </>
      }
      className="max-w-4xl"
      footer={
        <>
          <div className="min-w-0 flex-1 text-[12px]">
            {commitError ? (
              <span role="alert" className="flex items-center gap-1.5 text-danger">
                <OctagonX size={14} />
                {commitError}
              </span>
            ) : result ? (
              <span className="text-muted max-sm:hidden">{describeImport(result)}</span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onBack}
            className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-muted hover:bg-surface-hover hover:text-ink"
          >
            <RotateCcw size={13} />
            Autre fichier
          </button>
          <button
            type="button"
            onClick={run}
            disabled={!canImport}
            className="flex h-8 items-center gap-1.5 atelier-btn-primary rounded-lg px-3 font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {result?.updated && !result.inserted
              ? 'Mettre à jour'
              : `Importer${total ? ` ${total.toLocaleString('fr-FR')} ligne${total > 1 ? 's' : ''}` : ''}`}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        <Section title="Lecture du fichier">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <label className="flex items-center gap-2">
              <span className="text-muted">Séparateur</span>
              <select
                value={delimiter}
                onChange={(e) => setDelimiter(e.target.value as CsvDelimiter | 'auto')}
                className={fieldClass}
              >
                <option value="auto">
                  Automatique{analysis ? ` · ${DELIMITER_LABELS[analysis.delimiter]}` : ''}
                </option>
                {CSV_DELIMITERS.map((d) => (
                  <option key={d} value={d}>
                    {DELIMITER_LABELS[d]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              La première ligne contient les noms de colonnes
            </label>
          </div>
          {'error' in parsed && (
            <p
              role="alert"
              className="mt-3 flex items-center gap-2 rounded-lg bg-danger/10 px-3 py-2"
            >
              <OctagonX size={15} className="shrink-0 text-danger" />
              {parsed.error}
            </p>
          )}
          {analysis && analysis.columns.length === 1 && analysis.rows.length > 0 && (
            <p
              role="status"
              className="mt-3 flex items-start gap-2 rounded-lg bg-warning/15 px-3 py-2"
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
              Une seule colonne détectée : si votre fichier en a plusieurs, choisissez son
              séparateur ci-dessus.
            </p>
          )}
          {analysis?.enriched && (
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2">
              <Info size={15} className="mt-0.5 shrink-0 text-accent-fg" />
              CSV enrichi d’Atelier Tab reconnu : libellés, formules et identifiants de lignes sont
              repris.
            </p>
          )}
        </Section>

        <Section title="Destination">
          <div className="flex flex-col gap-2">
            <Choice
              name="destination"
              checked={destination === 'new'}
              onSelect={() => setDestination('new')}
            >
              <span className="flex flex-wrap items-center gap-2">
                Nouvelle table dans{' '}
                <span className="font-medium">{project?.name ?? 'le projet'}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onFocus={() => setDestination('new')}
                  aria-label="Nom de la nouvelle table"
                  className={cn(fieldClass, 'w-56 px-2')}
                />
              </span>
            </Choice>
            {table && (
              <Choice
                name="destination"
                checked={destination === 'table'}
                onSelect={() => setDestination('table')}
              >
                Table <span className="font-medium">{table.name}</span>{' '}
                <span className="text-muted">
                  ({table.rowOrder.length} ligne{table.rowOrder.length > 1 ? 's' : ''})
                </span>
              </Choice>
            )}
          </div>
          {target && plan && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line p-3">
              <Choice
                name="mode"
                checked={plan.mode === 'append'}
                onSelect={() => updatePlan({ targets: plan.targets, mode: 'append' })}
              >
                Ajouter toutes les lignes
              </Choice>
              <Choice
                name="mode"
                checked={plan.mode === 'upsert'}
                disabled={keyOptions.length === 0}
                onSelect={() => {
                  const first = keyOptions[0]
                  if (!first) return
                  updatePlan({
                    targets: plan.targets,
                    mode: 'upsert',
                    key: first.value === 'id' ? 'id' : Number(first.value),
                  })
                }}
              >
                Mettre à jour les lignes existantes
              </Choice>
              {plan.mode === 'upsert' && (
                <label className="flex items-center gap-2">
                  <span className="text-muted">reconnues par</span>
                  <select
                    value={String(plan.key ?? '')}
                    onChange={(e) =>
                      updatePlan({
                        ...plan,
                        key: e.target.value === 'id' ? 'id' : Number(e.target.value),
                      })
                    }
                    className={fieldClass}
                  >
                    {keyOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="w-full text-[12px] text-muted">
                {plan.mode === 'upsert'
                  ? 'Les lignes reconnues sont mises à jour (une cellule vide du fichier n’efface rien) ; les autres sont ajoutées.'
                  : keyOptions.length === 0
                    ? 'Pour mettre à jour des lignes existantes, associez une colonne du fichier à une colonne de la table.'
                    : 'Les lignes sont ajoutées au-dessus de la ligne de total, qui les inclut dans ses sommes.'}
              </p>
            </div>
          )}
        </Section>

        {analysis && plan && (
          <Section title="Colonnes">
            <ColumnsMapping analysis={analysis} plan={plan} table={target} onChange={setTarget} />
          </Section>
        )}

        {result && (
          <Section title="Vérifications">
            <Checks result={result} />
          </Section>
        )}
      </div>
    </Dialog>
  )
}

function ColumnsMapping({
  analysis,
  plan,
  table,
  onChange,
}: {
  analysis: CsvAnalysis
  plan: ImportPlan
  table: Table | null
  onChange: (index: number, target: ColumnTarget) => void
}) {
  const samples = useMemo(
    () => analysis.columns.map((col) => columnSample(analysis, col, 3)),
    [analysis],
  )
  const claimed = new Set(plan.targets.flatMap((t) => (t.kind === 'field' ? [t.fieldId] : [])))

  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="grid grid-cols-[minmax(0,0.8fr)_16px_minmax(0,1.7fr)] gap-3 border-b border-line bg-surface-sunken px-3 py-1.5 text-[12px] text-muted">
        <span>Colonne du fichier</span>
        <span />
        <span>Dans Atelier Tab</span>
      </div>
      {analysis.columns.map((col, i) => {
        const t = plan.targets[i] ?? { kind: 'skip' }
        const sample = samples[i] ?? []
        const selectValue = t.kind === 'field' ? `field:${t.fieldId}` : t.kind
        return (
          <div
            key={`${col.index}-${col.header}`}
            className={cn(
              'grid grid-cols-[minmax(0,0.8fr)_16px_minmax(0,1.7fr)] items-center gap-3 border-b border-line px-3 py-2 last:border-b-0',
              t.kind === 'skip' && 'opacity-60',
            )}
          >
            <div className="min-w-0">
              <div className="truncate font-medium" title={col.header}>
                {col.header}
                {col.formulaIndex !== undefined && (
                  <span className="ml-1.5 text-[11px] font-normal text-accent-fg">+ formules</span>
                )}
              </div>
              <div className="truncate text-[12px] text-muted" title={sample.join(' · ')}>
                {sample.length ? sample.join(' · ') : 'vide'}
              </div>
            </div>
            <ArrowRight size={14} className="text-faint" />
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <select
                value={selectValue}
                aria-label={`Destination de la colonne ${col.header}`}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === 'skip') onChange(i, { kind: 'skip' })
                  else if (v === 'new') {
                    onChange(i, { kind: 'new', label: col.header, type: 'text' })
                  } else onChange(i, { kind: 'field', fieldId: v.slice('field:'.length) })
                }}
                className={cn(fieldClass, 'w-52 min-w-0')}
              >
                <option value="new">Nouvelle colonne</option>
                {table && (
                  <optgroup label={`Colonnes de ${table.name}`}>
                    {table.fieldOrder.map((fid) => {
                      const f = table.fields[fid]
                      if (!f || f.type === 'formula') return null
                      const taken = claimed.has(fid) && !(t.kind === 'field' && t.fieldId === fid)
                      return (
                        <option key={fid} value={`field:${fid}`} disabled={taken}>
                          {f.label} · {FIELD_TYPES[f.type].label}
                        </option>
                      )
                    })}
                  </optgroup>
                )}
                <option value="skip">Ne pas importer</option>
              </select>
              {t.kind === 'new' && (
                <>
                  <input
                    value={t.label}
                    onChange={(e) => onChange(i, { ...t, label: e.target.value })}
                    aria-label={`Nom de la nouvelle colonne pour ${col.header}`}
                    className={cn(fieldClass, 'w-36 min-w-0 px-2')}
                  />
                  <TypeSelect
                    value={t.type}
                    label={col.header}
                    onChange={(type) =>
                      // Le rôle proposé dépendait du type : il est retiré.
                      onChange(i, {
                        kind: 'new',
                        label: t.label,
                        type,
                        ...(type === 'currency' ? { currency: t.currency ?? 'EUR' } : {}),
                      })
                    }
                  />
                  {t.mapping && t.mapping !== 'custom' && (
                    <span
                      className="truncate text-[11.5px] text-muted"
                      title="Rôle pour l’export vers Atelier Projets (modifiable ensuite dans l’export)"
                    >
                      {MAPPING_LABELS[t.mapping]}
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TypeSelect({
  value,
  label,
  onChange,
}: {
  value: FieldType
  label: string
  onChange: (type: FieldType) => void
}) {
  const Icon = FIELD_ICONS[value]
  return (
    <span className="relative flex items-center">
      <Icon size={13} className="pointer-events-none absolute left-1.5 text-muted" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as FieldType)}
        aria-label={`Type de la colonne ${label}`}
        className={cn(fieldClass, 'pl-6')}
      >
        {IMPORT_TYPES.map((type) => (
          <option key={type} value={type}>
            {FIELD_TYPES[type].label}
          </option>
        ))}
      </select>
    </span>
  )
}

function Checks({ result }: { result: NonNullable<ReturnType<typeof previewImport>> }) {
  const items: { tone: 'ok' | 'warn' | 'info'; text: ReactNode }[] = []
  if (result.issueCount === 0) {
    items.push({
      tone: 'ok',
      text: 'Toutes les valeurs sont compatibles avec le type de leur colonne.',
    })
  }
  if (result.skipped) {
    items.push({
      tone: 'info',
      text: `${result.skipped} ligne${result.skipped > 1 ? 's' : ''} sans valeur dans les colonnes importées, ignorée${result.skipped > 1 ? 's' : ''}.`,
    })
  }
  if (result.formulas) {
    items.push({
      tone: 'info',
      text: `${result.formulas} formule${result.formulas > 1 ? 's' : ''} : leurs références suivent le décalage de ligne, comme un copier-coller. Vérifiez-les si l’ordre des colonnes diffère.`,
    })
  }
  const added = Object.values(result.changes.addedChoices).flat()
  if (added.length) {
    items.push({
      tone: 'info',
      text: `Statuts ajoutés : ${added.map((c) => c.label).join(', ')}.`,
    })
  }
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <p
          key={i}
          className={cn(
            'flex items-start gap-2 rounded-lg px-3 py-2',
            item.tone === 'ok' ? 'bg-success/10' : 'bg-surface-sunken',
          )}
        >
          {item.tone === 'ok' ? (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" />
          ) : (
            <Info size={15} className="mt-0.5 shrink-0 text-muted" />
          )}
          <span>{item.text}</span>
        </p>
      ))}
      {result.issueCount > 0 && (
        <details className="rounded-lg bg-warning/15">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 select-none">
            <AlertTriangle size={15} className="shrink-0 text-warning" />
            {result.issueCount.toLocaleString('fr-FR')} valeur{result.issueCount > 1 ? 's' : ''}{' '}
            refusée{result.issueCount > 1 ? 's' : ''} : la cellule reste vide. Changez le type de la
            colonne pour les garder.
          </summary>
          <ul className="max-h-48 overflow-auto border-t border-line px-3 py-2 text-[12px]">
            {result.issues.map((issue, i) => (
              <li key={i} className="py-0.5">
                Ligne {issue.row}, <span className="font-medium">{issue.column}</span> :{' '}
                {issue.reason}
              </li>
            ))}
            {result.issueCount > result.issues.length && (
              <li className="py-0.5 text-muted">
                … et {result.issueCount - result.issues.length} autres
              </li>
            )}
          </ul>
        </details>
      )}
    </div>
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
      <span className="min-w-0">{children}</span>
    </label>
  )
}
