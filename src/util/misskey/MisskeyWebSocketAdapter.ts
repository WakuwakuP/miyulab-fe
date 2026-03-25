import { EventEmitter } from 'node:events'
import type { WebSocketInterface } from 'megalodon'
import type * as Misskey from 'misskey-js'
import { acquireStream, releaseStream } from './MisskeyStreamPool'
import { mapNoteToStatus, mapNotification } from './mappers'

type ChannelType =
  | 'homeTimeline'
  | 'localTimeline'
  | 'globalTimeline'
  | 'hashtag'
  | 'main'

/**
 * misskey-js の Stream/Connection を megalodon の WebSocketInterface でラップするアダプター
 *
 * megalodon の WebSocketInterface はイベントベース:
 *   - 'update'        → Entity.Status
 *   - 'status_update'  → Entity.Status
 *   - 'notification'   → Entity.Notification
 *   - 'delete'         → string (status id)
 *   - 'connect'        → void
 *   - 'error'          → Error
 *
 * misskey-js の Stream はチャンネルベース:
 *   - channel.on('note', Note)
 *   - mainChannel.on('notification', Notification)
 *   - stream.on('_connected_')
 *   - stream.on('_disconnected_')
 *
 * ## 共有 Stream プール
 *
 * Misskey のストリーミング API は 1 本の WebSocket 接続で複数チャンネルを
 * 同時に購読できる。このアダプターは MisskeyStreamPool から共有 Stream を
 * 取得し、チャンネルの購読/解除のみを行う。
 * WebSocket 自体のライフサイクルはプールが参照カウントで管理する。
 *
 * ## stop → start サイクル
 *
 * StreamingManagerProvider / StatusStoreProvider は stopStream() → restartStream()
 * のパターンでリトライを行う。stop() で Pool 参照を解放し、start() で再取得する。
 * 他のアダプターが同一 Stream を使用中なら既存の接続が再利用され、
 * 全アダプターが解放済みなら新しい WebSocket 接続が作られる。
 */
export class MisskeyWebSocketAdapter
  extends EventEmitter
  implements WebSocketInterface
{
  private stream: Misskey.Stream | null = null
  // biome-ignore lint/suspicious/noExplicitAny: misskey-js の Connection 型は厳密なジェネリクスを持ち、チャンネル横断で統一的に扱えないため any を使用
  private channel: any = null
  // biome-ignore lint/suspicious/noExplicitAny: 同上
  private mainChannel: any = null
  private channelType: ChannelType
  private channelParams: Record<string, unknown>
  private origin: string
  private token: string
  private started = false

  /**
   * _connected_ / _disconnected_ イベントのリスナー参照。
   * 共有 Stream に登録したリスナーを stop() 時に正確に除去するために保持する。
   */
  private onConnected: (() => void) | null = null
  private onDisconnected: (() => void) | null = null

  constructor(
    origin: string,
    token: string,
    channelType: ChannelType,
    channelParams: Record<string, unknown> = {},
  ) {
    super()
    this.origin = origin
    this.token = token
    this.channelType = channelType
    this.channelParams = channelParams
  }

  private setupStreamEvents(): void {
    if (!this.stream) return

    this.onConnected = () => {
      this.emit('connect')
    }
    this.onDisconnected = () => {
      // megalodon では disconnect 時に error を発火してリトライを促す
      this.emit('error', new Error('Misskey stream disconnected'))
    }

    this.stream.on('_connected_', this.onConnected)
    this.stream.on('_disconnected_', this.onDisconnected)
  }

  private removeStreamEvents(): void {
    if (!this.stream) return

    if (this.onConnected) {
      this.stream.off('_connected_', this.onConnected)
      this.onConnected = null
    }
    if (this.onDisconnected) {
      this.stream.off('_disconnected_', this.onDisconnected)
      this.onDisconnected = null
    }
  }

  private setupChannel(): void {
    if (!this.stream) return

    if (this.channelType === 'hashtag') {
      // hashtag チャンネルは q パラメータが string[][] 形式
      const tag = this.channelParams.tag as string
      // biome-ignore lint/correctness/useHookAtTopLevel: useChannel は React hook ではなく misskey-js の Stream メソッド
      this.channel = this.stream.useChannel('hashtag', {
        q: [[tag]],
      })
    } else {
      // biome-ignore lint/correctness/useHookAtTopLevel: useChannel は React hook ではなく misskey-js の Stream メソッド
      this.channel = this.stream.useChannel(
        this.channelType as 'homeTimeline' | 'localTimeline' | 'globalTimeline',
        this.channelParams as Record<string, never>,
      )
    }

    // Note イベント → 'update' に変換
    this.channel.on('note', (note: Misskey.entities.Note) => {
      const status = mapNoteToStatus(note, this.origin)
      this.emit('update', status)
    })

    // homeTimeline の場合は main チャンネルも接続して通知を受信
    if (this.channelType === 'homeTimeline') {
      // biome-ignore lint/correctness/useHookAtTopLevel: useChannel は React hook ではなく misskey-js の Stream メソッド
      this.mainChannel = this.stream.useChannel('main')

      this.mainChannel.on(
        'notification',
        (notif: Misskey.entities.Notification) => {
          const mapped = mapNotification(notif, this.origin)
          this.emit('notification', mapped)
        },
      )
    }
  }

  /**
   * 共有プールから Stream を取得してチャンネルを購読する。
   *
   * stop() 後に再度呼び出すと、プールから Stream を再取得する。
   * 他のアダプターが同一 origin+token の Stream を使用中なら既存接続が再利用され、
   * 全て解放済みなら新しい WebSocket 接続が作られる。
   */
  start(): void {
    if (this.started) return
    this.started = true

    // 共有プールから Stream を取得（参照カウント +1）
    this.stream = acquireStream(this.origin, this.token)
    this.setupStreamEvents()
    this.setupChannel()
  }

  /**
   * チャンネルの購読を解除し、共有プールの参照を解放する。
   *
   * 他のアダプターが同一 Stream を使用中なら WebSocket は閉じられない。
   * 全アダプターが解放すると Pool が Stream を close する。
   */
  stop(): void {
    if (!this.started) return
    this.started = false

    // 共有 Stream からこのアダプターのリスナーを除去
    this.removeStreamEvents()

    if (this.channel) {
      this.channel.dispose()
      this.channel = null
    }
    if (this.mainChannel) {
      this.mainChannel.dispose()
      this.mainChannel = null
    }

    // 共有プールの参照カウントをデクリメント
    // 他のアダプターが使用中なら Stream は閉じられない
    releaseStream(this.origin, this.token)
    this.stream = null
  }

  // on, once, removeListener, removeAllListeners are inherited from EventEmitter
}
