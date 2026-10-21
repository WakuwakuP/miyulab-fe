import { DbDiagnosticRecorder } from 'util/db/dbDiagnostics'
import type { DbDiagnosticOutcome } from 'util/db/dbDiagnosticTypes'
import { beforeEach, expect, it, vi } from 'vitest'

const { authorize, createMany, getClient } = vi.hoisted(() => ({
  authorize: vi.fn(),
  createMany: vi.fn(),
  getClient: vi.fn(),
}))
vi.mock('app/actions/dbDiagnosticsAuth.server', () => ({
  isDbDiagnosticOwnerAuthenticated: authorize,
}))
vi.mock('util/db/neon/client', () => ({ getNeonClient: getClient }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  authorize.mockResolvedValue(true)
  getClient.mockReturnValue({ queryLog: { createMany } })
  createMany.mockResolvedValue({ count: 2 })
})

const session = '00000000-0000-4000-8000-000000000001'

function windows(outcomes: DbDiagnosticOutcome[]) {
  const recorder = new DbDiagnosticRecorder()
  return outcomes.map((outcome, id) => {
    recorder.recordEnqueue(id, { type: 'exec' }, 'other')
    recorder.recordStart(id)
    recorder.recordEnd(id, outcome)
    return recorder.capture()
  })
}

it('正常・キャンセルのみのバッチはDBに接続せず受領する', async () => {
  const { createDbDiagnosticLogs } = await import('./dbDiagnostics.server')
  expect(
    await createDbDiagnosticLogs(session, windows(['success', 'cancelled'])),
  ).toEqual({ accepted: 2, count: 0, success: true })
  expect(getClient).not.toHaveBeenCalled()
})

it('混在バッチから失敗・タイムアウトの窓だけ保存し全件を受領する', async () => {
  const { createDbDiagnosticLogs } = await import('./dbDiagnostics.server')
  const input = windows(['success', 'error', 'cancelled', 'timeout'])
  expect(await createDbDiagnosticLogs(session, input)).toEqual({
    accepted: 4,
    count: 2,
    success: true,
  })
  const data = createMany.mock.calls[0][0].data
  expect(data.map((row: { bind: string }) => JSON.parse(row.bind))).toEqual([
    input[1],
    input[3],
  ])
})

it('保存対象外でも所有者認証を要求する', async () => {
  authorize.mockResolvedValue(false)
  const { createDbDiagnosticLogs } = await import('./dbDiagnostics.server')
  expect(
    await createDbDiagnosticLogs(session, windows(['success'])),
  ).toMatchObject({ success: false })
  expect(getClient).not.toHaveBeenCalled()
})
