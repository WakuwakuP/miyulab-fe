import type { NextRequest } from 'next/server'

const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch\?.*v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([\w-]+)/,
]

const ALLOWED_PLATFORMS: {
  name: string
  match: (url: string) => string | null
  embedUrl: (id: string) => string
}[] = [
  {
    embedUrl: (id) =>
      `https://www.youtube.com/embed/${id}?autoplay=1&origin=${encodeURIComponent('about:blank')}`,
    match: (url) => {
      for (const pattern of YOUTUBE_PATTERNS) {
        const m = url.match(pattern)
        if (m) return m[1]
      }
      return null
    },
    name: 'youtube',
  },
]

function getEmbedInfo(
  url: string,
): { embedUrl: string; platform: string } | null {
  for (const platform of ALLOWED_PLATFORMS) {
    const id = platform.match(url)
    if (id != null) {
      return { embedUrl: platform.embedUrl(id), platform: platform.name }
    }
  }
  return null
}

export function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  if (url == null || url.length === 0) {
    return new Response('Missing url parameter', { status: 400 })
  }

  const info = getEmbedInfo(url)
  if (info == null) {
    return new Response('Unsupported video platform', { status: 400 })
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden;background:#000}iframe{width:100%;height:100%;border:none}</style>
</head>
<body>
<iframe
  src="${info.embedUrl}"
  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
  allowfullscreen
></iframe>
</body>
</html>`

  return new Response(html, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
}
