/**
 * Copie Atelier_Tab.app (construite par `npm run app:build`) dans /Applications,
 * en remplaçant une version précédente. Les données ne sont pas touchées : elles sont
 * rangées dans ~/Library/Application Support/Atelier_Tab.
 */
import { existsSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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

console.log(`\n✓ Atelier_Tab est installée dans Applications.`)
console.log('  Ouvrez-la depuis le Launchpad, Spotlight (⌘ Espace) ou le Finder.\n')
