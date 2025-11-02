import { NextResponse } from 'next/server'

export const revalidate = 14400 // 4 hours

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

    // RefererまたはOriginヘッダーをチェック
    const referer = request.headers.get('referer')
    const origin = request.headers.get('origin')

    const { path } = await context.params

    if (!path || path.length === 0) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    // path配列を結合してURLを再構築 (https:// を追加)
    const imageUrl = `https://${path.join('/')}`

    // 新しいタブで開いた場合（RefererもOriginもない場合）
    // リダイレクトではなく画像を直接表示する
    const shouldProxy = !referer && !origin

    if (!shouldProxy) {
      const isAllowed = allowedDomains.some((domain) => {
        if (referer?.includes(domain)) return true
        if (origin?.includes(domain)) return true
        return false
      })

      if (!isAllowed) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    // URLの妥当性チェック
    try {
      new URL(imageUrl)
    } catch {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
    }

    // 外部画像を取得
    const imageResponse = await fetch(imageUrl, {
      cache: 'force-cache',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
      },
    })

    if (!imageResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch image' },
        { status: imageResponse.status },
      )
    }

    // Content-Typeを取得（画像タイプの検証）
    const contentType = imageResponse.headers.get('content-type')
    if (!contentType?.startsWith('image/')) {
      return NextResponse.json(
        { error: 'Resource is not an image' },
        { status: 400 },
      )
    }

    // 画像データを取得
    const imageBuffer = await imageResponse.arrayBuffer()

    // next/imageに適したレスポンスを返す
    // Content-Disposition: inline を追加してブラウザで表示されるようにする
    return new NextResponse(imageBuffer, {
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': 'inline',
        'Content-Length': imageBuffer.byteLength.toString(),
        'Content-Type': contentType,
      },
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
