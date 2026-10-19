/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
