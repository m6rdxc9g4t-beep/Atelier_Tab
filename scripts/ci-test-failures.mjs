/**
 * CI : résume les tests en échec d'un rapport Vitest JSON en une seule annotation GitHub
 * (`::error::`), lisible depuis la page du travail sans ouvrir le journal complet.
 * Usage : node scripts/ci-test-failures.mjs <rapport.json>
 */
import { existsSync, readFileSync } from 'node:fs'

const file = process.argv[2] ?? 'vitest-resultats.json'
if (!existsSync(file)) {
  console.log(`::error title=Tests::rapport ${file} absent (Vitest n'a pas démarré ?)`)
  process.exit(0)
}
const report = JSON.parse(readFileSync(file, 'utf8'))
const lines = []
for (const suite of report.testResults ?? []) {
  const name = String(suite.name ?? '').replace(/^.*?(desktop|src)[\\/]/, '$1/')
  if (suite.status === 'failed' && (suite.assertionResults ?? []).length === 0)
    lines.push(`${name} : ${String(suite.message ?? '').split('\n')[0]}`)
  for (const test of suite.assertionResults ?? []) {
    if (test.status !== 'failed') continue
    const message = String(test.failureMessages?.[0] ?? '')
      .split('\n')
      .slice(0, 3)
      .join(' | ')
    lines.push(`${name} › ${test.fullName} : ${message.slice(0, 400)}`)
  }
}
const escape = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
console.log(`::error title=Tests en échec (${lines.length})::${escape(lines.join('\n'))}`)
