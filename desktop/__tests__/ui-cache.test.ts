import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cacheControlFor,
  isHashedAsset,
  UI_STAMP_FILE,
  uiBuildStamp,
  uiChangedSinceLastLaunch,
} from '../ui-cache'

describe('cache de l’interface (app de bureau)', () => {
  it('index.html et les fichiers non hachés ne sont jamais mis en cache', () => {
    expect(cacheControlFor('index.html')).toMatch(/no-store/)
    expect(cacheControlFor('favicon.svg')).toMatch(/no-store/)
    expect(cacheControlFor('assets/logo.png')).toMatch(/no-store/)
  })

  it('les fichiers hachés par Vite gardent un cache long', () => {
    expect(isHashedAsset('assets/index-DlxIQwOw.js')).toBe(true)
    expect(isHashedAsset('assets/AssistantPanel-Duasi5HZ.js')).toBe(true)
    expect(cacheControlFor('assets/index-Dv6BHF6J.css')).toMatch(/immutable/)
  })

  it('l’empreinte change avec le contenu d’index.html', () => {
    const a = uiBuildStamp('<script src="/assets/index-AAAAAAAA.js"></script>')
    const b = uiBuildStamp('<script src="/assets/index-BBBBBBBB.js"></script>')
    expect(a).toHaveLength(16)
    expect(a).not.toBe(b)
    expect(uiBuildStamp('<x>')).toBe(uiBuildStamp('<x>'))
  })

  it('caches à vider au premier lancement et après une mise à jour, pas sinon', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-ui-'))
    expect(uiChangedSinceLastLaunch(dir, 'v1')).toBe(true)
    expect(fs.readFileSync(path.join(dir, UI_STAMP_FILE), 'utf8').trim()).toBe('v1')
    expect(uiChangedSinceLastLaunch(dir, 'v1')).toBe(false)
    expect(uiChangedSinceLastLaunch(dir, 'v2')).toBe(true)
    expect(uiChangedSinceLastLaunch(dir, 'v2')).toBe(false)
  })
})
