import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

const packageRoot = dirname(
  require.resolve('@sqlite.org/sqlite-wasm/package.json'),
)
const distDir = join(packageRoot, 'dist')
const publicDir = join(process.cwd(), 'public')

const assets = [
  ['index.mjs', 'sqlite3.mjs'],
  ['sqlite3-opfs-async-proxy.js', 'sqlite3-opfs-async-proxy.js'],
  ['sqlite3-worker1.mjs', 'sqlite3-worker1.mjs'],
  ['sqlite3.wasm', 'sqlite3.wasm'],
] as const

describe('sqlite-wasm public assets', () => {
  it.each(assets)('copies %s to public/%s', async (distFile, publicFile) => {
    await expect(readFile(join(publicDir, publicFile))).resolves.toEqual(
      await readFile(join(distDir, distFile)),
    )
  })
})
