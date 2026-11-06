/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { healthPlugin } from './desktop/health-server.ts'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

/**
 * Thème commun à la suite (docs/SUITE.md §1.5) : la copie verbatim de atelier-theme.js est
 * insérée en script bloquant dans le <head> d'index.html (dev et build), pour poser le thème
 * avant le premier rendu. L'app de bureau l'autorise par son empreinte (desktop/csp.ts).
 */
function atelierThemeScript(): Plugin {
  const file = new URL('./src/styles/atelier-brand/atelier-theme.js', import.meta.url)
  return {
    name: 'atelier-theme-script',
    transformIndexHtml: () => [
      { tag: 'script', children: readFileSync(file, 'utf8'), injectTo: 'head' },
    ],
  }
}

export default defineConfig({
  // healthPlugin : `GET /api/health` en dev et en aperçu (docs/SUITE.md §3).
  plugins: [atelierThemeScript(), react(), tailwindcss(), healthPlugin()],
  // Version de l'app (src/lib/version.ts), comme scripts/build-desktop.mjs pour le code Node.
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Ports de la Suite Atelier (docs/SUITE.md §2) : échec explicite en cas de conflit.
  // Sortie : `dist/` ; la mise à jour automatique de l'app compile à côté puis remplace (ADR 0005).
  build: { outDir: process.env.ATELIER_TAB_DIST_DIR || 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 5175, strictPort: true },
  preview: { host: '127.0.0.1', port: 4175, strictPort: true },
  test: {
    // Le moteur et DataFlow sont du TS pur : environnement node par défaut,
    // les tests de composants déclarent `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'desktop/**/*.test.ts'],
    coverage: {
      include: [
        'src/engine/**',
        'src/dataflow/**',
        'src/store/**',
        'src/ai/**',
        'src/storage/**',
        'desktop/**',
      ],
    },
  },
})
