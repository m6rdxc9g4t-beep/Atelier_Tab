import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ArrowUp,
  Check,
  CircleAlert,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { createOllamaTransport, listModels, preferredModel, type ModelsResult } from '@/ai/ollama'
import { askAssistant, cancelAssistant } from '@/store/assistant-actions'
import { useAssistant, type AssistantEntry } from '@/store/assistant.store'
import { useDataStore } from '@/store'
import { cn } from '@/lib/cn'
import { describeToolCall } from './tool-labels'

const SUGGESTIONS = [
  'Résume cette table et ses totaux',
  'Ajoute une ligne « Menuiseries » à 12 000 € HT',
  'Ajoute une colonne Marge = Coût TTC − Coût HT',
  'Cette table est-elle prête pour l’export vers Atelier Projets ?',
]

/** Panneau latéral de l'assistant, branché sur Ollama (modèles locaux). */
export function AssistantPanel() {
  const transport = useMemo(() => createOllamaTransport(), [])
  const close = useAssistant((s) => s.setOpen)
  const model = useAssistant((s) => s.model)
  const setModel = useAssistant((s) => s.setModel)
  const entries = useAssistant((s) => s.entries)
  const running = useAssistant((s) => s.running)
  const reset = useAssistant((s) => s.reset)
  const [models, setModels] = useState<ModelsResult | null>(null)
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const [attempt, setAttempt] = useState(0)

  // Recherche d'Ollama et de ses modèles (à l'ouverture, puis sur « Réessayer »).
  useEffect(() => {
    let alive = true
    void listModels(transport).then((res) => {
      if (!alive) return
      setModels(res)
      if (res.ok) {
        const current = useAssistant.getState().model
        const usable = res.models.filter((m) => m.tools)
        if (!current || !usable.some((m) => m.name === current))
          setModel(preferredModel(res.models) ?? null)
      }
    })
    return () => {
      alive = false
    }
  }, [transport, setModel, attempt])

  const refresh = () => {
    setModels(null)
    setAttempt((n) => n + 1)
  }

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight })
  }, [entries])

  const ready = models?.ok === true && model !== null
  const send = (text = draft) => {
    if (!ready || !text.trim()) return
    setDraft('')
    void askAssistant(text, transport)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  return (
    <aside
      aria-label="Assistant"
      className="flex w-[380px] shrink-0 flex-col border-l border-line bg-surface"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-2 pl-3">
        <Sparkles size={15} className="text-accent" />
        <span className="font-semibold">Assistant</span>
        <ModelPicker models={models} model={model} onChange={setModel} disabled={running} />
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

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {models === null ? (
          <p className="flex items-center gap-2 text-muted">
            <Loader2 size={14} className="animate-spin" /> Recherche d’Ollama…
          </p>
        ) : !models.ok ? (
          <OllamaMissing reason={models.reason} message={models.message} onRetry={refresh} />
        ) : !models.models.some((m) => m.tools) ? (
          <NoToolModel onRetry={refresh} hasModels={models.models.length > 0} />
        ) : entries.length === 0 ? (
          <EmptyState onPick={(s) => send(s)} />
        ) : (
          <ol className="flex flex-col gap-3">
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
            {running && (
              <li className="flex items-center gap-2 text-[12px] text-muted">
                <Loader2 size={13} className="animate-spin" /> {model} réfléchit…
              </li>
            )}
          </ol>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <div
          className={cn(
            'flex items-end gap-2 rounded-lg border border-line bg-surface-raised p-2 focus-within:border-accent',
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
              onClick={() => cancelAssistant(transport)}
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
              className="grid size-7 shrink-0 place-items-center rounded-md bg-accent text-accent-ink disabled:opacity-40"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-faint">
          Modèle local via Ollama : vos données ne quittent pas cet ordinateur.
        </p>
      </div>
    </aside>
  )
}

function ModelPicker({
  models,
  model,
  onChange,
  disabled,
}: {
  models: ModelsResult | null
  model: string | null
  onChange: (m: string) => void
  disabled: boolean
}) {
  if (!models?.ok || models.models.length === 0) return <span className="flex-1" />
  return (
    <select
      value={model ?? ''}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label="Modèle Ollama"
      className="ml-1 h-7 min-w-0 flex-1 truncate rounded-md border border-line bg-surface px-1.5 text-[12px] text-muted outline-none focus:border-accent"
    >
      {models.models.map((m) => (
        <option key={m.name} value={m.name} disabled={!m.tools}>
          {m.name}
          {m.parameters ? ` · ${m.parameters}` : ''}
          {m.tools ? '' : ' (sans outils)'}
        </option>
      ))}
    </select>
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
    return <li className="whitespace-pre-wrap text-ink">{entry.text}</li>
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
}: {
  reason: 'unreachable' | 'error'
  message: string
  onRetry: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium text-ink">
        {reason === 'unreachable' ? 'Ollama n’est pas lancé' : 'Ollama ne répond pas correctement'}
      </p>
      <p className="text-muted">
        Ouvrez l’application Ollama, ou lancez{' '}
        <code className="rounded bg-surface-sunken px-1 font-mono">ollama serve</code> dans le
        Terminal, puis réessayez.
      </p>
      <p className="text-[12px] text-faint">{message}</p>
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
        Pour agir dans vos tables, l’assistant a besoin d’un modèle compatible avec les outils. Dans
        le Terminal :
      </p>
      <code className="rounded-md bg-surface-sunken px-2 py-1.5 font-mono text-[12px]">
        ollama pull qwen3:8b
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
