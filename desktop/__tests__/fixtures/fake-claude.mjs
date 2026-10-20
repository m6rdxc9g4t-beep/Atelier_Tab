#!/usr/bin/env node
/**
 * Fausse CLI `claude` pour les tests (aucun réseau). Imite :
 * - `claude auth status` (JSON) et `claude --version` ;
 * - `claude -p --output-format json … [--json-schema …]` : lit la conversation sur l'entrée
 *   standard ; avec un schéma, demande d'abord un outil (add_rows si la demande parle de
 *   « Menuiseries », sinon list_tables), puis répond une fois le résultat de l'outil reçu.
 * Chaque appel est journalisé (JSON par ligne) dans FAKE_CLAUDE_LOG : arguments, dossier de
 * travail et son contenu, variables d'environnement utiles, entrée standard.
 */
import fs from 'node:fs'

const args = process.argv.slice(2)
const log = (entry) => {
  if (!process.env.FAKE_CLAUDE_LOG) return
  fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify(entry) + '\n')
}
const valueOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

if (args[0] === 'auth' && args[1] === 'status') {
  log({ args, cwd: process.cwd() })
  const loggedIn = process.env.FAKE_CLAUDE_LOGGED_OUT !== '1'
  process.stdout.write(
    JSON.stringify(
      { loggedIn, authMethod: loggedIn ? 'claude.ai' : 'none', apiProvider: 'firstParty' },
      null,
      2,
    ) + '\n',
  )
  process.exit(loggedIn ? 0 : 1)
}
if (args[0] === '--version') {
  process.stdout.write('9.9.9 (Claude Code)\n')
  process.exit(0)
}

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (stdin += c))
process.stdin.on('end', async () => {
  log({
    args,
    cwd: process.cwd(),
    cwdEntries: fs.readdirSync(process.cwd()),
    hasApiKey: 'ANTHROPIC_API_KEY' in process.env,
    nonEssential: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
    stdin,
  })
  const sleep = Number(process.env.FAKE_CLAUDE_SLEEP || 0)
  if (sleep) await new Promise((r) => setTimeout(r, sleep))
  const schema = valueOf('--json-schema')
  const system = valueOf('--system-prompt') ?? ''
  let structured
  let result
  if (schema) {
    if (stdin.includes('[Résultat de l’outil')) {
      const added = stdin.includes('[Résultat de l’outil add_rows]')
      structured = {
        action: 'answer',
        text: added
          ? 'J’ai ajouté la ligne « Menuiseries (Claude) » à 12 000 € HT.'
          : 'Voici vos tables : la liste a été lue par l’application.',
      }
    } else if (/Menuiseries/i.test(stdin)) {
      const table = /\(id (tbl_[A-Za-z0-9_-]+)\)/.exec(system)?.[1] ?? 'tbl_planning_lots'
      structured = {
        action: 'tool',
        name: 'add_rows',
        arguments: { table, rows: [{ A: 'Menuiseries (Claude)', C: '12 000' }] },
      }
    } else {
      structured = { action: 'tool', name: 'list_tables', arguments: {} }
    }
    result = JSON.stringify(structured)
  } else {
    result = 'Réponse libre de la fausse CLI.'
  }
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 2,
      result,
      ...(structured ? { structured_output: structured } : {}),
    }) + '\n',
  )
})
