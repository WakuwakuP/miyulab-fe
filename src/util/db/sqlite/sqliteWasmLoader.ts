import type initSqliteWasm from '@sqlite.org/sqlite-wasm'

export type SqliteWasmInitializer = typeof initSqliteWasm

/**
 * Load sqlite-wasm from public assets at runtime.
 *
 * Importing `@sqlite.org/sqlite-wasm` directly makes Turbopack statically
 * analyze sqlite3-worker1.mjs. That file creates an OPFS proxy worker from a
 * runtime-computed URL, which currently fails production builds with
 * "Can't resolve <dynamic>". Loading the ESM file from `public/` keeps it out
 * of the Turbopack module graph while preserving the browser runtime behavior.
 */
export async function loadSqliteWasmInitializer(
  origin = globalThis.location.origin,
): Promise<SqliteWasmInitializer> {
  const sqliteModuleUrl = `${origin}/sqlite3.mjs`
  const sqliteModule = (await import(
    /* webpackIgnore: true */ sqliteModuleUrl
  )) as { default: SqliteWasmInitializer }

  return sqliteModule.default
}
