'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'
import type { FlowNodePanelProps } from './flowNodePanelTypes'
import type { FlowNode, MergeFlowNodeDataV2 } from './types'

type MergePanelV2Props = {
  node: FlowNode
  onUpdate: FlowNodePanelProps['onUpdate']
}

export function MergePanelV2({ node, onUpdate }: MergePanelV2Props) {
  const data = node.data as MergeFlowNodeDataV2

  return (
    <div className="space-y-3">
      <div>
        <span className="text-xs font-semibold text-gray-300 block mb-1">
          戦略
        </span>
        <Select
          onValueChange={(v) =>
            onUpdate(node.id, {
              ...data,
              config: {
                ...data.config,
                strategy: v as MergeFlowNodeDataV2['config']['strategy'],
              },
            })
          }
          value={data.config.strategy}
        >
          <SelectTrigger className="w-full h-7 text-xs bg-gray-700 border-gray-600 text-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-60">
            <SelectItem value="union">union</SelectItem>
            <SelectItem value="intersect">intersect</SelectItem>
            <SelectItem value="interleave-by-time">
              interleave-by-time
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs font-semibold text-gray-300 block mb-1">
          limit
          <input
            className="w-full rounded bg-gray-700 px-2 py-1.5 text-sm text-white border border-gray-600"
            onChange={(e) =>
              onUpdate(node.id, {
                ...data,
                config: {
                  ...data.config,
                  limit: Number(e.target.value),
                },
              })
            }
            type="number"
            value={data.config.limit}
          />
        </label>
      </div>
    </div>
  )
}
