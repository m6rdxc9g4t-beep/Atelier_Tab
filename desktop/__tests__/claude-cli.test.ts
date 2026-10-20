import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLAUDE_STATUS_TTL_MS,
  CLAUDE_TIMEOUT_MS,
  ClaudeCli,
  claudeArgs,
  findClaudeExecutable,
  formatConversation,
  isolatedEnv,
  parseChatRequest,
  parseCliResult,
  spawnRunner,
  type RunOptions,
  type RunResult,
  type Runner,
} from '../claude-cli'

const FAKE = path.join(import.meta.dirname, 'fixtures', 'fake-claude.mjs')

const request = (extra: Record<string, unknown> = {}) => ({
  id: 'req_1',
  model: 'sonnet',
  system: 'Tu es l’assistant.',
  messages: [{ role: 'user', content: 'Bonjour' }],
  ...extra,
})

describe('recherche de l’exécutable (SUITE.md §5.3)', () => {
  const deps = (files: string[], env: Record<string, string> = {}) => ({
    env,
    homedir: '/Users/f',
    platform: 'darwin',
    isExecutable: (f: string) => files.includes(f),
  })

  it('CLAUDE_CLI d’abord, sans autre recherche', () => {
    expect(
      findClaudeExecutable(deps(['/x/claude', '/usr/bin/claude'], { CLAUDE_CLI: '/x/claude' })),
    ).toBe('/x/claude')
    expect(
      findClaudeExecutable(deps(['/usr/bin/claude'], { CLAUDE_CLI: '/absent', PATH: '/usr/bin' })),
    ).toBeNull()
  })

  it('puis le PATH, puis ~/.local/bin, /opt/homebrew/bin, /usr/local/bin', () => {
    expect(findClaudeExecutable(deps(['/usr/bin/claude'], { PATH: '/bin:/usr/bin' }))).toBe(
      '/usr/bin/claude',
    )
    // App lancée depuis le Finder : PATH minimal.
    const fallbacks = [
      '/Users/f/.local/bin/claude',
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
    ]
    expect(findClaudeExecutable(deps(fallbacks, { PATH: '/usr/bin:/bin' }))).toBe(fallbacks[0])
    expect(findClaudeExecutable(deps(fallbacks.slice(1)))).toBe('/opt/homebrew/bin/claude')
    expect(findClaudeExecutable(deps(fallbacks.slice(2)))).toBe('/usr/local/bin/claude')
    expect(findClaudeExecutable(deps([]))).toBeNull()
  })
})

describe('requête venue de l’interface', () => {
  it('accepte la conversation, le système, le schéma et l’alias', () => {
    const res = parseChatRequest(
      request({ schema: { type: 'object' }, extra: '--dangerously-skip-permissions' }),
    )
    expect(res).toEqual({
      ok: true,
      request: {
        id: 'req_1',
        model: 'sonnet',
        system: 'Tu es l’assistant.',
        messages: [{ role: 'user', content: 'Bonjour' }],
        schema: { type: 'object' },
      },
    })
  })

  it.each([
    ['modèle hors liste', { model: 'claude-3-opus --tools Bash' }],
    ['identifiant douteux', { id: '../x' }],
    ['prompt système en forme d’option', { system: '--dangerously-skip-permissions' }],
    ['prompt système trop long', { system: 'x'.repeat(70_000) }],
    ['rôle inconnu', { messages: [{ role: 'system', content: 'x' }] }],
    ['conversation vide', { messages: [] }],
    ['dernier message de l’assistant', { messages: [{ role: 'assistant', content: 'x' }] }],
    ['schéma non objet', { schema: ['x'] }],
    ['schéma sans type objet', { schema: { type: 'string' } }],
  ])('refuse : %s', (_label, extra) => {
    const res = parseChatRequest(request(extra))
    expect(res.ok).toBe(false)
  })

  it('ligne de commande du contrat, construite ici seulement', () => {
    const parsed = parseChatRequest(request({ schema: { type: 'object' } }))
    if (!parsed.ok) throw new Error(parsed.error)
    expect(claudeArgs(parsed.request)).toEqual([
      '-p',
      '--safe-mode',
      '--output-format',
      'json',
      '--tools',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--max-turns',
      '2',
      '--model',
      'sonnet',
      '--system-prompt',
      'Tu es l’assistant.',
      '--json-schema',
      '{"type":"object"}',
    ])
  })

  it('transcription de la conversation', () => {
    expect(formatConversation([{ role: 'user', content: 'Bonjour' }], false)).toBe('Bonjour')
    const text = formatConversation(
      [
        { role: 'user', content: 'Ajoute' },
        { role: 'assistant', content: '{"action":"tool"}' },
        { role: 'user', content: '[Résultat de l’outil add_rows]\n{}' },
      ],
      true,
    )
    expect(text).toContain('Utilisateur : Ajoute\n\nAssistant : {"action":"tool"}')
    expect(text).toMatch(/objet JSON conforme au schéma\.$/)
  })

  it('environnement : sans clé API, sans trafic non essentiel', () => {
    const env = isolatedEnv({ PATH: '/bin', ANTHROPIC_API_KEY: 'sk-x', HOME: '/h' })
    expect(env).toEqual({ PATH: '/bin', HOME: '/h', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' })
  })

  it('lit l’objet résultat final', () => {
    expect(parseCliResult('bruit\n{"type":"result","result":"ok"}\n')).toEqual({
      type: 'result',
      result: 'ok',
    })
    expect(parseCliResult('{\n "type": "result",\n "result": "x"\n}')).toMatchObject({
      result: 'x',
    })
    expect(parseCliResult('rien')).toBeNull()
  })
})

/** Exécutant simulé : mémorise les appels, rend des sorties préparées. */
function fakeRunner(reply: (args: readonly string[], options: RunOptions) => Partial<RunResult>) {
  const calls: {
    file: string
    args: readonly string[]
    options: RunOptions
    cwdExisted: boolean
  }[] = []
  const runner: Runner = async (file, args, options) => {
    calls.push({ file, args, options, cwdExisted: fs.existsSync(options.cwd) })
    return {
      code: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      aborted: false,
      ...reply(args, options),
    }
  }
  return { runner, calls }
}

const authOk = (args: readonly string[]): Partial<RunResult> =>
  args[0] === 'auth'
    ? { stdout: '{"loggedIn":true,"authMethod":"claude.ai"}' }
    : args[0] === '--version'
      ? { stdout: '2.1.0 (Claude Code)\n' }
      : {
          stdout:
            '{"type":"result","is_error":false,"result":"{}","structured_output":{"action":"answer","text":"Bonjour"}}',
        }

describe('ClaudeCli (exécutant simulé)', () => {
  let online = true
  let now = 0
  beforeEach(() => {
    online = true
    now = 1_000
  })
  const make = (runner: Runner, exe: string | null = '/bin/claude') =>
    new ClaudeCli({
      runner,
      findExecutable: () => exe,
      isOnline: () => online,
      now: () => now,
      env: { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-secret' },
    })

  it('hors ligne : rien n’est lancé, la requête est refusée', async () => {
    online = false
    const { runner, calls } = fakeRunner(authOk)
    const cli = make(runner)
    expect(await cli.status()).toMatchObject({ online: false, found: true, available: false })
    expect(await cli.chat(request())).toMatchObject({ ok: false, code: 'offline' })
    expect(calls).toEqual([])
  })

  it('état : auth status + version, en cache 60 s', async () => {
    const { runner, calls } = fakeRunner(authOk)
    const cli = make(runner)
    expect(await cli.status()).toEqual({
      online: true,
      found: true,
      available: true,
      detail: null,
      version: '2.1.0 (Claude Code)',
    })
    expect(calls.map((c) => c.args)).toEqual([['auth', 'status'], ['--version']])
    now += CLAUDE_STATUS_TTL_MS - 1
    await cli.status()
    expect(calls).toHaveLength(2)
    now += 2
    await cli.status()
    expect(calls).toHaveLength(4)
    await cli.status(true)
    expect(calls).toHaveLength(6)
  })

  it('état : introuvable, non connecté, clé API', async () => {
    expect(await make(fakeRunner(authOk).runner, null).status()).toMatchObject({
      found: false,
      available: false,
      detail: expect.stringMatching(/introuvable/),
    })
    const loggedOut = fakeRunner((a) =>
      a[0] === 'auth' ? { code: 1, stdout: '{"loggedIn":false}' } : {},
    )
    expect(await make(loggedOut.runner).status()).toMatchObject({
      available: false,
      detail: expect.stringMatching(/claude auth login/),
    })
    const apiKey = fakeRunner((a) =>
      a[0] === 'auth' ? { stdout: '{"loggedIn":true,"authMethod":"api_key"}' } : {},
    )
    expect(await make(apiKey.runner).status()).toMatchObject({
      available: true,
      detail: expect.stringMatching(/clé API/),
    })
  })

  it('appel isolé : drapeaux, dossier temporaire vide supprimé, environnement nettoyé', async () => {
    const { runner, calls } = fakeRunner(authOk)
    const res = await make(runner).chat(request({ schema: { type: 'object' } }))
    expect(res).toEqual({
      ok: true,
      text: '{}',
      output: { action: 'answer', text: 'Bonjour' },
    })
    const call = calls[0]!
    expect(call.file).toBe('/bin/claude')
    expect(call.args.slice(0, 9)).toEqual([
      '-p',
      '--safe-mode',
      '--output-format',
      'json',
      '--tools',
      '',
      '--strict-mcp-config',
      '--disable-slash-commands',
      '--no-session-persistence',
    ])
    expect(call.options.input).toBe(
      'Voici la conversation jusqu’ici :\n\nUtilisateur : Bonjour\n\nRéponds au dernier message par un seul objet JSON conforme au schéma.',
    )
    expect(call.options.timeoutMs).toBe(CLAUDE_TIMEOUT_MS)
    expect(call.options.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(call.options.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
    expect(call.cwdExisted).toBe(true)
    expect(path.basename(call.options.cwd)).toMatch(/^atelier-tab-claude-/)
    expect(fs.existsSync(call.options.cwd)).toBe(false)
  })

  it('erreurs : requête invalide, CLI absente, erreur de la CLI, délai dépassé', async () => {
    const { runner, calls } = fakeRunner(authOk)
    expect(await make(runner).chat(request({ model: 'gpt' }))).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    expect(await make(runner, null).chat(request())).toMatchObject({ ok: false, code: 'missing' })
    expect(calls).toEqual([])

    const failing = fakeRunner(() => ({
      code: 1,
      stdout: '{"type":"result","is_error":true,"result":"Limite atteinte"}',
    }))
    expect(await make(failing.runner).chat(request())).toEqual({
      ok: false,
      code: 'cli',
      error: 'Claude (CLI) : Limite atteinte',
    })
    const old = fakeRunner(() => ({ code: 1, stderr: "error: unknown option '--safe-mode'" }))
    expect(await make(old.runner).chat(request())).toMatchObject({
      error: expect.stringMatching(/claude update/),
    })
    const slow = fakeRunner(() => ({ code: null, timedOut: true }))
    expect(await make(slow.runner).chat(request())).toMatchObject({
      code: 'timeout',
      error: 'Claude (CLI) n’a pas répondu en 180 s.',
    })
  })

  it('annulation par identifiant', async () => {
    let signal: AbortSignal | undefined
    const runner: Runner = (_f, _a, options) =>
      new Promise((resolve) => {
        signal = options.signal
        options.signal?.addEventListener('abort', () =>
          resolve({ code: null, stdout: '', stderr: '', timedOut: false, aborted: true }),
        )
      })
    const cli = make(runner)
    const pending = cli.chat(request({ id: 'req_cancel' }))
    await vi.waitFor(() => expect(signal).toBeDefined())
    cli.cancel('req_cancel')
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled' })
  })
})

describe('ClaudeCli avec un vrai sous-processus (fausse CLI)', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-claude-it-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const make = (env: Record<string, string> = {}) => {
    const log = path.join(dir, 'calls.jsonl')
    const cli = new ClaudeCli({
      runner: spawnRunner,
      findExecutable: () =>
        findClaudeExecutable({
          env: { CLAUDE_CLI: FAKE },
          homedir: os.homedir(),
          platform: process.platform,
          isExecutable: (f) => fs.existsSync(f),
        }),
      isOnline: () => true,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: 'sk-ne-doit-pas-partir',
        FAKE_CLAUDE_LOG: log,
        ...env,
      },
      tmpRoot: dir,
    })
    const calls = () =>
      fs
        .readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Record<string, unknown>)
    return { cli, calls }
  }

  it('état puis un appel d’outil et une réponse, de bout en bout', async () => {
    const { cli, calls } = make()
    expect(await cli.status()).toMatchObject({ available: true, version: '9.9.9 (Claude Code)' })

    const first = await cli.chat(
      request({
        system: 'Tu es l’assistant. Table ouverte : « Planning » (id tbl_planning_lots).',
        messages: [{ role: 'user', content: 'Ajoute Menuiseries' }],
        schema: { type: 'object' },
      }),
    )
    expect(first).toMatchObject({
      ok: true,
      output: { action: 'tool', name: 'add_rows', arguments: { table: 'tbl_planning_lots' } },
    })
    const second = await cli.chat(
      request({
        messages: [
          { role: 'user', content: 'Ajoute Menuiseries' },
          { role: 'assistant', content: '{"action":"tool","name":"add_rows"}' },
          { role: 'user', content: '[Résultat de l’outil add_rows]\n{"added":[]}' },
        ],
        schema: { type: 'object' },
      }),
    )
    expect(second).toMatchObject({ ok: true, output: { action: 'answer' } })

    const chat = calls().filter((c) => (c.args as string[])[0] === '-p')
    expect(chat).toHaveLength(2)
    for (const c of chat) {
      expect(c.hasApiKey).toBe(false)
      expect(c.nonEssential).toBe('1')
      expect(c.cwdEntries).toEqual([])
      expect(path.dirname(String(c.cwd))).toBe(fs.realpathSync(dir))
      expect(c.args).toContain('--safe-mode')
      expect((c.args as string[])[(c.args as string[]).indexOf('--tools') + 1]).toBe('')
    }
    // Dossiers de travail supprimés après chaque appel.
    expect(fs.readdirSync(dir)).toEqual(['calls.jsonl'])
  }, 20_000)

  it('annule un appel en cours (processus arrêté)', async () => {
    const { cli } = make({ FAKE_CLAUDE_SLEEP: '10000' })
    const pending = cli.chat(request({ id: 'req_long' }))
    await new Promise((r) => setTimeout(r, 300))
    cli.cancel('req_long')
    expect(await pending).toMatchObject({ ok: false, code: 'cancelled' })
  }, 20_000)
})
