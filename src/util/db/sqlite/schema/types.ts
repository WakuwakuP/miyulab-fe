/** テーブル作成関数が受け取る DB インターフェース */
export type DbExec = {
  exec: (sql: string, opts?: { returnValue?: 'resultRows' }) => unknown
}
