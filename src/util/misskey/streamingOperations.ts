import type { WebSocketInterface } from 'megalodon'
import { type MisskeyClientContext, NotImplementedError } from './helpers'
import { MisskeyWebSocketAdapter } from './MisskeyWebSocketAdapter'

// =============================================
// Streaming
// =============================================

export async function streamingURL(ctx: MisskeyClientContext): Promise<string> {
  return ctx.origin
}

export async function userStreaming(
  ctx: MisskeyClientContext,
): Promise<WebSocketInterface> {
  const adapter = new MisskeyWebSocketAdapter(
    ctx.origin,
    ctx.credential ?? '',
    'homeTimeline',
  )
  adapter.start()
  return adapter
}

export async function publicStreaming(
  ctx: MisskeyClientContext,
): Promise<WebSocketInterface> {
  const adapter = new MisskeyWebSocketAdapter(
    ctx.origin,
    ctx.credential ?? '',
    'globalTimeline',
  )
  adapter.start()
  return adapter
}

export async function localStreaming(
  ctx: MisskeyClientContext,
): Promise<WebSocketInterface> {
  const adapter = new MisskeyWebSocketAdapter(
    ctx.origin,
    ctx.credential ?? '',
    'localTimeline',
  )
  adapter.start()
  return adapter
}

export async function tagStreaming(
  ctx: MisskeyClientContext,
  tag: string,
): Promise<WebSocketInterface> {
  const adapter = new MisskeyWebSocketAdapter(
    ctx.origin,
    ctx.credential ?? '',
    'hashtag',
    { tag },
  )
  adapter.start()
  return adapter
}

export async function listStreaming(
  _listId: string,
): Promise<WebSocketInterface> {
  throw new NotImplementedError('listStreaming')
}

export async function directStreaming(): Promise<WebSocketInterface> {
  throw new NotImplementedError('directStreaming')
}
