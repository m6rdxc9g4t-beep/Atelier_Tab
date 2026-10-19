import { describe, expect, it, vi } from 'vitest'
import { APP_ORIGIN_PREFIX, guardSender, isTrustedSender, UntrustedSenderError } from '../ipc-guard'

const from = (url: unknown) => ({ senderFrame: { url } })

describe('contrôle de l’expéditeur IPC (M7)', () => {
  it('accepte l’interface de l’app (app://atelier/…)', () => {
    expect(APP_ORIGIN_PREFIX).toBe('app://atelier/')
    expect(isTrustedSender(from('app://atelier/index.html'))).toBe(true)
    expect(isTrustedSender(from('app://atelier/'))).toBe(true)
    expect(isTrustedSender(from('app://atelier/index.html#/table/tbl_a'))).toBe(true)
  })

  it('refuse tout autre cadre', () => {
    for (const url of [
      'http://127.0.0.1:5175/',
      'https://evil.example/',
      'app://atelier.evil/',
      'app://atelierx/',
      'app://evil/atelier/',
      'file:///tmp/app://atelier/',
      'data:text/html,app://atelier/',
      'about:blank',
      'null',
      '',
      undefined,
      42,
    ]) {
      expect(isTrustedSender(from(url)), String(url)).toBe(false)
    }
    expect(isTrustedSender({ senderFrame: null })).toBe(false)
    expect(isTrustedSender({})).toBe(false)
    expect(isTrustedSender(null)).toBe(false)
  })

  it('guardSender n’exécute le gestionnaire que pour l’interface de l’app', async () => {
    const handler = vi.fn((_e: unknown, a: number, b: number) => a + b)
    const rejected = vi.fn()
    const guarded = guardSender('suite:post', handler, rejected)

    expect(guarded(from('app://atelier/index.html'), 1, 2)).toBe(3)
    expect(() => guarded(from('https://evil.example/'), 1, 2)).toThrow(UntrustedSenderError)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(rejected).toHaveBeenCalledWith('suite:post', 'https://evil.example/')
  })
})
