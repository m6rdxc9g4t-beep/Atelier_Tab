import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'dist-desktop', 'dist-launcher', 'release', '.mise-a-jour']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Lanceur de l'app installée : CommonJS exécuté tel quel (ADR 0005).
    files: ['desktop/launcher/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    // Code Node de l'application de bureau (processus principal, serveur MCP).
    files: ['desktop/**/*.ts', 'scripts/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
