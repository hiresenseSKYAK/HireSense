import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  publicDir: resolve(__dirname, 'static'),
  build: {
    emptyOutDir: false,
    lib: { entry: resolve(__dirname, 'src/popup.ts'), formats: ['iife'], name: 'HireSensePopup', fileName: () => 'popup.js' },
    outDir: resolve(__dirname, 'dist'),
  },
})
