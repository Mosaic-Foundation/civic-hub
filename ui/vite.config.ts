import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { UI_SECURITY_HEADERS } from '../src/shared/securityHeaders.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
