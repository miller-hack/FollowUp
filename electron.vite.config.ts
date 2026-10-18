import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared },
    build: { rollupOptions: { external: ['node:sqlite'] } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: shared }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { ...shared, '@': resolve(__dirname, 'src/renderer/src') }
    },
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } }
  }
})
