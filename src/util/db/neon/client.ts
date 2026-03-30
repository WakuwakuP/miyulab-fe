/**
 * Neon (PostgreSQL) 用 ZenStack クライアント — シングルトン
 *
 * DATABASE_URL 未設定時は null を返し、呼び出し側で保存処理をスキップする。
 */

import { ZenStackClient } from '@zenstackhq/orm'
import { PostgresDialect } from '@zenstackhq/orm/dialects/postgres'
import { Pool } from 'pg'
import { schema } from 'zenstack/schema'

let client: InstanceType<typeof ZenStackClient> | null = null
let initialized = false

/**
 * ZenStack クライアントを取得する。
 * DATABASE_URL が未設定の場合は null を返す。
 */
export function getNeonClient(): InstanceType<typeof ZenStackClient> | null {
  if (initialized) return client

  initialized = true

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.warn(
      '[QueryLog] DATABASE_URL is not set. Slow query logging to Neon is disabled.',
    )
    return null
  }

  client = new ZenStackClient(schema, {
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl,
      }),
    }),
  })

  return client
}
