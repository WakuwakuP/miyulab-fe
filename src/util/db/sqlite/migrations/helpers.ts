/**
 * マイグレーションヘルパー関数
 *
 * テーブル再作成やカラム追加など、マイグレーション内で使う汎用ユーティリティ。
 */

type DbExec = {
  exec: (sql: string, opts?: Record<string, unknown>) => unknown
}

/**
 * テーブルが存在するかチェック
 */
export function tableExists(db: DbExec, tableName: string): boolean {
  const rows = db.exec(
    `SELECT count(*) FROM sqlite_master WHERE type='table' AND name='${tableName}';`,
    { returnValue: 'resultRows' },
  ) as number[][]
  return rows[0][0] > 0
}

/**
 * カラムが存在しない場合のみ追加
 */
export function addColumnIfNotExists(
  db: DbExec,
  tableName: string,
  columnName: string,
  columnDef: string,
): void {
  const rows = db.exec(`PRAGMA table_info(${tableName});`, {
    returnValue: 'resultRows',
  }) as (string | number | null)[][]
  const exists = rows.some((row) => row[1] === columnName)
  if (!exists) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef};`)
  }
}

/**
 * テーブルを新しいスキーマで再作成（バックアップリネーム方式・データ移行付き）
 *
 * 1. preSql があれば実行
 * 2. 旧テーブルをバックアップにリネーム
 * 3. newCreateSql で新テーブル作成
 * 4. バックアップからデータをコピー
 * 5. バックアップ削除
 * 6. postSql があれば実行
 */
export function recreateTable(
  db: DbExec,
  tableName: string,
  newCreateSql: string,
  columnMapping: string,
  selectExpr?: string,
  options?: {
    postSql?: string[]
    preSql?: string[]
  },
): void {
  const backupName = `_${tableName}_v1_backup`

  // 1. preSql があれば実行
  if (options?.preSql) {
    for (const sql of options.preSql) {
      db.exec(sql)
    }
  }

  // 2. 旧テーブルをバックアップにリネーム
  db.exec(`ALTER TABLE "${tableName}" RENAME TO "${backupName}";`)

  // 3. newCreateSql で新テーブル作成
  db.exec(newCreateSql)

  // 4. バックアップからデータをコピー
  const src = selectExpr ?? columnMapping
  db.exec(
    `INSERT INTO "${tableName}" (${columnMapping}) SELECT ${src} FROM "${backupName}";`,
  )

  // 5. バックアップ削除
  db.exec(`DROP TABLE "${backupName}";`)

  // 6. postSql があれば実行
  if (options?.postSql) {
    for (const sql of options.postSql) {
      db.exec(sql)
    }
  }
}

/**
 * CREATE INDEX IF NOT EXISTS をラップ
 */
export function createIndexSafe(db: DbExec, sql: string): void {
  const safeSql = sql.includes('IF NOT EXISTS')
    ? sql
    : sql.replace('CREATE INDEX', 'CREATE INDEX IF NOT EXISTS')
  db.exec(safeSql)
}
