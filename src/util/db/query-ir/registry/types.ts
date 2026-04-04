/** ソーステーブルからの結合方法 */
export type JoinPath = {
  /** 結合先テーブルのカラム */
  column: string
  /** ソーステーブル側の対応カラム */
  sourceColumn: string
  /** 中間テーブルを経由する場合の JOIN チェーン */
  via?: {
    fromColumn: string
    table: string
    toColumn: string
  }[]
}

/** テーブルのカーディナリティ（ソースに対する関係） */
export type Cardinality = '1:1' | '1:N' | 'N:1' | 'lookup'

/** フィルタ可能なカラムのメタデータ */
export type ColumnMeta = {
  /** UI で表示するカテゴリ */
  category?: string
  /** 値の候補（ルックアップテーブルの場合） */
  knownValues?: string[]
  /** UI 表示用のラベル */
  label: string
  /** NULL 許容か */
  nullable: boolean
  /** SQLite の型 */
  type: 'integer' | 'text' | 'real'
}

/** テーブルのレジストリエントリ */
export type TableRegistryEntry = {
  /** ソーステーブルに対するカーディナリティ */
  cardinality: Cardinality
  /** フィルタ可能なカラム */
  columns: Record<string, ColumnMeta>
  /** コンパイラへのヒント */
  hints?: {
    /** 小さいルックアップテーブルか（スカラーサブクエリ向き） */
    isSmallLookup?: boolean
    /** EXISTS サブクエリを優先するか（1:N テーブルのデフォルト） */
    preferExists?: boolean
  }
  /** ソーステーブルごとの結合パス */
  joinPaths: {
    notifications?: JoinPath
    posts?: JoinPath
  }
  /** UI 表示名 */
  label: string
  /** テーブル名 */
  table: string
}

export type TableRegistry = Record<string, TableRegistryEntry>
