import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // Two pages: the hub app, and the super admin's console
      // (src/console/, served on the console hostname by vercel.json).
      input: {
        main: resolve(__dirname, 'index.html'),
        console: resolve(__dirname, 'console.html'),
      },
    },
  },
  server: {
    // The console calls /api/control/* on its own origin. Locally that is
    // http://console.localhost:5173/console.html, proxied to the API with the
    // Host header kept, so the API sees the console hostname
    // (CIVIC_CONSOLE_HOSTNAME=console.localhost). The hub app calls
    // http://localhost:3000 directly and does not use this.
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
