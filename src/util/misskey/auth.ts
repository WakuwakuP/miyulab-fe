import type { OAuth } from 'megalodon'

/**
 * MiAuth のパーミッションスコープ
 * read/write の Mastodon スコープを Misskey パーミッションにマッピング
 */
const MISSKEY_PERMISSIONS = [
  'read:account',
  'write:account',
  'read:blocks',
  'write:blocks',
  'read:drive',
  'write:drive',
  'read:favorites',
  'write:favorites',
  'read:following',
  'write:following',
  'read:mutes',
  'write:mutes',
  'write:notes',
  'read:notifications',
  'write:notifications',
  'read:reactions',
  'write:reactions',
  'write:votes',
]

/**
 * MiAuth セッション ID を生成
 */
function generateSessionId(): string {
  return crypto.randomUUID()
}

/**
 * MiAuth 認証 URL を構築する
 *
 * @returns OAuth.AppData 互換オブジェクト（url に MiAuth URL を格納）
 */
export function createMiAuthAppData(
  origin: string,
  appName: string,
  callbackUrl: string,
): OAuth.AppData {
  const sessionId = generateSessionId()
  const permissions = MISSKEY_PERMISSIONS.join(',')
  const miAuthUrl = `${origin}/miauth/${sessionId}?name=${encodeURIComponent(appName)}&callback=${encodeURIComponent(callbackUrl)}&permission=${permissions}`

  return {
    client_id: sessionId,
    client_secret: '',
    id: '',
    name: appName,
    redirect_uri: callbackUrl,
    session_token: sessionId,
    url: miAuthUrl,
    website: callbackUrl,
  }
}

/**
 * MiAuth セッションからアクセストークンを取得する
 *
 * @param origin Misskey インスタンスの URL
 * @param sessionId MiAuth セッション ID (= appData.client_id)
 * @returns OAuth.TokenData 互換オブジェクト
 */
export async function fetchMiAuthToken(
  origin: string,
  sessionId: string,
): Promise<OAuth.TokenData> {
  const response = await fetch(`${origin}/api/miauth/${sessionId}/check`, {
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(
      `MiAuth check failed: ${response.status} ${response.statusText}`,
    )
  }

  const data = (await response.json()) as {
    ok: boolean
    token: string
    user: Record<string, unknown>
  }

  if (!data.ok || !data.token) {
    throw new Error('MiAuth check returned ok=false or missing token')
  }

  return {
    access_token: data.token,
    created_at: Math.floor(Date.now() / 1000),
    expires_in: null,
    refresh_token: null,
    scope: MISSKEY_PERMISSIONS.join(' '),
    token_type: 'Bearer',
  }
}

/**
 * Misskey インスタンスかどうかを nodeinfo から判定する
 */
export async function detectMisskey(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/api/meta`, {
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    if (!res.ok) return false
    const meta = (await res.json()) as Record<string, unknown>
    // Misskey の /api/meta は version フィールドを持つ
    return typeof meta.version === 'string'
  } catch {
    return false
  }
}
