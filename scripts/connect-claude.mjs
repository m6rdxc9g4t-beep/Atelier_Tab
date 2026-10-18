/**
 * Enregistre le serveur MCP d'Atelier_Tab dans Claude Code (portée « user » : disponible
 * dans tous les projets). Utilise le lanceur livré dans l'application installée.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const launcher =
  process.platform === 'darwin'
    ? '/Applications/Atelier_Tab.app/Contents/Resources/atelier-mcp'
    : null

if (!launcher || !existsSync(launcher)) {
  console.error(
    process.platform === 'darwin'
      ? 'Atelier_Tab n’est pas installée dans Applications : lancez d’abord `npm run app:install`.'
      : 'Cette commande est prévue pour macOS. En développement : claude mcp add --scope user atelier-tab -- node dist-desktop/atelier-mcp.mjs',
  )
  process.exit(1)
}

const which = spawnSync('claude', ['--version'], { encoding: 'utf8' })
if (which.error) {
  console.error(
    'La commande `claude` est introuvable. Installez Claude Code, puis relancez `npm run ai:connect`.',
  )
  process.exit(1)
}

// Remplace une éventuelle configuration précédente.
spawnSync('claude', ['mcp', 'remove', 'atelier-tab', '--scope', 'user'], { stdio: 'ignore' })
execFileSync('claude', ['mcp', 'add', '--scope', 'user', 'atelier-tab', '--', launcher], {
  stdio: 'inherit',
})

console.log('\n✓ Claude Code a maintenant accès à Atelier_Tab (serveur MCP « atelier-tab »).')
console.log('  Dans une nouvelle session Claude Code, essayez :')
console.log(
  '  « Liste mes tables Atelier_Tab » ou « Ajoute une ligne Menuiseries à 12 000 € dans Planning & Lots »\n',
)
