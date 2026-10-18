/**
 * Vérifie que le binaire Electron est présent. Les versions récentes de npm n'exécutent
 * plus automatiquement les scripts d'installation des paquets : le téléchargement
 * d'Electron est alors lancé ici, explicitement.
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const require = createRequire(import.meta.url)
const electronDir = path.dirname(require.resolve('electron/package.json'))

if (!existsSync(path.join(electronDir, 'path.txt'))) {
  console.log('Téléchargement d’Electron…')
  const res = spawnSync(process.execPath, [path.join(electronDir, 'install.js')], {
    stdio: 'inherit',
  })
  if (res.status !== 0) process.exit(res.status ?? 1)
}
