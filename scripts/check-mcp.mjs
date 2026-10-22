/**
 * Vérifie qu'un lanceur MCP répond : liste ses outils et lit une table.
 * Usage : node scripts/check-mcp.mjs <lanceur> [dossier de données] [-- arguments du lanceur…]
 * Windows : le lanceur peut être un `.cmd` (`resources\atelier-mcp.cmd`, lancé comme le ferait un
 * client MCP) ou `Atelier_Tab.exe` suivi de `-- resources\atelier-mcp.cjs` (avec ELECTRON_RUN_AS_NODE=1).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const argv = process.argv.slice(2)
const sep = argv.indexOf('--')
const launcherArgs = sep >= 0 ? argv.slice(sep + 1) : []
const [launcher, dataDir = mkdtempSync(path.join(os.tmpdir(), 'atelier-check-'))] =
  sep >= 0 ? argv.slice(0, sep) : argv
if (!launcher) {
  console.error(
    'Usage : node scripts/check-mcp.mjs <lanceur> [dossier de données] [-- arguments du lanceur…]',
  )
  process.exit(2)
}

const client = new Client({ name: 'check-mcp', version: '1.0.0' })
await client.connect(
  new StdioClientTransport({
    command: launcher,
    args: launcherArgs,
    env: { ...process.env, ATELIER_TAB_DATA: dataDir },
  }),
)
const { tools } = await client.listTools()
console.log(
  `✓ ${client.getServerVersion()?.name} ${client.getServerVersion()?.version} : ${tools.length} outils`,
)
const res = await client.callTool({ name: 'list_tables', arguments: {} })
console.log(
  `✓ list_tables : ${res.isError ? 'dossier vide (attendu sans données)' : 'données lues'}`,
)
await client.close()

// Outils attendus : ceux déclarés dans src/ai/tools.ts (seule définition des outils), sans chiffre en dur.
const source = readFileSync(new URL('../src/ai/tools.ts', import.meta.url), 'utf8')
const expected = [...source.matchAll(/^\s+name: '([a-z_]+)',$/gm)].map((m) => m[1]).sort()
const served = tools.map((t) => t.name).sort()
const missing = expected.filter((n) => !served.includes(n))
const extra = served.filter((n) => !expected.includes(n))
if (expected.length === 0 || missing.length || extra.length) {
  console.error(
    `✗ outils attendus ${expected.length}, servis ${served.length}` +
      (missing.length ? ` — manquants : ${missing.join(', ')}` : '') +
      (extra.length ? ` — en trop : ${extra.join(', ')}` : ''),
  )
  process.exit(1)
}
console.log(`✓ outils conformes à src/ai/tools.ts (${expected.length})`)
