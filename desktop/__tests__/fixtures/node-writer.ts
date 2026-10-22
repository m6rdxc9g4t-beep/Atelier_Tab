/**
 * Écrivain concurrent pour les tests du nœud Atelier : un processus qui joue l'app de bureau ou
 * le serveur MCP sur le même dossier de données. Construit par rolldown dans le test.
 *
 *   node node-writer.mjs <dossier> <rôle> <tours>
 *
 * À chaque tour, sous le verrou du nœud (comme le serveur MCP pour un appel avec clé) :
 * relit le dossier, modifie une cellule propre à ce rôle, enregistre, publie les instantanés,
 * puis enregistre une clé d'idempotence. Écrit « ok » à la fin.
 */
import { produce } from 'immer'
import { FileStore } from '../../file-store'
import { NodeJournal } from '../../atelier-node'
import { SnapshotWriter } from '../../snapshots'

const [dir, role, rounds] = process.argv.slice(2) as [string, string, string]
const store = new FileStore({ dir })
const journal = new NodeJournal({ dataDir: dir, lockTimeoutMs: 60_000 })
const snapshots = new SnapshotWriter({
  dir,
  journal,
  onError: (e) => {
    console.error(e)
    process.exitCode = 1
  },
})

const record = role === 'app' ? 'rec_01' : 'rec_02'
for (let i = 1; i <= Number(rounds); i++) {
  await journal.withLockAsync(async () => {
    const data = store.load().data
    if (!data) throw new Error('aucune donnée')
    const next = produce(data, (d) => {
      d.tables.tbl_planning_lots!.records[record]!.cells.cost_ht = 1000 * i
    })
    store.save(next)
    snapshots.update(next)
    const ledger = journal.openLedger()
    ledger.put(`${role}:${i}`, { fingerprint: role, content: String(i) })
    ledger.commit()
  })
}
process.stdout.write('ok')
