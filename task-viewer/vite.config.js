import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { writeFileSync } from 'fs'
import { join } from 'path'

// Vite plugin: write version.json to dist on build
function buildVersion() {
  let outDir
  return {
    name: 'build-version',
    configResolved(config) {
      outDir = config.build.outDir
    },
    closeBundle() {
      const version = { buildId: Date.now() }
      writeFileSync(join(outDir, 'version.json'), JSON.stringify(version), 'utf-8')
    },
  }
}

export default defineConfig({
  plugins: [
    vue(),
    buildVersion(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
