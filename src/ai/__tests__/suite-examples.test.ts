import { afterEach, describe, expect, it } from 'vitest'
import { storiesFromIndex, type ExamplePart, type ExampleSource } from '@/examples/suite'
import { createDemoData } from '@/fixtures/demo'
import { createHeadlessSession, type HeadlessOptions, type HeadlessSession } from '../headless'
import { runTool, type ConfirmRequest } from '../tools'

// Les fichiers livrés avec l'app, servis comme le ferait l'app ou le serveur MCP.
const FILES = import.meta.glob<unknown>('../../../exemples-suite/*.json', { eager: true, import: 'default' })
const file = (name: string) => FILES[`../../../exemples-suite/${name}.json`]
const source: ExampleSource = {
  list: async () => storiesFromIndex(file('index')),
  load: async (id) => {
    const part = file(id)
    if (!part) throw new Error('absent')
    return part as ExamplePart
  },
}

let session: HeadlessSession | null = null
afterEach(() => session?.dispose())

function open(options: Partial<HeadlessOptions> = {}) {
  session = createHeadlessSession(createDemoData(), async (name) => name, { caller: 'mcp', examples: source, ...options })
  return session
}

async function call(name: string, args: unknown = {}) {
  const res = await runTool(name, args, session!.host)
  return { ...res, json: res.ok ? JSON.parse(res.content) : undefined }
}

describe('outils des exemples de la suite', () => {
  it('liste les histoires et indique celles déjà chargées', async () => {
    open()
    const { json } = await call('list_suite_examples')
    expect(json.examples.length).toBeGreaterThanOrEqual(9)
    expect(json.examples[0]).toMatchObject({ id: 'studio-garance', loaded: false })
    expect(json.examples[0].in_tab).toEqual(expect.any(String))

    await call('load_suite_example', { example: 'studio-garance' })
    const after = await call('list_suite_examples')
    expect(after.json.examples.find((e: { id: string }) => e.id === 'studio-garance').loaded).toBe(true)
  })

  it('charge le projet de l’histoire sans toucher aux autres données, puis le retire', async () => {
    open()
    const before = session!.snapshot()
    const loaded = await call('load_suite_example', { example: 'studio-garance' })
    expect(loaded.json).toMatchObject({
      example: 'studio-garance',
      reloaded: false,
      project: { id: 'prj_ex_studio-garance' },
    })
    expect(loaded.json.tables[0]).toMatchObject({ id: 'tbl_ex_studio-garance_0', rows: expect.any(Number) })
    const data = session!.snapshot()
    for (const id of Object.keys(before.tables)) expect(data.tables[id]).toEqual(before.tables[id])

    // Lisible par les autres outils, comme toute table.
    const read = await call('read_table', { table: 'tbl_ex_studio-garance_1' })
    expect(read.ok).toBe(true)

    const removed = await call('remove_suite_example', { example: 'studio-garance' })
    expect(removed.json).toEqual({ example: 'studio-garance', removed: true })
    expect(session!.snapshot()).toEqual(before)
    expect((await call('remove_suite_example', { example: 'studio-garance' })).json.removed).toBe(false)
  })

  it('assistant : recharger ou retirer demande une confirmation', async () => {
    const asked: ConfirmRequest[] = []
    open({ caller: 'assistant', confirm: async (r) => (asked.push(r), false) })
    expect((await call('load_suite_example', { example: 'freelance-data' })).ok).toBe(true)
    expect(asked).toHaveLength(0)
    expect((await call('load_suite_example', { example: 'freelance-data' })).ok).toBe(false)
    expect((await call('remove_suite_example', { example: 'freelance-data' })).ok).toBe(false)
    expect(asked.map((r) => r.tool)).toEqual(['load_suite_example', 'remove_suite_example'])
    expect(session!.snapshot().projects['prj_ex_freelance-data']).toBeDefined()
  })

  it('histoire inconnue ou exemples absents : erreur codée', async () => {
    open()
    const unknown = await call('load_suite_example', { example: '../atelier' })
    expect(unknown).toMatchObject({ ok: false, code: 'NOT_FOUND' })
    session!.dispose()
    session = createHeadlessSession(createDemoData(), async (n) => n, { caller: 'mcp' })
    expect(await call('list_suite_examples')).toMatchObject({ ok: false, code: 'UNAVAILABLE' })
  })
})
