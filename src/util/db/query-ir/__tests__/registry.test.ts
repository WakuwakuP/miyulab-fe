import { TABLE_REGISTRY } from 'util/db/query-ir/registry'
import { describe, expect, it } from 'vitest'

describe('TABLE_REGISTRY', () => {
  it('全ソーステーブルが登録されている', () => {
    expect(TABLE_REGISTRY.posts).toBeDefined()
    expect(TABLE_REGISTRY.notifications).toBeDefined()
  })

  it('ソーステーブルは joinPaths が空', () => {
    expect(Object.keys(TABLE_REGISTRY.posts.joinPaths)).toHaveLength(0)
    expect(Object.keys(TABLE_REGISTRY.notifications.joinPaths)).toHaveLength(0)
  })

  it('1:1 テーブルに posts への joinPath がある', () => {
    expect(TABLE_REGISTRY.profiles.joinPaths.posts).toBeDefined()
    expect(TABLE_REGISTRY.post_stats.joinPaths.posts).toBeDefined()
    expect(TABLE_REGISTRY.post_interactions.joinPaths.posts).toBeDefined()
  })

  it('profiles は notifications への joinPath も持つ', () => {
    expect(TABLE_REGISTRY.profiles.joinPaths.notifications).toBeDefined()
    expect(TABLE_REGISTRY.profiles.joinPaths.notifications?.sourceColumn).toBe(
      'actor_profile_id',
    )
  })

  it('lookup テーブルに isSmallLookup ヒントがある', () => {
    expect(TABLE_REGISTRY.visibility_types.hints?.isSmallLookup).toBe(true)
    expect(TABLE_REGISTRY.notification_types.hints?.isSmallLookup).toBe(true)
    expect(TABLE_REGISTRY.servers.hints?.isSmallLookup).toBe(true)
  })

  it('1:N テーブルに preferExists ヒントがある', () => {
    expect(TABLE_REGISTRY.post_media.hints?.preferExists).toBe(true)
    expect(TABLE_REGISTRY.post_mentions.hints?.preferExists).toBe(true)
    expect(TABLE_REGISTRY.post_hashtags.hints?.preferExists).toBe(true)
  })

  it('hashtags は via チェーンを持つ', () => {
    const via = TABLE_REGISTRY.hashtags.joinPaths.posts?.via
    expect(via).toBeDefined()
    expect(via?.[0]?.table).toBe('post_hashtags')
  })

  it('muted_accounts と blocked_instances は joinPaths が空', () => {
    expect(Object.keys(TABLE_REGISTRY.muted_accounts.joinPaths)).toHaveLength(0)
    expect(
      Object.keys(TABLE_REGISTRY.blocked_instances.joinPaths),
    ).toHaveLength(0)
  })

  it('notification_types の knownValues にメイン通知タイプが含まれる', () => {
    const knownValues =
      TABLE_REGISTRY.notification_types.columns.name.knownValues
    expect(knownValues).toContain('mention')
    expect(knownValues).toContain('reblog')
    expect(knownValues).toContain('favourite')
    expect(knownValues).toContain('follow')
    expect(knownValues).toContain('emoji_reaction')
  })
})
