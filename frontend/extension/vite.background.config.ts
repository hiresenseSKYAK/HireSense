import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  publicDir: resolve(__dirname, 'static'),
  build: {
    emptyOutDir: true,
    lib: { entry: resolve(__dirname, 'src/background.ts'), formats: ['iife'], name: 'HireSenseBackground', fileName: () => 'background.js' },
    outDir: resolve(__dirname, 'dist'),
  },
})
