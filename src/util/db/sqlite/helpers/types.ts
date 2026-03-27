// ================================================================
// DB 実行インターフェース（helpers/ 共通型）
// ================================================================

export type DbExecCompat = {
  exec: (
    sql: string,
    opts?: {
      bind?: (string | number | null)[]
      returnValue?: 'resultRows'
    },
  ) => unknown
}
