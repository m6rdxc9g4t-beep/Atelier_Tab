import { describe, expect, it } from 'vitest'
import { createDemoData } from '@/fixtures/demo'
import {
  assembleData,
  DataFileError,
  parseIndexFile,
  parseAppState,
  parsePreferencesFile,
  parseTableFile,
  serializeData,
  serializePreferences,
  tableIdFromPath,
} from '../format'

function roundTrip() {
  const data = createDemoData()
  data.integrations.atelierProjets = { webhookUrl: 'https://a.example/hook', token: 'secret' }
  const files = serializeData(data)
  const index = parseIndexFile(files.get('atelier.json')!)
  const tables = Object.fromEntries(
    [...files]
      .filter(([p]) => p.startsWith('tables/'))
      .map(([p, text]) => [tableIdFromPath(p)!, parseTableFile(p, text)]),
  )
  return { data, files, rebuilt: assembleData(index, tables) }
}

describe('format sur disque', () => {
  it('écrit un index et un fichier par table', () => {
    const { files } = roundTrip()
    expect([...files.keys()].sort()).toEqual([
      'atelier.json',
      'tables/tbl_budget_global.json',
      'tables/tbl_calculs_surfaces.json',
      'tables/tbl_materiaux.json',
      'tables/tbl_planning_lots.json',
    ])
    expect(files.get('atelier.json')).toContain('"format": "atelier_tab"')
  })

  it('n’écrit jamais le jeton du webhook', () => {
    const { files } = roundTrip()
    expect([...files.values()].join('')).not.toContain('secret')
    expect(files.get('atelier.json')).toContain('https://a.example/hook')
  })

  it('relit exactement les mêmes données', () => {
    const { data, rebuilt } = roundTrip()
    const { token: _t, ...expected } = data.integrations.atelierProjets
    void _t
    expect(rebuilt).toEqual({ ...data, integrations: { atelierProjets: expected } })
  })

  it('relit les rôles item_type et time_spent', () => {
    const data = createDemoData()
    const table = data.tables.tbl_planning_lots!
    table.fields.status!.atelierMapping = 'item_type'
    table.fields.cost_ht!.atelierMapping = 'time_spent'
    const files = serializeData(data)
    const parsed = parseTableFile(
      'tables/tbl_planning_lots.json',
      files.get('tables/tbl_planning_lots.json')!,
    )
    expect(parsed.fields.status?.atelierMapping).toBe('item_type')
    expect(parsed.fields.cost_ht?.atelierMapping).toBe('time_spent')
  })

  it('relit une colonne-formule au format date', () => {
    const data = createDemoData()
    data.tables.tbl_planning_lots!.fields.cost_ttc!.options = { resultFormat: 'date' }
    const files = serializeData(data)
    const parsed = parseTableFile(
      'tables/tbl_planning_lots.json',
      files.get('tables/tbl_planning_lots.json')!,
    )
    expect(parsed.fields.cost_ttc?.options?.resultFormat).toBe('date')
  })

  it('reconnaît les chemins de tables', () => {
    expect(tableIdFromPath('tables/tbl_x.json')).toBe('tbl_x')
    expect(tableIdFromPath('tables/.tbl_x.json.123.tmp')).toBeNull()
    expect(tableIdFromPath('atelier.json')).toBeNull()
  })
})

describe('tolérance aux éditions externes', () => {
  const base = () =>
    JSON.parse(serializeData(createDemoData()).get('tables/tbl_planning_lots.json')!)

  it('ajoute à la fin une ligne absente de rowOrder et complète les valeurs par défaut', () => {
    const t = base()
    t.records.rec_new = { cells: { task_name: 'Ajout IA' } }
    const table = parseTableFile('tables/tbl_planning_lots.json', JSON.stringify(t))
    expect(table.rowOrder.at(-1)).toBe('rec_new')
    expect(table.records.rec_new).toEqual({
      id: 'rec_new',
      kind: 'data',
      cells: { task_name: 'Ajout IA' },
    })
  })

  it('ignore les références orphelines et répare la vue active', () => {
    const t = base()
    t.rowOrder.push('rec_fantome')
    t.fieldOrder.push('fld_fantome')
    t.activeViewId = 'view_inconnue'
    const table = parseTableFile('tables/tbl_planning_lots.json', JSON.stringify(t))
    expect(table.rowOrder).not.toContain('rec_fantome')
    expect(table.fieldOrder).not.toContain('fld_fantome')
    expect(table.activeViewId).toBe('view_planning_grid')
  })

  it('crée une vue si la table n’en a pas', () => {
    const t = base()
    t.views = []
    expect(parseTableFile('x', JSON.stringify(t)).views[0]?.mode).toBe('hybrid')
  })

  it('signale un JSON cassé ou un type inconnu avec le fichier en cause', () => {
    expect(() => parseTableFile('tables/a.json', '{ "id": ')).toThrow(DataFileError)
    const t = base()
    t.fields.status.type = 'statut'
    expect(() => parseTableFile('tables/a.json', JSON.stringify(t))).toThrow(
      /tables\/a\.json : fields\.status\.type/,
    )
  })

  it('rattache une table nouvelle à son projet', () => {
    const data = createDemoData()
    const files = serializeData(data)
    const index = parseIndexFile(files.get('atelier.json')!)
    const extra = {
      ...structuredClone(data.tables.tbl_materiaux!),
      id: 'tbl_ia',
      name: 'Créée par IA',
    }
    const rebuilt = assembleData(index, { ...data.tables, tbl_ia: extra })
    expect(rebuilt.projects.proj_chiffrage_materiaux?.tableIds).toEqual(['tbl_materiaux', 'tbl_ia'])
  })

  it('écarte une table dont le projet n’existe pas', () => {
    const data = createDemoData()
    const index = parseIndexFile(serializeData(data).get('atelier.json')!)
    const orphan = {
      ...structuredClone(data.tables.tbl_materiaux!),
      id: 'tbl_o',
      projectId: 'proj_absent',
    }
    expect(assembleData(index, { tbl_o: orphan }).tables.tbl_o).toBeUndefined()
  })
})

describe('projet cible Atelier Projets (integrations.atelierProjets.projectId)', () => {
  const index = (atelierProjets: unknown) =>
    JSON.stringify({ workspaces: {}, projects: {}, integrations: { atelierProjets } })

  it('est enregistré et relu', () => {
    const data = createDemoData()
    data.integrations.atelierProjets = {
      webhookUrl: 'http://127.0.0.1:3000/api/imports/atelier-tab',
      projectId: '3',
    }
    const text = serializeData(data).get('atelier.json')!
    expect(JSON.parse(text).integrations.atelierProjets.projectId).toBe('3')
    const rebuilt = assembleData(parseIndexFile(text), {})
    expect(rebuilt.integrations.atelierProjets).toEqual(data.integrations.atelierProjets)
  })

  it('lecture tolérante : ancien fichier, nombre saisi à la main, valeur invalide', () => {
    const read = (v: unknown) =>
      assembleData(parseIndexFile(index(v)), {}).integrations.atelierProjets
    expect(read({ webhookUrl: 'https://a.example' })).toEqual({ webhookUrl: 'https://a.example' })
    expect(read({ projectId: 7 })).toEqual({ projectId: '7' })
    expect(read({ projectId: '' })).toEqual({})
    expect(read({ projectId: { id: 3 } })).toEqual({})
    // Un journal d'export abîmé n'empêche pas le chargement.
    expect(read({ webhookUrl: 'https://a.example', lastExport: { at: 1 } })).toEqual({
      webhookUrl: 'https://a.example',
    })
  })
})

describe('mode « En ligne » hors du dossier de données (SUITE.md §5.1)', () => {
  const base = { workspaces: {}, projects: {} }
  const index = (extra: Record<string, unknown>) => JSON.stringify({ ...base, ...extra })

  it('atelier.json ne contient jamais le mode « En ligne »', () => {
    const data = createDemoData()
    data.preferences = { onlineMode: true }
    const text = serializeData(data).get('atelier.json')!
    expect(JSON.parse(text)).not.toHaveProperty('preferences')
    expect(text).not.toMatch(/online/i)
  })

  it('migration tolérante : une ancienne valeur dans atelier.json est lue sans erreur mais ignorée', () => {
    for (const preferences of [{ onlineMode: true }, { online_mode: true }, 'oui', 42, null, []]) {
      const parsed = parseIndexFile(index({ preferences }))
      // L'app repart hors ligne.
      expect(assembleData(parsed, {}).preferences).toEqual({ onlineMode: false })
    }
  })

  it('l’état reçu de l’interface (data:save) ne peut pas passer en ligne', () => {
    const data = createDemoData()
    data.preferences = { onlineMode: true }
    expect(parseAppState(JSON.parse(JSON.stringify(data))).preferences).toEqual({
      onlineMode: false,
    })
  })

  it('fichier de préférences : seul `true` exact passe en ligne ; absent ou abîmé → hors ligne', () => {
    expect(parsePreferencesFile(serializePreferences({ onlineMode: true }))).toEqual({
      onlineMode: true,
    })
    expect(parsePreferencesFile(serializePreferences({ onlineMode: false }))).toEqual({
      onlineMode: false,
    })
    for (const text of [
      null,
      '',
      '{ cassé',
      'true',
      '[]',
      '{"onlineMode":"true"}',
      '{"onlineMode":1}',
    ]) {
      expect(parsePreferencesFile(text)).toEqual({ onlineMode: false })
    }
  })
})
