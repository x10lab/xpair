import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Build stamp — a fresh, monotonic-ish id baked into every build so a launched window is
// verifiably the latest build (shown in the UI + window title). Re-evaluated on each `vite build`.
const BUILD_ID = new Date().toISOString().slice(5, 19).replace('T', ' ') // "MM-DD HH:MM:SS"

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
