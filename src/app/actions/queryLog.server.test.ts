import { beforeEach, expect, it, vi } from 'vitest'

const { createMany } = vi.hoisted(() => ({ createMany: vi.fn() }))
vi.mock('util/db/neon/client', () => ({
  getNeonClient: () => ({ queryLog: { createMany } }),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  createMany.mockResolvedValue({ count: 2 })
})

it('1秒未満を除外し、ちょうど1秒と1秒超のスロークエリを保存する', async () => {
  const { createQueryLogs } = await import('./queryLog.server')
  expect(
    await createQueryLogs([
      { durationMs: 999.9, sql: 'SELECT 1' },
      { durationMs: 1000, sql: 'SELECT 2' },
      { durationMs: 1500, sql: 'SELECT 3' },
    ]),
  ).toEqual({ count: 2, success: true })
  expect(createMany).toHaveBeenCalledExactlyOnceWith({
    data: [
      {
        bind: null,
        durationMs: 1000,
        explainPlan: null,
        sql: 'SELECT 2',
        userAgent: null,
      },
      {
        bind: null,
        durationMs: 1500,
        explainPlan: null,
        sql: 'SELECT 3',
        userAgent: null,
      },
    ],
  })
})
