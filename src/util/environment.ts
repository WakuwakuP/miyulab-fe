import assert from 'node:assert'

import type { Backend } from 'types/types'

const VERCEL_URL =
  process.env.NEXT_PUBLIC_VERCEL_URL != null
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
    : undefined

export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? VERCEL_URL ?? 'http://localhost:3000'

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? 'https://pl.waku.dev'

export const APP_NAME = 'miyulab-fe'

assert(
  process.env.NEXT_PUBLIC_BACKEND_SNS === 'mastodon' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === 'pleroma' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === 'friendica' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === 'firefish' ||
    process.env.NEXT_PUBLIC_BACKEND_SNS === undefined,
  'Invalid NEXT_PUBLIC_BACKEND_SNS',
)

export const BACKEND_SNS: Backend =
  process.env.NEXT_PUBLIC_BACKEND_SNS ?? 'pleroma'

export const MAX_LENGTH = Number(process.env.NEXT_PUBLIC_MAX_LENGTH ?? 100000)

/**
 * タイムラインクエリで一度に取得する最大レコード数。
 *
 * MAX_LENGTH はストレージ上限（クリーンアップ閾値）であり、表示クエリの上限としては大きすぎるため、
 * 表示用クエリには別途この定数を使用する。
 */
export const TIMELINE_QUERY_LIMIT = Number(
  process.env.NEXT_PUBLIC_TIMELINE_QUERY_LIMIT ?? 200,
)

export const CENTER_INDEX = Math.floor(Number.MAX_SAFE_INTEGER / 2)
