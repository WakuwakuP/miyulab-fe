// ================================================================
// エンゲージメント操作ヘルパー（Worker 共通）
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
