import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'

// This onboarding loads INSIDE XpairHost.app's WKWebView over file://. WKWebView blocks
// external `<script type="module" crossorigin src="./assets/…">` over file:// (CORS), which left
// the window blank. viteSingleFile() inlines all JS/CSS into one index.html (no external module
// fetch), so it renders via file://. Keep base './' for any residual relative refs.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: { outDir: 'dist' },
})
