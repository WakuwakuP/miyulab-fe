import {
  ALIAS_TO_TABLE,
  ALLOWED_COLUMN_VALUES,
  COLUMN_TABLE_OVERRIDE,
  QUERY_COMPLETIONS,
} from 'util/db/sqlite/queries/statusCustomQuery'
import { describe, expect, it } from 'vitest'

// ─── QUERY_COMPLETIONS: 新カラム ────────────────────────────────

describe('QUERY_COMPLETIONS に新カラムが含まれている', () => {
  it('p に id が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.p).toContain('id')
  })

  it('p に edited_at_ms が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.p).toContain('edited_at_ms')
  })

  it('p に plain_content が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.p).toContain('plain_content')
  })

  it('p に quote_of_post_id が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.p).toContain('quote_of_post_id')
  })

  it('p に quote_state が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.p).toContain('quote_state')
  })

  it('p に in_reply_to_uri が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.p).toContain('in_reply_to_uri')
  })

  it('p に in_reply_to_account_acct が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.p).toContain('in_reply_to_account_acct')
  })

  it('p に application_name が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.p).toContain('application_name')
  })

  it('p に last_fetched_at が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.p).toContain('last_fetched_at')
  })

  it('p に is_local_only が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.p).toContain('is_local_only')
  })

  it('n に id が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.n).toContain('id')
  })
})

// ─── QUERY_COMPLETIONS: 旧カラム ────────────────────────────────

describe('QUERY_COMPLETIONS に旧カラムが含まれていない', () => {
  it('p に post_id が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('post_id')
  })

  it('p に stored_at が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('stored_at')
  })

  it('p に has_media が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('has_media')
  })

  it('p に media_count が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('media_count')
  })

  it('p に has_spoiler が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('has_spoiler')
  })

  it('p に reblog_of_uri が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('reblog_of_uri')
  })

  it('p に repost_of_post_id が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('repost_of_post_id')
  })

  it('p に in_reply_to_id が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('in_reply_to_id')
  })

  it('p に edited_at が含まれていない（edited_at_ms に変更済み）', () => {
    // edited_at_ms は含まれるが、edited_at 単体は含まれない
    const cols = QUERY_COMPLETIONS.columns.p as readonly string[]
    const exactMatch = cols.filter((c) => c === 'edited_at')
    expect(exactMatch).toHaveLength(0)
  })

  it('p に visibility が含まれていない（compat 仮想カラム）', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('visibility')
  })

  it('p に account_acct が含まれていない（compat 仮想カラム）', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('account_acct')
  })

  it('p に origin_backend_url が含まれていない（compat 仮想カラム）', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('origin_backend_url')
  })

  it('p に favourites_count が含まれていない（post_stats に移動）', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('favourites_count')
  })

  it('p に reblogs_count が含まれていない（post_stats に移動）', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('reblogs_count')
  })

  it('p に replies_count が含まれていない（post_stats に移動）', () => {
    expect(QUERY_COMPLETIONS.columns.p).not.toContain('replies_count')
  })

  it('n に notification_id が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.n).not.toContain('notification_id')
  })

  it('n に stored_at が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.n).not.toContain('stored_at')
  })

  it('n に server_id が含まれていない', () => {
    expect(QUERY_COMPLETIONS.columns.n).not.toContain('server_id')
  })

  it('n に notification_type が含まれていない（compat 仮想カラム）', () => {
    expect(QUERY_COMPLETIONS.columns.n).not.toContain('notification_type')
  })

  it('n に account_acct が含まれていない（compat 仮想カラム）', () => {
    expect(QUERY_COMPLETIONS.columns.n).not.toContain('account_acct')
  })

  it('n に backend_url が含まれていない（compat 仮想カラム）', () => {
    expect(QUERY_COMPLETIONS.columns.n).not.toContain('backend_url')
  })
})

// ─── QUERY_COMPLETIONS: 新エイリアス ────────────────────────────

describe('QUERY_COMPLETIONS に新エイリアスが含まれている', () => {
  it('aliases に pr (profiles) が含まれている', () => {
    expect(QUERY_COMPLETIONS.aliases).toContain('pr')
  })

  it('aliases に vt (visibility_types) が含まれている', () => {
    expect(QUERY_COMPLETIONS.aliases).toContain('vt')
  })

  it('aliases に ps (post_stats) が含まれている', () => {
    expect(QUERY_COMPLETIONS.aliases).toContain('ps')
  })

  it('aliases に ht (hashtags) が含まれている', () => {
    expect(QUERY_COMPLETIONS.aliases).toContain('ht')
  })

  it('aliases に nt (notification_types) が含まれている', () => {
    expect(QUERY_COMPLETIONS.aliases).toContain('nt')
  })

  it('aliases に ap (profiles - 通知元) が含まれている', () => {
    expect(QUERY_COMPLETIONS.aliases).toContain('ap')
  })

  it('aliases に pbt が含まれていない（ht に置き換え）', () => {
    expect(QUERY_COMPLETIONS.aliases).not.toContain('pbt')
  })

  it('pr のカラムに acct が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.pr).toContain('acct')
  })

  it('vt のカラムに name が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.vt).toContain('name')
  })

  it('ps のカラムに favourites_count が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.ps).toContain('favourites_count')
  })

  it('ht のカラムに name が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.ht).toContain('name')
  })

  it('nt のカラムに name が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.nt).toContain('name')
  })

  it('ap のカラムに acct が含まれている', () => {
    expect(QUERY_COMPLETIONS.columns.ap).toContain('acct')
  })

  it('pb のカラムに backend_url が含まれていない（実カラムのみ）', () => {
    expect(QUERY_COMPLETIONS.columns.pb).not.toContain('backend_url')
    expect(QUERY_COMPLETIONS.columns.pb).not.toContain('backendUrl')
  })
})

// ─── ALLOWED_COLUMN_VALUES ──────────────────────────────────────

describe('ALLOWED_COLUMN_VALUES に新テーブル名が使われている', () => {
  it('visibility_types に name が含まれている（code ではない）', () => {
    expect(ALLOWED_COLUMN_VALUES.visibility_types).toContain('name')
    expect(ALLOWED_COLUMN_VALUES.visibility_types).not.toContain('code')
  })

  it('notification_types に name が含まれている（code ではない）', () => {
    expect(ALLOWED_COLUMN_VALUES.notification_types).toContain('name')
    expect(ALLOWED_COLUMN_VALUES.notification_types).not.toContain('code')
  })

  it('channel_kinds が含まれていない', () => {
    expect(ALLOWED_COLUMN_VALUES).not.toHaveProperty('channel_kinds')
  })

  it('hashtags に name が含まれている（normalized_name ではない）', () => {
    expect(ALLOWED_COLUMN_VALUES.hashtags).toContain('name')
    expect(ALLOWED_COLUMN_VALUES.hashtags).not.toContain('normalized_name')
  })

  it('post_backend_ids が含まれている（posts_backends ではない）', () => {
    expect(ALLOWED_COLUMN_VALUES).toHaveProperty('post_backend_ids')
    expect(ALLOWED_COLUMN_VALUES).not.toHaveProperty('posts_backends')
  })
})

// ─── ALIAS_TO_TABLE ─────────────────────────────────────────────

describe('ALIAS_TO_TABLE に新テーブル名が使われている', () => {
  it('pb が post_backend_ids を参照する（posts_backends ではない）', () => {
    expect(ALIAS_TO_TABLE.pb.table).toBe('post_backend_ids')
  })

  it('pe が post_interactions を参照する（post_engagements ではない）', () => {
    expect(ALIAS_TO_TABLE.pe.table).toBe('post_interactions')
  })

  it('pme が post_mentions を参照する（posts_mentions ではない）', () => {
    expect(ALIAS_TO_TABLE.pme.table).toBe('post_mentions')
  })

  it('pbt の tag カラムが name にマッピングされる（normalized_name ではない）', () => {
    expect(ALIAS_TO_TABLE.pbt.columns.tag).toBe('name')
  })

  it('ptt の timelineType カラムが timeline_key にマッピングされる（code ではない）', () => {
    expect(ALIAS_TO_TABLE.ptt.columns.timelineType).toBe('timeline_key')
  })

  it('ptt が timeline_entries を参照する（channel_kinds ではない）', () => {
    expect(ALIAS_TO_TABLE.ptt.table).toBe('timeline_entries')
  })
})

// ─── COLUMN_TABLE_OVERRIDE ──────────────────────────────────────

describe('COLUMN_TABLE_OVERRIDE に新カラム名が使われている', () => {
  it('p.visibility が visibility_types.name を参照する（code ではない）', () => {
    expect(COLUMN_TABLE_OVERRIDE.p.visibility.column).toBe('name')
    expect(COLUMN_TABLE_OVERRIDE.p.visibility.table).toBe('visibility_types')
  })

  it('n.notification_type が notification_types.name を参照する（code ではない）', () => {
    expect(COLUMN_TABLE_OVERRIDE.n.notification_type.column).toBe('name')
    expect(COLUMN_TABLE_OVERRIDE.n.notification_type.table).toBe(
      'notification_types',
    )
  })

  it('p.origin_backend_url が local_accounts を参照する', () => {
    expect(COLUMN_TABLE_OVERRIDE.p.origin_backend_url.table).toBe(
      'local_accounts',
    )
  })
})
