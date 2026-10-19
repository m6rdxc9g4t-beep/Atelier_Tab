/**
 * Contrôle de l'expéditeur des messages IPC (processus principal).
 *
 * Seule l'interface de l'app, servie par le protocole privé `app://atelier/`, peut appeler
 * les canaux sensibles (écriture des données, relais vers Atelier Projets, ouverture d'une
 * adresse…). Un cadre d'une autre origine (iframe, page distante après une navigation
 * forcée) est refusé. Module pur : testé sans Electron.
 */

/** Préfixe des adresses de l'interface de l'app. */
export const APP_ORIGIN_PREFIX = 'app://atelier/'

/** Ce qu'on lit de l'évènement IPC (`IpcMainInvokeEvent.senderFrame`). */
export interface IpcSenderLike {
  senderFrame?: { url?: unknown } | null
}

/** Vrai si le message vient d'un cadre de l'interface de l'app (`app://atelier/…`). */
export function isTrustedSender(event: IpcSenderLike | null | undefined): boolean {
  const url = event?.senderFrame?.url
  if (typeof url !== 'string' || !url.startsWith(APP_ORIGIN_PREFIX)) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'app:' && parsed.host === 'atelier' && parsed.username === ''
  } catch {
    return false
  }
}

export class UntrustedSenderError extends Error {
  constructor(channel: string) {
    super(`Message IPC refusé (${channel}) : expéditeur hors de ${APP_ORIGIN_PREFIX}`)
    this.name = 'UntrustedSenderError'
  }
}

/**
 * Enveloppe un gestionnaire IPC : l'appel d'un expéditeur non reconnu est refusé (erreur
 * renvoyée à l'appelant) sans exécuter le gestionnaire.
 */
export function guardSender<E extends IpcSenderLike, A extends unknown[], R>(
  channel: string,
  handler: (event: E, ...args: A) => R,
  onReject: (channel: string, url: unknown) => void = () => {},
): (event: E, ...args: A) => R {
  return (event, ...args) => {
    if (!isTrustedSender(event)) {
      onReject(channel, event?.senderFrame?.url)
      throw new UntrustedSenderError(channel)
    }
    return handler(event, ...args)
  }
}
