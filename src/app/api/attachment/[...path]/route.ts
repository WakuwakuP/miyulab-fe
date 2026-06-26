import { NextResponse } from 'next/server'

export const revalidate = 14400 // 4 hours

const ALLOWED_CONTENT_TYPES = ['image/', 'audio/', 'video/']

function isAllowedContentType(contentType: string | null): boolean {
  if (!contentType) return false
  return ALLOWED_CONTENT_TYPES.some((prefix) => contentType.startsWith(prefix))
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true
  if (hostname === '[::1]' || hostname === '0.0.0.0') return true
  if (hostname.startsWith('10.')) return true
  if (hostname.startsWith('192.168.')) return true
  if (hostname.startsWith('169.254.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true
  return false
}

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    // Vercelの環境変数から許可されたドメインを取得
    const allowedDomains = [
      process.env.VERCEL_URL,
      process.env.VERCEL_BRANCH_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
    ].filter((domain): domain is string => !!domain)

    // RefererまたはOriginヘッダーをチェック（両方不在の場合も拒否）
    const referer = request.headers.get('referer')
    const origin = request.headers.get('origin')

    if (!referer && !origin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const isAllowed = allowedDomains.some((domain) => {
      if (referer?.includes(domain)) return true
      if (origin?.includes(domain)) return true
      return false
    })

    if (!isAllowed) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { path } = await context.params

    if (!path || path.length === 0) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    // path配列を結合してURLを再構築 (https:// を追加)
    // Next.jsがpath segmentsをデコード済みのため、そのまま結合
    const decodedPath = path.join('/')
    // リクエストURLからクエリパラメータを取得して付与 (Misskey proxy等で必要)
    const requestUrl = new URL(request.url)
    const queryString = requestUrl.search
    const imageUrl = `https://${decodedPath}${queryString}`

    // URLの妥当性チェック
    let parsedUrl: URL
    try {
      parsedUrl = new URL(imageUrl)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    // プライベート/内部ネットワークへのリクエストをブロック (SSRF防止)
    if (isPrivateHost(parsedUrl.hostname)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // 外部メディアを取得
    const attachmentResponse = await fetch(imageUrl, {
      cache: 'force-cache',
      headers: { 'User-Agent': 'miyulab-fe/1.0' },
    })

    if (!attachmentResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch image' },
        { status: attachmentResponse.status },
      )
    }

    const contentType = attachmentResponse.headers.get('content-type')

    // メディア以外のContent-Typeを拒否
    if (!isAllowedContentType(contentType)) {
      return NextResponse.json(
        { error: 'Invalid content type' },
        { status: 403 },
      )
    }

    // メディアデータを取得
    const imageBuffer = await attachmentResponse.arrayBuffer()

    // next/imageに適したレスポンスを返す
    // Content-Disposition: inline を追加してブラウザで表示されるようにする
    const headers: HeadersInit = {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Disposition': 'inline',
      'Content-Length': imageBuffer.byteLength.toString(),
    }

    if (contentType) {
      headers['Content-Type'] = contentType
    }

    return new NextResponse(imageBuffer, {
      headers,
      status: 200,
    })
  } catch (error) {
    console.error('Error in attachment proxy:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
