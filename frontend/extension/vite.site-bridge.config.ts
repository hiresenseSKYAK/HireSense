import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    lib: { entry: resolve(__dirname, 'src/siteBridge.ts'), formats: ['iife'], name: 'HireSenseSiteBridge', fileName: () => 'siteBridge.js' },
    outDir: resolve(__dirname, 'dist'),
  },
})
