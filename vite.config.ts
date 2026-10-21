/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { healthPlugin } from './desktop/health-server.ts'

const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineConfig({
  // healthPlugin : `GET /api/health` en dev et en aperçu (docs/SUITE.md §3).
  plugins: [react(), tailwindcss(), healthPlugin()],
  // Version de l'app (src/lib/version.ts), comme scripts/build-desktop.mjs pour le code Node.
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // Ports de la Suite Atelier (docs/SUITE.md §2) : échec explicite en cas de conflit.
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
