/**
 * Serveur MCP d'Atelier_Tab (stdio), pour Claude Code et tout client MCP.
 *
 * À chaque appel : relecture du dossier de données, exécution de l'outil avec le même
 * store et le même moteur que l'app, puis écriture des seuls fichiers modifiés. L'app,
 * si elle est ouverte, voit le changement et se met à jour.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createHeadlessSession } from '@/ai/headless'
import { runTool, toolSchemas } from '@/ai/tools'
import { defaultDataDir, defaultSecretsFile, FileStore } from './file-store'

declare const __APP_VERSION__: string

const dataDir = defaultDataDir()
const store = new FileStore({ dir: dataDir, secretsFile: defaultSecretsFile() })

const INSTRUCTIONS = `Atelier_Tab est un tableur-base de données. Les tables ont des colonnes typées (lettres A, B, C…) et des lignes numérotées à partir de 1, comme dans Excel.
- Commence par list_tables puis read_table pour connaître les colonnes et les lignes.
- Les valeurs s'écrivent comme dans la grille : "45 000", "30/11/2026", libellé du statut, nom du responsable, formules "=SUM(C1:C3)".
- Une colonne de type formula a une formule écrite pour la ligne 1, recopiée sur chaque ligne.
- Les lignes de total (total_row) sont exclues des sommes et de l'export ; add_rows insère avant elles.
- Pour exporter vers atelier_projets : check_export puis export_table.
Données : ${dataDir}`

function expandHome(p: string): string {
  return p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p
}

async function saveExport(filename: string, content: string, _mime: string, requested?: string) {
  const target = requested
    ? path.resolve(dataDir, expandHome(requested))
    : path.join(dataDir, 'exports', filename)
  const final =
    requested && fs.existsSync(target) && fs.statSync(target).isDirectory()
      ? path.join(target, filename)
      : target
  fs.mkdirSync(path.dirname(final), { recursive: true })
  fs.writeFileSync(final, content, 'utf8')
  return final
}

const server = new Server(
  { name: 'atelier-tab', version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0' },
  { capabilities: { tools: {} }, instructions: INSTRUCTIONS },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolSchemas().map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters as { type: 'object'; properties?: Record<string, unknown> },
  })),
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { data, errors } = store.load()
  if (!data) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `Aucune donnée dans ${dataDir}. Ouvrez l’application Atelier_Tab une première fois pour créer le dossier (vos données existantes y seront reprises).`,
        },
      ],
    }
  }
  const session = createHeadlessSession(data, saveExport)
  try {
    const result = await runTool(request.params.name, request.params.arguments ?? {}, session.host)
    if (result.ok) store.save(session.snapshot())
    const content = [{ type: 'text' as const, text: result.content }]
    if (errors.length) {
      content.push({
        type: 'text' as const,
        text: `Attention, fichiers invalides ignorés (dernière version valide utilisée) :\n${errors.join('\n')}`,
      })
    }
    return { isError: !result.ok, content }
  } finally {
    session.dispose()
  }
})

await server.connect(new StdioServerTransport())
