import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// What the hub app (src/, not the console or the start page) may not import.
const HUB_APP_BOUNDARIES = [
  { group: ['**/console', '**/console/**'], message: 'The hub app may not import the super admin console (src/console/).' },
  { group: ['**/start', '**/start/**'], message: 'The hub app may not import the start page (src/start/).' },
]

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
    rules: {
      // Hot reload only (a file that exports a component and something else
      // reloads the whole page in dev). CI runs the lint with --max-warnings 0
      // since the frontend pass (2026-10-24), so it holds like an error.
      'react-refresh/only-export-components': 'warn',
    },
  },
  // The console's Dashboard section registry: it exports the registry
  // (SECTION_VIEWS, QUEUE_LABELS) and a time helper, and its components are
  // the registry's private renderers. Splitting them apart would scatter one
  // table; an edit there reloads the console page in dev, which is all the
  // rule is about.
  {
    files: ['src/console/dashboardSections.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // The super admin's page (src/console/, console.html) and the hub app are
  // separate: the hub app may not import the console, and the console
  // imports nothing of the hub app's (Adam, 2026-09-26; the server-side
  // twin is civic/control-boundary in ../eslint.config.js).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/console/**', 'src/start/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: HUB_APP_BOUNDARIES }],
    },
  },
  // A component reads the hub's config through useHub() (config/hub.ts), so
  // it re-renders when the config changes under a running page, whatever
  // renders above it (frontend pass, 2026-10-24; ADR-013). ESLint replaces a
  // rule's options per block, so the hub app's boundaries are repeated here.
  // Plain modules, config/ itself and the process display tables (called
  // from a component's render) read the object directly.
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/console/**', 'src/start/**', 'src/config/**', 'src/processes/**', 'src/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          ...HUB_APP_BOUNDARIES,
          { group: ['**/config/hub'], importNames: ['default', 'meetingSummaryLabel'], message: 'In a component, read the hub with useHub() (config/hub): it re-renders when the config changes. ADR-013.' },
          { group: ['**/config/plugins'], importNames: ['pluginEnabled', 'pluginShown', 'pluginSetup', 'processTypeEnabled', 'processTypeShown'], message: 'In a component, read plugin switches with useHub().plugins (config/hub). ADR-013.' },
          { group: ['**/config/hubConfig'], importNames: ['getLoadedHubConfig', 'setting'], message: 'In a component, read the config with useHub().config / useHub().setting(key). ADR-013.' },
        ],
      }],
    },
  },
  // The start page (src/start/, start.html; session 4b) is a platform page
  // like the console: it may use the console's form pieces and src/shared/,
  // nothing of the hub app's.
  {
    files: ['src/start/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        // services/errorReporter: the one error reporter, which holds no hub state.
        patterns: [{ regex: '^\\.\\./(?!console/|\\.\\./\\.\\./src/shared/|services/errorReporter$)', message: 'The start page imports only the console, src/shared/ and the error reporter, nothing of the hub app.' }],
      }],
    },
  },
  {
    files: ['src/console/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        // src/shared/ is one exception: pure code written to be shared by the
        // server and the console (jurisdiction types and names). The other is
        // the one Modal (components/Modal), which holds no hub state, so every
        // dialog in the hub and the console behaves alike (Submit and Save).
        // The third is the one error reporter (services/errorReporter), which
        // holds no hub state either (operations shell). The fourth is the
        // feature packages' console views (config/featureConsole.ts, ADR-016),
        // which import the console's own types and their feature's plain data.
        patterns: [{ regex: '^\\.\\./(?!\\.\\./\\.\\./src/shared/|\\.\\./\\.\\./config/featureConsole$|components/Modal$|services/errorReporter$)', message: 'The console stands alone: it imports nothing from the hub app (src/shared/, components/Modal, services/errorReporter and the features\' console views excepted).' }],
      }],
    },
  },
])
