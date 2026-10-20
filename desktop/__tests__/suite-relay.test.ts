import { describe, expect, it } from 'vitest'
import { buildRelayRequest, RELAY_HEADERS } from '../suite-relay'

const URL_OK = 'http://127.0.0.1:3000/api/imports/atelier-tab'
const ALL_HEADERS = {
  'Content-Type': 'application/json',
  Authorization: 'Bearer jeton',
  'Idempotency-Key': 'k1',
  'X-Atelier-Schema-Version': '2.1.0',
}

/**
 * Garde CORS d'Atelier Projets selon docs/SUITE.md §4.1 : http://127.0.0.1:* et
 * http://localhost:* admis, absence d'Origin = appel local, `null` (et le reste) refusé.
 */
function projetsAccepts(headers: Record<string, string>): boolean {
  const origin = Object.entries(headers).find(([k]) => k.toLowerCase() === 'origin')?.[1]
  if (origin === undefined) return true
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
}

const relay = (url: unknown, online: boolean, headers: Record<string, string> = ALL_HEADERS) =>
  buildRelayRequest({ url, body: '{}', headers }, { online })

describe('relais webhook:post (SUITE.md §4.1, §5.4)', () => {
  it('ne transmet que les en-têtes du contrat, jamais Origin', () => {
    const res = relay(URL_OK, false, {
      ...ALL_HEADERS,
      Origin: 'null',
      origin: 'app://atelier',
      Cookie: 'x=1',
    })
    expect(res).toEqual({ ok: true, request: { url: URL_OK, body: '{}', headers: ALL_HEADERS } })
    expect(RELAY_HEADERS).not.toContain('Origin')
    // Requête sans Origin : acceptée par Projets, sans dépendre de l'origine `null`.
    if (!res.ok) throw new Error(res.error)
    expect(projetsAccepts(res.request.headers)).toBe(true)
    expect(projetsAccepts({ Origin: 'null' })).toBe(false)
    expect(projetsAccepts({ Origin: 'app://atelier' })).toBe(false)
  })

  it('hors ligne : seules les adresses de cette machine, quel que soit le chemin', () => {
    expect(relay(`${URL_OK}/preview`, false).ok).toBe(true)
    expect(relay('http://localhost:8080/hook', false).ok).toBe(true)
    for (const url of [
      'https://atelier.example/api/imports/atelier-tab',
      'https://evil.example/collect',
      'https://127.0.0.1.evil.example/x',
    ]) {
      const res = relay(url, false)
      expect(res.ok, url).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/^Mode hors ligne : envoi vers .* refusé/)
    }
  })

  it('en ligne : https extérieur admis, mais sans le jeton', () => {
    const res = relay('https://partenaire.example/api', true)
    expect(res).toEqual({
      ok: true,
      request: {
        url: 'https://partenaire.example/api',
        body: '{}',
        headers: { ...ALL_HEADERS, Authorization: undefined },
      },
    })
    if (res.ok) expect('Authorization' in res.request.headers).toBe(false)
    // Le jeton ne part qu'à la route d'import d'Atelier Projets locale.
    const authorization = (url: string) => {
      const r = relay(url, true)
      if (!r.ok) throw new Error(r.error)
      return r.request.headers.Authorization
    }
    expect(authorization('https://projets.example/api/imports/atelier-tab')).toBeUndefined()
    expect(authorization('http://127.0.0.1:3000/api/admin')).toBeUndefined()
    expect(authorization(URL_OK)).toBe('Bearer jeton')
    expect(authorization('http://localhost:3000/api/imports/atelier-tab/preview')).toBe(
      'Bearer jeton',
    )
  })

  it('refuse les adresses invalides ou avec identifiants, et un corps invalide', () => {
    for (const url of [
      'http://192.168.1.2:3000/api/imports/atelier-tab',
      'http://atelier.example/hook',
      'http://user:pw@127.0.0.1:3000/api/imports/atelier-tab',
      'https://user@partenaire.example/api',
      'file:///etc/passwd',
      `https://a.example/${'x'.repeat(3000)}`,
      42,
    ]) {
      expect(relay(url, true).ok, String(url)).toBe(false)
    }
    expect(buildRelayRequest({ url: URL_OK, body: {}, headers: {} }, { online: true }).ok).toBe(
      false,
    )
    expect(buildRelayRequest(null, { online: true }).ok).toBe(false)
  })
})
