import { describe, expect, it, vi } from 'vitest'

vi.mock('util/attachmentProxy', async () => {
  const actual = await vi.importActual<typeof import('util/attachmentProxy')>(
    'util/attachmentProxy',
  )
  return {
    isPrivateHostWithDns: async (hostname: string) =>
      actual.isPrivateHost(hostname),
  }
})

import {
  type SettingsBackupVerifyFetch,
  verifySettingsBackupAccount,
} from './verifyAccount'

const TOKEN = 'owner-token-123_ABC~+/='
const ORIGIN = 'https://social.example'

function jsonResponse(body: unknown, ok = true) {
  return { json: async () => body, ok }
}

describe('verifySettingsBackupAccount', () => {
  it('Mastodon 互換では verify_credentials の id と acct を使う', async () => {
    const fetchImpl = vi.fn<SettingsBackupVerifyFetch>(async () =>
      jsonResponse({ acct: 'alice', id: 'remote-id' }),
    )
    await expect(
      verifySettingsBackupAccount('pleroma', ORIGIN, TOKEN, fetchImpl),
    ).resolves.toEqual({ accountId: 'remote-id', acct: 'alice' })
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ORIGIN}/api/v1/accounts/verify_credentials`,
      expect.objectContaining({
        headers: { Authorization: `Bearer ${TOKEN}` },
        method: 'GET',
        redirect: 'error',
      }),
    )
  })

  it('Misskey では /api/i の id と username を使う', async () => {
    const fetchImpl = vi.fn<SettingsBackupVerifyFetch>(async () =>
      jsonResponse({ host: 'other.example', id: 'mk-id', username: 'bob' }),
    )
    await expect(
      verifySettingsBackupAccount('misskey', ORIGIN, TOKEN, fetchImpl),
    ).resolves.toEqual({ accountId: 'mk-id', acct: 'bob@other.example' })
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ORIGIN}/api/i`,
      expect.objectContaining({
        body: JSON.stringify({ i: TOKEN }),
        method: 'POST',
        redirect: 'error',
      }),
    )
  })

  it('私有アドレスへは問い合わせない', async () => {
    const fetchImpl = vi.fn<SettingsBackupVerifyFetch>()
    await expect(
      verifySettingsBackupAccount(
        'mastodon',
        'https://127.0.0.1',
        TOKEN,
        fetchImpl,
      ),
    ).resolves.toBeNull()
    await expect(
      verifySettingsBackupAccount(
        'mastodon',
        'https://169.254.169.254',
        TOKEN,
        fetchImpl,
      ),
    ).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('失敗した応答や例外では null を返し、トークンをエラーに含めない', async () => {
    const fetchImpl = vi.fn<SettingsBackupVerifyFetch>(async () => {
      throw new Error(`network ${TOKEN}`)
    })
    await expect(
      verifySettingsBackupAccount('mastodon', ORIGIN, TOKEN, fetchImpl),
    ).resolves.toBeNull()
  })
})
