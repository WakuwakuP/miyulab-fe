import { describe, expect, it, vi } from 'vitest'
import type { DbExec } from '../../sqlite/queries/executionEngine'
import { executeLookupRelated } from '../executor/lookupRelatedExecutor'
import type { NodeOutput } from '../executor/types'
import type { LookupRelatedNode } from '../nodes'

/** db.exec モック: 空の結果を返し、呼び出し引数を記録する */
function mockDb(returnValue: (string | number | null)[][] = []): DbExec {
  return { exec: vi.fn().mockReturnValue(returnValue) }
}

function makeInput(
  rows: { id: number; createdAtMs: number }[],
  sourceTable = 'notifications',
): NodeOutput {
  return {
    hash: `test:${rows.length}`,
    rows: rows.map((r) => ({ ...r, table: sourceTable })),
    sourceTable,
  }
}

describe('executeLookupRelated', () => {
  describe('空入力', () => {
    it('入力行が空の場合、SQL を実行せず空の結果を返す', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [{ inputColumn: 'id', lookupColumn: 'id' }],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([])

      const result = executeLookupRelated(db, node, input)

      expect(result.sql).toBe('')
      expect(result.binds).toEqual([])
      expect(result.output.rows).toEqual([])
      expect(db.exec).not.toHaveBeenCalled()
    })
  })

  describe('IN ベース: 直接 JOIN (inputColumn=id, timeCondition なし)', () => {
    it('inputColumn が id の場合、上流 ID を直接 IN 句で使用する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [{ inputColumn: 'id', lookupColumn: 'post_id' }],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([
        { createdAtMs: 1000, id: 10 },
        { createdAtMs: 2000, id: 20 },
      ])

      const result = executeLookupRelated(db, node, input)

      expect(result.sql).toContain('lt.post_id IN (?, ?)')
      expect(result.binds).toEqual([10, 20])
    })

    it('inputColumn 省略時（空文字）も直接 IN 句で使用する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [{ inputColumn: '', lookupColumn: 'post_id' }],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([{ createdAtMs: 1000, id: 10 }])

      const result = executeLookupRelated(db, node, input)

      expect(result.sql).toContain('lt.post_id IN (?)')
      expect(result.binds).toEqual([10])
    })
  })

  describe('IN ベース: inputColumn 自動解決 (timeCondition なし)', () => {
    it('inputColumn が id 以外の場合、上流テーブルから subquery で取得する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [
          {
            inputColumn: 'actor_profile_id',
            lookupColumn: 'author_profile_id',
          },
        ],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([
        { createdAtMs: 1000, id: 100 },
        { createdAtMs: 2000, id: 200 },
      ])

      const result = executeLookupRelated(db, node, input)

      expect(result.sql).toContain(
        'lt.author_profile_id IN (SELECT actor_profile_id FROM notifications WHERE id IN (?, ?))',
      )
      expect(result.binds).toEqual([100, 200])
    })

    it('上流テーブル名が sourceTable として正しく使用される', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [
          { inputColumn: 'related_post_id', lookupColumn: 'id' },
        ],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([{ createdAtMs: 1000, id: 50 }], 'notifications')

      const result = executeLookupRelated(db, node, input)

      expect(result.sql).toContain(
        'SELECT related_post_id FROM notifications WHERE id IN (?)',
      )
    })
  })

  describe('IN ベース: 明示的 resolve (中間テーブル経由)', () => {
    it('resolve が指定されている場合、中間テーブル経由の subquery を生成する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [
          {
            inputColumn: 'id',
            lookupColumn: 'id',
            resolve: {
              inputKey: 'id',
              lookupKey: 'id',
              matchColumn: 'related_post_id',
              via: 'notifications',
            },
          },
        ],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([
        { createdAtMs: 1000, id: 10 },
        { createdAtMs: 2000, id: 20 },
      ])

      const result = executeLookupRelated(db, node, input)

      expect(result.sql).toContain(
        'lt.id IN (SELECT related_post_id FROM notifications WHERE id IN (?, ?))',
      )
      expect(result.binds).toEqual([10, 20])
      expect(result.dependentTables).toContain('notifications')
    })

    it('resolve は inputColumn の値に関わらず resolve パスを優先する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [
          {
            inputColumn: 'actor_profile_id',
            lookupColumn: 'author_profile_id',
            resolve: {
              inputKey: 'id',
              lookupKey: 'id',
              matchColumn: 'actor_profile_id',
              via: 'notifications',
            },
          },
        ],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([{ createdAtMs: 1000, id: 100 }])

      const result = executeLookupRelated(db, node, input)

      expect(result.sql).toContain(
        'lt.author_profile_id IN (SELECT actor_profile_id FROM notifications WHERE id IN (?))',
      )
    })

    it('resolve + timeCondition の場合、IN ベース + グローバル時間窓になる', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [
          {
            inputColumn: 'id',
            lookupColumn: 'id',
            resolve: {
              inputKey: 'id',
              lookupKey: 'id',
              matchColumn: 'related_post_id',
              via: 'notifications',
            },
          },
        ],
        kind: 'lookup-related',
        lookupTable: 'posts',
        timeCondition: {
          afterInput: true,
          inputTimeColumn: 'created_at_ms',
          lookupTimeColumn: 'created_at_ms',
          windowMs: 180000,
        },
      }
      const input = makeInput([
        { createdAtMs: 1000, id: 10 },
        { createdAtMs: 3000, id: 20 },
      ])

      const result = executeLookupRelated(db, node, input)

      // resolve があるため IN ベース（グローバル時間窓）
      expect(result.sql).toContain('lt.id IN (SELECT related_post_id')
      expect(result.sql).toContain('lt.created_at_ms > ?')
      expect(result.sql).toContain('lt.created_at_ms <= ?')
      // JOIN は使用されない
      expect(result.sql).not.toContain('JOIN')
    })
  })

  describe('JOIN ベース: timeCondition あり・resolve なし (per-row 相関)', () => {
    it('afterInput=true + inputColumn=id の場合、per-row 相関の JOIN クエリを生成する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [{ inputColumn: 'id', lookupColumn: 'id' }],
        kind: 'lookup-related',
        lookupTable: 'posts',
        timeCondition: {
          afterInput: true,
          inputTimeColumn: 'created_at_ms',
          lookupTimeColumn: 'created_at_ms',
          windowMs: 180000,
        },
      }
      const input = makeInput([
        { createdAtMs: 1000, id: 1 },
        { createdAtMs: 3000, id: 3 },
      ])

      const result = executeLookupRelated(db, node, input)

      // JOIN を使用
      expect(result.sql).toContain('JOIN notifications src ON src.id = lt.id')
      expect(result.sql).toContain('src.id IN (?, ?)')
      // per-row 時間条件
      expect(result.sql).toContain('lt.created_at_ms > src.created_at_ms')
      expect(result.sql).toContain(
        'lt.created_at_ms <= src.created_at_ms + 180000',
      )
      // DISTINCT を使用
      expect(result.sql).toContain('SELECT DISTINCT')
      // バインドは入力 ID のみ（時間は per-row なので bind 不要）
      expect(result.binds).toEqual([1, 3])
    })

    it('afterInput=true + inputColumn=actor_profile_id の場合、inputColumn で JOIN する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [
          {
            inputColumn: 'actor_profile_id',
            lookupColumn: 'author_profile_id',
          },
        ],
        kind: 'lookup-related',
        lookupTable: 'posts',
        timeCondition: {
          afterInput: true,
          inputTimeColumn: 'created_at_ms',
          lookupTimeColumn: 'created_at_ms',
          windowMs: 180000,
        },
      }
      const input = makeInput([
        { createdAtMs: 1000, id: 100 },
        { createdAtMs: 5000, id: 200 },
      ])

      const result = executeLookupRelated(db, node, input)

      // inputColumn で JOIN
      expect(result.sql).toContain(
        'JOIN notifications src ON src.actor_profile_id = lt.author_profile_id',
      )
      expect(result.sql).toContain('src.id IN (?, ?)')
      // per-row 時間条件
      expect(result.sql).toContain('lt.created_at_ms > src.created_at_ms')
      expect(result.sql).toContain(
        'lt.created_at_ms <= src.created_at_ms + 180000',
      )
      expect(result.binds).toEqual([100, 200])
    })

    it('afterInput=false の場合、上流時間の前の時間窓で per-row 検索する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [{ inputColumn: 'id', lookupColumn: 'id' }],
        kind: 'lookup-related',
        lookupTable: 'posts',
        timeCondition: {
          afterInput: false,
          inputTimeColumn: 'created_at_ms',
          lookupTimeColumn: 'created_at_ms',
          windowMs: 60000,
        },
      }
      const input = makeInput([
        { createdAtMs: 5000, id: 1 },
        { createdAtMs: 8000, id: 2 },
      ])

      const result = executeLookupRelated(db, node, input)

      expect(result.sql).toContain('lt.created_at_ms < src.created_at_ms')
      expect(result.sql).toContain(
        'lt.created_at_ms >= src.created_at_ms - 60000',
      )
    })
  })

  describe('dependentTables', () => {
    it('lookupTable と sourceTable が常に含まれる', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [{ inputColumn: 'id', lookupColumn: 'id' }],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([{ createdAtMs: 1000, id: 1 }])

      const result = executeLookupRelated(db, node, input)

      expect(result.dependentTables).toContain('posts')
      expect(result.dependentTables).toContain('notifications')
    })

    it('resolve の via テーブルも dependentTables に含まれる', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [
          {
            inputColumn: 'id',
            lookupColumn: 'id',
            resolve: {
              inputKey: 'id',
              lookupKey: 'id',
              matchColumn: 'post_id',
              via: 'timeline_entries',
            },
          },
        ],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([{ createdAtMs: 1000, id: 1 }])

      const result = executeLookupRelated(db, node, input)

      expect(result.dependentTables).toContain('timeline_entries')
    })
  })

  describe('出力テーブル解決', () => {
    it('lookupTable=posts の場合、出力行の table は posts になる', () => {
      const db = mockDb([[1, 5000]])
      const node: LookupRelatedNode = {
        joinConditions: [{ inputColumn: 'id', lookupColumn: 'id' }],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([{ createdAtMs: 1000, id: 1 }])

      const result = executeLookupRelated(db, node, input)

      expect(result.output.sourceTable).toBe('posts')
      expect(result.output.rows[0].table).toBe('posts')
    })

    it('lookupTable=notifications の場合、出力行の table は notifications になる', () => {
      const db = mockDb([[1, 5000]])
      const node: LookupRelatedNode = {
        joinConditions: [{ inputColumn: 'id', lookupColumn: 'id' }],
        kind: 'lookup-related',
        lookupTable: 'notifications',
      }
      const input = makeInput([{ createdAtMs: 1000, id: 1 }], 'posts')

      const result = executeLookupRelated(db, node, input)

      expect(result.output.sourceTable).toBe('notifications')
    })
  })

  describe('resolveIdentity: JOIN ベース (timeCondition あり)', () => {
    it('resolveIdentity=true の場合、profiles.canonical_acct を介した JOIN を生成する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [
          {
            inputColumn: 'actor_profile_id',
            lookupColumn: 'author_profile_id',
            resolveIdentity: true,
          },
        ],
        kind: 'lookup-related',
        lookupTable: 'posts',
        timeCondition: {
          afterInput: true,
          inputTimeColumn: 'created_at_ms',
          lookupTimeColumn: 'created_at_ms',
          windowMs: 180000,
        },
      }
      const input = makeInput([
        { createdAtMs: 1000, id: 19 },
        { createdAtMs: 5000, id: 20 },
      ])

      const result = executeLookupRelated(db, node, input)

      // profiles JOIN による同一人物解決
      expect(result.sql).toContain(
        'JOIN profiles _p_lt0 ON lt.author_profile_id = _p_lt0.id',
      )
      expect(result.sql).toContain(
        'JOIN profiles _p_src0 ON _p_lt0.canonical_acct = _p_src0.canonical_acct',
      )
      // source JOIN は profiles 経由
      expect(result.sql).toContain(
        'JOIN notifications src ON src.actor_profile_id = _p_src0.id',
      )
      // 直接 JOIN は使用されない
      expect(result.sql).not.toContain(
        'src.actor_profile_id = lt.author_profile_id',
      )
      // per-row 時間条件
      expect(result.sql).toContain('lt.created_at_ms > src.created_at_ms')
      expect(result.sql).toContain(
        'lt.created_at_ms <= src.created_at_ms + 180000',
      )
      // profiles が dependentTables に含まれる
      expect(result.dependentTables).toContain('profiles')
      // CTE は使用されない
      expect(result.sql).not.toContain('WITH')
    })

    it('resolveIdentity=false の joinCondition は通常の JOIN を生成する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [
          {
            inputColumn: 'actor_profile_id',
            lookupColumn: 'author_profile_id',
          },
        ],
        kind: 'lookup-related',
        lookupTable: 'posts',
        timeCondition: {
          afterInput: true,
          inputTimeColumn: 'created_at_ms',
          lookupTimeColumn: 'created_at_ms',
          windowMs: 180000,
        },
      }
      const input = makeInput([{ createdAtMs: 1000, id: 100 }])

      const result = executeLookupRelated(db, node, input)

      // profiles JOIN なし
      expect(result.sql).not.toContain('JOIN profiles')
      // 通常の JOIN
      expect(result.sql).toContain(
        'src.actor_profile_id = lt.author_profile_id',
      )
    })
  })

  describe('resolveIdentity: IN ベース (timeCondition なし)', () => {
    it('resolveIdentity=true の場合、canonical_acct サブクエリで同一人物の profile ID を展開する', () => {
      const db = mockDb()
      const node: LookupRelatedNode = {
        joinConditions: [
          {
            inputColumn: 'actor_profile_id',
            lookupColumn: 'author_profile_id',
            resolveIdentity: true,
          },
        ],
        kind: 'lookup-related',
        lookupTable: 'posts',
      }
      const input = makeInput([
        { createdAtMs: 1000, id: 10 },
        { createdAtMs: 2000, id: 20 },
      ])

      const result = executeLookupRelated(db, node, input)

      // canonical_acct カラムを使用したサブクエリ
      expect(result.sql).toContain(
        'lt.author_profile_id IN (SELECT p2.id FROM profiles p2',
      )
      expect(result.sql).toContain('p2.canonical_acct IN (')
      expect(result.sql).toContain('SELECT p1.canonical_acct FROM profiles p1')
      expect(result.sql).toContain(
        'SELECT DISTINCT actor_profile_id FROM notifications WHERE id IN (?, ?)',
      )
      // profiles が dependentTables に含まれる
      expect(result.dependentTables).toContain('profiles')
      // CTE は使用されない
      expect(result.sql).not.toContain('WITH')
    })
  })
})
