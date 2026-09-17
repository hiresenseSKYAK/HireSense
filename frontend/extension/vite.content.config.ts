import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  publicDir: resolve(__dirname, 'static'),
  build: {
    emptyOutDir: false,
    lib: { entry: resolve(__dirname, 'src/content.ts'), formats: ['iife'], name: 'HireSenseContent', fileName: () => 'content.js' },
    outDir: resolve(__dirname, 'dist'),
  },
})
