import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { UI_SECURITY_HEADERS } from '../src/shared/securityHeaders.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // A plugin package's UI module (../packages/<name>/ui.tsx, ADR-014) sits
  // outside ui/: its imports of these resolve to ui's own copy, so there is
  // one React.
  resolve: {
    dedupe: ['react', 'react-dom', 'react-router-dom', 'react-router'],
    // A package written on SDK v1 (ADR-015) names its manifest's helpers by
    // the SDK's npm name; in this repository that is kit/sdk.
    alias: [
      { find: /^@civic-social\/plugin-sdk\/manifest$/, replacement: resolve(import.meta.dirname, '../kit/sdk/manifest.ts') },
      // The UI kit and the UI module's types (engine 2, A7).
      { find: /^@civic-social\/plugin-sdk\/ui$/, replacement: resolve(import.meta.dirname, '../kit/sdk/ui.ts') },
    ],
  },
  // The commit this bundle was built from, for error reports
  // (src/services/errorReporter.ts). Vercel sets it at build time.
  define: {
    __CIVIC_COMMIT__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? ''),
  },
  build: {
    rollupOptions: {
      // Three pages: the hub app, the super admin's console (src/console/,
      // served on the console hostname by vercel.json), and the start page
      // (src/start/, on the start hostname; session 4b).
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        console: resolve(import.meta.dirname, 'console.html'),
        start: resolve(import.meta.dirname, 'start.html'),
      },
      // Named chunks (frontend pass, 2026-10-24): the hub's stylesheets as
      // one file in their old order, React and the router in one, and the
      // markdown renderer in one. Pages are their own chunks (lazyPages.ts).
      output: {
        codeSplitting: {
          groups: [
            // Every hub stylesheet in one file, in the order styles/hubStyles.ts
            // imports them: the cascade resolves as it did in one bundle. Not
            // the console's or the start page's, and not Modal.css, which the
            // console also loads.
            {
              name: 'styles',
              test: (id: string) =>
                /[\\/]ui[\\/]src[\\/].*\.css$/.test(id) &&
                !/[\\/]ui[\\/]src[\\/](console|start)[\\/]/.test(id) &&
                !/[\\/]components[\\/]Modal\.css$/.test(id),
              priority: 4,
            },
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 3 },
            { name: 'markdown', test: /node_modules[\\/](react-markdown|remark-|micromark|mdast-|hast-|unist-|unified|vfile|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities|devlop|bail|trough|is-plain-obj|ccount|markdown-table|longest-streak|zwitch|html-url-attributes|estree-util|style-to-|inline-style-parser|trim-lines|escape-string-regexp)/, priority: 2 },
          ],
        },
      },
    },
  },
  server: {
    // The console calls /api/control/* on its own origin. Locally that is
    // http://console.localhost:5173/console.html, proxied to the API with the
    // Host header kept, so the API sees the console hostname
    // (CIVIC_CONSOLE_HOSTNAME=console.localhost). The start page likewise:
    // http://start.localhost:5173/start.html with
    // CIVIC_START_HOSTNAME=start.localhost. The hub app calls
    // http://localhost:3000 directly and does not use this.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  // A production build served locally gets production's headers (vercel.json
  // has the same ones), so Playwright runs the pages under the real CSP. The
  // dev server does not: Vite's dev client needs inline scripts.
  //
  // `/api` is proxied as on Vercel (Host kept, prefix stripped), to the API at
  // CIVIC_PREVIEW_API (default :3000), so a preview build is what Playwright
  // runs against, locally and in CI (.github/workflows/e2e.yml).
  preview: {
    headers: { ...UI_SECURITY_HEADERS },
    allowedHosts: true,
    proxy: {
      '/api': {
        target: process.env.CIVIC_PREVIEW_API || 'http://localhost:3000',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
