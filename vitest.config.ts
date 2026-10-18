import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    projects: [
      // main-process services against a real (in-memory) SQLite database
      { extends: true, test: { name: 'main', include: ['tests/**/*.test.ts'], environment: 'node' } },
      // React components in a simulated DOM, with the IPC bridge stubbed (ADR-011)
      {
        extends: true,
        plugins: [react()],
        resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
        test: { name: 'renderer', include: ['tests/renderer/**/*.test.tsx'], environment: 'jsdom', setupFiles: ['tests/renderer/setup.ts'] }
      }
    ]
  }
})
