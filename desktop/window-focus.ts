/**
 * Retour au premier plan de la fenêtre de l'app (route de santé `GET /`, adresse de Tab
 * lui-même). Module pur : la fenêtre est injectée.
 *
 * Seulement `restore()` / `show()` / `focus()` : jamais `app.focus({ steal: true })`. Une page
 * ou un programme local qui ouvre `http://127.0.0.1:4175/` ne peut pas voler le premier plan à
 * l'application active ; le système décide (au pire, l'icône du Dock rebondit).
 */
export interface FocusableWindow {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function bringToFront(win: FocusableWindow): void {
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
