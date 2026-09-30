import { describe, expect, it, vi } from 'vitest'
import { createChangeCoalescer } from '../subscriptionCoalescer'

function makeCoalescer() {
  const onMatched = vi.fn()
  const onHintless = vi.fn()
  return {
    coalescer: createChangeCoalescer(onMatched, onHintless),
    onHintless,
    onMatched,
  }
}

async function flushMicrotask(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve()
  }
}

describe('createChangeCoalescer', () => {
  it('同一フラッシュ内の複数テーブル通知を 1 回の onMatched に合体する', async () => {
    const { coalescer, onHintless, onMatched } = makeCoalescer()

    coalescer.push({ hintless: false, matched: true, tables: ['posts'] })
    coalescer.push({
      hintless: false,
      matched: true,
      tables: ['timeline_entries'],
    })
    coalescer.push({
      hintless: false,
      matched: true,
      tables: ['post_interactions'],
    })
    await flushMicrotask()

    expect(onMatched).toHaveBeenCalledOnce()
    expect(onMatched).toHaveBeenCalledWith(
      new Set(['posts', 'timeline_entries', 'post_interactions']),
      undefined,
    )
    expect(onHintless).not.toHaveBeenCalled()
  })

  it('次のフラッシュでは追加で 1 回だけ呼ばれる', async () => {
    const { coalescer, onMatched } = makeCoalescer()

    coalescer.push({ hintless: false, matched: true, tables: ['posts'] })
    await flushMicrotask()
    coalescer.push({
      hintless: false,
      matched: true,
      tables: ['notifications'],
    })
    await flushMicrotask()

    expect(onMatched).toHaveBeenCalledTimes(2)
    expect(onMatched).toHaveBeenLastCalledWith(
      new Set(['notifications']),
      undefined,
    )
  })

  it('hintless が混ざったフラッシュは onHintless のみを 1 回呼ぶ', async () => {
    const { coalescer, onHintless, onMatched } = makeCoalescer()

    coalescer.push({ hintless: false, matched: true, tables: ['posts'] })
    coalescer.push({ hintless: true, matched: false })
    coalescer.push({
      hintless: false,
      matched: true,
      tables: ['timeline_entries'],
    })
    await flushMicrotask()

    expect(onHintless).toHaveBeenCalledOnce()
    expect(onMatched).not.toHaveBeenCalled()
  })

  it('マイクロタスク前に dispose すると呼び出されない', async () => {
    const { coalescer, onHintless, onMatched } = makeCoalescer()

    coalescer.push({ hintless: false, matched: true, tables: ['posts'] })
    coalescer.dispose()
    await flushMicrotask()

    expect(onMatched).not.toHaveBeenCalled()
    expect(onHintless).not.toHaveBeenCalled()
  })

  it('changedTables が空でも一致した hint は onMatched を呼ぶ', async () => {
    const { coalescer, onMatched } = makeCoalescer()

    coalescer.push({ hintless: false, matched: true, tables: [] })
    await flushMicrotask()

    expect(onMatched).toHaveBeenCalledOnce()
    expect(onMatched).toHaveBeenCalledWith(new Set(), undefined)
  })

  it('マッチしない通知だけでは何も呼ばない', async () => {
    const { coalescer, onHintless, onMatched } = makeCoalescer()

    coalescer.push({ hintless: false, matched: false, tables: ['posts'] })
    await flushMicrotask()

    expect(onMatched).not.toHaveBeenCalled()
    expect(onHintless).not.toHaveBeenCalled()
  })

  it('changedPostIds が世代内で union される', async () => {
    const { coalescer, onMatched } = makeCoalescer()

    coalescer.push({
      hintless: false,
      matched: true,
      postIds: [1, 2],
      tables: ['post_interactions'],
    })
    coalescer.push({
      hintless: false,
      matched: true,
      postIds: [2, 3],
      tables: ['post_interactions'],
    })
    await flushMicrotask()

    expect(onMatched).toHaveBeenCalledOnce()
    expect(onMatched).toHaveBeenCalledWith(
      new Set(['post_interactions']),
      new Set([1, 2, 3]),
    )
  })

  it('ID 不明 (undefined) が 1 つでもあれば全体を unknown にする', async () => {
    const { coalescer, onMatched } = makeCoalescer()

    coalescer.push({
      hintless: false,
      matched: true,
      postIds: [1],
      tables: ['post_interactions'],
    })
    coalescer.push({
      hintless: false,
      matched: true,
      tables: ['post_interactions'],
    })
    await flushMicrotask()

    expect(onMatched).toHaveBeenCalledOnce()
    expect(onMatched).toHaveBeenCalledWith(
      new Set(['post_interactions']),
      undefined,
    )
  })

  it('ID 不明は次の世代に持ち越されない', async () => {
    const { coalescer, onMatched } = makeCoalescer()

    coalescer.push({ hintless: false, matched: true, tables: ['posts'] })
    await flushMicrotask()
    coalescer.push({
      hintless: false,
      matched: true,
      postIds: [7],
      tables: ['post_interactions'],
    })
    await flushMicrotask()

    expect(onMatched).toHaveBeenLastCalledWith(
      new Set(['post_interactions']),
      new Set([7]),
    )
  })
})
