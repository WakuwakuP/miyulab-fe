/**
 * SQLite DevTools デバッグヘルパー
 *
 * 開発モード時に `window.__MIYULAB_SQLITE__` を公開し、
 * ブラウザの DevTools コンソールから直接 SQL クエリを実行できるようにする。
 *
 * ## 使い方
 *
 * DevTools コンソールで以下のように使用する:
 *
 * ```js
 * // テーブル一覧を取得
 * __MIYULAB_SQLITE__.tables()
 *
 * // 任意の SQL を実行（結果をオブジェクト配列で返す）
 * __MIYULAB_SQLITE__.query('SELECT * FROM statuses LIMIT 5')
 *
 * // 投稿数を確認
 * __MIYULAB_SQLITE__.query('SELECT COUNT(*) as count FROM statuses')
 *
 * // 生の exec を呼ぶ（sqlite3 の低レベル API）
 * __MIYULAB_SQLITE__.exec('PRAGMA table_info(statuses)')
 *
 * // DB ハンドルに直接アクセス
 * __MIYULAB_SQLITE__.db
 * __MIYULAB_SQLITE__.sqlite3
 * ```
 *
 * ## 推奨 Chrome 拡張機能
 *
 * OPFS 上の SQLite ファイルを直接閲覧するには
 * 「OPFS Explorer」Chrome 拡張機能が便利:
 * https://chromewebstore.google.com/detail/opfs-explorer/acndjpgkpaclldomagafnognkcgjignd
 */

import type {
  Database,
  OpfsDatabase,
  Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'

interface SqliteDevTools {
  /** データベースハンドル */
  db: Database | OpfsDatabase
  /** sqlite3 モジュール */
  sqlite3: Sqlite3Static
  /** SQL を実行して結果をオブジェクト配列で返す */
  query: (sql: string) => Record<string, unknown>[]
  /** SQL を実行して生の結果行を返す */
  exec: (sql: string) => unknown[][]
  /** テーブル一覧を取得 */
  tables: () => { name: string; type: string }[]
  /** テーブルのカラム情報を取得 */
  schema: (tableName: string) => Record<string, unknown>[]
}

declare global {
  var __MIYULAB_SQLITE__: SqliteDevTools | undefined
}

/**
 * 開発モード時に DevTools ヘルパーを window に公開する
 */
export function installDevTools(
  db: Database | OpfsDatabase,
  sqlite3: Sqlite3Static,
): void {
  if (process.env.NODE_ENV !== 'development') return
  if (typeof globalThis === 'undefined') return

  const devtools: SqliteDevTools = {
    db,

    exec(sql: string): unknown[][] {
      return db.exec(sql, {
        returnValue: 'resultRows',
      }) as unknown[][]
    },

    query(sql: string): Record<string, unknown>[] {
      const result = db.exec(sql, {
        returnValue: 'resultRows',
        rowMode: 'object',
      })
      return result as unknown as Record<string, unknown>[]
    },

    schema(tableName: string): Record<string, unknown>[] {
      const rows = db.exec(`PRAGMA table_info('${tableName}');`, {
        returnValue: 'resultRows',
        rowMode: 'object',
      })
      return rows as unknown as Record<string, unknown>[]
    },
    sqlite3,

    tables(): { name: string; type: string }[] {
      const rows = db.exec(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY name;",
        { returnValue: 'resultRows', rowMode: 'object' },
      )
      return rows as unknown as { name: string; type: string }[]
    },
  }

  globalThis.__MIYULAB_SQLITE__ = devtools

  console.info(
    '%c[miyulab-fe]%c SQLite DevTools enabled. Use %c__MIYULAB_SQLITE__%c in console.',
    'color: #8b5cf6; font-weight: bold',
    'color: inherit',
    'color: #f59e0b; font-weight: bold',
    'color: inherit',
  )
  console.info(
    '  .tables()                         — テーブル一覧\n' +
      "  .query('SELECT ...')              — SQL 実行 (オブジェクト配列)\n" +
      "  .schema('statuses')               — カラム情報\n" +
      '  .db / .sqlite3                    — 生のハンドル',
  )
}
