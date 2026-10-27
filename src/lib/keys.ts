/** Raccourcis clavier : ⌘ sur Mac, Ctrl ailleurs (affichage dans les menus et bulles d'aide). */
export const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** Préfixe du modificateur principal : « ⌘ » ou « Ctrl+ ». */
export const MOD = IS_MAC ? '⌘' : 'Ctrl+'

/** Texte d'un raccourci : `shortcut('Z', { shift: true })` → « ⇧⌘Z » ou « Ctrl+Maj+Z ». */
export function shortcut(key: string, options: { shift?: boolean; mod?: boolean } = {}): string {
  const mod = options.mod === false ? '' : MOD
  if (IS_MAC) return `${options.shift ? '⇧' : ''}${mod}${key}`
  return `${mod}${options.shift ? 'Maj+' : ''}${key}`
}
