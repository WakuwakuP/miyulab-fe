/**
 * dbQueue — キュー飽和メトリクス・定数のテスト
 */

import { describe, expect, it } from 'vitest'

import {
  isTimelineQueueSaturated,
  MAX_TIMELINE_QUEUE_SIZE,
  QUEUE_SATURATED_THRESHOLD,
  recordWaitTime,
  reportDequeue,
  reportEnqueue,
} from '../dbQueue'

// --------------- ヘルパー ---------------

/**
 * timeline キューサイズを指定値にセットする。
 */
function setTimelineQueueSize(target: number): void {
  // まず 0 にリセット（十分な回数 dequeue）
  for (let i = 0; i < MAX_TIMELINE_QUEUE_SIZE + 10; i++) {
    reportDequeue('timeline')
  }
  // 目標値まで enqueue
  for (let i = 0; i < target; i++) {
    reportEnqueue('timeline')
  }
}

// --------------- テスト ---------------

describe('dbQueue saturation', () => {
  describe('isTimelineQueueSaturated', () => {
    it('returns false when queue size is below threshold', () => {
      setTimelineQueueSize(0)
      expect(isTimelineQueueSaturated()).toBe(false)
    })

    it('returns false when queue size is just below threshold', () => {
      setTimelineQueueSize(QUEUE_SATURATED_THRESHOLD - 1)
      expect(isTimelineQueueSaturated()).toBe(false)
    })

    it('returns true when queue size equals threshold', () => {
      setTimelineQueueSize(QUEUE_SATURATED_THRESHOLD)
      expect(isTimelineQueueSaturated()).toBe(true)
    })

    it('returns true when queue size exceeds threshold', () => {
      setTimelineQueueSize(MAX_TIMELINE_QUEUE_SIZE)
      expect(isTimelineQueueSaturated()).toBe(true)
    })
  })

  describe('constants', () => {
    it('MAX_TIMELINE_QUEUE_SIZE is 20', () => {
      expect(MAX_TIMELINE_QUEUE_SIZE).toBe(20)
    })

    it('QUEUE_SATURATED_THRESHOLD is 15', () => {
      expect(QUEUE_SATURATED_THRESHOLD).toBe(15)
    })

    it('threshold is less than max size', () => {
      expect(QUEUE_SATURATED_THRESHOLD).toBeLessThan(MAX_TIMELINE_QUEUE_SIZE)
    })
  })

  // cleanup
  it('cleanup: reset queue size', () => {
    setTimelineQueueSize(0)
    expect(isTimelineQueueSaturated()).toBe(false)
  })
})

describe('recordWaitTime', () => {
  it('records wait time without throwing', () => {
    expect(() => recordWaitTime(100)).not.toThrow()
    expect(() => recordWaitTime(200)).not.toThrow()
    expect(() => recordWaitTime(50)).not.toThrow()
  })
})
