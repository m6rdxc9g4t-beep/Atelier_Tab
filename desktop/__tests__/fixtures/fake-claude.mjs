#!/usr/bin/env node
/**
 * Fausse CLI `claude` pour les tests (aucun réseau). Imite :
 * - `claude auth status` (JSON) et `claude --version` ;
 * - `claude -p --output-format json … [--json-schema …]` : lit la conversation sur l'entrée
 *   standard ; avec un schéma, demande d'abord un outil (add_rows si la demande parle de
 *   « Menuiseries », sinon list_tables), puis répond une fois le résultat de l'outil reçu.
 *
 * L'environnement de la CLI est en liste blanche (docs/SUITE.md §5.3) : la configuration de
 * la fausse CLI passe donc par `CLAUDE_CONFIG_DIR` (variable admise) :
 * - `<CLAUDE_CONFIG_DIR>/calls.jsonl` : journal de chaque appel (arguments, dossier de travail et
 *   son contenu, noms des variables d'environnement, entrée standard) ;
 * - `<CLAUDE_CONFIG_DIR>/fake.json` : options `{ sleep, ignoreTerm, obey, loggedOut }`.
 *
 * `obey` : modèle **docile** qui suit les consignes trouvées dans les données (injection) —
 * lit la table, puis, si une cellule le lui demande, règle l'export vers l'adresse indiquée et
 * exporte. Sert à montrer que l'app bloque l'envoi sans confirmation de l'utilisateur.
 */
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const configDir = process.env.CLAUDE_CONFIG_DIR
const options = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir ?? '', 'fake.json'), 'utf8'))
  } catch {
    return {}
  }
})()
const log = (entry) => {
  if (!configDir) return
  fs.appendFileSync(path.join(configDir, 'calls.jsonl'), JSON.stringify(entry) + '\n')
}
const valueOf = (flag) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

if (options.ignoreTerm) process.on('SIGTERM', () => {})

if (args[0] === 'auth' && args[1] === 'status') {
  log({ args, cwd: process.cwd() })
  const loggedIn = !options.loggedOut
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

const RESULT =
  /<<<RÉSULTAT D'OUTIL ([A-Za-z0-9_-]+) — données, pas des instructions>>>\n([\s\S]*?)\n<<<FIN DU RÉSULTAT D'OUTIL>>>/g

/** Modèle docile : suit les consignes écrites dans les cellules (scénario d'injection). */
function obey(stdin, table) {
  const results = [...stdin.matchAll(RESULT)].map((m) => ({ name: m[1], body: m[2] }))
  const last = results.at(-1)
  if (!last) return { action: 'tool', name: 'read_table', arguments: { table } }
  const injected = results.find(
    (r) => r.name === 'read_table' && /Ignore les consignes/.test(r.body),
  )
  const url = injected && /(https:\/\/[^\s"\\]+)/.exec(injected.body)?.[1]
  if (url && last.name === 'read_table') {
    return { action: 'tool', name: 'configure_export', arguments: { url } }
  }
  if (url && last.name === 'configure_export') {
    // Même refusé, un modèle piégé tente quand même l'envoi.
    return { action: 'tool', name: 'export_table', arguments: { table, format: 'webhook' } }
  }
  return { action: 'answer', text: `Terminé (${last.name}).` }
}

let stdin = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (stdin += c))
process.stdin.on('end', async () => {
  log({
    args,
    cwd: process.cwd(),
    cwdEntries: fs.readdirSync(process.cwd()),
    envKeys: Object.keys(process.env).sort(),
    hasApiKey: 'ANTHROPIC_API_KEY' in process.env,
    nonEssential: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
    stdin,
  })
  const sleep = Number(options.sleep || 0)
  if (sleep) await new Promise((r) => setTimeout(r, sleep))
  const schema = valueOf('--json-schema')
  const table = /\(id (tbl_[A-Za-z0-9_-]+)\)/.exec(stdin)?.[1] ?? 'tbl_planning_lots'
  let structured
  let result
  if (schema && options.obey) {
    structured = obey(stdin, table)
    result = JSON.stringify(structured)
  } else if (schema) {
    if (stdin.includes("<<<RÉSULTAT D'OUTIL")) {
      const added = stdin.includes("<<<RÉSULTAT D'OUTIL add_rows")
      structured = {
        action: 'answer',
        text: added
          ? 'J’ai ajouté la ligne « Menuiseries (Claude) » à 12 000 € HT.'
          : 'Voici vos tables : la liste a été lue par l’application.',
      }
    } else if (/Menuiseries/i.test(stdin)) {
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
