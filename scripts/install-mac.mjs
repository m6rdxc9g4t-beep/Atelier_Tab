/**
 * Copie Atelier_Tab.app (construite par `npm run app:build`) dans /Applications, en
 * remplaçant une version précédente, puis connecte Claude Code si celui-ci est installé.
 * Les données ne sont pas touchées : elles sont dans ~/Atelier_Tab.
 */
import { existsSync, readdirSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'

if (process.platform !== 'darwin') {
  console.error('Cette commande ne fonctionne que sur macOS.')
  process.exit(1)
}

const release = path.resolve('release')
const folder = existsSync(release)
  ? readdirSync(release).find(
      (d) => d.startsWith('mac') && existsSync(path.join(release, d, 'Atelier_Tab.app')),
    )
  : undefined
if (!folder) {
  console.error('Application introuvable : lancez d’abord `npm run app:build`.')
  process.exit(1)
}

const source = path.join(release, folder, 'Atelier_Tab.app')
const target = '/Applications/Atelier_Tab.app'

// Ferme l'application si elle tourne, pour pouvoir la remplacer.
try {
  execFileSync('osascript', ['-e', 'tell application "Atelier_Tab" to quit'], { stdio: 'ignore' })
} catch {
  /* elle n'était pas ouverte */
}

execFileSync('rm', ['-rf', target])
execFileSync('ditto', [source, target])
// Une app construite localement n'est pas en quarantaine, mais on s'en assure.
execFileSync('xattr', ['-cr', target])

// Une seule copie de l'app sur le Mac : la copie de construction (release/…) porte le même identifiant
// (fr.atelier.tab). macOS pouvait la lancer à la place de /Applications (Dock, Spotlight, menu
// « Suite Atelier » des autres apps) et afficher une version périmée. On la retire et on la désinscrit.
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
try {
  execFileSync(lsregister, ['-u', source], { stdio: 'ignore' })
} catch {
  /* désinscription facultative */
}
execFileSync('rm', ['-rf', source])
try {
  execFileSync(lsregister, ['-f', target], { stdio: 'ignore' })
} catch {
  /* inscription facultative : macOS la fera au premier lancement */
}

console.log(`\n✓ Atelier_Tab est installée dans Applications.`)
console.log('  Ouvrez-la depuis le Launchpad, Spotlight (⌘ Espace) ou le Finder.\n')

// Claude Code installé : on (ré)enregistre le serveur MCP livré avec l'app.
const claude = spawnSync('claude', ['--version'], { encoding: 'utf8' })
if (!claude.error && claude.status === 0) {
  const launcher = path.join(target, 'Contents', 'Resources', 'atelier-mcp')
  spawnSync('claude', ['mcp', 'remove', 'atelier-tab', '--scope', 'user'], { stdio: 'ignore' })
  const add = spawnSync(
    'claude',
    ['mcp', 'add', '--scope', 'user', 'atelier-tab', '--', launcher],
    {
      encoding: 'utf8',
    },
  )
  if (add.status === 0) {
    console.log('✓ Claude Code est connecté à Atelier_Tab (serveur MCP « atelier-tab »).')
    console.log('  Dans une nouvelle session : « Liste mes tables Atelier_Tab ».\n')
  } else {
    console.log('! Connexion à Claude Code impossible :', (add.stderr || add.stdout).trim())
    console.log('  Réessayez avec `npm run ai:connect`.\n')
  }
} else {
  console.log('  Claude Code introuvable : une fois installé, lancez `npm run ai:connect`.\n')
}
