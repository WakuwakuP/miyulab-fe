import type { DebugNodeResult, DebugResultItem, FlowNode } from './types'
import { getNodeLabelV2 } from './types'

// --------------- デバッグ結果の抽出 ---------------

/** HTML タグを除去してプレーンテキスト化し、指定文字数で切り詰める */
export function stripHtml(html: string, maxLen = 80): string {
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text
}

/** ms タイムスタンプを HH:mm 形式に変換 */
export function formatTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * GraphExecuteResult の生データからノード別の DebugNodeResult[] を構築する。
 *
 * Post row layout (STATUS_BASE_SELECT):
 *   [0] post_id, [3] created_at_ms, [5] content_html,
 *   [11] is_reblog, [14] author_acct
 *
 * Notification row layout:
 *   [0] id, [2] created_at_ms, [3] notification_type,
 *   [6] actor_acct, [15] rp_content
 */
export function buildDebugResultsByNode(
  nodeOutputIds: Record<
    string,
    { table: 'posts' | 'notifications'; id: number }[]
  >,
  postRows: (string | number | null)[][],
  notifRows: (string | number | null)[][],
  flowNodes: FlowNode[],
): DebugNodeResult[] {
  const postMap = new Map<number, (string | number | null)[]>()
  for (const row of postRows) postMap.set(row[0] as number, row)

  const notifMap = new Map<number, (string | number | null)[]>()
  for (const row of notifRows) notifMap.set(row[0] as number, row)

  // ReactFlow node ID → label のマップ
  const flowNodeMap = new Map<string, FlowNode>()
  for (const fn of flowNodes) flowNodeMap.set(fn.id, fn)

  const results: DebugNodeResult[] = []

  // output-v2 ノードは最終結果なのでスキップ
  for (const [nodeId, entries] of Object.entries(nodeOutputIds)) {
    const flowNode = flowNodeMap.get(nodeId)
    if (!flowNode) continue
    // output ノードは他のノードの集約なのでスキップ
    if (flowNode.data.nodeType === 'output-v2') continue

    const label = getNodeLabelV2(flowNode.data)
    const items: DebugResultItem[] = []

    for (const entry of entries) {
      if (entry.table === 'posts') {
        const row = postMap.get(entry.id)
        if (!row) continue
        items.push({
          acct: (row[14] as string) ?? '',
          contentPreview: stripHtml((row[5] as string) ?? ''),
          createdAt: formatTime(row[3] as number),
          id: entry.id,
          isReblog: (row[11] as number) === 1,
          table: 'posts',
        })
      } else {
        const row = notifMap.get(entry.id)
        if (!row) continue
        items.push({
          actorAcct: (row[6] as string) ?? '',
          createdAt: formatTime(row[2] as number),
          id: entry.id,
          notificationType: (row[3] as string) ?? '',
          relatedContentPreview: stripHtml((row[15] as string) ?? ''),
          table: 'notifications',
        })
      }
    }

    results.push({ items, nodeId, nodeLabel: label })
  }

  return results
}
