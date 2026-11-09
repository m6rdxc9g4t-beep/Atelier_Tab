import { useEffect, useState } from 'react'
import { BookOpen, ExternalLink, Trash2 } from 'lucide-react'
import { Dialog } from '@/components/ui/Dialog'
import type { ExamplePart, ExampleStory } from '@/examples/suite'
import { cn } from '@/lib/cn'
import { SUITE_APPS, openSuiteApp } from '@/lib/suite'
import { useDataStore, useUIStore } from '@/store'
import {
  exampleProjectId,
  installExample,
  listExampleStories,
  loadExamplePart,
  removeExample,
} from '@/store/example-actions'
import { useNotices } from '@/store/notices.store'

const APPS: Record<string, string> = {
  convert: 'Convert',
  tab: 'Tab',
  viz: 'Viz',
  tresorerie: 'Trésorerie',
  nexus: 'Nexus',
  projets: 'Projets',
  wiki: 'Wiki',
}
/** Histoire choisie, mémorisée sur l'appareil (clé commune aux apps de la suite servies depuis la même origine). */
const STORAGE_KEY = 'atelier:exemple'

function remembered(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * « Exemples de la suite » : une histoire fictive suivie d'une app à l'autre. Ici, son projet et ses tables : les
 * opérations des relevés convertis par Atelier Convert, catégorisées, et les tables métier de l'histoire.
 */
export function SuiteExamplesDialog() {
  const open = useUIStore((s) => s.examplesOpen)
  const setOpen = useUIStore((s) => s.setExamplesOpen)
  const [stories, setStories] = useState<ExampleStory[]>([])
  const [selected, setSelected] = useState<string | null>(remembered)
  // Partie Tab de l'histoire, rattachée à son identifiant : changer d'histoire n'affiche jamais l'ancienne.
  const [fetched, setFetched] = useState<{
    id: string
    part: ExamplePart | null
    error: string | null
  } | null>(null)
  // Relu pour savoir si le projet de l'histoire est dans Tab (après chargement ou retrait).
  const projects = useDataStore((s) => s.projects)

  useEffect(() => {
    if (open) void listExampleStories().then(setStories, () => setStories([]))
  }, [open])

  const story = stories.find((s) => s.id === selected) ?? stories[0]

  const storyId = story?.id
  useEffect(() => {
    if (!storyId) return
    loadExamplePart(storyId).then(
      (part) => setFetched({ id: storyId, part, error: null }),
      (e: unknown) =>
        setFetched({ id: storyId, part: null, error: e instanceof Error ? e.message : String(e) }),
    )
  }, [storyId])
  const part = fetched?.id === storyId && fetched ? fetched.part : null
  const error = fetched?.id === storyId && fetched ? fetched.error : null

  const close = () => setOpen(false)
  const choose = (id: string) => {
    setSelected(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // stockage indisponible : le choix n'est simplement pas gardé
    }
  }

  const loaded =
    part !== null && projects[part.projet.id] !== undefined && exampleProjectId(part) !== null
  const index = story ? story.parcours.findIndex((e) => e.app === 'tab') : -1
  const current = story?.parcours[index]
  const next = story?.parcours[index + 1]
  const nextApp = next ? SUITE_APPS.find((a) => a.id === next.app) : undefined

  const load = () => {
    if (!part) return
    installExample(part)
    useNotices
      .getState()
      .push({ tone: 'info', title: `Exemple « ${part.histoire.titre} » chargé` }, 4000)
    close()
  }

  const remove = () => {
    if (!part) return
    removeExample(part)
    useNotices
      .getState()
      .push({ tone: 'info', title: `Exemple « ${part.histoire.titre} » retiré` }, 4000)
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Exemples de la suite"
      description="Des histoires fictives qui traversent toute la suite Atelier : les relevés convertis par Convert arrivent ici, catégorisés, avec les tables de l’histoire ; Viz, Trésorerie, Nexus, Projets et Wiki prennent la suite."
      className="w-[min(620px,calc(100vw-2rem))]"
      footer={
        <>
          {loaded && (
            <button type="button" className="btn mr-auto" onClick={remove}>
              <Trash2 size={14} aria-hidden /> Retirer l’exemple
            </button>
          )}
          <button type="button" className="btn" onClick={close}>
            Fermer
          </button>
          <button
            type="button"
            className="atelier-btn-primary inline-flex h-[30px] items-center gap-1.5 rounded-lg px-3 font-medium disabled:opacity-50"
            disabled={!part}
            onClick={load}
          >
            <BookOpen size={14} aria-hidden />{' '}
            {loaded ? 'Recharger l’exemple' : 'Charger l’exemple'}
          </button>
        </>
      }
    >
      {story ? (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            Histoire
            <select
              className="field-input"
              value={story.id}
              onChange={(e) => choose(e.target.value)}
            >
              {stories.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.secteur} · {s.titre}
                </option>
              ))}
            </select>
          </label>
          <div>
            <p className="font-medium text-ink">
              {story.titre} <span className="font-normal text-muted">— {story.sous_titre}</span>
            </p>
            <p className="mt-1 text-[12.5px] text-muted">{story.resume}</p>
          </div>
          <ol className="flex flex-wrap gap-1.5" aria-label="Parcours de l’histoire dans la suite">
            {story.parcours.map((e, i) => (
              <li
                key={e.app}
                title={e.texte}
                aria-current={e.app === 'tab' ? 'step' : undefined}
                className={cn(
                  'inline-flex h-[22px] items-center gap-1.5 rounded-md border px-2 text-[12px]',
                  e.app === 'tab'
                    ? 'border-focus bg-selection text-accent-fg'
                    : 'border-line text-muted',
                )}
              >
                <span className="tabular-nums text-faint">{i + 1}</span>
                {APPS[e.app] ?? e.app}
              </li>
            ))}
          </ol>
          {current && <p className="text-[13px] text-ink">{current.texte}</p>}
          {part && (
            <p className="text-[12px] text-muted">
              Projet « {part.projet.nom} » dans l’espace « {part.espace.nom} » :{' '}
              {part.tables.map((t) => t.nom).join(', ')}.
              {loaded && ' Déjà chargé : recharger remet les tables dans leur état d’origine.'}
            </p>
          )}
          {error && <p className="text-[12px] text-down">{error}</p>}
          {next && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[12.5px] text-muted">
              <p className="min-w-0">
                <span className="font-medium text-ink">Ensuite, {APPS[next.app] ?? next.app}</span>{' '}
                — {next.texte}
              </p>
              {nextApp && (
                <button type="button" className="btn-ghost" onClick={() => openSuiteApp(nextApp)}>
                  Ouvrir Atelier {APPS[next.app]} <ExternalLink size={13} aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-muted">Aucun exemple livré avec cette installation.</p>
      )}
    </Dialog>
  )
}
