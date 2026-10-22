/**
 * Construit le code Node de l'application de bureau dans dist-desktop/ :
 * - main.cjs         processus principal Electron
 * - preload.cjs      pont sécurisé vers l'interface
 * - atelier-mcp.mjs  serveur MCP autonome (toutes dépendances incluses)
 */
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { build } from 'rolldown'

const root = path.resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
// ATELIER_TAB_DESKTOP_DIR : dossier temporaire de la mise à jour automatique (ADR 0005), qui
// remplace ensuite dist-desktop/ d'un bloc.
const out = process.env.ATELIER_TAB_DESKTOP_DIR
  ? path.resolve(process.env.ATELIER_TAB_DESKTOP_DIR)
  : path.join(root, 'dist-desktop')
rmSync(out, { recursive: true, force: true })

const common = {
  platform: 'node',
  resolve: { alias: { '@': path.join(root, 'src') } },
  transform: {
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      __APP_VERSION__: JSON.stringify(version),
    },
  },
  logLevel: 'warn',
}

await build({
  ...common,
  input: path.join(root, 'desktop/main.ts'),
  external: ['electron'],
  output: { file: path.join(out, 'main.cjs'), format: 'cjs' },
})
await build({
  ...common,
  input: path.join(root, 'desktop/preload.ts'),
  external: ['electron'],
  output: { file: path.join(out, 'preload.cjs'), format: 'cjs' },
})
await build({
  ...common,
  input: path.join(root, 'desktop/mcp-server.ts'),
  output: { file: path.join(out, 'atelier-mcp.mjs'), format: 'esm', minify: true },
})
console.log(`✓ ${path.relative(root, out) || out} : main.cjs, preload.cjs, atelier-mcp.mjs`)
