/**
 * `ClaudeCli` réel (vrai sous-processus, `spawnRunner`) branché sur la fausse CLI
 * `fake-claude.mjs`. Configuration et journal dans `<dir>/cfg` (`CLAUDE_CONFIG_DIR`, seule
 * voie admise par l'environnement en liste blanche).
 *
 * POSIX : le script est lancé tel quel (shebang). Windows : fausse installation npm
 * (`<dir>\npm\claude.cmd`, `node.exe` à côté, `node_modules\@anthropic-ai\claude-code\cli.js`),
 * résolue par `findClaudeExecutable` en `node.exe cli.js` comme la vraie (docs/SUITE.md §9.6).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ClaudeCli, findClaudeExecutable, spawnRunner } from '../../claude-cli'

export const FAKE_CLI = path.join(import.meta.dirname, 'fake-claude.mjs')

export interface FakeCliOptions {
  sleep?: number
  ignoreTerm?: boolean
  obey?: boolean
  loggedOut?: boolean
}

/** Windows : fausse installation npm de Claude Code ; rend le chemin de `claude.cmd`. */
function fakeNpmInstall(dir: string): string {
  const npm = path.join(dir, 'npm')
  const pkg = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code')
  fs.mkdirSync(pkg, { recursive: true })
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"type":"module"}\n')
  fs.copyFileSync(FAKE_CLI, path.join(pkg, 'cli.js'))
  // Jamais exécuté : il suffit qu'il existe (la résolution le remplace par node.exe cli.js).
  fs.writeFileSync(path.join(npm, 'claude.cmd'), '@echo off\r\nexit /b 9\r\n')
  const node = path.join(npm, 'node.exe')
  try {
    fs.linkSync(process.execPath, node)
  } catch {
    fs.copyFileSync(process.execPath, node)
  }
  return path.join(npm, 'claude.cmd')
}

export function fakeCli(dir: string, options: FakeCliOptions = {}, online = () => true) {
  const executable = process.platform === 'win32' ? fakeNpmInstall(dir) : FAKE_CLI
  const config = path.join(dir, 'cfg')
  fs.mkdirSync(config, { recursive: true })
  fs.writeFileSync(path.join(config, 'fake.json'), JSON.stringify(options))
  const log = path.join(config, 'calls.jsonl')
  const cli = new ClaudeCli({
    runner: spawnRunner,
    findExecutable: () =>
      findClaudeExecutable({
        env: { CLAUDE_CLI: executable },
        homedir: os.homedir(),
        platform: process.platform,
        isExecutable: (f) => fs.existsSync(f),
      }),
    isOnline: online,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: 'sk-ne-doit-pas-partir',
      ATELIER_TAB_SECRETS: '/ne/doit/pas/partir',
      CLAUDE_CONFIG_DIR: config,
    },
    tmpRoot: dir,
  })
  const calls = () =>
    fs.existsSync(log)
      ? fs
          .readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as Record<string, unknown>)
      : []
  return { cli, calls }
}
