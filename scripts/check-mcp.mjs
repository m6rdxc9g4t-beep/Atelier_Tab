/**
 * Vérifie qu'un lanceur MCP répond : liste ses outils et lit une table.
 * Usage : node scripts/check-mcp.mjs <lanceur> [dossier de données]
 */
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const [launcher, dataDir = mkdtempSync(path.join(os.tmpdir(), 'atelier-check-'))] = process.argv.slice(2)
if (!launcher) {
  console.error('Usage : node scripts/check-mcp.mjs <lanceur> [dossier de données]')
  process.exit(2)
}

const client = new Client({ name: 'check-mcp', version: '1.0.0' })
await client.connect(
  new StdioClientTransport({ command: launcher, args: [], env: { ...process.env, ATELIER_TAB_DATA: dataDir } }),
)
const { tools } = await client.listTools()
console.log(`✓ ${client.getServerVersion()?.name} ${client.getServerVersion()?.version} : ${tools.length} outils`)
const res = await client.callTool({ name: 'list_tables', arguments: {} })
console.log(`✓ list_tables : ${res.isError ? 'dossier vide (attendu sans données)' : 'données lues'}`)
await client.close()
if (tools.length !== 14) process.exit(1)
