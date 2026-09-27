import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // The super admin's page (src/console/, console.html) and the hub app are
  // separate: the hub app may not import the console, and the console
  // imports nothing of the hub app's (Adam, 2026-09-26; the server-side
  // twin is civic/control-boundary in ../eslint.config.js).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/console/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['**/console', '**/console/**'], message: 'The hub app may not import the super admin console (src/console/).' }],
      }],
    },
  },
  {
    files: ['src/console/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        // src/shared/ is the one exception: pure code written to be shared by
        // the server and the console (jurisdiction types and names).
        patterns: [{ regex: '^\\.\\./(?!\\.\\./\\.\\./src/shared/)', message: 'The console stands alone: it imports nothing from the hub app (src/shared/ excepted).' }],
      }],
    },
  },
])
