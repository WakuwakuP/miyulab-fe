'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import type { FlowNodePanelProps } from './flowNodePanelTypes'
import type { FlowNode, OutputFlowNodeDataV2 } from './types'

type OutputPanelV2Props = {
  node: FlowNode
  onUpdate: FlowNodePanelProps['onUpdate']
}

export function OutputPanelV2({ node, onUpdate }: OutputPanelV2Props) {
  const data = node.data as OutputFlowNodeDataV2
  const displayMode = data.config.displayMode ?? 'auto'

  return (
    <div className="space-y-3">
      <div>
        <span className="block mb-1 text-xs font-semibold text-gray-300">
          ソート方向
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate(node.id, {
              ...data,
              config: {
                ...data.config,
                sort: {
                  ...data.config.sort,
                  direction: v as 'ASC' | 'DESC',
                },
              },
            })
          }
          value={data.config.sort.direction}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectItem value="DESC">新しい順 (DESC)</SelectItem>
            <SelectItem value="ASC">古い順 (ASC)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          表示モード
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate(node.id, {
              ...data,
              config: {
                ...data.config,
                displayMode: v as 'auto' | 'media-gallery',
              },
            })
          }
          value={displayMode}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectItem value="auto">自動選択 (投稿/通知/混合)</SelectItem>
            <SelectItem value="media-gallery">メディアギャラリー</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="block mb-1 text-xs font-semibold text-gray-300">
          取得件数
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) =>
              onUpdate(node.id, {
                ...data,
                config: {
                  ...data.config,
                  pagination: {
                    ...data.config.pagination,
                    limit: Number(e.target.value),
                  },
                },
              })
            }
            type="number"
            value={data.config.pagination.limit}
          />
        </label>
      </div>
    </div>
  )
}
