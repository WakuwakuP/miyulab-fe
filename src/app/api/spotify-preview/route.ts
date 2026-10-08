import { getSpotifyEmbedUrl } from 'util/spotifyEmbed'
import { parseSpotifyPreview } from 'util/spotifyPreview'

export async function GET(request: Request) {
  const url = new URL(request.url).searchParams.get('url') ?? ''
  const embedUrl = url.length <= 512 ? getSpotifyEmbedUrl(url) : null
  if (!embedUrl)
    return Response.json({ error: 'Invalid Spotify URL' }, { status: 400 })
  try {
    const response = await fetch(embedUrl, {
      next: { revalidate: 3600 },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error('Spotify preview request failed')
    const html = await response.text()
    if (html.length > 4_000_000)
      throw new Error('Spotify preview response is too large')
    return Response.json(parseSpotifyPreview(html))
  } catch {
    return Response.json(
      { error: 'Spotify preview is unavailable' },
      { status: 502 },
    )
  }
}
