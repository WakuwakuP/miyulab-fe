import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const packageJsonPath = require.resolve('@sqlite.org/sqlite-wasm/package.json')
const packageRoot = dirname(packageJsonPath)
const projectRoot = dirname(
  fileURLToPath(new URL('../package.json', import.meta.url)),
)

const distDir = join(packageRoot, 'dist')
const publicDir = join(projectRoot, 'public')

const isPublicSqliteAsset = (fileName) =>
  fileName.startsWith('sqlite3.') || fileName.startsWith('sqlite3-')

const sqliteAssetFiles = (await readdir(distDir))
  .filter(isPublicSqliteAsset)
  .sort()

const assets = [
  { from: 'index.mjs', to: 'sqlite3.mjs' },
  ...sqliteAssetFiles.map((fileName) => ({ from: fileName, to: fileName })),
]

await mkdir(publicDir, { recursive: true })
await Promise.all(
  assets.map(async ({ from, to }) => {
    await copyFile(join(distDir, from), join(publicDir, to))
  }),
)

console.info(`Copied ${assets.length} sqlite-wasm assets to public/`)
