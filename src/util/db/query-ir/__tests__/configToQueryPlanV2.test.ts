import type { TimelineConfigV2 } from 'types/types'
import { describe, expect, it } from 'vitest'
import {
  type ConfigToV2Context,
  configToQueryPlanV2,
} from '../configToQueryPlanV2'
import type {
  ExistsCondition,
  FilterCondition,
  GetIdsFilter,
  GetIdsNode,
  MergeNodeV2,
  OutputNodeV2,
  QueryPlanV2,
} from '../nodes'

// ================ ヘルパー関数 ================

function makeConfig(
  overrides: Partial<TimelineConfigV2> = {},
): TimelineConfigV2 {
  return {
    id: 'test',
    order: 0,
    type: 'home',
    visible: true,
    ...overrides,
  }
}

function makeContext(
  overrides: Partial<ConfigToV2Context> = {},
): ConfigToV2Context {
  return {
    localAccountIds: [],
    queryLimit: 50,
    serverIds: [],
    ...overrides,
  }
}

/** ノード ID で検索 */
function findNode(plan: QueryPlanV2, id: string) {
  return plan.nodes.find((n) => n.id === id)
}

/** kind でノードをすべて検索 */
function findNodesByKind(plan: QueryPlanV2, kind: string) {
  return plan.nodes.filter((n) => n.node.kind === kind)
}

/** GetIdsNode を ID 指定で取得 */
function getGetIdsNode(plan: QueryPlanV2, id: string): GetIdsNode {
  const found = findNode(plan, id)
  if (!found || found.node.kind !== 'get-ids') {
    throw new Error(`GetIdsNode not found: ${id}`)
  }
  return found.node
}

/** OutputNodeV2 を取得 */
function getOutputNode(plan: QueryPlanV2): OutputNodeV2 {
  const found = plan.nodes.find((n) => n.node.kind === 'output-v2')
  if (!found) throw new Error('OutputNodeV2 not found')
  return found.node as OutputNodeV2
}

// ---- フィルタ判別 ----

function isFilterCond(f: GetIdsFilter): f is FilterCondition {
  return 'column' in f && 'op' in f
}

function isExistsCond(f: GetIdsFilter): f is ExistsCondition {
  return 'mode' in f
}

/** table + column + op で FilterCondition を探す */
function findFilter(
  filters: GetIdsFilter[],
  table: string,
  column: string,
  op?: string,
): FilterCondition | undefined {
  return filters.find(
    (f): f is FilterCondition =>
      isFilterCond(f) &&
      f.table === table &&
      f.column === column &&
      (op == null || f.op === op),
  )
}

/** table + mode で ExistsCondition を探す */
function findExists(
  filters: GetIdsFilter[],
  table: string,
  mode?: string,
): ExistsCondition | undefined {
  return filters.find(
    (f): f is ExistsCondition =>
      isExistsCond(f) && f.table === table && (mode == null || f.mode === mode),
  )
}

/** table + mode で ExistsCondition をすべて取得 */
function findAllExists(
  filters: GetIdsFilter[],
  table: string,
  mode?: string,
): ExistsCondition[] {
  return filters.filter(
    (f): f is ExistsCondition =>
      isExistsCond(f) && f.table === table && (mode == null || f.mode === mode),
  )
}

// ================ テスト ================

describe('configToQueryPlanV2', () => {
  // --- 正常系: 共通構造 ---
  describe('共通構造', () => {
    it('生成されたQueryPlanV2のversionが2であること', () => {
      // Arrange
      const config = makeConfig()
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      expect(plan.version).toBe(2)
    })

    it('単一ソースの場合、nodesにsourceとoutputの2つが含まれること', () => {
      // Arrange
      const config = makeConfig()
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      expect(plan.nodes).toHaveLength(2)
      expect(findNode(plan, 'source')).toBeDefined()
      expect(findNode(plan, 'output')).toBeDefined()
    })

    it('単一ソースの場合、edgesにsource→outputの1本が含まれること', () => {
      // Arrange
      const config = makeConfig()
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      expect(plan.edges).toHaveLength(1)
      expect(plan.edges[0]).toEqual({ source: 'source', target: 'output' })
    })
  })

  // --- 正常系: home タイムライン ---
  describe('home タイムライン', () => {
    it('type=homeの時、GetIdsノードのtableがtimeline_entriesであること', () => {
      // Arrange
      const config = makeConfig({ type: 'home' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      expect(node.table).toBe('timeline_entries')
    })

    it('type=homeの時、timeline_key IN ["home"] のフィルタが含まれること', () => {
      // Arrange
      const config = makeConfig({ type: 'home' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'timeline_entries',
        'timeline_key',
        'IN',
      )
      expect(filter).toBeDefined()
      expect(filter!.value).toEqual(['home'])
    })

    it('type=homeの時、localAccountIdsが存在すればlocal_account_id INフィルタが含まれること', () => {
      // Arrange
      const config = makeConfig({ type: 'home' })
      const context = makeContext({ localAccountIds: [1, 2] })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'timeline_entries',
        'local_account_id',
        'IN',
      )
      expect(filter).toBeDefined()
      expect(filter!.value).toEqual([1, 2])
    })

    it('type=homeの時、outputIdColumnがpost_idであること', () => {
      // Arrange
      const config = makeConfig({ type: 'home' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      expect(node.outputIdColumn).toBe('post_id')
    })
  })

  // --- 正常系: local タイムライン ---
  describe('local タイムライン', () => {
    it('type=localの時、GetIdsノードのtableがtimeline_entriesであること', () => {
      // Arrange
      const config = makeConfig({ type: 'local' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      expect(node.table).toBe('timeline_entries')
    })

    it('type=localの時、timeline_key IN ["local"] のフィルタが含まれること', () => {
      // Arrange
      const config = makeConfig({ type: 'local' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'timeline_entries',
        'timeline_key',
        'IN',
      )
      expect(filter).toBeDefined()
      expect(filter!.value).toEqual(['local'])
    })

    it('type=localの時、localAccountIdsが空でもlocal_account_idフィルタが追加されないこと', () => {
      // Arrange
      const config = makeConfig({ type: 'local' })
      const context = makeContext({ localAccountIds: [] })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'timeline_entries',
        'local_account_id',
      )
      expect(filter).toBeUndefined()
    })

    it('type=localの時、outputIdColumnがpost_idであること', () => {
      // Arrange
      const config = makeConfig({ type: 'local' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      expect(node.outputIdColumn).toBe('post_id')
    })
  })

  // --- 正常系: public タイムライン ---
  describe('public タイムライン', () => {
    it('type=publicの時、GetIdsノードのtableがtimeline_entriesであること', () => {
      // Arrange
      const config = makeConfig({ type: 'public' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      expect(node.table).toBe('timeline_entries')
    })

    it('type=publicの時、timeline_key IN ["public"] のフィルタが含まれること', () => {
      // Arrange
      const config = makeConfig({ type: 'public' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'timeline_entries',
        'timeline_key',
        'IN',
      )
      expect(filter).toBeDefined()
      expect(filter!.value).toEqual(['public'])
    })

    it('type=publicの時、outputIdColumnがpost_idであること', () => {
      // Arrange
      const config = makeConfig({ type: 'public' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      expect(node.outputIdColumn).toBe('post_id')
    })
  })

  // --- 正常系: tag タイムライン ---
  describe('tag タイムライン', () => {
    it('type=tagの時、GetIdsノードのtableがpostsであること', () => {
      // Arrange
      const config = makeConfig({ type: 'tag' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      expect(node.table).toBe('posts')
    })

    it('type=tagの時、outputIdColumnがundefinedであること', () => {
      // Arrange
      const config = makeConfig({ type: 'tag' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      expect(node.outputIdColumn).toBeUndefined()
    })

    describe('ORモード', () => {
      it('tagConfig.mode=orの時、post_hashtagsテーブルにexists条件が1つ生成されること', () => {
        // Arrange
        const config = makeConfig({
          tagConfig: { mode: 'or', tags: ['vitest', 'testing'] },
          type: 'tag',
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const conditions = findAllExists(
          node.filters,
          'post_hashtags',
          'exists',
        )
        expect(conditions).toHaveLength(1)
      })

      it('tagConfig.mode=orで複数タグの時、innerFiltersにhashtags.name IN [タグ一覧] が含まれること', () => {
        // Arrange
        const config = makeConfig({
          tagConfig: { mode: 'or', tags: ['vitest', 'testing'] },
          type: 'tag',
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'post_hashtags', 'exists')
        expect(exists).toBeDefined()
        expect(exists!.innerFilters).toBeDefined()
        const inner = exists!.innerFilters!.find(
          (f) => f.table === 'hashtags' && f.column === 'name' && f.op === 'IN',
        )
        expect(inner).toBeDefined()
        expect(inner!.value).toEqual(['vitest', 'testing'])
      })

      it('タグ名が大文字を含む時、小文字に正規化されてフィルタに設定されること', () => {
        // Arrange
        const config = makeConfig({
          tagConfig: { mode: 'or', tags: ['Vitest', 'TESTING'] },
          type: 'tag',
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'post_hashtags', 'exists')
        expect(exists).toBeDefined()
        const inner = exists!.innerFilters!.find(
          (f) => f.table === 'hashtags' && f.column === 'name',
        )
        expect(inner!.value).toEqual(['vitest', 'testing'])
      })
    })

    describe('ANDモード', () => {
      it('tagConfig.mode=andで複数タグの時、タグ数と同数のexists条件が生成されること', () => {
        // Arrange
        const config = makeConfig({
          tagConfig: { mode: 'and', tags: ['vitest', 'testing', 'tdd'] },
          type: 'tag',
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const conditions = findAllExists(
          node.filters,
          'post_hashtags',
          'exists',
        )
        expect(conditions).toHaveLength(3)
      })

      it('tagConfig.mode=andの時、各exists条件のinnerFiltersにhashtags.name = (小文字タグ名) が含まれること', () => {
        // Arrange
        const config = makeConfig({
          tagConfig: { mode: 'and', tags: ['Vitest', 'Testing'] },
          type: 'tag',
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const conditions = findAllExists(
          node.filters,
          'post_hashtags',
          'exists',
        )
        expect(conditions).toHaveLength(2)

        const innerValues = conditions.map((ec) => {
          const inner = ec.innerFilters!.find(
            (f) =>
              f.table === 'hashtags' && f.column === 'name' && f.op === '=',
          )
          return inner!.value
        })
        expect(innerValues).toContain('vitest')
        expect(innerValues).toContain('testing')
      })
    })

    describe('単一タグ', () => {
      it('タグが1つの時、modeに関わらずexists条件が1つだけ生成されること', () => {
        // Arrange（mode=and でもタグ1つなら OR パスに入る）
        const config = makeConfig({
          tagConfig: { mode: 'and', tags: ['vitest'] },
          type: 'tag',
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const conditions = findAllExists(
          node.filters,
          'post_hashtags',
          'exists',
        )
        expect(conditions).toHaveLength(1)
      })
    })

    // --- 境界値 ---
    it('tagConfigが未設定の時、post_hashtagsのexists条件が生成されないこと', () => {
      // Arrange
      const config = makeConfig({ type: 'tag' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const exists = findExists(node.filters, 'post_hashtags')
      expect(exists).toBeUndefined()
    })

    it('tagConfig.tagsが空配列の時、post_hashtagsのexists条件が生成されないこと', () => {
      // Arrange
      const config = makeConfig({
        tagConfig: { mode: 'or', tags: [] },
        type: 'tag',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const exists = findExists(node.filters, 'post_hashtags')
      expect(exists).toBeUndefined()
    })
  })

  // --- 正常系: notification タイムライン ---
  describe('notification タイムライン', () => {
    it('type=notificationの時、GetIdsノードのtableがnotificationsであること', () => {
      // Arrange
      const config = makeConfig({ type: 'notification' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      expect(node.table).toBe('notifications')
    })

    it('type=notificationの時、outputIdColumnがundefinedであること', () => {
      // Arrange
      const config = makeConfig({ type: 'notification' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      expect(node.outputIdColumn).toBeUndefined()
    })

    it('type=notificationの時、timeline_keyフィルタが生成されないこと', () => {
      // Arrange
      const config = makeConfig({ type: 'notification' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'timeline_entries',
        'timeline_key',
      )
      expect(filter).toBeUndefined()
    })

    describe('通知タイプフィルタ', () => {
      it('notificationFilterが指定されている時、notification_types.name INフィルタが含まれること', () => {
        // Arrange
        const config = makeConfig({
          notificationFilter: ['follow', 'favourite', 'reblog'],
          type: 'notification',
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(
          node.filters,
          'notification_types',
          'name',
          'IN',
        )
        expect(filter).toBeDefined()
        expect(filter!.value).toEqual(['follow', 'favourite', 'reblog'])
      })

      it('notificationFilterが未指定の時、notification_typesのフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig({ type: 'notification' })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'notification_types', 'name')
        expect(filter).toBeUndefined()
      })

      it('notificationFilterが空配列の時、notification_typesのフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig({
          notificationFilter: [],
          type: 'notification',
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'notification_types', 'name')
        expect(filter).toBeUndefined()
      })
    })
  })

  // --- 正常系: composite タイムライン ---
  describe('composite タイムライン', () => {
    it('timelineTypesが["home","local"]の時、GetIdsノードが2つ生成されること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home', 'local'],
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const getIdsNodes = findNodesByKind(plan, 'get-ids')
      expect(getIdsNodes).toHaveLength(2)
    })

    it('timelineTypesが["home","local"]の時、MergeNodeV2が1つ生成されること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home', 'local'],
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const mergeNodes = findNodesByKind(plan, 'merge-v2')
      expect(mergeNodes).toHaveLength(1)
    })

    it('MergeノードのstrategyがInterleave-by-timeであること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home', 'local'],
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const mergeNode = findNode(plan, 'merge')!.node as MergeNodeV2
      expect(mergeNode.strategy).toBe('interleave-by-time')
    })

    it('Mergeノードのlimitがcontext.queryLimitと一致すること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home', 'local'],
        type: 'home',
      })
      const context = makeContext({ queryLimit: 75 })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const mergeNode = findNode(plan, 'merge')!.node as MergeNodeV2
      expect(mergeNode.limit).toBe(75)
    })

    it('各GetIdsノードのidがsource-{key}形式であること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home', 'local'],
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      expect(findNode(plan, 'source-home')).toBeDefined()
      expect(findNode(plan, 'source-local')).toBeDefined()
    })

    it('各GetIdsノードからmergeへのedgeが存在すること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home', 'local'],
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      expect(plan.edges).toContainEqual({
        source: 'source-home',
        target: 'merge',
      })
      expect(plan.edges).toContainEqual({
        source: 'source-local',
        target: 'merge',
      })
    })

    it('mergeからoutputへのedgeが存在すること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home', 'local'],
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      expect(plan.edges).toContainEqual({ source: 'merge', target: 'output' })
    })

    it('timelineTypesが3つの時、GetIdsノードが3つ生成されること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home', 'local', 'public'],
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const getIdsNodes = findNodesByKind(plan, 'get-ids')
      expect(getIdsNodes).toHaveLength(3)
    })

    it('各GetIdsノードのtimeline_keyフィルタが個別のキーで設定されること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home', 'local', 'public'],
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      for (const key of ['home', 'local', 'public']) {
        const node = getGetIdsNode(plan, `source-${key}`)
        const filter = findFilter(
          node.filters,
          'timeline_entries',
          'timeline_key',
          'IN',
        )
        expect(filter).toBeDefined()
        expect(filter!.value).toEqual([key])
      }
    })

    it('コンテンツフィルタが各GetIdsノードに伝播されること', () => {
      // Arrange
      const config = makeConfig({
        onlyMedia: true,
        timelineTypes: ['home', 'local'],
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      for (const key of ['home', 'local']) {
        const node = getGetIdsNode(plan, `source-${key}`)
        const exists = findExists(node.filters, 'post_media', 'exists')
        expect(exists).toBeDefined()
      }
    })

    // --- 境界値 ---
    it('timelineTypesが1要素のみの時、compositeではなく単一ソースとして処理されること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home'],
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert（単一ソース: source + output、merge なし）
      expect(findNode(plan, 'source')).toBeDefined()
      expect(findNode(plan, 'output')).toBeDefined()
      expect(findNodesByKind(plan, 'merge-v2')).toHaveLength(0)
    })

    it('timelineTypesが未指定の時、config.typeをtimelineKeyとして単一ソース処理されること', () => {
      // Arrange
      const config = makeConfig({ type: 'local' })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      expect(findNode(plan, 'source')).toBeDefined()
      expect(findNodesByKind(plan, 'merge-v2')).toHaveLength(0)

      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'timeline_entries',
        'timeline_key',
        'IN',
      )
      expect(filter!.value).toEqual(['local'])
    })

    it('timelineTypesが空配列の時、config.typeをtimelineKeyとして単一ソース処理されること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: [],
        type: 'public',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      expect(findNode(plan, 'source')).toBeDefined()
      expect(findNodesByKind(plan, 'merge-v2')).toHaveLength(0)

      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'timeline_entries',
        'timeline_key',
        'IN',
      )
      expect(filter!.value).toEqual(['public'])
    })
  })

  // --- コンテンツフィルタ ---
  describe('コンテンツフィルタ', () => {
    describe('メディアフィルタ', () => {
      it('onlyMedia=trueの時、post_mediaテーブルのexists条件が含まれること', () => {
        // Arrange
        const config = makeConfig({ onlyMedia: true })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'post_media', 'exists')
        expect(exists).toBeDefined()
      })

      it('onlyMedia=falseの時、post_mediaのexists条件が含まれないこと', () => {
        // Arrange
        const config = makeConfig({ onlyMedia: false })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'post_media')
        expect(exists).toBeUndefined()
      })

      it('onlyMediaが未指定の時、post_mediaのexists条件が含まれないこと', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'post_media')
        expect(exists).toBeUndefined()
      })

      it('minMediaCountが2の時、post_mediaテーブルのcount-gte条件(countValue=2)が含まれること', () => {
        // Arrange
        const config = makeConfig({ minMediaCount: 2 })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'post_media', 'count-gte')
        expect(exists).toBeDefined()
        expect(exists!.countValue).toBe(2)
      })

      it('minMediaCountが1の時、count-gte条件(countValue=1)が含まれること', () => {
        // Arrange
        const config = makeConfig({ minMediaCount: 1 })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'post_media', 'count-gte')
        expect(exists).toBeDefined()
        expect(exists!.countValue).toBe(1)
      })

      it('minMediaCountが0の時、メディアフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig({ minMediaCount: 0 })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'post_media')
        expect(exists).toBeUndefined()
      })

      it('minMediaCountとonlyMediaの両方が設定されている時、minMediaCountが優先されること', () => {
        // Arrange
        const config = makeConfig({ minMediaCount: 3, onlyMedia: true })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const countGte = findExists(node.filters, 'post_media', 'count-gte')
        expect(countGte).toBeDefined()
        expect(countGte!.countValue).toBe(3)

        // exists は含まれない（count-gte が優先）
        const simpleExists = findExists(node.filters, 'post_media', 'exists')
        expect(simpleExists).toBeUndefined()
      })
    })

    describe('公開範囲フィルタ', () => {
      it('visibilityFilterが["public"]の時、visibility_types.name INフィルタが含まれること', () => {
        // Arrange
        const config = makeConfig({ visibilityFilter: ['public'] })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(
          node.filters,
          'visibility_types',
          'name',
          'IN',
        )
        expect(filter).toBeDefined()
        expect(filter!.value).toEqual(['public'])
      })

      it('visibilityFilterが["public","unlisted"]の時、2つの値を含むINフィルタが生成されること', () => {
        // Arrange
        const config = makeConfig({ visibilityFilter: ['public', 'unlisted'] })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(
          node.filters,
          'visibility_types',
          'name',
          'IN',
        )
        expect(filter).toBeDefined()
        expect(filter!.value).toEqual(['public', 'unlisted'])
      })

      it('visibilityFilterが未指定の時、visibility_typesフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'visibility_types', 'name')
        expect(filter).toBeUndefined()
      })

      it('visibilityFilterが空配列の時、visibility_typesフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig({ visibilityFilter: [] })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'visibility_types', 'name')
        expect(filter).toBeUndefined()
      })

      it('visibilityFilterが4種類すべてを含む時、フィルタが含まれないこと（全指定は制限なしと等価）', () => {
        // Arrange
        const config = makeConfig({
          visibilityFilter: ['public', 'unlisted', 'private', 'direct'],
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'visibility_types', 'name')
        expect(filter).toBeUndefined()
      })

      it('visibilityFilterが3種類の時、フィルタが含まれること', () => {
        // Arrange
        const config = makeConfig({
          visibilityFilter: ['public', 'unlisted', 'private'],
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(
          node.filters,
          'visibility_types',
          'name',
          'IN',
        )
        expect(filter).toBeDefined()
        expect(filter!.value).toEqual(['public', 'unlisted', 'private'])
      })
    })

    describe('言語フィルタ', () => {
      it('languageFilterが["ja"]の時、posts.language INフィルタが含まれること', () => {
        // Arrange
        const config = makeConfig({ languageFilter: ['ja'] })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'language', 'IN')
        expect(filter).toBeDefined()
        expect(filter!.value).toEqual(['ja'])
      })

      it('languageFilterが["ja","en"]の時、2つの値を含むINフィルタが生成されること', () => {
        // Arrange
        const config = makeConfig({ languageFilter: ['ja', 'en'] })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'language', 'IN')
        expect(filter).toBeDefined()
        expect(filter!.value).toEqual(['ja', 'en'])
      })

      it('languageFilterが未指定の時、languageフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'language')
        expect(filter).toBeUndefined()
      })

      it('languageFilterが空配列の時、languageフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig({ languageFilter: [] })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'language')
        expect(filter).toBeUndefined()
      })
    })

    describe('ブースト除外', () => {
      it('excludeReblogs=trueの時、posts.reblog_of_post_id IS NULLフィルタが含まれること', () => {
        // Arrange
        const config = makeConfig({ excludeReblogs: true })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(
          node.filters,
          'posts',
          'reblog_of_post_id',
          'IS NULL',
        )
        expect(filter).toBeDefined()
      })

      it('excludeReblogs=falseの時、reblog_of_post_idフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig({ excludeReblogs: false })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'reblog_of_post_id')
        expect(filter).toBeUndefined()
      })

      it('excludeReblogsが未指定の時、reblog_of_post_idフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'reblog_of_post_id')
        expect(filter).toBeUndefined()
      })
    })

    describe('リプライ除外', () => {
      it('excludeReplies=trueの時、posts.in_reply_to_uri IS NULLフィルタが含まれること', () => {
        // Arrange
        const config = makeConfig({ excludeReplies: true })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(
          node.filters,
          'posts',
          'in_reply_to_uri',
          'IS NULL',
        )
        expect(filter).toBeDefined()
      })

      it('excludeReplies=falseの時、in_reply_to_uriフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig({ excludeReplies: false })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'in_reply_to_uri')
        expect(filter).toBeUndefined()
      })

      it('excludeRepliesが未指定の時、in_reply_to_uriフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'in_reply_to_uri')
        expect(filter).toBeUndefined()
      })
    })

    describe('CW除外', () => {
      it('excludeSpoiler=trueの時、posts.spoiler_text = ""フィルタが含まれること', () => {
        // Arrange
        const config = makeConfig({ excludeSpoiler: true })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'spoiler_text', '=')
        expect(filter).toBeDefined()
        expect(filter!.value).toBe('')
      })

      it('excludeSpoiler=falseの時、spoiler_textフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig({ excludeSpoiler: false })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'spoiler_text')
        expect(filter).toBeUndefined()
      })
    })

    describe('センシティブ除外', () => {
      it('excludeSensitive=trueの時、posts.is_sensitive = 0フィルタが含まれること', () => {
        // Arrange
        const config = makeConfig({ excludeSensitive: true })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'is_sensitive', '=')
        expect(filter).toBeDefined()
        expect(filter!.value).toBe(0)
      })

      it('excludeSensitive=falseの時、is_sensitiveフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig({ excludeSensitive: false })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'posts', 'is_sensitive')
        expect(filter).toBeUndefined()
      })
    })

    describe('アカウントフィルタ', () => {
      it('accountFilter.mode=includeの時、profiles.acct INフィルタが含まれること', () => {
        // Arrange
        const config = makeConfig({
          accountFilter: { accts: ['user@mastodon.social'], mode: 'include' },
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'profiles', 'acct', 'IN')
        expect(filter).toBeDefined()
        expect(filter!.value).toEqual(['user@mastodon.social'])
      })

      it('accountFilter.mode=excludeの時、profiles.acct NOT INフィルタが含まれること', () => {
        // Arrange
        const config = makeConfig({
          accountFilter: { accts: ['spam@example.com'], mode: 'exclude' },
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'profiles', 'acct', 'NOT IN')
        expect(filter).toBeDefined()
        expect(filter!.value).toEqual(['spam@example.com'])
      })

      it('accountFilterが未指定の時、profiles.acctフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'profiles', 'acct')
        expect(filter).toBeUndefined()
      })

      it('accountFilter.acctsが空配列の時、profiles.acctフィルタが含まれないこと', () => {
        // Arrange
        const config = makeConfig({
          accountFilter: { accts: [], mode: 'include' },
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const filter = findFilter(node.filters, 'profiles', 'acct')
        expect(filter).toBeUndefined()
      })
    })

    describe('フォロー限定', () => {
      it('followsOnly=trueの時、followsテーブルのexists条件が含まれること', () => {
        // Arrange
        const config = makeConfig({ followsOnly: true })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'follows', 'exists')
        expect(exists).toBeDefined()
      })

      it('followsOnly=falseの時、followsのexists条件が含まれないこと', () => {
        // Arrange
        const config = makeConfig({ followsOnly: false })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'follows')
        expect(exists).toBeUndefined()
      })

      it('followsOnlyが未指定の時、followsのexists条件が含まれないこと', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'follows')
        expect(exists).toBeUndefined()
      })
    })
  })

  // --- モデレーションフィルタ ---
  describe('モデレーションフィルタ', () => {
    describe('ミュートフィルタ', () => {
      it('applyMuteFilterがデフォルト(未指定)の時、muted_accountsのnot-exists条件が含まれること', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'muted_accounts', 'not-exists')
        expect(exists).toBeDefined()
      })

      it('applyMuteFilter=trueの時、muted_accountsのnot-exists条件が含まれること', () => {
        // Arrange
        const config = makeConfig({ applyMuteFilter: true })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'muted_accounts', 'not-exists')
        expect(exists).toBeDefined()
      })

      it('applyMuteFilter=falseの時、muted_accountsのnot-exists条件が含まれないこと', () => {
        // Arrange
        const config = makeConfig({ applyMuteFilter: false })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'muted_accounts', 'not-exists')
        expect(exists).toBeUndefined()
      })

      it('serverIdsが存在する時、not-exists条件のinnerFiltersにserver_id条件が含まれること', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext({ serverIds: [10, 20] })

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'muted_accounts', 'not-exists')
        expect(exists).toBeDefined()
        expect(exists!.innerFilters).toBeDefined()
        expect(exists!.innerFilters).toHaveLength(2)

        const serverIdValues = exists!.innerFilters!.map((f) => f.value)
        expect(serverIdValues).toContain(10)
        expect(serverIdValues).toContain(20)
      })

      it('serverIdsが空配列の時、innerFiltersなしのnot-exists条件が生成されること', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext({ serverIds: [] })

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'muted_accounts', 'not-exists')
        expect(exists).toBeDefined()
        expect(exists!.innerFilters).toBeUndefined()
      })

      it('accountFilter.mode=includeの時、ミュートフィルタがスキップされること', () => {
        // Arrange
        const config = makeConfig({
          accountFilter: { accts: ['user@example.com'], mode: 'include' },
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'muted_accounts', 'not-exists')
        expect(exists).toBeUndefined()
      })

      it('accountFilter.mode=excludeの時、ミュートフィルタが適用されること', () => {
        // Arrange
        const config = makeConfig({
          accountFilter: { accts: ['spam@example.com'], mode: 'exclude' },
        })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(node.filters, 'muted_accounts', 'not-exists')
        expect(exists).toBeDefined()
      })
    })

    describe('インスタンスブロックフィルタ', () => {
      it('applyInstanceBlockがデフォルト(未指定)の時、blocked_instancesのnot-exists条件が含まれること', () => {
        // Arrange
        const config = makeConfig()
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(
          node.filters,
          'blocked_instances',
          'not-exists',
        )
        expect(exists).toBeDefined()
      })

      it('applyInstanceBlock=trueの時、blocked_instancesのnot-exists条件が含まれること', () => {
        // Arrange
        const config = makeConfig({ applyInstanceBlock: true })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(
          node.filters,
          'blocked_instances',
          'not-exists',
        )
        expect(exists).toBeDefined()
      })

      it('applyInstanceBlock=falseの時、blocked_instancesのnot-exists条件が含まれないこと', () => {
        // Arrange
        const config = makeConfig({ applyInstanceBlock: false })
        const context = makeContext()

        // Act
        const plan = configToQueryPlanV2(config, context)

        // Assert
        const node = getGetIdsNode(plan, 'source')
        const exists = findExists(
          node.filters,
          'blocked_instances',
          'not-exists',
        )
        expect(exists).toBeUndefined()
      })
    })
  })

  // --- バックエンドフィルタ ---
  describe('バックエンドフィルタ (localAccountIds)', () => {
    it('type=notificationの時、localAccountIdsがあればnotifications.local_account_id INフィルタが含まれること', () => {
      // Arrange
      const config = makeConfig({ type: 'notification' })
      const context = makeContext({ localAccountIds: [1] })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'notifications',
        'local_account_id',
        'IN',
      )
      expect(filter).toBeDefined()
      expect(filter!.value).toEqual([1])
    })

    it('type=tagの時、localAccountIdsがあればlocal_accounts.id INフィルタが含まれること', () => {
      // Arrange
      const config = makeConfig({ type: 'tag' })
      const context = makeContext({ localAccountIds: [5] })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(node.filters, 'local_accounts', 'id', 'IN')
      expect(filter).toBeDefined()
      expect(filter!.value).toEqual([5])
    })

    it('type=homeの時、localAccountIdsがあればtimeline_entries.local_account_id INフィルタで設定されること', () => {
      // Arrange
      const config = makeConfig({ type: 'home' })
      const context = makeContext({ localAccountIds: [3, 4] })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'timeline_entries',
        'local_account_id',
        'IN',
      )
      expect(filter).toBeDefined()
      expect(filter!.value).toEqual([3, 4])
    })

    it('type=localの時、localAccountIdsによる追加のlocal_account_idフィルタが生成されないこと（homeのみ）', () => {
      // Arrange
      const config = makeConfig({ type: 'local' })
      const context = makeContext({ localAccountIds: [1, 2] })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const filter = findFilter(
        node.filters,
        'timeline_entries',
        'local_account_id',
      )
      expect(filter).toBeUndefined()
    })

    it('localAccountIdsが空配列の時、バックエンドスコープのフィルタが追加されないこと', () => {
      // Arrange
      const config = makeConfig({ type: 'notification' })
      const context = makeContext({ localAccountIds: [] })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')
      const notifFilter = findFilter(
        node.filters,
        'notifications',
        'local_account_id',
      )
      expect(notifFilter).toBeUndefined()
    })
  })

  // --- Outputノード ---
  describe('Outputノード', () => {
    it('Outputノードのkindがoutput-v2であること', () => {
      // Arrange
      const config = makeConfig()
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const output = getOutputNode(plan)
      expect(output.kind).toBe('output-v2')
    })

    it('Outputノードのsort.fieldがcreated_at_msであること', () => {
      // Arrange
      const config = makeConfig()
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const output = getOutputNode(plan)
      expect(output.sort.field).toBe('created_at_ms')
    })

    it('Outputノードのsort.directionがDESCであること', () => {
      // Arrange
      const config = makeConfig()
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const output = getOutputNode(plan)
      expect(output.sort.direction).toBe('DESC')
    })

    it('Outputノードのpagination.limitがcontext.queryLimitと一致すること', () => {
      // Arrange
      const config = makeConfig()
      const context = makeContext({ queryLimit: 75 })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const output = getOutputNode(plan)
      expect(output.pagination.limit).toBe(75)
    })

    it('queryLimitが50の時、pagination.limitが50であること', () => {
      // Arrange
      const config = makeConfig()
      const context = makeContext({ queryLimit: 50 })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const output = getOutputNode(plan)
      expect(output.pagination.limit).toBe(50)
    })

    it('queryLimitが100の時、pagination.limitが100であること', () => {
      // Arrange
      const config = makeConfig()
      const context = makeContext({ queryLimit: 100 })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const output = getOutputNode(plan)
      expect(output.pagination.limit).toBe(100)
    })
  })

  // --- 複合条件 ---
  describe('複合条件の組み合わせ', () => {
    it('homeタイムラインでonlyMedia+excludeReblogs+languageFilterを同時指定した時、すべてのフィルタが含まれること', () => {
      // Arrange
      const config = makeConfig({
        excludeReblogs: true,
        languageFilter: ['ja', 'en'],
        onlyMedia: true,
        type: 'home',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')

      const mediaExists = findExists(node.filters, 'post_media', 'exists')
      expect(mediaExists).toBeDefined()

      const reblogFilter = findFilter(
        node.filters,
        'posts',
        'reblog_of_post_id',
        'IS NULL',
      )
      expect(reblogFilter).toBeDefined()

      const langFilter = findFilter(node.filters, 'posts', 'language', 'IN')
      expect(langFilter).toBeDefined()
      expect(langFilter!.value).toEqual(['ja', 'en'])
    })

    it('tagタイムラインでvisibilityFilter+excludeRepliesを同時指定した時、hashtagフィルタとコンテンツフィルタの両方が含まれること', () => {
      // Arrange
      const config = makeConfig({
        excludeReplies: true,
        tagConfig: { mode: 'or', tags: ['vitest'] },
        type: 'tag',
        visibilityFilter: ['public'],
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')

      const hashtagExists = findExists(node.filters, 'post_hashtags', 'exists')
      expect(hashtagExists).toBeDefined()

      const visFilter = findFilter(
        node.filters,
        'visibility_types',
        'name',
        'IN',
      )
      expect(visFilter).toBeDefined()
      expect(visFilter!.value).toEqual(['public'])

      const replyFilter = findFilter(
        node.filters,
        'posts',
        'in_reply_to_uri',
        'IS NULL',
      )
      expect(replyFilter).toBeDefined()
    })

    it('notificationタイムラインでnotificationFilter+applyMuteFilter=falseの時、通知タイプフィルタは含まれるがミュートフィルタは含まれないこと', () => {
      // Arrange
      const config = makeConfig({
        applyMuteFilter: false,
        notificationFilter: ['follow', 'mention'],
        type: 'notification',
      })
      const context = makeContext()

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      const node = getGetIdsNode(plan, 'source')

      const notifFilter = findFilter(
        node.filters,
        'notification_types',
        'name',
        'IN',
      )
      expect(notifFilter).toBeDefined()
      expect(notifFilter!.value).toEqual(['follow', 'mention'])

      const muteExists = findExists(
        node.filters,
        'muted_accounts',
        'not-exists',
      )
      expect(muteExists).toBeUndefined()
    })

    it('compositeタイムラインでモデレーションフィルタが各GetIdsノードに適用されること', () => {
      // Arrange
      const config = makeConfig({
        timelineTypes: ['home', 'local'],
        type: 'home',
      })
      const context = makeContext({ serverIds: [10] })

      // Act
      const plan = configToQueryPlanV2(config, context)

      // Assert
      for (const key of ['home', 'local']) {
        const node = getGetIdsNode(plan, `source-${key}`)

        const muteExists = findExists(
          node.filters,
          'muted_accounts',
          'not-exists',
        )
        expect(muteExists).toBeDefined()

        const blockExists = findExists(
          node.filters,
          'blocked_instances',
          'not-exists',
        )
        expect(blockExists).toBeDefined()
      }
    })
  })
})
