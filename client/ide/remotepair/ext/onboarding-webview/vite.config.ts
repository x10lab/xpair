import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'

// Version — derived from the shared monotonic build counter (LOCKSTEP with the host: same
// 0.5.0a base + shared/.build-counter). This only READS the current value (display stamp); the
// counter is bumped by the host/client build scripts. repo root is 5 levels up.
const APP_VERSION = (() => {
  try {
    const n = readFileSync(path.resolve(__dirname, '../../../../../shared/.build-counter'), 'utf8').trim()
    return `0.5.0a${n}`
  } catch {
    return '0.5.0a'
  }
})()
// Build stamp = version + a fresh timestamp, so a launched window shows the 0.5.0aN naming AND is
// verifiably the latest build (re-evaluated on each `vite build`). e.g. "0.5.0a1 · 06-17 10:40:12".
const BUILD_ID = `${APP_VERSION} · ${new Date().toISOString().slice(5, 19).replace('T', ' ')}`

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
  },
})
