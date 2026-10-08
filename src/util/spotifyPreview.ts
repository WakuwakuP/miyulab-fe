export type SpotifyPreview = {
  title: string
  tracks: { title: string; subtitle: string; url: string }[]
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}
}

export function parseSpotifyPreview(html: string): SpotifyPreview {
  // ponytail: public embed data is undocumented; use authenticated Spotify APIs if its shape changes.
  const json =
    /<script\b[^>]*\bid="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(
      html,
    )?.[1]
  if (!json) throw new Error('Spotify preview data is unavailable')
  const props = record(record(JSON.parse(json)).props)
  const state = record(record(props.pageProps).state)
  const entity = record(record(state.data).entity)
  if (typeof entity.name !== 'string')
    throw new Error('Invalid Spotify preview data')
  const candidates = Array.isArray(entity.trackList)
    ? entity.trackList
    : [entity]
  const tracks: SpotifyPreview['tracks'] = []
  for (const candidate of candidates) {
    const track = record(candidate)
    const url = record(track.audioPreview).url
    const title = track.title ?? track.name
    if (typeof url !== 'string' || typeof title !== 'string') continue
    // Only the public preview CDN is playable; never forward arbitrary remote URLs.
    if (!/^https:\/\/p\.scdn\.co\/mp3-preview\/[\da-f]+(?:\?[^#]*)?$/.test(url))
      continue
    tracks.push({
      subtitle: typeof track.subtitle === 'string' ? track.subtitle : '',
      title,
      url,
    })
  }
  if (!tracks.length) throw new Error('No playable Spotify previews')
  return { title: entity.name, tracks }
}
