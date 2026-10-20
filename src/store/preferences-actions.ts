/**
 * Mode « En ligne » choisi par l'utilisateur (interrupteur de l'en-tête, docs/SUITE.md §5.1).
 *
 * App de bureau : le processus principal l'enregistre dans le fichier de préférences, hors du
 * dossier de données (que les IA peuvent modifier) ; il relit ce fichier pour chaque appel de
 * Claude et chaque envoi webhook. Navigateur : le réglage reste dans le stockage du navigateur.
 * Aucun outil d'IA n'appelle cette action.
 */
import { getDesktopApi } from '@/services/desktop'
import { useDataStore } from './index'

export async function setOnlineModeByUser(online: boolean): Promise<void> {
  const desktop = getDesktopApi()
  // Enregistré d'abord par le processus principal : la revérification de Claude qui suit la
  // bascule lit déjà la nouvelle valeur.
  const saved = desktop ? await desktop.setOnlineMode(online) : online
  useDataStore.getState().setOnlineMode(saved)
}
