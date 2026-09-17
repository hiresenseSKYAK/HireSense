import { defineConfig } from 'vite'
import { resolve } from 'node:path'
export default defineConfig({
  publicDir: resolve(__dirname, 'static'),
  build: {
    emptyOutDir: false,
    lib: { entry: resolve(__dirname, 'src/resume.ts'), formats: ['iife'], name: 'HireSenseResume', fileName: () => 'resume.js' },
    outDir: resolve(__dirname, 'dist'),
  },
})
