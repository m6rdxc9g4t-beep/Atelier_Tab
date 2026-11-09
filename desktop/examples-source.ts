/**
 * Exemples de la suite pour le serveur MCP : le dossier `exemples-suite/` du dépôt (format atelier-exemples/1),
 * ou celui de `ATELIER_TAB_EXEMPLES_DIR`. Lecture seule ; un id d'histoire n'est accepté que s'il figure dans
 * l'index, ce qui exclut tout chemin.
 */
import fs from 'node:fs'
import path from 'node:path'
import { isExamplePart, storiesFromIndex, type ExampleSource } from '@/examples/suite'

/**
 * Dossier par défaut : `exemples-suite/` à la racine du dépôt (à côté de `dist-desktop/`), ou à côté
 * du serveur MCP quand il est copié seul (image Docker d'Atelier Nexus).
 */
export function defaultExamplesDir(here: string): string {
  if (process.env.ATELIER_TAB_EXEMPLES_DIR) return process.env.ATELIER_TAB_EXEMPLES_DIR
  const beside = path.join(here, 'exemples-suite')
  return fs.existsSync(path.join(beside, 'index.json'))
    ? beside
    : path.join(here, '..', 'exemples-suite')
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
}

export function folderExamples(dir: string): ExampleSource {
  const stories = () => {
    try {
      return storiesFromIndex(readJson(path.join(dir, 'index.json')))
    } catch {
      return []
    }
  }
  return {
    async list() {
      return stories().filter((s) => fs.existsSync(path.join(dir, `${s.id}.json`)))
    },
    async load(id) {
      if (!stories().some((s) => s.id === id)) throw new Error(`Exemple « ${id} » introuvable`)
      const part = readJson(path.join(dir, `${id}.json`))
      if (!isExamplePart(part)) throw new Error(`Exemple « ${id} » illisible`)
      return part
    },
  }
}
