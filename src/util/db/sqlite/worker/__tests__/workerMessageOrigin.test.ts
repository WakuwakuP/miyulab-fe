import { describe, expect, it } from 'vitest'
import { isAcceptedWorkerMessageOrigin } from '../workerMessageOrigin'

describe('isAcceptedWorkerMessageOrigin', () => {
  it('Chromium の Dedicated Worker が付ける空の origin を受け付ける', () => {
    expect(isAcceptedWorkerMessageOrigin('', 'https://ml-fe.waku.dev')).toBe(
      true,
    )
  })

  it('ワーカーと同じ origin を受け付ける', () => {
    expect(
      isAcceptedWorkerMessageOrigin(
        'https://ml-fe.waku.dev',
        'https://ml-fe.waku.dev',
      ),
    ).toBe(true)
  })

  it('空でない別 origin を拒否する', () => {
    expect(
      isAcceptedWorkerMessageOrigin(
        'https://evil.example',
        'https://ml-fe.waku.dev',
      ),
    ).toBe(false)
  })
})
