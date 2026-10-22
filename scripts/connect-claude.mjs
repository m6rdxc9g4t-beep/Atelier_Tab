/**
 * Enregistre le serveur MCP d'Atelier_Tab dans Claude Code (portée « user » : disponible
 * dans tous les projets). Utilise le serveur livré avec l'application installée :
 * - macOS : /Applications/Atelier_Tab.app/Contents/Resources/atelier-mcp ;
 * - Windows : %LOCALAPPDATA%\Programs\Atelier_Tab\Atelier_Tab.exe resources\atelier-mcp.cjs avec
 *   ELECTRON_RUN_AS_NODE=1, lancé sans shell (le chemin stable `resources\atelier-mcp.cmd` sert aux
 *   outils qui attendent un seul fichier, comme Nexus).
 *
 * Options : `--si-present` (installation : rien à faire, code 0, si Claude Code est absent) ;
 * `--retirer` (désinstallation : retire l'enregistrement).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import d from '../desktop/launcher/decision.cjs'

const ifPresent = process.argv.includes('--si-present')
const remove = process.argv.includes('--retirer')

/** Serveur MCP livré par l'app installée, ou null (plateforme non prise en charge). */
function installedServer() {
  if (process.platform === 'darwin') {
    return d.mcpServerCommand({
      platform: 'darwin',
      resourcesPath: '/Applications/Atelier_Tab.app/Contents/Resources',
      exePath: '/Applications/Atelier_Tab.app/Contents/MacOS/Atelier_Tab',
    })
  }
  if (process.platform === 'win32') {
    const dir = d.windowsInstallDir({ home: os.homedir(), env: process.env })
    return d.mcpServerCommand({
      platform: 'win32',
      resourcesPath: path.win32.join(dir, 'resources'),
      exePath: path.win32.join(dir, 'Atelier_Tab.exe'),
    })
  }
  return null
}

/**
 * Commande `claude` lançable sans shell : `claude` (macOS, Linux) ; Windows : `claude.exe` du PATH
 * (installateur officiel), sinon `claude.cmd` d'une installation npm, remplacé par Node.js et le
 * `cli.js` du paquet (un `.cmd` exigerait cmd.exe et une ligne de commande à échapper).
 * @returns {{ command: string, prefix: string[] } | null}
 */
function claudeCommand() {
  if (process.platform !== 'win32') return { command: 'claude', prefix: [] }
  const dirs = d.cleanPathEntries(d.splitPath(d.envPathValue(process.env), 'win32'), 'win32')
  for (const dir of [...dirs, path.win32.join(os.homedir(), '.local', 'bin')]) {
    const exe = path.win32.join(dir, 'claude.exe')
    if (existsSync(exe)) return { command: exe, prefix: [] }
    const cli = path.win32.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
    if (existsSync(path.win32.join(dir, 'claude.cmd')) && existsSync(cli))
      return { command: process.execPath, prefix: [cli] }
  }
  return null
}

/** @param {{ command: string, prefix: string[] }} claude @param {string[]} args */
function runClaude(claude, args, inherit = false) {
  return spawnSync(claude.command, [...claude.prefix, ...args], {
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    windowsHide: true,
  })
}

// Vérifié avant tout appel à Claude Code (rien n'est retiré si l'app n'est pas installée).
const server = installedServer()
const missing = server ? [server.command, ...server.args].filter((f) => !existsSync(f)) : []
if (!remove && (!server || missing.length > 0)) {
  console.error(
    server
      ? `Atelier_Tab n’est pas installée (${missing.join(', ')} introuvable) : lancez d’abord \`npm run app:install\`.`
      : 'Cette commande est prévue pour macOS et Windows. En développement : claude mcp add --scope user atelier-tab -- node dist-desktop/atelier-mcp.mjs',
  )
  process.exit(1)
}

const claude = claudeCommand()
const probe = claude ? runClaude(claude, ['--version']) : null
if (!claude || !probe || probe.error || probe.status !== 0) {
  const message =
    'Claude Code introuvable : une fois installé, lancez `npm run ai:connect` dans le dépôt.'
  if (ifPresent || remove) {
    console.log(`  ${message}`)
    process.exit(0)
  }
  console.error(
    'La commande `claude` est introuvable. Installez Claude Code, puis relancez `npm run ai:connect`.',
  )
  process.exit(1)
}

// Remplace une éventuelle configuration précédente.
runClaude(claude, ['mcp', 'remove', 'atelier-tab', '--scope', 'user'])
if (remove) {
  console.log('✓ Serveur MCP « atelier-tab » retiré de Claude Code.')
  process.exit(0)
}

if (!server) process.exit(1)
const add = runClaude(claude, d.claudeMcpAddArgs(server), true)
if (add.error || add.status !== 0) {
  console.error('✗ Connexion à Claude Code impossible. Commande à lancer à la main :')
  console.error(`  ${d.claudeMcpAddCommand(server)}`)
  process.exit(ifPresent ? 0 : 1)
}

console.log('\n✓ Claude Code a maintenant accès à Atelier_Tab (serveur MCP « atelier-tab »).')
console.log('  Dans une nouvelle session Claude Code, essayez :')
console.log(
  '  « Liste mes tables Atelier_Tab » ou « Ajoute une ligne Menuiseries à 12 000 € dans Planning & Lots »\n',
)
