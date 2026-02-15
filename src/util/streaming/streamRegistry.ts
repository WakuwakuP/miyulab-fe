import type { WebSocketInterface } from 'megalodon'

export type StreamEntry = {
  /** リトライタイマー ID */
  retryTimer: ReturnType<typeof setTimeout> | null
  /** 接続状態 */
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  /** WebSocket ストリームインスタンス（初期化中はnull） */
  stream: WebSocketInterface | null
}

// 注: 参照カウント（refCount）は不要。
// syncStreamsEvent が deriveRequiredStreams の結果に基づいて
// ストリームのライフサイクルを一元管理するため、
// 同一キーの重複は Set の性質により自然に排除される。

export type StreamRegistry = Map<string, StreamEntry>
