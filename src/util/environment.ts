import assert from 'assert'

export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ??
  process.env.NEXT_PUBLIC_VERCEL_URL ??
  'http://localhost:3000'

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  'https://pl.waku.dev'

export const APP_NAME = 'miyulab-fe'

type Sns = 'mastodon' | 'pleroma' | 'friendica' | 'firefish'

assert(
  process.env.NEXT_PUBLIC_BACKEND_SNS === 'mastodon' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === 'pleroma' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === 'friendica' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === 'firefish' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === undefined,
  'Invalid NEXT_PUBLIC_BACKEND_SNS'
)

export const BACKEND_SNS: Sns =
  process.env.NEXT_PUBLIC_BACKEND_SNS ?? 'pleroma'
