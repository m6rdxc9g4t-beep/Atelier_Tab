/**
 * Installe le lanceur Atelier_Tab.app (construit par `npm run app:build`) dans /Applications et
 * fait la première mise à jour, pour que le premier lancement soit immédiat (ADR 0005).
 *
 * L'app installée exécute le code du dépôt : après un `git pull`, il suffit de la relancer, elle se
 * met à jour toute seule (docs/SUITE.md §8). Cette commande n'est à relancer que si le dépôt change
 * de place ou si Electron change de version.
 *
 * Une ancienne app (copie figée, ou lanceur précédent) est d'abord quittée puis remplacée. Les
 * données ne sont pas touchées : elles sont dans ~/Atelier_Tab (préférences et secrets dans
 * ~/Library/Application Support/Atelier_Tab).
 */
import { existsSync, readdirSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'

if (process.platform !== 'darwin') {
  console.error('Cette commande ne fonctionne que sur macOS.')
  process.exit(1)
}

const root = path.resolve(import.meta.dirname, '..')
const release = path.join(root, 'release')
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
const BUNDLE_ID = 'fr.atelier.tab'

// 1. Ferme l'app si elle tourne (ancienne copie figée ou lanceur), pour pouvoir la remplacer.
try {
  execFileSync(
    'osascript',
    [
      '-e',
      `if application id "${BUNDLE_ID}" is running then tell application id "${BUNDLE_ID}" to quit`,
    ],
    { stdio: 'ignore' },
  )
} catch {
  /* elle n'était pas ouverte */
}
for (let i = 0; i < 20; i++) {
  const running = spawnSync('pgrep', ['-f', `${target}/Contents/MacOS/`], { stdio: 'ignore' })
  if (running.status !== 0) break
  if (i === 19) console.log('! Atelier_Tab semble encore ouverte : elle sera remplacée quand même.')
  else spawnSync('sleep', ['0.5'])
}

// 2. Première mise à jour (npm ci si besoin, compilation) depuis ce terminal : même logique, même
//    verrou et même tampon que l'app. Échec → l'app installée n'est pas touchée.
console.log('\n→ Mise à jour de la compilation…')
const update = spawnSync(process.execPath, [path.join(root, 'desktop', 'launcher', 'cli.cjs')], {
  stdio: 'inherit',
})
if (update.status !== 0) {
  console.error(
    '\n✗ Installation interrompue : corrigez l’erreur ci-dessus, puis relancez `npm run app:install`.',
  )
  process.exit(update.status ?? 1)
}

// 3. Remplace l'app.
execFileSync('rm', ['-rf', target])
execFileSync('ditto', [source, target])
// Une app construite localement n'est pas en quarantaine, mais on s'en assure.
execFileSync('xattr', ['-cr', target])

// Une seule copie de l'app sur le Mac : la copie de construction (release/…) porte le même identifiant
// (fr.atelier.tab). macOS pouvait la lancer à la place de /Applications (Dock, Spotlight, menu
// « Suite Atelier » des autres apps). On la retire et on la désinscrit.
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

console.log(`\n✓ Atelier_Tab est installée dans Applications (dépôt : ${root}).`)
console.log('  Ouvrez-la depuis le Launchpad, Spotlight (⌘ Espace) ou le Finder.')
console.log('  Après un `git pull`, relancez simplement l’app : elle se met à jour toute seule.\n')

// 4. Claude Code installé : on (ré)enregistre le serveur MCP livré avec l'app (même chemin qu'avant).
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
