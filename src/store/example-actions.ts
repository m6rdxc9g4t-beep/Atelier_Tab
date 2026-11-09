/**
 * Exemples de la suite : charger ou retirer le projet d'une histoire (`@/examples/suite`, format atelier-exemples/1).
 * Les parts d'histoire sont livrées avec l'app (`exemples-suite/*.json`, chargées à la demande) ; l'écriture passe
 * par les actions du store.
 */
import {
  buildExampleTables,
  isExamplePart,
  storiesFromIndex,
  type ExamplePart,
  type ExampleSource,
  type ExampleStory,
} from '@/examples/suite'
import { useDataStore } from './index'
import { useUIStore } from './ui.store'

const PARTS = import.meta.glob<unknown>('../../exemples-suite/*.json', { import: 'default' })
const INDEX = '../../exemples-suite/index.json'

/** Histoires livrées avec l'app (liste vide si elles n'y sont pas). */
export async function listExampleStories(): Promise<ExampleStory[]> {
  const load = PARTS[INDEX]
  if (!load) return []
  return storiesFromIndex(await load()).filter((h) => !!PARTS[partPath(h.id)])
}

function partPath(id: string): string {
  return `../../exemples-suite/${id}.json`
}

export async function loadExamplePart(id: string): Promise<ExamplePart> {
  const load = PARTS[partPath(id)]
  const part = load ? await load() : null
  if (!isExamplePart(part)) throw new Error('Exemple introuvable dans cette installation.')
  return part
}

/** Source des histoires pour les outils de l'assistant. */
export const bundledExamples: ExampleSource = { list: listExampleStories, load: loadExamplePart }

/** Identifiant du projet de l'histoire s'il est déjà dans Tab. */
export function exampleProjectId(part: Pick<ExamplePart, 'projet'>): string | null {
  return useDataStore.getState().projects[part.projet.id] ? part.projet.id : null
}

/** Charge l'histoire (remplace son projet s'il existe déjà) et ouvre sa première table. */
export function installExample(part: ExamplePart): string | null {
  const tables = buildExampleTables(part)
  useDataStore.getState().installProject({ id: part.espace.id, name: part.espace.nom }, { id: part.projet.id, name: part.projet.nom }, tables)
  const first = tables[0]?.id ?? null
  const ui = useUIStore.getState()
  ui.toggleProject(part.projet.id, true)
  if (first) ui.openTable(first)
  return first
}

/** Retire le projet de l'histoire, et son espace s'il ne contient plus rien. */
export function removeExample(part: ExamplePart): void {
  const data = useDataStore.getState()
  data.deleteProject(part.projet.id)
  const ws = useDataStore.getState().workspaces[part.espace.id]
  if (ws && ws.projectIds.length === 0) data.deleteWorkspace(part.espace.id)
}
