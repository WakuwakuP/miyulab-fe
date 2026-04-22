/**
 * priority キュー追加後の dbQueue カウンタ動作確認
 */

import { describe, expect, it } from 'vitest'

import { getCurrentQueueSizes, reportDequeue, reportEnqueue } from '../dbQueue'

describe('dbQueue priority queue', () => {
  it('reportEnqueue("priority") / reportDequeue("priority") がカウンタを増減させる', () => {
    const before = getCurrentQueueSizes().priority

    reportEnqueue('priority')
    reportEnqueue('priority')
    expect(getCurrentQueueSizes().priority).toBe(before + 2)

    reportDequeue('priority')
    expect(getCurrentQueueSizes().priority).toBe(before + 1)

    reportDequeue('priority')
    expect(getCurrentQueueSizes().priority).toBe(before)
  })

  it('priority カウンタは other / timeline と独立', () => {
    const sizes0 = getCurrentQueueSizes()

    reportEnqueue('priority')
    const sizes1 = getCurrentQueueSizes()
    expect(sizes1.priority).toBe(sizes0.priority + 1)
    expect(sizes1.other).toBe(sizes0.other)
    expect(sizes1.timeline).toBe(sizes0.timeline)

    // cleanup
    reportDequeue('priority')
  })

  it('priority カウンタは 0 未満にならない', () => {
    // 既にゼロであることを確認してから dequeue を過剰に呼ぶ
    const current = getCurrentQueueSizes().priority
    for (let i = 0; i < current; i++) reportDequeue('priority')
    expect(getCurrentQueueSizes().priority).toBe(0)

    reportDequeue('priority')
    reportDequeue('priority')
    expect(getCurrentQueueSizes().priority).toBe(0)
  })
})
