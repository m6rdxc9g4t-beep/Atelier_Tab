/**
 * Adresses locales de la Suite Atelier. Module pur, partagé par l'interface et le
 * processus principal Electron (qui revérifie toute adresse reçue de l'interface).
 */

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

function parse(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** Vrai pour une adresse http(s) vers cette machine (127.0.0.1 ou localhost), sans identifiants. */
export function isLocalHttpUrl(value: unknown): value is string {
  const url = parse(value)
  return (
    url !== null &&
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    LOCAL_HOSTS.has(url.hostname) &&
    url.username === '' &&
    url.password === ''
  )
}
