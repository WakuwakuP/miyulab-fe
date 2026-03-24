import { EventEmitter } from 'node:events'
import type { WebSocketInterface } from 'megalodon'
import * as Misskey from 'misskey-js'
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
 */
export class MisskeyWebSocketAdapter
  extends EventEmitter
  implements WebSocketInterface
{
  private stream: Misskey.Stream
  // biome-ignore lint/suspicious/noExplicitAny: misskey-js の Connection 型は厳密なジェネリクスを持ち、チャンネル横断で統一的に扱えないため any を使用
  private channel: any = null
  // biome-ignore lint/suspicious/noExplicitAny: 同上
  private mainChannel: any = null
  private channelType: ChannelType
  private channelParams: Record<string, unknown>
  private origin: string
  private started = false

  constructor(
    origin: string,
    token: string,
    channelType: ChannelType,
    channelParams: Record<string, unknown> = {},
  ) {
    super()
    this.origin = origin
    this.channelType = channelType
    this.channelParams = channelParams
    this.stream = new Misskey.Stream(origin, { token })
    this.setupStreamEvents()
  }

  private setupStreamEvents(): void {
    this.stream.on('_connected_', () => {
      this.emit('connect')
    })

    this.stream.on('_disconnected_', () => {
      // megalodon では disconnect 時に error を発火してリトライを促す
      this.emit('error', new Error('Misskey stream disconnected'))
    })
  }

  private setupChannel(): void {
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

  start(): void {
    if (this.started) return
    this.started = true
    this.setupChannel()
  }

  stop(): void {
    if (!this.started) return
    this.started = false

    if (this.channel) {
      this.channel.dispose()
      this.channel = null
    }
    if (this.mainChannel) {
      this.mainChannel.dispose()
      this.mainChannel = null
    }

    this.stream.close()
  }

  // on, once, removeListener, removeAllListeners are inherited from EventEmitter
}
