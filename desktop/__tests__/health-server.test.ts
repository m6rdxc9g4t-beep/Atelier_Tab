import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHealthHandler, HEALTH_HOST, HEALTH_PORT, startHealthServer } from '../health-server'

const servers: http.Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
})

async function start(onFocus = vi.fn()) {
  const server = await startHealthServer({ port: 0, onFocus, log: () => {} })
  if (!server) throw new Error('serveur non démarré')
  servers.push(server)
  return { server, onFocus, port: (server.address() as AddressInfo).port }
}

function get(
  port: number,
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => (body += c))
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), body }),
      )
    })
    req.on('error', reject)
    req.end()
  })
}

describe('route de santé de l’app de bureau (SUITE.md §3)', () => {
  it('écoute sur 127.0.0.1:4175 uniquement', async () => {
    expect(HEALTH_HOST).toBe('127.0.0.1')
    expect(HEALTH_PORT).toBe(4175)
    const { server } = await start()
    expect((server.address() as AddressInfo).address).toBe('127.0.0.1')
  })

  it('GET /api/health → {"status":"ok","app":"atelier-tab"}', async () => {
    const { port, onFocus } = await start()
    const res = await get(port, '/api/health')
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/^application\/json/)
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', app: 'atelier-tab' })
    expect(onFocus).not.toHaveBeenCalled()
  })

  it('GET / → page « Atelier Tab est ouvert » et fenêtre ramenée', async () => {
    const { port, onFocus } = await start()
    const res = await get(port, '/', { 'Sec-Fetch-Dest': 'document' })
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/^text\/html/)
    expect(res.body).toContain('Atelier Tab est ouvert')
    expect(res.body).toContain('atelier_')
    // Page autonome : aucune ressource externe.
    expect(res.body).not.toMatch(/https?:\/\//)
    expect(onFocus).toHaveBeenCalledOnce()
  })

  it('une image ou un fetch posés par une page web ne volent pas le focus', async () => {
    const { port, onFocus } = await start()
    expect((await get(port, '/', { 'Sec-Fetch-Dest': 'image' })).status).toBe(200)
    expect(onFocus).not.toHaveBeenCalled()
  })

  it('tout le reste → 404, sans aucune donnée', async () => {
    const { port, onFocus } = await start()
    for (const path of ['/api/tables', '/index.html', '/api/health/x', '/../atelier.json']) {
      const res = await get(port, path)
      expect(res.status, path).toBe(404)
      expect(res.body).toBe('Introuvable')
    }
    expect((await get(port, '/api/health', {}, 'POST')).status).toBe(404)
    expect(onFocus).not.toHaveBeenCalled()
  })

  it('refuse un en-tête Host étranger (DNS rebinding)', async () => {
    const { port } = await start()
    expect((await get(port, '/api/health', { Host: 'evil.example:4175' })).status).toBe(404)
    expect((await get(port, '/api/health', { Host: `localhost:${port}` })).status).toBe(200)
  })

  it('port déjà pris : journalisé, sans exception', async () => {
    const { port } = await start()
    const log = vi.fn()
    expect(await startHealthServer({ port, log })).toBeNull()
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/déjà utilisé/))
  })

  it('le gestionnaire seul ne dépend que de la requête', () => {
    const handler = createHealthHandler()
    const writeHead = vi.fn()
    const end = vi.fn()
    handler(
      { method: 'GET', url: '/api/health?x=1', headers: { host: '127.0.0.1:4175' } } as never,
      { writeHead, end } as never,
    )
    expect(writeHead).toHaveBeenCalledWith(200, expect.any(Object))
    expect(end).toHaveBeenCalledWith('{"status":"ok","app":"atelier-tab"}')
  })
})

describe('greffon Vite /api/health (dev 5175, aperçu 4175)', () => {
  it('répond sur /api/health et laisse passer le reste', async () => {
    const { healthMiddleware, healthPlugin } = await import('../health-server')
    const writeHead = vi.fn()
    const end = vi.fn()
    const next = vi.fn()
    healthMiddleware(
      { method: 'GET', url: '/api/health' } as never,
      { writeHead, end } as never,
      next,
    )
    expect(end).toHaveBeenCalledWith('{"status":"ok","app":"atelier-tab"}')
    expect(next).not.toHaveBeenCalled()
    healthMiddleware({ method: 'GET', url: '/' } as never, { writeHead, end } as never, next)
    expect(next).toHaveBeenCalledOnce()
    const plugin = healthPlugin()
    const use = vi.fn()
    plugin.configureServer({ middlewares: { use } })
    plugin.configurePreviewServer({ middlewares: { use } })
    expect(use).toHaveBeenCalledTimes(2)
    expect(use).toHaveBeenCalledWith(healthMiddleware)
  })
})
