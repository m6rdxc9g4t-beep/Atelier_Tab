import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowUp,
  Check,
  CircleAlert,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react'
import {
  CLAUDE_MODELS,
  claudeModelLabel,
  claudeProvider,
  type ClaudeModelAlias,
  type ClaudeStatus,
} from '@/ai/claude'
import {
  ENGINE_CHOICES,
  ollamaLabel,
  privacyNote,
  resolveEngine,
  type EngineState,
} from '@/ai/engine'
import { usesServerOllama, type ModelsResult } from '@/ai/ollama'
import { ENGINE_LABELS, ollamaProvider } from '@/ai/provider'
import { answerConfirmation, askAssistant, cancelAssistant } from '@/store/assistant-actions'
import { useAssistant, type AssistantEntry } from '@/store/assistant.store'
import {
  getClaudeTransport,
  getOllamaTransport,
  refreshClaude,
  refreshAiStatus,
  refreshOllama,
  startAiStatusWatch,
  useAiStatus,
} from '@/store/ai-status.store'
import { useDataStore } from '@/store'
import { cn } from '@/lib/cn'
import { describeToolCall } from './tool-labels'

const SUGGESTIONS = [
  'Résume cette table et ses totaux',
  'Ajoute une ligne « Menuiseries » à 12 000 € HT',
  'Ajoute une colonne Marge = Coût TTC − Coût HT',
  'Cette table est-elle prête pour l’export vers Atelier Projets ?',
]

/**
 * Panneau latéral de l'assistant. Moteur au choix (docs/SUITE.md §5.2) : Ollama (local) ou
 * Claude (CLI de l'app de bureau, en ligne seulement) ; les outils sont toujours exécutés
 * par l'app.
 */
export function AssistantPanel() {
  const close = useAssistant((s) => s.setOpen)
  const model = useAssistant((s) => s.model)
  const setModel = useAssistant((s) => s.setModel)
  const choice = useAssistant((s) => s.engine)
  const setEngine = useAssistant((s) => s.setEngine)
  const claudeModel = useAssistant((s) => s.claudeModel)
  const setClaudeModel = useAssistant((s) => s.setClaudeModel)
  const entries = useAssistant((s) => s.entries)
  const running = useAssistant((s) => s.running)
  const reset = useAssistant((s) => s.reset)
  const ollama = useAiStatus((s) => s.ollama)
  const claude = useAiStatus((s) => s.claude)
  const online = useDataStore((s) => s.preferences?.onlineMode === true)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const claudeTransport = getClaudeTransport()
  useEffect(() => startAiStatusWatch(), [])
  // À chaque ouverture : Ollama a pu être lancé entre-temps (Claude : cache de 60 s).
  useEffect(() => {
    void refreshAiStatus()
  }, [])

  const ollamaReady = ollama?.ok === true && ollama.models.some((m) => m.tools && m.name === model)
  const engine = resolveEngine({
    choice,
    online,
    desktop: claudeTransport !== null,
    claude,
    ollamaReady,
  })

  const provider = useMemo(() => {
    if (engine.engine === 'claude')
      return claudeTransport ? claudeProvider(claudeTransport, claudeModel) : null
    return model ? ollamaProvider(getOllamaTransport(), model) : null
  }, [engine.engine, claudeTransport, claudeModel, model])

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight })
  }, [entries])

  const ready = !engine.down && provider !== null
  const send = (text = draft) => {
    if (!ready || !provider || !text.trim()) return
    setDraft('')
    void askAssistant(text, provider)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  const thinking =
    engine.engine === 'claude' ? `Claude ${claudeModelLabel(claudeModel)}` : (model ?? 'Ollama')

  return (
    <aside
      aria-label="Assistant"
      className="flex w-[380px] shrink-0 flex-col border-l border-line-strong bg-sidebar"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-3">
        <Sparkles size={15} className="text-accent-fg" />
        <span className="flex-1 font-semibold">Assistant</span>
        <button
          type="button"
          onClick={reset}
          disabled={running || entries.length === 0}
          title="Nouvelle conversation"
          aria-label="Nouvelle conversation"
          className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-ink disabled:opacity-40"
        >
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          onClick={() => close(false)}
          aria-label="Fermer l’assistant"
          className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>

      <EnginePicker
        engine={engine}
        onChoose={setEngine}
        disabled={running}
        ollama={ollama}
        model={model}
        onModel={setModel}
        claude={claude}
        claudeModel={claudeModel}
        onClaudeModel={setClaudeModel}
      />

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {entries.length > 0 ? (
          <ol className="flex flex-col gap-3">
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
            {running && (
              <li className="flex items-center gap-2 text-[12px] text-muted">
                <Loader2 size={13} className="animate-spin" /> {thinking} réfléchit…
              </li>
            )}
          </ol>
        ) : engine.engine === 'claude' ? (
          claude === null ? (
            <Checking label="Vérification de Claude…" />
          ) : engine.down ? (
            <ClaudeMissing status={claude} onRetry={() => void refreshClaude(true)} />
          ) : (
            <EmptyState onPick={(s) => send(s)} />
          )
        ) : ollama === null ? (
          <Checking label="Recherche d’Ollama…" />
        ) : !ollama.ok ? (
          <OllamaMissing
            reason={ollama.reason}
            message={ollama.message}
            onRetry={() => void refreshOllama()}
            claudeHint={engine.claudeSelectable ? null : engine.claudeHint}
          />
        ) : !ollama.models.some((m) => m.tools) ? (
          <NoToolModel onRetry={() => void refreshOllama()} hasModels={ollama.models.length > 0} />
        ) : (
          <EmptyState onPick={(s) => send(s)} />
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <div
          className={cn(
            'flex items-end gap-2 rounded-lg border border-line-strong bg-field p-2 focus-within:border-focus focus-within:shadow-focus',
            !ready && 'opacity-60',
          )}
        >
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!ready}
            rows={2}
            placeholder={
              ready ? 'Demandez une modification ou une analyse…' : 'Assistant indisponible'
            }
            aria-label="Message à l’assistant"
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent outline-none placeholder:text-faint"
          />
          {running ? (
            <button
              type="button"
              onClick={() => cancelAssistant()}
              aria-label="Arrêter"
              title="Arrêter"
              className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-hover text-ink"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => send()}
              disabled={!ready || !draft.trim()}
              aria-label="Envoyer"
              title="Envoyer (Entrée)"
              className="grid size-7 shrink-0 place-items-center atelier-btn-primary rounded-md disabled:opacity-40"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}

/**
 * Choix du moteur, mêmes libellés et même disposition que Viz : commande segmentée
 * « Auto · Ollama · Claude », modèle, puis ligne bouclier (ce qui est envoyé).
 */
function EnginePicker({
  engine,
  onChoose,
  disabled,
  ollama,
  model,
  onModel,
  claude,
  claudeModel,
  onClaudeModel,
}: {
  engine: EngineState
  onChoose: (c: EngineState['choice']) => void
  disabled: boolean
  ollama: ModelsResult | null
  model: string | null
  onModel: (m: string) => void
  claude: ClaudeStatus | null
  claudeModel: ClaudeModelAlias
  onClaudeModel: (m: ClaudeModelAlias) => void
}) {
  const label = engine.engine === 'claude' ? 'Claude' : ollamaLabel()
  return (
    <section aria-label="Moteur" className="shrink-0 border-b border-line px-3 pt-2.5 pb-3">
      <h2 className="mb-1.5 text-[12px] font-semibold text-muted">Moteur</h2>
      <div
        role="radiogroup"
        aria-label="Moteur d’IA"
        className="grid grid-cols-3 gap-1 rounded-md border border-line p-0.5 text-[12px]"
      >
        {ENGINE_CHOICES.map((c) => {
          const unavailable = c.value === 'claude' && !engine.claudeSelectable
          const checked = engine.choice === c.value
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-disabled={unavailable || disabled}
              title={unavailable ? (engine.claudeHint ?? undefined) : undefined}
              onClick={() => {
                if (!unavailable && !disabled) onChoose(c.value)
              }}
              className={cn(
                'rounded py-1.5',
                checked ? 'bg-surface-hover font-medium text-ink' : 'text-muted hover:text-ink',
                (unavailable || disabled) && 'cursor-not-allowed opacity-40 hover:text-muted',
              )}
            >
              {c.label}
            </button>
          )
        })}
      </div>

      <label className="mt-2 flex items-center gap-2 text-[12px] text-muted">
        <span className="shrink-0">Modèle</span>
        {engine.engine === 'claude' ? (
          <select
            value={claudeModel}
            onChange={(e) => onClaudeModel(e.target.value as ClaudeModelAlias)}
            disabled={disabled}
            aria-label="Modèle Claude"
            className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-field px-1.5 text-ink outline-none focus:border-focus focus:shadow-focus"
          >
            {CLAUDE_MODELS.map((m) => (
              <option key={m.alias} value={m.alias}>
                {m.label}
              </option>
            ))}
          </select>
        ) : ollama?.ok && ollama.models.length > 0 ? (
          <select
            value={model ?? ''}
            onChange={(e) => onModel(e.target.value)}
            disabled={disabled}
            aria-label="Modèle Ollama"
            className="h-7 min-w-0 flex-1 truncate rounded-md border border-line-strong bg-field px-1.5 text-ink outline-none focus:border-focus focus:shadow-focus"
          >
            {ollama.models.map((m) => (
              <option key={m.name} value={m.name} disabled={!m.tools}>
                {m.name}
                {m.parameters ? ` · ${m.parameters}` : ''}
                {m.tools ? '' : ' (sans outils)'}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 flex-1 truncate text-faint">Aucun modèle Ollama</span>
        )}
      </label>

      <p
        className={cn(
          'mt-2 flex items-start gap-1.5 text-[11.5px] leading-snug',
          engine.down ? 'text-danger' : 'text-muted',
        )}
      >
        {engine.down ? (
          <TriangleAlert size={12} className="mt-px shrink-0" aria-hidden />
        ) : (
          <ShieldCheck size={12} className="mt-px shrink-0" aria-hidden />
        )}
        <span>
          {engine.down
            ? `${label} n’est pas disponible${engine.engine === 'claude' && claude?.detail ? ` : ${claude.detail}` : '.'}`
            : privacyNote(engine.engine)}
        </span>
      </p>
      {!engine.claudeSelectable && engine.claudeHint && (
        <p className="mt-1 pl-[18px] text-[11.5px] leading-snug text-faint">{engine.claudeHint}</p>
      )}
    </section>
  )
}

function Checking({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-muted">
      <Loader2 size={14} className="animate-spin" /> {label}
    </p>
  )
}

function Entry({ entry }: { entry: AssistantEntry }) {
  const tables = useDataStore((s) => s.tables)
  if (entry.kind === 'user') {
    return (
      <li className="ml-8 self-end rounded-lg bg-accent-soft px-3 py-2 whitespace-pre-wrap text-ink">
        {entry.text}
      </li>
    )
  }
  if (entry.kind === 'assistant') {
    return (
      <li className="whitespace-pre-wrap text-ink">
        {entry.text}
        {entry.engine && (
          <span className="mt-1 block text-[10px] tracking-wide text-muted uppercase">
            via {ENGINE_LABELS[entry.engine]}
            {entry.model ? ` · ${entry.model}` : ''}
          </span>
        )}
      </li>
    )
  }
  if (entry.kind === 'error') {
    return (
      <li
        role="alert"
        className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2 text-danger"
      >
        <CircleAlert size={14} className="mt-0.5 shrink-0" />
        <span>{entry.text}</span>
      </li>
    )
  }
  if (entry.kind === 'confirm') return <ConfirmCard entry={entry} />
  const label = describeToolCall(entry.name, entry.args, tables)
  return (
    <li className="text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        {entry.status === 'running' ? (
          <Loader2 size={12} className="shrink-0 animate-spin" />
        ) : entry.status === 'ok' ? (
          <Check size={12} className="shrink-0 text-success" />
        ) : (
          <X size={12} className="shrink-0 text-danger" />
        )}
        <span className="truncate">{label}</span>
      </span>
      {entry.detail && <span className="mt-0.5 block pl-[18px] text-danger">{entry.detail}</span>}
    </li>
  )
}

const CONFIRM_TITLES: Record<ConfirmEntry['request']['kind'], string> = {
  send: 'Envoi hors de cet ordinateur',
  configure: 'Adresse d’envoi hors de cet ordinateur',
  delete: 'Suppression',
}

type ConfirmEntry = Extract<AssistantEntry, { kind: 'confirm' }>

/**
 * Carte « Autoriser / Refuser » : une action de l'assistant qui enverrait des données hors de
 * cet ordinateur ou supprimerait des données attend la décision de l'utilisateur
 * (docs/SUITE.md §5.4). Le texte vient de l'app, l'adresse est affichée telle quelle.
 */
function ConfirmCard({ entry }: { entry: ConfirmEntry }) {
  const { request, status } = entry
  const danger = request.kind === 'delete'
  return (
    <li
      role="group"
      aria-label={`Confirmation : ${CONFIRM_TITLES[request.kind]}`}
      className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-ink"
    >
      <p className="flex items-center gap-1.5 font-medium">
        <ShieldAlert size={14} className="shrink-0 text-warning" aria-hidden />
        {CONFIRM_TITLES[request.kind]}
      </p>
      <p className="mt-1 break-words">{request.message}</p>
      {request.url && (
        <p className="mt-1 font-mono text-[11.5px] break-all text-muted">{request.url}</p>
      )}
      {status === 'pending' ? (
        <div className="mt-2.5 flex gap-2">
          <button
            type="button"
            onClick={() => answerConfirmation(entry.id, true)}
            className={cn(
              'h-7 rounded-md px-3 font-medium',
              danger ? 'bg-danger text-solid-ink' : 'atelier-btn-primary',
            )}
          >
            Autoriser
          </button>
          <button
            type="button"
            onClick={() => answerConfirmation(entry.id, false)}
            className="h-7 rounded-md border border-line px-3 hover:bg-surface-hover"
          >
            Refuser
          </button>
        </div>
      ) : (
        <p className="mt-1.5 text-[12px] text-muted">
          {status === 'allowed' ? 'Autorisé par vous.' : 'Refusé : rien n’a été fait.'}
        </p>
      )}
    </li>
  )
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted">
        L’assistant lit et modifie vos tables avec les mêmes règles que la grille : formules, totaux
        et export vers Atelier Projets.
      </p>
      <ul className="flex flex-col gap-1.5">
        {SUGGESTIONS.map((s) => (
          <li key={s}>
            <button
              type="button"
              onClick={() => onPick(s)}
              className="w-full rounded-lg border border-line px-3 py-2 text-left hover:border-line-strong hover:bg-surface-hover"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OllamaMissing({
  reason,
  message,
  onRetry,
  claudeHint,
}: {
  reason: 'unreachable' | 'error'
  message: string
  onRetry: () => void
  /** Pourquoi Claude n'est pas proposé en remplacement (null : il l'est). */
  claudeHint: string | null
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium text-ink">
        {usesServerOllama()
          ? 'L’IA du serveur ne répond pas'
          : reason === 'unreachable'
            ? 'Ollama n’est pas lancé'
            : 'Ollama ne répond pas correctement'}
      </p>
      {usesServerOllama() ? (
        <p className="text-muted">
          Elle démarre peut-être encore : réessayez dans un instant. Si cela dure, vérifiez le
          service <code className="rounded bg-surface-sunken px-1 font-mono">ollama</code> du
          serveur.
        </p>
      ) : (
        <p className="text-muted">
          Ouvrez l’application Ollama, ou lancez{' '}
          <code className="rounded bg-surface-sunken px-1 font-mono">ollama serve</code> dans le
          Terminal, puis réessayez.
        </p>
      )}
      <p className="text-[12px] text-faint">{message}</p>
      {!claudeHint && (
        <p className="text-[12px] text-muted">Autre moteur : choisissez « Claude » ci-dessus.</p>
      )}
      <RetryButton onRetry={onRetry} />
    </div>
  )
}

function ClaudeMissing({ status, onRetry }: { status: ClaudeStatus; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium text-ink">
        {status.found ? 'Claude n’est pas prêt' : 'Claude Code n’est pas installé'}
      </p>
      <p className="text-muted">{status.detail ?? 'Claude est indisponible.'}</p>
      {!status.found && (
        <p className="text-[12px] text-muted">
          L’assistant appelle la CLI Claude Code de cet ordinateur (votre abonnement). Après
          l’installation, lancez{' '}
          <code className="rounded bg-surface-sunken px-1 font-mono">claude auth login</code> dans
          le Terminal.
        </p>
      )}
      <RetryButton onRetry={onRetry} />
    </div>
  )
}

function NoToolModel({ onRetry, hasModels }: { onRetry: () => void; hasModels: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium text-ink">
        {hasModels ? 'Aucun de vos modèles ne sait utiliser d’outils' : 'Aucun modèle installé'}
      </p>
      <p className="text-muted">
        Pour agir dans vos tables, l’assistant a besoin d’un modèle compatible avec les outils.
        {usesServerOllama() ? ' Sur le serveur :' : ' Dans le Terminal :'}
      </p>
      <code className="rounded-md bg-surface-sunken px-2 py-1.5 font-mono text-[12px]">
        {usesServerOllama() ? 'sudo ./update.sh' : 'ollama pull qwen3:8b'}
      </code>
      <RetryButton onRetry={onRetry} />
    </div>
  )
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="flex h-8 w-fit items-center gap-1.5 rounded-lg border border-line px-3 hover:bg-surface-hover"
    >
      <RefreshCw size={13} /> Réessayer
    </button>
  )
}
