import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      app: path.resolve(__dirname, 'src/app'),
      components: path.resolve(__dirname, 'src/components'),
      types: path.resolve(__dirname, 'src/types'),
      util: path.resolve(__dirname, 'src/util'),
    },
  },
  test: {
    coverage: {
      include: ['src/util/db/sqlite/**'],
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary'],
    },
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
})
