import { beforeEach, describe, expect, it } from 'vitest'
import { type NodeCacheKey, WorkerNodeCache } from '../executor/workerNodeCache'
import type { NodeOutputRow } from '../plan'

describe('WorkerNodeCache', () => {
  let cache: WorkerNodeCache

  beforeEach(() => {
    cache = new WorkerNodeCache()
  })

  // ============================================================
  // --- get / set 基本操作 ---
  // ============================================================
  describe('get / set 基本操作', () => {
    it('set で保存したエントリを同一パラメータで get した時、保存した rows がそのまま返ること', () => {
      // Arrange
      const params: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT * FROM users',
        upstreamHash: 'h1',
      }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
        { createdAtMs: 2000, id: 2, table: 'posts' },
      ]
      cache.set(params, rows, ['users'])

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows)
    })

    it('set していないパラメータで get した時、null が返ること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toBeNull()
    })

    it('同一キーに対して set を2回呼んだ時、後から保存した rows で上書きされること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows1: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      const rows2: NodeOutputRow[] = [
        { createdAtMs: 9000, id: 99, table: 'posts' },
      ]
      cache.set(params, rows1, ['t'])

      // Act
      cache.set(params, rows2, ['t'])
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows2)
    })

    it('異なるパラメータで複数エントリを set した時、それぞれ独立して get できること', () => {
      // Arrange
      const params1: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const params2: NodeCacheKey = { binds: [], nodeId: 'n2', sql: 'SELECT 2' }
      const rows1: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      const rows2: NodeOutputRow[] = [
        { createdAtMs: 2000, id: 2, table: 'posts' },
      ]
      cache.set(params1, rows1, ['t1'])
      cache.set(params2, rows2, ['t2'])

      // Act
      const result1 = cache.get(params1)
      const result2 = cache.get(params2)

      // Assert
      expect(result1).toEqual(rows1)
      expect(result2).toEqual(rows2)
    })

    it('rows が空配列の時、空配列がそのままキャッシュされ get で空配列が返ること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      cache.set(params, [], ['t'])

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toEqual([])
    })

    it('dependentTables が空配列の時、テーブル依存なしとして保存され get で rows が返ること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, [])

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows)
    })
  })

  // ============================================================
  // --- キー生成（makeKey の振る舞い） ---
  // ============================================================
  describe('キー生成', () => {
    it('nodeId・sql・binds・upstreamHash がすべて同一の時、同じキャッシュエントリが返ること', () => {
      // Arrange
      const params: NodeCacheKey = {
        binds: [1, 'a'],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['t'])
      const sameParams: NodeCacheKey = {
        binds: [1, 'a'],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }

      // Act
      const result = cache.get(sameParams)

      // Assert
      expect(result).toEqual(rows)
    })

    it('nodeId のみ異なる時、別のキャッシュエントリとして扱われること', () => {
      // Arrange
      const params1: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }
      const params2: NodeCacheKey = {
        binds: [1],
        nodeId: 'n2',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params1, rows, ['t'])

      // Act
      const result = cache.get(params2)

      // Assert
      expect(result).toBeNull()
    })

    it('sql のみ異なる時、別のキャッシュエントリとして扱われること', () => {
      // Arrange
      const params1: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }
      const params2: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT 2',
        upstreamHash: 'h1',
      }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params1, rows, ['t'])

      // Act
      const result = cache.get(params2)

      // Assert
      expect(result).toBeNull()
    })

    it('binds の値が異なる時、別のキャッシュエントリとして扱われること', () => {
      // Arrange
      const params1: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }
      const params2: NodeCacheKey = {
        binds: [2],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params1, rows, ['t'])

      // Act
      const result = cache.get(params2)

      // Assert
      expect(result).toBeNull()
    })

    it('binds の順序が異なる時、別のキャッシュエントリとして扱われること', () => {
      // Arrange
      const params1: NodeCacheKey = {
        binds: [1, 2],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }
      const params2: NodeCacheKey = {
        binds: [2, 1],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params1, rows, ['t'])

      // Act
      const result = cache.get(params2)

      // Assert
      expect(result).toBeNull()
    })

    it('upstreamHash のみ異なる時、別のキャッシュエントリとして扱われること', () => {
      // Arrange
      const params1: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }
      const params2: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h2',
      }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params1, rows, ['t'])

      // Act
      const result = cache.get(params2)

      // Assert
      expect(result).toBeNull()
    })

    it('upstreamHash が undefined の時と空文字の時で、異なるキーとして扱われること', () => {
      // Arrange
      const paramsUndefined: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: undefined,
      }
      const paramsEmpty: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: '',
      }
      const rowsUndefined: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      const rowsEmpty: NodeOutputRow[] = [
        { createdAtMs: 2000, id: 2, table: 'posts' },
      ]
      cache.set(paramsUndefined, rowsUndefined, ['t'])
      cache.set(paramsEmpty, rowsEmpty, ['t'])

      // Act
      const resultUndefined = cache.get(paramsUndefined)
      const resultEmpty = cache.get(paramsEmpty)

      // Assert
      expect(resultUndefined).toEqual(rowsUndefined)
      expect(resultEmpty).toEqual(rowsEmpty)
    })

    it('upstreamHash が undefined の場合、nodeId・sql・binds のみでキーが生成されること', () => {
      // Arrange
      const paramsNoHash: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT 1',
      }
      const paramsWithHash: NodeCacheKey = {
        binds: [1],
        nodeId: 'n1',
        sql: 'SELECT 1',
        upstreamHash: 'h1',
      }
      const rowsNoHash: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      const rowsWithHash: NodeOutputRow[] = [
        { createdAtMs: 2000, id: 2, table: 'posts' },
      ]
      cache.set(paramsNoHash, rowsNoHash, ['t'])
      cache.set(paramsWithHash, rowsWithHash, ['t'])

      // Act
      const resultNoHash = cache.get(paramsNoHash)
      const resultWithHash = cache.get(paramsWithHash)

      // Assert
      expect(resultNoHash).toEqual(rowsNoHash)
      expect(resultWithHash).toEqual(rowsWithHash)
    })

    it('binds に null を含む時、正しくキーが生成されキャッシュが機能すること', () => {
      // Arrange
      const params: NodeCacheKey = {
        binds: [null, 1, 'a'],
        nodeId: 'n1',
        sql: 'SELECT 1',
      }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['t'])

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows)
    })

    it('binds が空配列の時、正しくキーが生成されキャッシュが機能すること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['t'])

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows)
    })
  })

  // ============================================================
  // --- バージョン無効化（テーブルバージョンベース） ---
  // ============================================================
  describe('バージョン無効化', () => {
    it('set 後にテーブルバージョンが変わっていない時、get でキャッシュヒットすること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA'])

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows)
    })

    it('set 後に依存テーブルの bumpVersion が呼ばれた時、get で null が返ること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA'])
      cache.bumpVersion('tableA')

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toBeNull()
    })

    it('バージョン不一致で get 時に無効化された後、同一キーで再度 get した時もエントリが削除されていて null が返ること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA'])
      cache.bumpVersion('tableA')
      cache.get(params) // 1回目の get でエントリが削除される

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toBeNull()
    })

    it('依存テーブルに含まれないテーブルの bumpVersion が呼ばれた時、キャッシュが無効化されないこと', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA'])
      cache.bumpVersion('tableB') // 依存していないテーブル

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows)
    })

    it('set 時点でテーブルバージョンが 0 より大きい時、そのバージョンがスナップショットとして記録され get できること', () => {
      // Arrange
      cache.bumpVersion('tableA') // version = 1
      cache.bumpVersion('tableA') // version = 2
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA']) // スナップショットは version 2

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows)
    })
  })

  // ============================================================
  // --- 依存テーブル追跡（複数テーブル依存） ---
  // ============================================================
  describe('依存テーブル追跡', () => {
    it('複数テーブルに依存するエントリで、1つのテーブルだけバージョンが変わった時、キャッシュが無効化されること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA', 'tableB', 'tableC'])
      cache.bumpVersion('tableB') // 1つだけバージョンアップ

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toBeNull()
    })

    it('複数テーブルに依存するエントリで、すべてのテーブルのバージョンが変わった時、キャッシュが無効化されること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA', 'tableB'])
      cache.bumpVersion('tableA')
      cache.bumpVersion('tableB')

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toBeNull()
    })

    it('複数テーブルに依存するエントリで、どのテーブルもバージョンが変わっていない時、キャッシュヒットすること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA', 'tableB', 'tableC'])

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows)
    })

    it('異なるエントリが異なるテーブルに依存している時、一方のテーブル更新で他方のエントリは影響を受けないこと', () => {
      // Arrange
      const params1: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const params2: NodeCacheKey = { binds: [], nodeId: 'n2', sql: 'SELECT 2' }
      const rows1: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      const rows2: NodeOutputRow[] = [
        { createdAtMs: 2000, id: 2, table: 'posts' },
      ]
      cache.set(params1, rows1, ['tableA'])
      cache.set(params2, rows2, ['tableB'])
      cache.bumpVersion('tableA') // tableA のみ更新

      // Act
      const result1 = cache.get(params1)
      const result2 = cache.get(params2)

      // Assert
      expect(result1).toBeNull()
      expect(result2).toEqual(rows2)
    })

    it('依存テーブルが未登録（バージョン 0 扱い）の状態で set し、その後 bumpVersion された時、無効化されること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA']) // tableA 未登録 → スナップショットは version 0
      cache.bumpVersion('tableA') // version 0 → 1

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toBeNull()
    })
  })

  // ============================================================
  // --- bumpVersion ---
  // ============================================================
  describe('bumpVersion', () => {
    it('未登録テーブルに対して bumpVersion を呼んだ時、バージョンが 1 になること', () => {
      // Arrange（未登録状態）

      // Act
      cache.bumpVersion('tableA')

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableA']).toBe(1)
    })

    it('既にバージョンが存在するテーブルに bumpVersion を呼んだ時、バージョンが 1 増加すること', () => {
      // Arrange
      cache.bumpVersion('tableA') // version = 1

      // Act
      cache.bumpVersion('tableA')

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableA']).toBe(2)
    })

    it('同じテーブルに対して bumpVersion を複数回呼んだ時、呼んだ回数分バージョンが増加すること', () => {
      // Arrange（初期状態）

      // Act
      cache.bumpVersion('tableA')
      cache.bumpVersion('tableA')
      cache.bumpVersion('tableA')
      cache.bumpVersion('tableA')
      cache.bumpVersion('tableA')

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableA']).toBe(5)
    })

    it('あるテーブルの bumpVersion が他のテーブルのバージョンに影響しないこと', () => {
      // Arrange
      cache.bumpVersion('tableA') // tableA = 1
      cache.bumpVersion('tableB') // tableB = 1

      // Act
      cache.bumpVersion('tableA') // tableA = 2

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableA']).toBe(2)
      expect(versions['tableB']).toBe(1)
    })
  })

  // ============================================================
  // --- syncVersions ---
  // ============================================================
  describe('syncVersions', () => {
    it('外部バージョンがローカルより大きい時、ローカルバージョンが外部の値に更新されること', () => {
      // Arrange
      cache.bumpVersion('tableA') // local = 1

      // Act
      cache.syncVersions(new Map([['tableA', 5]]))

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableA']).toBe(5)
    })

    it('外部バージョンがローカルと同じ時、ローカルバージョンが変化しないこと', () => {
      // Arrange
      cache.bumpVersion('tableA') // local = 1

      // Act
      cache.syncVersions(new Map([['tableA', 1]]))

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableA']).toBe(1)
    })

    it('外部バージョンがローカルより小さい時、ローカルバージョンが変化しないこと（巻き戻らないこと）', () => {
      // Arrange
      cache.bumpVersion('tableA') // local = 1
      cache.bumpVersion('tableA') // local = 2
      cache.bumpVersion('tableA') // local = 3

      // Act
      cache.syncVersions(new Map([['tableA', 1]]))

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableA']).toBe(3)
    })

    it('ローカルに存在しないテーブルが外部にある時、そのテーブルのバージョンが新規追加されること', () => {
      // Arrange（tableX はローカルに未登録）

      // Act
      cache.syncVersions(new Map([['tableX', 10]]))

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableX']).toBe(10)
    })

    it('外部に存在しないテーブルがローカルにある時、そのテーブルのバージョンが維持されること', () => {
      // Arrange
      cache.bumpVersion('tableA') // local tableA = 1

      // Act
      cache.syncVersions(new Map([['tableB', 5]])) // 外部には tableB のみ

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableA']).toBe(1)
      expect(versions['tableB']).toBe(5)
    })

    it('空の Map を syncVersions に渡した時、ローカルバージョンが変化しないこと', () => {
      // Arrange
      cache.bumpVersion('tableA') // local = 1

      // Act
      cache.syncVersions(new Map())

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableA']).toBe(1)
    })

    it('syncVersions で依存テーブルのバージョンが上がった場合、既存キャッシュが無効化されること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA']) // スナップショットは tableA version 0
      cache.syncVersions(new Map([['tableA', 3]])) // tableA が 3 に跳ぶ

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toBeNull()
    })
  })

  // ============================================================
  // --- captureVersions ---
  // ============================================================
  describe('captureVersions', () => {
    it('テーブルバージョンが未登録の時、空オブジェクトが返ること', () => {
      // Arrange（初期状態）

      // Act
      const versions = cache.captureVersions()

      // Assert
      expect(versions).toEqual({})
    })

    it('bumpVersion で登録されたテーブルバージョンが captureVersions の結果に含まれること', () => {
      // Arrange
      cache.bumpVersion('tableA')
      cache.bumpVersion('tableB')
      cache.bumpVersion('tableB')

      // Act
      const versions = cache.captureVersions()

      // Assert
      expect(versions).toEqual({ tableA: 1, tableB: 2 })
    })

    it('syncVersions で登録されたテーブルバージョンが captureVersions の結果に含まれること', () => {
      // Arrange
      cache.syncVersions(
        new Map([
          ['tableX', 7],
          ['tableY', 3],
        ]),
      )

      // Act
      const versions = cache.captureVersions()

      // Assert
      expect(versions).toEqual({ tableX: 7, tableY: 3 })
    })

    it('captureVersions の結果が Record<string, number> 型のプレーンオブジェクトであること', () => {
      // Arrange
      cache.bumpVersion('tableA')

      // Act
      const versions = cache.captureVersions()

      // Assert
      expect(typeof versions).toBe('object')
      expect(versions).not.toBeInstanceOf(Map)
      expect(Array.isArray(versions)).toBe(false)
      expect(Object.getPrototypeOf(versions)).toBe(Object.prototype)
      for (const value of Object.values(versions)) {
        expect(typeof value).toBe('number')
      }
    })
  })

  // ============================================================
  // --- clear ---
  // ============================================================
  describe('clear', () => {
    it('キャッシュにエントリがある状態で clear を呼んだ時、すべてのエントリが削除されること', () => {
      // Arrange
      const params1: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const params2: NodeCacheKey = { binds: [], nodeId: 'n2', sql: 'SELECT 2' }
      cache.set(params1, [{ createdAtMs: 1000, id: 1, table: 'posts' }], ['t1'])
      cache.set(params2, [{ createdAtMs: 2000, id: 2, table: 'posts' }], ['t2'])

      // Act
      cache.clear()

      // Assert
      expect(cache.get(params1)).toBeNull()
      expect(cache.get(params2)).toBeNull()
    })

    it('clear 後に以前 set したキーで get した時、null が返ること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      cache.set(params, [{ createdAtMs: 1000, id: 1, table: 'posts' }], ['t'])
      cache.clear()

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toBeNull()
    })

    it('clear 後に size が 0 になること', () => {
      // Arrange
      cache.set(
        { binds: [], nodeId: 'n1', sql: 'SELECT 1' },
        [{ createdAtMs: 1000, id: 1, table: 'posts' }],
        ['t'],
      )
      cache.set(
        { binds: [], nodeId: 'n2', sql: 'SELECT 2' },
        [{ createdAtMs: 2000, id: 2, table: 'posts' }],
        ['t'],
      )

      // Act
      cache.clear()

      // Assert
      expect(cache.size).toBe(0)
    })

    it('clear を呼んでもテーブルバージョンはリセットされないこと', () => {
      // Arrange
      cache.bumpVersion('tableA')
      cache.bumpVersion('tableA')

      // Act
      cache.clear()

      // Assert
      const versions = cache.captureVersions()
      expect(versions['tableA']).toBe(2)
    })

    it('キャッシュが空の状態で clear を呼んでもエラーにならないこと', () => {
      // Arrange（空のキャッシュ）

      // Act & Assert
      expect(() => cache.clear()).not.toThrow()
    })
  })

  // ============================================================
  // --- size ---
  // ============================================================
  describe('size', () => {
    it('初期状態の時、size が 0 であること', () => {
      // Arrange（初期状態）

      // Act
      const result = cache.size

      // Assert
      expect(result).toBe(0)
    })

    it('エントリを1つ set した時、size が 1 になること', () => {
      // Arrange
      cache.set(
        { binds: [], nodeId: 'n1', sql: 'SELECT 1' },
        [{ createdAtMs: 1000, id: 1, table: 'posts' }],
        ['t'],
      )

      // Act
      const result = cache.size

      // Assert
      expect(result).toBe(1)
    })

    it('同一キーで set を2回呼んだ時、size が 1 のままであること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      cache.set(params, [{ createdAtMs: 1000, id: 1, table: 'posts' }], ['t'])
      cache.set(params, [{ createdAtMs: 2000, id: 2, table: 'posts' }], ['t'])

      // Act
      const result = cache.size

      // Assert
      expect(result).toBe(1)
    })

    it('バージョン不一致で get 時に無効化された後、size が減少すること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      cache.set(
        params,
        [{ createdAtMs: 1000, id: 1, table: 'posts' }],
        ['tableA'],
      )
      expect(cache.size).toBe(1) // 前提条件の確認
      cache.bumpVersion('tableA')

      // Act
      cache.get(params) // get 時にバージョン不一致で削除される
      const result = cache.size

      // Assert
      expect(result).toBe(0)
    })
  })

  // ============================================================
  // --- 状態遷移（複合操作） ---
  // ============================================================
  describe('状態遷移（複合操作）', () => {
    it('set → bumpVersion → set の順で操作した時、新しいバージョンでエントリが保存され get できること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows1: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      const rows2: NodeOutputRow[] = [
        { createdAtMs: 2000, id: 2, table: 'posts' },
      ]
      cache.set(params, rows1, ['tableA']) // スナップショット version 0
      cache.bumpVersion('tableA') // version = 1

      // Act
      cache.set(params, rows2, ['tableA']) // 新スナップショット version 1
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows2)
    })

    it('set → bumpVersion → get(null) → 再度 set → get の順で操作した時、再キャッシュが正しく動作すること', () => {
      // Arrange
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows1: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      const rows2: NodeOutputRow[] = [
        { createdAtMs: 2000, id: 2, table: 'posts' },
      ]
      cache.set(params, rows1, ['tableA'])
      cache.bumpVersion('tableA')
      const missResult = cache.get(params) // null が返り、エントリ削除
      expect(missResult).toBeNull() // 前提条件の確認

      // Act
      cache.set(params, rows2, ['tableA']) // 新バージョンで再キャッシュ
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows2)
    })

    it('syncVersions → set → bumpVersion → get の順で操作した時、bumpVersion による無効化が正しく動作すること', () => {
      // Arrange
      cache.syncVersions(new Map([['tableA', 5]])) // tableA = 5
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]
      cache.set(params, rows, ['tableA']) // スナップショット tableA version 5
      cache.bumpVersion('tableA') // tableA = 6

      // Act
      const result = cache.get(params)

      // Assert
      expect(result).toBeNull()
    })

    it('clear → set → get の順で操作した時、clear 後に新しいエントリが正常にキャッシュされること', () => {
      // Arrange
      cache.set(
        { binds: [], nodeId: 'n1', sql: 'SELECT 1' },
        [{ createdAtMs: 9000, id: 99, table: 'posts' }],
        ['t'],
      )
      cache.clear()
      const params: NodeCacheKey = { binds: [], nodeId: 'n1', sql: 'SELECT 1' }
      const rows: NodeOutputRow[] = [
        { createdAtMs: 1000, id: 1, table: 'posts' },
      ]

      // Act
      cache.set(params, rows, ['t'])
      const result = cache.get(params)

      // Assert
      expect(result).toEqual(rows)
    })
  })
})
