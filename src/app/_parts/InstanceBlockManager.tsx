'use client'

import { useCallback, useEffect, useState } from 'react'
import { getSqliteDb, notifyChange } from 'util/db/sqlite/connection'

type BlockedInstance = {
  blocked_at: number
  instance_domain: string
}

/**
 * インスタンスドメインのバリデーション
 *
 * - 空文字列を拒否
 * - プロトコル（https:// 等）が含まれている場合は除去
 * - パス（/path 等）が含まれている場合は除去
 * - 基本的なドメイン形式チェック
 */
function validateDomain(input: string): string | null {
  let domain = input.trim().toLowerCase()

  // プロトコルを除去
  domain = domain.replace(/^https?:\/\//, '')

  // パスを除去
  domain = domain.split('/')[0]

  // ポート番号を除去
  domain = domain.split(':')[0]

  // 基本的なドメイン形式チェック
  if (!domain?.includes('.')) {
    return null
  }

  return domain
}

/**
 * ブロックインスタンス一覧を取得する
 */
async function getBlockedInstances(): Promise<BlockedInstance[]> {
  const handle = await getSqliteDb()
  const rows = (await handle.execAsync(
    'SELECT instance_domain, blocked_at FROM blocked_instances ORDER BY blocked_at DESC;',
    { returnValue: 'resultRows' },
  )) as (string | number)[][]

  return rows.map((row) => ({
    blocked_at: row[1] as number,
    instance_domain: row[0] as string,
  }))
}

/**
 * インスタンスをブロックする
 */
async function blockInstance(domain: string): Promise<void> {
  const handle = await getSqliteDb()
  await handle.execAsync(
    `INSERT OR IGNORE INTO blocked_instances (instance_domain, blocked_at)
     VALUES (?, ?);`,
    { bind: [domain, Date.now()] },
  )
  notifyChange('posts') // タイムラインの再クエリをトリガー
}

/**
 * インスタンスのブロックを解除する
 */
async function unblockInstance(domain: string): Promise<void> {
  const handle = await getSqliteDb()
  await handle.execAsync(
    'DELETE FROM blocked_instances WHERE instance_domain = ?;',
    {
      bind: [domain],
    },
  )
  notifyChange('posts')
}

/**
 * インスタンスブロック管理コンポーネント
 *
 * blocked_instances テーブルを直接操作して、
 * ブロックしたインスタンスドメインの一覧表示・追加・削除を行う。
 */
export function InstanceBlockManager({ onClose }: { onClose: () => void }) {
  const [blockedInstances, setBlockedInstances] = useState<BlockedInstance[]>(
    [],
  )
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const fetchBlockedInstances = useCallback(async () => {
    setIsLoading(true)
    try {
      const instances = await getBlockedInstances()
      setBlockedInstances(instances)
    } catch (e) {
      console.error('Failed to fetch blocked instances:', e)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBlockedInstances()
  }, [fetchBlockedInstances])

  const handleBlock = useCallback(async () => {
    const domain = validateDomain(input)
    if (!domain) {
      setValidationError(
        'Invalid domain. Please enter a valid domain (e.g. example.com)',
      )
      return
    }

    // 既にブロック済みかチェック
    if (blockedInstances.some((b) => b.instance_domain === domain)) {
      setValidationError(`${domain} is already blocked`)
      return
    }

    try {
      await blockInstance(domain)
      setInput('')
      setValidationError(null)
      await fetchBlockedInstances()
    } catch (e) {
      console.error('Failed to block instance:', e)
    }
  }, [input, blockedInstances, fetchBlockedInstances])

  const handleUnblock = useCallback(
    async (domain: string) => {
      try {
        await unblockInstance(domain)
        await fetchBlockedInstances()
      } catch (e) {
        console.error('Failed to unblock instance:', e)
      }
    },
    [fetchBlockedInstances],
  )

  const handleInputChange = useCallback((value: string) => {
    setInput(value)
    setValidationError(null)
  }, [])

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-gray-600 bg-gray-800 p-4 shadow-xl">
        <h3 className="mb-3 text-sm font-semibold text-gray-200">
          Blocked Instances
        </h3>

        {/* Input */}
        <div className="mb-1 flex gap-1">
          <input
            className="flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-white"
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleBlock()
              }
            }}
            placeholder="instance.example.com"
            type="text"
            value={input}
          />
          <button
            className="rounded bg-red-700 px-3 py-1 text-xs hover:bg-red-600 disabled:cursor-not-allowed disabled:bg-gray-600"
            disabled={!input.trim()}
            onClick={handleBlock}
            type="button"
          >
            Block
          </button>
        </div>

        {/* Validation error */}
        {validationError && (
          <p className="mb-2 text-xs text-red-400">{validationError}</p>
        )}

        <p className="mb-3 text-xs text-gray-500">
          Posts from blocked instances will be hidden in timelines with Instance
          Block enabled.
        </p>

        {/* List */}
        <div className="max-h-60 overflow-y-auto">
          {isLoading ? (
            <p className="py-4 text-center text-xs text-gray-500">Loading...</p>
          ) : blockedInstances.length === 0 ? (
            <p className="py-4 text-center text-xs text-gray-500">
              No blocked instances
            </p>
          ) : (
            <ul className="space-y-1">
              {blockedInstances.map((instance) => (
                <li
                  className="flex items-center justify-between rounded border border-slate-700 px-2 py-1.5"
                  key={instance.instance_domain}
                >
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-xs text-white">
                      {instance.instance_domain}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatDate(instance.blocked_at)}
                    </span>
                  </div>
                  <button
                    className="ml-2 shrink-0 rounded border border-slate-600 px-2 py-0.5 text-xs text-gray-300 hover:bg-slate-700 hover:text-white"
                    onClick={() => handleUnblock(instance.instance_domain)}
                    type="button"
                  >
                    Unblock
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Close */}
        <div className="mt-3 flex justify-end">
          <button
            className="rounded bg-gray-600 px-3 py-1 text-xs hover:bg-gray-500"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

export { blockInstance }
