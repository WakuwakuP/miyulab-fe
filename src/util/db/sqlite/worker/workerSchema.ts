/**
 * Worker 側: スキーマ初期化ラッパー
 *
 * Worker で使う DbHandle は raw db オブジェクトを直接ラップする。
 * schema.ts の ensureSchema(handle) をそのまま呼べるように互換型を提供する。
 */

/**
 * schema.ts が期待する DbHandle の最小インターフェース。
 * Worker 側では sqlite-wasm の db オブジェクトをそのまま { db } で包めばよい。
 */
export type SchemaDbHandle = {
  db: {
    exec: (
      sql: string,
      opts?: {
        bind?: (string | number | null)[]
        returnValue?: 'resultRows'
      },
    ) => unknown
  }
}
