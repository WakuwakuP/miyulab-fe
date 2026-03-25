import * as Misskey from 'misskey-js'

/**
 * Misskey WebSocket ストリームプール
 *
 * Misskey のストリーミング API は 1 本の WebSocket 接続で
 * 複数のチャンネル（localTimeline, globalTimeline, hashtag 等）を
 * 同時に購読できる。
 *
 * このプールは origin + token ごとに Misskey.Stream インスタンスを共有管理し、
 * チャンネルごとに個別の WebSocket を張る無駄を排除する。
 *
 * ライフサイクル:
 * - acquireStream(): 参照カウントをインクリメントし、Stream を返す
 * - releaseStream(): 参照カウントをデクリメントし、0 になったら close して削除
 */

const KEY_SEPARATOR = '|'

type PoolEntry = {
  stream: Misskey.Stream
  refCount: number
}

const pool = new Map<string, PoolEntry>()

function makeKey(origin: string, token: string): string {
  return `${origin}${KEY_SEPARATOR}${token}`
}

/**
 * 共有 Misskey.Stream を取得する。
 * 同一 origin + token に対して既存の Stream があればそれを返し、
 * なければ新規作成する。参照カウントをインクリメントする。
 */
export function acquireStream(origin: string, token: string): Misskey.Stream {
  const key = makeKey(origin, token)
  const existing = pool.get(key)

  if (existing) {
    existing.refCount += 1
    return existing.stream
  }

  const stream = new Misskey.Stream(origin, { token })
  pool.set(key, { refCount: 1, stream })
  return stream
}

/**
 * 共有 Misskey.Stream の参照を解放する。
 * 参照カウントが 0 になったら Stream を close してプールから削除する。
 */
export function releaseStream(origin: string, token: string): void {
  const key = makeKey(origin, token)
  const entry = pool.get(key)
  if (!entry) return

  entry.refCount -= 1

  if (entry.refCount <= 0) {
    entry.stream.close()
    pool.delete(key)
  }
}

/**
 * プール内のアクティブな Stream 数を返す（デバッグ用）。
 */
export function getPoolSize(): number {
  return pool.size
}
