/**
 * Version de l'application (celle de package.json), injectée à la construction par `define`
 * (vite.config.ts pour l'interface et les tests, scripts/build-desktop.mjs pour le code Node).
 */
declare const __APP_VERSION__: string

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
