import { describe, expect, it } from 'vitest'
import { buildRelayRequest, RELAY_HEADERS } from '../suite-relay'

const URL_OK = 'http://127.0.0.1:3000/api/imports/atelier-tab'

/**
 * Garde CORS d'Atelier Projets selon docs/SUITE.md §4.1 : http://127.0.0.1:* et
 * http://localhost:* admis, absence d'Origin = appel local, `null` (et le reste) refusé.
 */
function projetsAccepts(headers: Record<string, string>): boolean {
  const origin = Object.entries(headers).find(([k]) => k.toLowerCase() === 'origin')?.[1]
  if (origin === undefined) return true
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
}

describe('relais suite:post (SUITE.md §4.1)', () => {
  it('ne transmet que les en-têtes du contrat, jamais Origin', () => {
    const req = buildRelayRequest({
      url: URL_OK,
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer jeton',
        'Idempotency-Key': 'k1',
        'X-Atelier-Schema-Version': '2.1.0',
        Origin: 'null',
        origin: 'app://atelier',
        Cookie: 'x=1',
      },
    })
    expect(req).toEqual({
      url: URL_OK,
      body: '{}',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer jeton',
        'Idempotency-Key': 'k1',
        'X-Atelier-Schema-Version': '2.1.0',
      },
    })
    expect(RELAY_HEADERS).not.toContain('Origin')
    // Requête sans Origin : acceptée par Projets, sans dépendre de l'origine `null`.
    expect(projetsAccepts(req!.headers)).toBe(true)
    expect(projetsAccepts({ Origin: 'null' })).toBe(false)
    expect(projetsAccepts({ Origin: 'app://atelier' })).toBe(false)
  })

  it('refuse toute adresse hors de la route d’import locale', () => {
    for (const url of [
      'http://192.168.1.2:3000/api/imports/atelier-tab',
      'https://atelier.example/api/imports/atelier-tab',
      'http://127.0.0.1:3000/api/admin',
      'http://user:pw@127.0.0.1:3000/api/imports/atelier-tab',
      'file:///etc/passwd',
      42,
    ]) {
      expect(buildRelayRequest({ url, body: '{}', headers: {} }), String(url)).toBeNull()
    }
    expect(buildRelayRequest({ url: `${URL_OK}/preview`, body: '{}', headers: {} })).not.toBeNull()
    expect(buildRelayRequest({ url: URL_OK, body: {}, headers: {} })).toBeNull()
    expect(buildRelayRequest(null)).toBeNull()
  })
})
