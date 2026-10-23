import { describe, expect, it } from 'vitest'
import { LOCAL_OLLAMA_URL, ollamaBaseUrl, usesServerOllama } from '@/ai/ollama'
import { ollamaLabel } from '@/ai/engine'

describe('adresse d’Ollama', () => {
  it('vise cette machine sans réglage', () => {
    expect(ollamaBaseUrl({})).toBe(LOCAL_OLLAMA_URL)
    expect(ollamaBaseUrl({ VITE_OLLAMA_URL: '  ' })).toBe(LOCAL_OLLAMA_URL)
    expect(usesServerOllama({})).toBe(false)
  })

  it('suit VITE_OLLAMA_URL (chemin relatif du serveur ou adresse complète)', () => {
    expect(ollamaBaseUrl({ VITE_OLLAMA_URL: '/ollama/' })).toBe('/ollama')
    expect(ollamaBaseUrl({ VITE_OLLAMA_URL: 'https://ia.exemple.fr//' })).toBe(
      'https://ia.exemple.fr',
    )
    expect(usesServerOllama({ VITE_OLLAMA_URL: '/ollama' })).toBe(true)
  })
})

describe('ollamaLabel', () => {
  it('nomme l’IA du serveur dans la version web hébergée, Ollama (local) sinon', () => {
    expect(ollamaLabel(true)).toBe('L’IA du serveur (Ollama)')
    expect(ollamaLabel(false)).toBe('Ollama (local)')
  })
})
