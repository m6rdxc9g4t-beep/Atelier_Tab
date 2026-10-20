import { describe, expect, it } from 'vitest'
import { withoutOnlineMode } from '../persistence/desktop.adapter'

describe('reprise des données d’une ancienne version (SUITE.md §5.1)', () => {
  it('le mode « En ligne » repris d’IndexedDB est ignoré : l’app repart hors ligne', () => {
    const legacy = JSON.stringify({
      state: { workspaces: {}, preferences: { onlineMode: true } },
      version: 1,
    })
    expect(JSON.parse(withoutOnlineMode(legacy))).toEqual({
      state: { workspaces: {}, preferences: { onlineMode: false } },
      version: 1,
    })
  })

  it('état illisible : rendu tel quel (le processus principal le refusera)', () => {
    expect(withoutOnlineMode('{ cassé')).toBe('{ cassé')
    expect(withoutOnlineMode('{"version":1}')).toBe('{"version":1}')
  })
})
