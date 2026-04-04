import type {
  ExistsCondition,
  FilterCondition,
  GetIdsNode,
  QueryPlanV2,
} from 'util/db/query-ir/nodes'
import { validateQueryPlanV2 } from 'util/db/query-ir/v2/validateV2'
import { describe, expect, it } from 'vitest'
import { FLOW_PRESETS } from '../flowPresets'

// --------------- ヘルパー関数 ---------------

function getPreset(id: string) {
  const preset = FLOW_PRESETS.find((p) => p.id === id)
  if (!preset) throw new Error(`Preset '${id}' not found`)
  return preset
}

function getIdsNodes(plan: QueryPlanV2): GetIdsNode[] {
  return plan.nodes
    .filter((n) => n.node.kind === 'get-ids')
    .map((n) => n.node as GetIdsNode)
}

function isFilterCondition(f: unknown): f is FilterCondition {
  return typeof f === 'object' && f !== null && 'column' in f && 'op' in f
}

function isExistsCondition(f: unknown): f is ExistsCondition {
  return typeof f === 'object' && f !== null && 'mode' in f
}

describe('FLOW_PRESETS', () => {
  describe('一覧取得', () => {
    it('8件のプリセットが返ること', () => {
      expect(FLOW_PRESETS).toHaveLength(8)
    })

    it('すべてのプリセットが id, label, description, plan を持つこと', () => {
      for (const preset of FLOW_PRESETS) {
        expect(typeof preset.id).toBe('string')
        expect(typeof preset.label).toBe('string')
        expect(typeof preset.description).toBe('string')
        expect(typeof preset.plan).toBe('function')
      }
    })

    it('すべてのプリセットの id が一意であること', () => {
      const ids = FLOW_PRESETS.map((p) => p.id)

      expect(new Set(ids).size).toBe(ids.length)
    })

    it('すべてのプリセットの label が空文字でないこと', () => {
      for (const preset of FLOW_PRESETS) {
        expect(preset.label).not.toBe('')
      }
    })

    it('すべてのプリセットの description が空文字でないこと', () => {
      for (const preset of FLOW_PRESETS) {
        expect(preset.description).not.toBe('')
      }
    })
  })

  describe('全プリセット共通の QueryPlanV2 構造', () => {
    it('すべてのプリセットの plan().version が 2 であること', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()

        expect(plan.version).toBe(2)
      }
    })

    it('すべてのプリセットの plan().nodes が1件以上存在すること', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()

        expect(plan.nodes.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('すべてのプリセットの plan().edges が1件以上存在すること', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()

        expect(plan.edges.length).toBeGreaterThanOrEqual(1)
      }
    })

    it('すべてのプリセットが output-v2 ノードをちょうど1つだけ持つこと', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()
        const outputNodes = plan.nodes.filter(
          (n) => n.node.kind === 'output-v2',
        )

        expect(outputNodes).toHaveLength(1)
      }
    })

    it('すべてのプリセットのエッジが実在するノード ID のみを参照していること', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()
        const nodeIds = new Set(plan.nodes.map((n) => n.id))

        for (const edge of plan.edges) {
          expect(nodeIds.has(edge.source)).toBe(true)
          expect(nodeIds.has(edge.target)).toBe(true)
        }
      }
    })

    it('すべてのプリセットに孤立ノード（エッジに接続されていないノード）が存在しないこと', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()
        const connected = new Set<string>()
        for (const edge of plan.edges) {
          connected.add(edge.source)
          connected.add(edge.target)
        }

        for (const node of plan.nodes) {
          expect(connected.has(node.id)).toBe(true)
        }
      }
    })

    it('すべてのプリセットが validateQueryPlanV2 でバリデーションに成功すること', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()

        const result = validateQueryPlanV2(plan)

        expect(result.valid).toBe(true)
        expect(result.errors).toEqual([])
      }
    })

    it('plan()を2回呼ぶと異なるノードIDが生成されること', () => {
      for (const preset of FLOW_PRESETS) {
        const plan1 = preset.plan()
        const plan2 = preset.plan()
        const ids1 = new Set(plan1.nodes.map((n) => n.id))
        const ids2 = new Set(plan2.nodes.map((n) => n.id))

        for (const id of ids1) {
          expect(ids2.has(id)).toBe(false)
        }
      }
    })
  })

  describe('ホームタイムライン プリセット', () => {
    it('get-ids ノードが timeline_entries テーブルを参照していること', () => {
      const plan = getPreset('home').plan()
      const nodes = getIdsNodes(plan)

      expect(nodes).toHaveLength(1)
      expect(nodes[0].table).toBe('timeline_entries')
    })

    it("get-ids ノードのフィルタに timeline_entries.timeline_key IN ['home'] 条件が含まれること", () => {
      const plan = getPreset('home').plan()
      const nodes = getIdsNodes(plan)
      const timelineFilter = nodes[0].filters.find(
        (f): f is FilterCondition =>
          isFilterCondition(f) &&
          f.table === 'timeline_entries' &&
          f.column === 'timeline_key' &&
          f.op === 'IN',
      )

      expect(timelineFilter).toBeDefined()
      expect(timelineFilter?.value).toEqual(['home'])
    })

    it('post_id を出力 ID カラムとして使うこと', () => {
      const plan = getPreset('home').plan()
      const nodes = getIdsNodes(plan)
      expect(nodes[0].outputIdColumn).toBe('post_id')
    })

    it('getIds → output の2ノード構成であること', () => {
      const plan = getPreset('home').plan()

      expect(plan.nodes).toHaveLength(2)
      expect(plan.nodes[0].node.kind).toBe('get-ids')
      expect(plan.nodes[1].node.kind).toBe('output-v2')
      expect(plan.edges).toHaveLength(1)
      expect(plan.edges[0].source).toBe(plan.nodes[0].id)
      expect(plan.edges[0].target).toBe(plan.nodes[1].id)
    })
  })

  describe('ローカルタイムライン プリセット', () => {
    it('get-ids ノードが timeline_entries テーブルを参照していること', () => {
      const plan = getPreset('local').plan()
      const nodes = getIdsNodes(plan)

      expect(nodes).toHaveLength(1)
      expect(nodes[0].table).toBe('timeline_entries')
    })

    it("get-ids ノードのフィルタに timeline_entries.timeline_key IN ['local'] 条件が含まれること", () => {
      const plan = getPreset('local').plan()
      const nodes = getIdsNodes(plan)
      const timelineFilter = nodes[0].filters.find(
        (f): f is FilterCondition =>
          isFilterCondition(f) &&
          f.table === 'timeline_entries' &&
          f.column === 'timeline_key' &&
          f.op === 'IN',
      )

      expect(timelineFilter).toBeDefined()
      expect(timelineFilter?.value).toEqual(['local'])
    })
  })

  describe('通知タイムライン プリセット', () => {
    it('get-ids ノードが notifications テーブルを参照していること', () => {
      const plan = getPreset('notification').plan()
      const nodes = getIdsNodes(plan)

      expect(nodes).toHaveLength(1)
      expect(nodes[0].table).toBe('notifications')
    })

    it('get-ids ノードのフィルタが空であること', () => {
      const plan = getPreset('notification').plan()
      const nodes = getIdsNodes(plan)

      expect(nodes[0].filters).toEqual([])
    })
  })

  describe('メディア付き投稿 プリセット', () => {
    it('get-ids ノードが posts テーブルを参照していること', () => {
      const plan = getPreset('media').plan()
      const nodes = getIdsNodes(plan)

      expect(nodes).toHaveLength(1)
      expect(nodes[0].table).toBe('posts')
    })

    it('get-ids ノードのフィルタに post_media テーブルの exists 条件が含まれること', () => {
      const plan = getPreset('media').plan()
      const nodes = getIdsNodes(plan)
      const existsFilter = nodes[0].filters.find(
        (f): f is ExistsCondition =>
          isExistsCondition(f) &&
          f.mode === 'exists' &&
          f.table === 'post_media',
      )

      expect(existsFilter).toBeDefined()
    })
  })

  describe('ハッシュタグフィルタ プリセット', () => {
    it('get-ids ノードが post_hashtags テーブルを参照していること', () => {
      const plan = getPreset('hashtag').plan()
      const nodes = getIdsNodes(plan)

      expect(nodes).toHaveLength(1)
      expect(nodes[0].table).toBe('post_hashtags')
    })

    it('get-ids ノードのフィルタに post_hashtags テーブルの exists 条件が含まれること', () => {
      const plan = getPreset('hashtag').plan()
      const nodes = getIdsNodes(plan)
      const existsFilter = nodes[0].filters.find(
        (f): f is ExistsCondition =>
          isExistsCondition(f) &&
          f.mode === 'exists' &&
          f.table === 'post_hashtags',
      )

      expect(existsFilter).toBeDefined()
    })

    it('exists 条件の innerFilters に hashtags.name IN 条件が含まれること', () => {
      const plan = getPreset('hashtag').plan()
      const nodes = getIdsNodes(plan)
      const existsFilter = nodes[0].filters.find(
        (f): f is ExistsCondition =>
          isExistsCondition(f) &&
          f.mode === 'exists' &&
          f.table === 'post_hashtags',
      )

      expect(existsFilter).toBeDefined()
      expect(existsFilter?.innerFilters).toBeDefined()
      const innerFilter = existsFilter?.innerFilters?.find(
        (f) => f.table === 'hashtags' && f.column === 'name' && f.op === 'IN',
      )
      expect(innerFilter).toBeDefined()
    })

    it('出力 ID が post_id であること', () => {
      const plan = getPreset('hashtag').plan()
      const nodes = getIdsNodes(plan)
      expect(nodes[0].outputIdColumn).toBe('post_id')
    })
  })

  describe('ハッシュタグ（メディア）プリセット', () => {
    it('getIds が2つ（post_hashtags → posts）であること', () => {
      const plan = getPreset('hashtag-media').plan()
      const nodes = getIdsNodes(plan)
      expect(nodes).toHaveLength(2)
      expect(nodes[0].table).toBe('post_hashtags')
      expect(nodes[1].table).toBe('posts')
    })

    it('2段目の posts に upstreamSourceNodeId と post_media exists があること', () => {
      const plan = getPreset('hashtag-media').plan()
      const nodes = getIdsNodes(plan)
      const postNode = nodes[1]
      const idIn = postNode.filters.find(
        (f): f is FilterCondition =>
          isFilterCondition(f) &&
          f.table === 'posts' &&
          f.column === 'id' &&
          f.op === 'IN',
      )
      expect(idIn?.upstreamSourceNodeId).toBeDefined()
      const mediaExists = postNode.filters.find(
        (f): f is ExistsCondition =>
          isExistsCondition(f) &&
          f.mode === 'exists' &&
          f.table === 'post_media',
      )
      expect(mediaExists).toBeDefined()
    })
  })

  describe('複合タイムライン プリセット', () => {
    it('get-ids ノードが1つ（timeline_entries）であること', () => {
      const plan = getPreset('composite').plan()
      const nodes = getIdsNodes(plan)

      expect(nodes).toHaveLength(1)
      expect(nodes[0].table).toBe('timeline_entries')
    })

    it("timeline_key IN ['home','local'] であること", () => {
      const plan = getPreset('composite').plan()
      const nodes = getIdsNodes(plan)
      const filter = nodes[0].filters.find(
        (f): f is FilterCondition =>
          isFilterCondition(f) &&
          f.table === 'timeline_entries' &&
          f.column === 'timeline_key' &&
          f.op === 'IN',
      )

      expect(filter).toBeDefined()
      expect(filter?.value).toEqual(['home', 'local'])
    })

    it('merge ノードを含まないこと', () => {
      const plan = getPreset('composite').plan()
      const mergeNodes = plan.nodes.filter((n) => n.node.kind === 'merge-v2')

      expect(mergeNodes).toHaveLength(0)
    })

    it('2ノード1エッジの構成であること', () => {
      const plan = getPreset('composite').plan()

      expect(plan.nodes).toHaveLength(2)
      expect(plan.edges).toHaveLength(1)
    })
  })

  describe('空中リプライ プリセット', () => {
    it('notifications → lookup-related → merge → output の構成であること', () => {
      const plan = getPreset('aerial-reply').plan()
      expect(plan.nodes.some((n) => n.node.kind === 'get-ids')).toBe(true)
      expect(plan.nodes.some((n) => n.node.kind === 'lookup-related')).toBe(
        true,
      )
      expect(plan.nodes.filter((n) => n.node.kind === 'merge-v2')).toHaveLength(
        1,
      )
      expect(plan.nodes.some((n) => n.node.kind === 'output-v2')).toBe(true)
    })

    it('lookup が posts を参照し actor_profile_id → author_profile_id で結合すること', () => {
      const plan = getPreset('aerial-reply').plan()
      const lookup = plan.nodes.find((n) => n.node.kind === 'lookup-related')
      expect(lookup?.node.kind).toBe('lookup-related')
      if (lookup?.node.kind === 'lookup-related') {
        expect(lookup.node.lookupTable).toBe('posts')
        expect(lookup.node.joinConditions[0]?.inputColumn).toBe(
          'actor_profile_id',
        )
        expect(lookup.node.joinConditions[0]?.lookupColumn).toBe(
          'author_profile_id',
        )
      }
    })
  })

  describe('出力ノードのデフォルト値', () => {
    it('sortのdirectionがDESCであること', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()
        const outputNode = plan.nodes.find(
          (n) => n.node.kind === 'output-v2',
        )?.node

        expect(outputNode?.kind).toBe('output-v2')
        if (outputNode?.kind === 'output-v2') {
          expect(outputNode.sort.direction).toBe('DESC')
        }
      }
    })

    it('sortのfieldがcreated_at_msであること', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()
        const outputNode = plan.nodes.find(
          (n) => n.node.kind === 'output-v2',
        )?.node

        expect(outputNode?.kind).toBe('output-v2')
        if (outputNode?.kind === 'output-v2') {
          expect(outputNode.sort.field).toBe('created_at_ms')
        }
      }
    })

    it('pagination.limitが正の整数であること', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()
        const outputNode = plan.nodes.find(
          (n) => n.node.kind === 'output-v2',
        )?.node

        expect(outputNode?.kind).toBe('output-v2')
        if (outputNode?.kind === 'output-v2') {
          expect(outputNode.pagination.limit).toBeGreaterThan(0)
          expect(Number.isInteger(outputNode.pagination.limit)).toBe(true)
        }
      }
    })
  })

  describe('グラフの整合性', () => {
    it('循環参照が存在しないこと', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()
        const adj = new Map<string, string[]>()
        for (const edge of plan.edges) {
          const list = adj.get(edge.source) ?? []
          list.push(edge.target)
          adj.set(edge.source, list)
        }

        const visiting = new Set<string>()
        const visited = new Set<string>()
        let hasCycle = false
        const dfs = (nodeId: string): void => {
          if (visited.has(nodeId)) return
          if (visiting.has(nodeId)) {
            hasCycle = true
            return
          }
          visiting.add(nodeId)
          for (const next of adj.get(nodeId) ?? []) {
            dfs(next)
          }
          visiting.delete(nodeId)
          visited.add(nodeId)
        }

        for (const node of plan.nodes) {
          if (!visited.has(node.id)) dfs(node.id)
        }

        expect(hasCycle).toBe(false)
      }
    })

    it('自己ループが存在しないこと', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()

        for (const edge of plan.edges) {
          expect(edge.source).not.toBe(edge.target)
        }
      }
    })

    it('output-v2 ノードが他のノードへの出力エッジを持たないこと', () => {
      for (const preset of FLOW_PRESETS) {
        const plan = preset.plan()
        const outputNodeIds = new Set(
          plan.nodes
            .filter((n) => n.node.kind === 'output-v2')
            .map((n) => n.id),
        )

        const outgoingFromOutput = plan.edges.filter((e) =>
          outputNodeIds.has(e.source),
        )

        expect(outgoingFromOutput).toHaveLength(0)
      }
    })
  })
})
