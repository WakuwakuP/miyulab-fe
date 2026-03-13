import type { WebSocketInterface } from 'megalodon'

/**
 * megalodon の WebSocket ストリームを安全に停止する。
 *
 * megalodon の `stop()` は `_connectionClosed = true` を設定するが、
 * すでに予約された `_reconnect()` の setTimeout をキャンセルしない。
 * また `_reconnect()` は `_connectionClosed` をチェックしないため、
 * stop() 後でもゴースト再接続が発生し得る。
 *
 * この関数は `stop()` 呼び出し後に `_reconnectMaxAttempts` を 0 に設定し、
 * 予約済みの `_reconnect()` が実行されても新しい接続を作らないようにする。
 */
export function stopStream(stream: WebSocketInterface): void {
  stream.stop()

  // megalodon 内部プロパティへの直接アクセス:
  // _reconnect() は _reconnectCurrentAttempts < _reconnectMaxAttempts を
  // チェックするため、maxAttempts を 0 に設定すればゴースト再接続を防止できる。
  const s = stream as unknown as { _reconnectMaxAttempts: number }
  s._reconnectMaxAttempts = 0
}

/**
 * 停止済みストリームの再接続能力を復元してから start() を呼ぶ。
 *
 * `stopStream()` で `_reconnectMaxAttempts` を 0 に設定した後、
 * 再接続する場合は `start()` 前に元の値（Infinity）に戻す必要がある。
 */
export function restartStream(stream: WebSocketInterface): void {
  const s = stream as unknown as { _reconnectMaxAttempts: number }
  s._reconnectMaxAttempts = Number.POSITIVE_INFINITY
  stream.start()
}
