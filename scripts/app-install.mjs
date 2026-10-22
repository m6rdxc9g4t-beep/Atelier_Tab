/**
 * `npm run app:install` : installe l'app de bureau (le lanceur du dépôt, ADR 0005) selon la plateforme.
 *
 * - macOS : construit Atelier_Tab.app (`npm run app:build`), puis `scripts/install-mac.mjs`
 *   (première mise à jour, copie dans /Applications, connexion de Claude Code) — inchangé.
 * - Windows : `scripts/windows/install.ps1` fait tout (prérequis, première mise à jour, construction
 *   du lanceur, copie dans %LOCALAPPDATA%\Programs\Atelier_Tab, raccourcis, enregistrement, Claude
 *   Code) : c'est aussi la commande documentée (docs/SUITE.md §9.1). Les arguments suivent
 *   (`npm run app:install -- -SansBureau`).
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const extra = process.argv.slice(2)

/** @param {string} command @param {string[]} args */
function run(command, args) {
  const res = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (res.error) {
    console.error(`✗ ${command} : ${res.error.message}`)
    process.exit(1)
  }
  if (res.status !== 0) process.exit(res.status ?? 1)
}

if (process.platform === 'darwin') {
  // npm qui exécute cette commande (npm_execpath), sinon celui du PATH.
  const npm = process.env.npm_execpath
  if (npm) run(process.execPath, [npm, 'run', 'app:build'])
  else run('npm', ['run', 'app:build'])
  run(process.execPath, [path.join(root, 'scripts', 'install-mac.mjs')])
} else if (process.platform === 'win32') {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const powershell = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  run(powershell, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(root, 'scripts', 'windows', 'install.ps1'),
    ...extra,
  ])
} else {
  console.error(
    'Installation prévue pour macOS et Windows. Sous Linux : `npm run app:build`, puis lancez ' +
      'release/linux-unpacked/atelier-tab.',
  )
  process.exit(1)
}
