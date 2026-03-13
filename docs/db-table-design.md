# DBテーブル設計書

## 1. 目的

本書は における SQLite 向けの新規 DB テーブル設計書である。
設計方針として、検索・蓄積・統合表示に必要な業務データをできる限り正規化し、UI 設定や秘密情報とは責務を分離する。

本版では、単純な一覧取得だけでなく、**複雑なクエリに耐えられること** を重要要件として明示する。
具体的には、以下のような問い合わせを安定して表現できる構造を目指す。

- 複数条件を組み合わせた投稿検索
- タイムライン横断の混合表示
- 通知と投稿の時系列結合
- 投稿統計値による絞り込み
- ホーム / ローカル / 連合 / タグ / 通知などのチャネル単位取得
- ユーザー・タグ・メディア・言語・公開範囲・会話関係を横断した問い合わせ
- 後から SQL フィルタや高度検索を載せやすい構造

本設計の主目的は以下のとおり。

- 複数 Fediverse サーバーから取得したデータを重複なく統合管理する
- 投稿・通知・プロフィール・DM・タグ・リアクションを正規化して保持する
- タイムライン表示やフィルタリングに必要な問い合わせを安定して実現する
- 将来的な通知種別追加や対応サーバー拡張に耐えられる構造にする
- 複雑なクエリ向けに、必要最小限の補助テーブルを加えて拡張性を確保する

---

## 2. 保存対象と責務分離

### 2.1 SQLite に保存するもの

- サーバー情報
- ログイン済みアカウント参照情報
- フォロー関係
- プロフィール
- 投稿
- 添付メディア
- ハッシュタグ
- メンション
- カスタム絵文字
- 投票
- OGP カード
- 投稿統計
- 通知
- DM 会話
- アカウントごとの投稿状態
- タイムライン定義とタイムライン要素
- 取り込みチャネル
- 差分取得チェックポイント
- 検索・表示に必要な補助イベント

### 2.2 SQLite に保存しないもの

以下は本設計の対象外とし、別ストアで管理する。

- OAuth アクセストークン
- OAuth リフレッシュトークン
- タイムラインレイアウト
- タブ構成
- アプリ設定

---

## 3. 設計方針

### 3.1 正規化方針

1. 第3正規形を基本とする
2. 繰り返し属性は子テーブルへ分離する
3. サーバー依存 ID と canonical URI を分離する
4. 業務主体データとログインアカウントごとの状態を分離する
5. 導出可能属性は原則保持しない
6. 列挙値は原則としてマスターテーブルで管理する
7. 多対多関係は中間テーブルで表現する
8. 複雑なクエリで頻出する「帰属」「集計」「時系列イベント」は、業務データ本体とは分離した補助テーブルとして保持する
9. 本体正規化を崩さずに高速化したい場合は、キャッシュ列よりもまず補助テーブルとインデックスで対応する

### 3.2 設計上の重要原則

- `profiles` と `posts` は canonical な実体を表す
- サーバーごとの差異は alias テーブルで吸収する
- 1つの投稿を複数サーバー経由で受信しても `posts` では重複登録しない
- 1つのプロフィールを複数サーバーの account ID で参照しても `profiles` では重複登録しない
- お気に入り、ブースト、ブックマーク、リアクションは `post_engagements` に統一して保持する
- 投稿の統計値は `post_stats` に分離する
- タイムラインへの帰属は `timeline_items` に分離する
- ホームタイムライン再構成やローカル判定のため、アカウント所属とフォロー関係を明示的に保持する
- 通知と投稿の混合表示や高度な表示順制御のため、必要に応じて `feed_events` を用いる
- 初期設計では非正規化を避け、性能課題が実測で確認された場合のみ補助構造を追加する

### 3.3 複雑なクエリ対応方針

本設計は、単表検索よりも以下のような複合条件を重視する。

- 投稿者 + タグ + 言語 + visibility + メディア有無
- 通知種別 + 通知元ユーザー + 通知時刻直後の投稿
- ホームタイムライン + 通知イベントの混合
- ブースト除外 + CW 有り + ふぁぼ数下限 + メンション条件
- ローカルTL + 指定タグ + 特定サーバー所属ユーザー
- あるユーザーがブーストした投稿と、その元投稿の条件絞り込み

このため、以下を重視する。

- 事実テーブルと補助テーブルの役割分離
- 時系列キーの明示
- チャネル帰属の保持
- 投稿統計の独立管理
- フォロー関係の保存
- タイムライン / 通知混合表示を可能にするイベントモデル

---

## 4. 想定ER概要

```/dev/null/db-table-design.txt#L1-38
software_types ─┐
visibility_types ─┤
notification_types ─┤
media_types ─┤
engagement_types ─┤
channel_kinds ─┤
timeline_item_kinds ─┘

servers ─┬─< profile_aliases >─ profiles ─┬─< profile_fields
         │                                ├─< local_accounts
         │                                ├─< follows
         │                                └─< posts
         ├─< post_aliases >──── posts ─────┬─< post_media
         │                                 ├─< post_hashtags >─ hashtags
         │                                 ├─< post_mentions >─ profiles
         │                                 ├─< post_custom_emojis >─ custom_emojis
         │                                 ├─1 polls ─< poll_options
         │                                 ├─< post_links >─ link_cards
         │                                 ├─1 post_stats
         │                                 └─< timeline_items
         ├─< notifications >─ local_accounts
         ├─< conversations >─ local_accounts ─< conversation_members
         │                    └───────────────< conversation_posts >─ posts
         ├─< ingest_channels ─1 ingest_checkpoints
         └─< timelines ─< timeline_items

local_accounts ─< post_engagements >─ posts
local_accounts ─< tag_history >─ hashtags
local_accounts ─< timelines
local_accounts ─< notifications
local_accounts ─< feed_events

timelines ─< timeline_items >─ posts
notifications ─< feed_events
posts ─< feed_events
profiles ─< feed_events

profiles ─< follows >─ local_accounts
```

---

## 5. 命名ルール

- テーブル名は複数形の `snake_case`
- 主キーは原則 `<table_singular>_id`
- 外部キーは参照先テーブルの主キー名をそのまま使う
- 真偽値は `is_` もしくは意味が明確な形容詞で命名する
- 日時は `*_at`
- 表示順は `sort_order`
- 外部システム依存の識別子には `remote_` 接頭辞を付ける
- canonical URI は `actor_uri`、`object_uri`、`canonical_url` のように用途別に命名する
- タイムライン帰属やイベント表の並び順用キーは `sort_key`
- 「どのサーバーのローカルか」を表す列には `home_server_id` または `origin_server_id` を用いる

---

## 6. テーブル一覧

## 6.1 共通マスター

### 6.1.1 `software_types`

| 項目 | 内容 |
|---|---|
| 役割 | サーバーソフトウェア種別マスター |
| 主キー | `software_type_id` |
| 一意制約 | `code` |
| 主な利用箇所 | サーバー種別判定、互換処理分岐 |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| software_type_id | INTEGER | NOT NULL | PK | サーバーソフトウェア種別ID |
| code | TEXT | NOT NULL | UNIQUE | 識別コード。例: `mastodon`, `pleroma`, `misskey`, `firefish` |
| display_name | TEXT | NOT NULL |  | 表示名 |

### 6.1.2 `visibility_types`

| 項目 | 内容 |
|---|---|
| 役割 | 投稿公開範囲マスター |
| 主キー | `visibility_id` |
| 一意制約 | `code` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| visibility_id | INTEGER | NOT NULL | PK | 公開範囲ID |
| code | TEXT | NOT NULL | UNIQUE | `public`, `unlisted`, `private`, `direct` など |
| display_name | TEXT | NOT NULL |  | 表示名 |

### 6.1.3 `notification_types`

| 項目 | 内容 |
|---|---|
| 役割 | 通知種別マスター |
| 主キー | `notification_type_id` |
| 一意制約 | `code` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| notification_type_id | INTEGER | NOT NULL | PK | 通知種別ID |
| code | TEXT | NOT NULL | UNIQUE | `follow`, `favourite`, `reblog`, `mention`, `reaction` など |
| display_name | TEXT | NOT NULL |  | 表示名 |

### 6.1.4 `media_types`

| 項目 | 内容 |
|---|---|
| 役割 | メディア種別マスター |
| 主キー | `media_type_id` |
| 一意制約 | `code` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| media_type_id | INTEGER | NOT NULL | PK | メディア種別ID |
| code | TEXT | NOT NULL | UNIQUE | `image`, `video`, `gifv`, `audio` など |
| display_name | TEXT | NOT NULL |  | 表示名 |

### 6.1.5 `engagement_types`

| 項目 | 内容 |
|---|---|
| 役割 | 投稿に対するアクション種別マスター |
| 主キー | `engagement_type_id` |
| 一意制約 | `code` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| engagement_type_id | INTEGER | NOT NULL | PK | アクション種別ID |
| code | TEXT | NOT NULL | UNIQUE | `favourite`, `reblog`, `bookmark`, `reaction` |
| display_name | TEXT | NOT NULL |  | 表示名 |

### 6.1.6 `channel_kinds`

| 項目 | 内容 |
|---|---|
| 役割 | 取り込みチャネル種別マスター |
| 主キー | `channel_kind_id` |
| 一意制約 | `code` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| channel_kind_id | INTEGER | NOT NULL | PK | チャネル種別ID |
| code | TEXT | NOT NULL | UNIQUE | `home`, `local`, `federated`, `tag`, `notification`, `bookmark`, `conversation` |
| display_name | TEXT | NOT NULL |  | 表示名 |

### 6.1.7 `timeline_item_kinds`

| 項目 | 内容 |
|---|---|
| 役割 | タイムライン要素種別マスター |
| 主キー | `timeline_item_kind_id` |
| 一意制約 | `code` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| timeline_item_kind_id | INTEGER | NOT NULL | PK | タイムライン要素種別ID |
| code | TEXT | NOT NULL | UNIQUE | `post`, `notification`, `event` |
| display_name | TEXT | NOT NULL |  | 表示名 |

---

## 6.2 サーバー・アカウント系

### 6.2.1 `servers`

| 項目 | 内容 |
|---|---|
| 役割 | 接続先サーバーの正規化マスター |
| 主キー | `server_id` |
| 一意制約 | `host` |
| 外部キー | `software_type_id -> software_types.software_type_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| server_id | INTEGER | NOT NULL | PK | サーバーID |
| host | TEXT | NOT NULL | UNIQUE | ホスト名 |
| base_url | TEXT | NOT NULL |  | ベースURL |
| software_type_id | INTEGER | NULL | FK | サーバーソフトウェア種別 |
| software_version | TEXT | NULL |  | 検出したバージョン |
| detected_at | TEXT | NULL |  | 初回または最新の検出日時 |

### 6.2.2 `profiles`

| 項目 | 内容 |
|---|---|
| 役割 | canonical なユーザープロフィール |
| 主キー | `profile_id` |
| 一意制約 | `actor_uri` |
| 外部キー | `home_server_id -> servers.server_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| profile_id | INTEGER | NOT NULL | PK | プロフィールID |
| actor_uri | TEXT | NOT NULL | UNIQUE | ActivityPub actor の canonical URI |
| home_server_id | INTEGER | NULL | FK | そのプロフィールの所属元サーバー |
| acct | TEXT | NULL |  | `user` または `user@domain` 形式 |
| username | TEXT | NOT NULL |  | ユーザー名 |
| domain | TEXT | NULL |  | 所属ドメイン |
| display_name | TEXT | NULL |  | 表示名 |
| note_html | TEXT | NULL |  | 自己紹介HTML |
| avatar_url | TEXT | NULL |  | アイコンURL |
| header_url | TEXT | NULL |  | ヘッダー画像URL |
| locked | INTEGER | NOT NULL |  | 鍵アカウントフラグ |
| bot | INTEGER | NOT NULL |  | bot フラグ |
| discoverable | INTEGER | NULL |  | discoverable フラグ |
| created_at | TEXT | NULL |  | リモート上の作成日時 |
| updated_at | TEXT | NOT NULL |  | ローカル更新日時 |

### 6.2.3 `profile_aliases`

| 項目 | 内容 |
|---|---|
| 役割 | サーバーごとの account ID と canonical profile の対応 |
| 主キー | `profile_alias_id` |
| 一意制約 | `(server_id, remote_account_id)` |
| 外部キー | `server_id -> servers.server_id`, `profile_id -> profiles.profile_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| profile_alias_id | INTEGER | NOT NULL | PK | プロフィール別名ID |
| server_id | INTEGER | NOT NULL | FK | 受信元サーバーID |
| remote_account_id | TEXT | NOT NULL |  | サーバー依存の account ID |
| profile_id | INTEGER | NOT NULL | FK | canonical profile |
| fetched_at | TEXT | NOT NULL |  | 取得日時 |

### 6.2.4 `profile_fields`

| 項目 | 内容 |
|---|---|
| 役割 | プロフィール拡張項目 |
| 主キー | `profile_field_id` |
| 一意制約 | `(profile_id, sort_order)` |
| 外部キー | `profile_id -> profiles.profile_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| profile_field_id | INTEGER | NOT NULL | PK | プロフィール項目ID |
| profile_id | INTEGER | NOT NULL | FK | 対象プロフィール |
| field_name | TEXT | NOT NULL |  | 項目名 |
| field_value | TEXT | NOT NULL |  | 項目値 |
| verified_at | TEXT | NULL |  | 検証日時 |
| sort_order | INTEGER | NOT NULL |  | 表示順 |

### 6.2.5 `local_accounts`

| 項目 | 内容 |
|---|---|
| 役割 | ログイン済みアカウントの参照情報 |
| 主キー | `local_account_id` |
| 一意制約 | `(server_id, profile_id)` |
| 外部キー | `server_id -> servers.server_id`, `profile_id -> profiles.profile_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| local_account_id | INTEGER | NOT NULL | PK | ローカルアカウントID |
| server_id | INTEGER | NOT NULL | FK | ログイン先サーバー |
| profile_id | INTEGER | NOT NULL | FK | 対応プロフィール |
| is_default_post_account | INTEGER | NOT NULL |  | デフォルト投稿アカウントか |
| last_authenticated_at | TEXT | NULL |  | 最終認証日時 |

> 注記: トークン本体は保存しない。認証情報は別ストア管理とする。

### 6.2.6 `follows`

| 項目 | 内容 |
|---|---|
| 役割 | ローカルアカウントごとのフォロー関係 |
| 主キー | `follow_id` |
| 一意制約 | `(local_account_id, target_profile_id)` |
| 外部キー | `local_account_id -> local_accounts.local_account_id`, `target_profile_id -> profiles.profile_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| follow_id | INTEGER | NOT NULL | PK | フォロー関係ID |
| local_account_id | INTEGER | NOT NULL | FK | フォロー主体アカウント |
| target_profile_id | INTEGER | NOT NULL | FK | フォロー対象プロフィール |
| created_at | TEXT | NULL |  | フォロー成立日時 |
| fetched_at | TEXT | NOT NULL |  | 取得日時 |

---

## 6.3 投稿系

### 6.3.1 `posts`

| 項目 | 内容 |
|---|---|
| 役割 | canonical な投稿本体 |
| 主キー | `post_id` |
| 一意制約 | `object_uri` |
| 外部キー | `author_profile_id -> profiles.profile_id`, `reply_to_post_id -> posts.post_id`, `repost_of_post_id -> posts.post_id`, `quote_post_id -> posts.post_id`, `visibility_id -> visibility_types.visibility_id`, `origin_server_id -> servers.server_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| post_id | INTEGER | NOT NULL | PK | 投稿ID |
| object_uri | TEXT | NOT NULL | UNIQUE | ActivityPub object の canonical URI |
| origin_server_id | INTEGER | NULL | FK | 投稿の起点サーバー |
| author_profile_id | INTEGER | NOT NULL | FK | 投稿者 |
| reply_to_post_id | INTEGER | NULL | FK | リプライ先投稿 |
| repost_of_post_id | INTEGER | NULL | FK | ブースト元投稿 |
| quote_post_id | INTEGER | NULL | FK | 引用投稿 |
| visibility_id | INTEGER | NOT NULL | FK | 公開範囲 |
| language_code | TEXT | NULL |  | 言語コード |
| content_html | TEXT | NULL |  | 投稿本文HTML |
| spoiler_text | TEXT | NULL |  | CW テキスト |
| is_sensitive | INTEGER | NOT NULL |  | センシティブフラグ |
| is_local_only | INTEGER | NOT NULL |  | ローカル限定投稿フラグ |
| created_at | TEXT | NOT NULL |  | 投稿作成日時 |
| edited_at | TEXT | NULL |  | 編集日時 |

### 6.3.2 `post_aliases`

| 項目 | 内容 |
|---|---|
| 役割 | サーバーごとの status ID と canonical post の対応 |
| 主キー | `post_alias_id` |
| 一意制約 | `(server_id, remote_status_id)` |
| 外部キー | `server_id -> servers.server_id`, `post_id -> posts.post_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| post_alias_id | INTEGER | NOT NULL | PK | 投稿別名ID |
| server_id | INTEGER | NOT NULL | FK | 受信元サーバー |
| remote_status_id | TEXT | NOT NULL |  | サーバー依存の status ID |
| post_id | INTEGER | NOT NULL | FK | canonical post |
| fetched_at | TEXT | NOT NULL |  | 取得日時 |

### 6.3.3 `post_media`

| 項目 | 内容 |
|---|---|
| 役割 | 添付メディア |
| 主キー | `media_id` |
| 一意制約 | `(post_id, sort_order)` |
| 外部キー | `post_id -> posts.post_id`, `media_type_id -> media_types.media_type_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| media_id | INTEGER | NOT NULL | PK | メディアID |
| post_id | INTEGER | NOT NULL | FK | 対象投稿 |
| media_type_id | INTEGER | NOT NULL | FK | メディア種別 |
| remote_media_id | TEXT | NULL |  | サーバー依存メディアID |
| url | TEXT | NOT NULL |  | 本体URL |
| preview_url | TEXT | NULL |  | プレビューURL |
| description | TEXT | NULL |  | 代替テキスト |
| blurhash | TEXT | NULL |  | blurhash |
| width | INTEGER | NULL |  | 横幅 |
| height | INTEGER | NULL |  | 高さ |
| duration_ms | INTEGER | NULL |  | 再生時間 |
| sort_order | INTEGER | NOT NULL |  | 並び順 |
| is_sensitive | INTEGER | NOT NULL |  | メディア単位センシティブフラグ |

### 6.3.4 `hashtags`

| 項目 | 内容 |
|---|---|
| 役割 | ハッシュタグ辞書 |
| 主キー | `hashtag_id` |
| 一意制約 | `normalized_name` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| hashtag_id | INTEGER | NOT NULL | PK | ハッシュタグID |
| normalized_name | TEXT | NOT NULL | UNIQUE | 正規化済みタグ名 |
| display_name | TEXT | NOT NULL |  | 表示用タグ名 |

### 6.3.5 `post_hashtags`

| 項目 | 内容 |
|---|---|
| 役割 | 投稿とタグの多対多 |
| 主キー | `(post_id, hashtag_id)` |
| 外部キー | `post_id -> posts.post_id`, `hashtag_id -> hashtags.hashtag_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| post_id | INTEGER | NOT NULL | PK, FK | 投稿ID |
| hashtag_id | INTEGER | NOT NULL | PK, FK | ハッシュタグID |
| sort_order | INTEGER | NULL |  | 投稿内の出現順 |

### 6.3.6 `post_mentions`

| 項目 | 内容 |
|---|---|
| 役割 | 投稿内メンション |
| 主キー | `(post_id, mentioned_profile_id)` |
| 外部キー | `post_id -> posts.post_id`, `mentioned_profile_id -> profiles.profile_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| post_id | INTEGER | NOT NULL | PK, FK | 投稿ID |
| mentioned_profile_id | INTEGER | NOT NULL | PK, FK | メンション対象プロフィール |
| mention_url | TEXT | NULL |  | メンションURL |

### 6.3.7 `custom_emojis`

| 項目 | 内容 |
|---|---|
| 役割 | サーバー単位のカスタム絵文字 |
| 主キー | `emoji_id` |
| 一意制約 | `(server_id, shortcode)` |
| 外部キー | `server_id -> servers.server_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| emoji_id | INTEGER | NOT NULL | PK | 絵文字ID |
| server_id | INTEGER | NOT NULL | FK | 所属サーバー |
| shortcode | TEXT | NOT NULL |  | shortcode |
| domain | TEXT | NULL |  | ドメイン補助情報 |
| image_url | TEXT | NOT NULL |  | アニメーション含む画像URL |
| static_url | TEXT | NULL |  | 静止画像URL |
| visible_in_picker | INTEGER | NOT NULL |  | ピッカー表示可否 |

### 6.3.8 `post_custom_emojis`

| 項目 | 内容 |
|---|---|
| 役割 | 投稿本文やリアクションで使用された絵文字 |
| 主キー | `(post_id, emoji_id, usage_context)` |
| 外部キー | `post_id -> posts.post_id`, `emoji_id -> custom_emojis.emoji_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| post_id | INTEGER | NOT NULL | PK, FK | 投稿ID |
| emoji_id | INTEGER | NOT NULL | PK, FK | 絵文字ID |
| usage_context | TEXT | NOT NULL | PK | 使用文脈。例: `content`, `reaction_summary` |

### 6.3.9 `polls`

| 項目 | 内容 |
|---|---|
| 役割 | 投稿に紐づく投票本体 |
| 主キー | `poll_id` |
| 一意制約 | `post_id` |
| 外部キー | `post_id -> posts.post_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| poll_id | INTEGER | NOT NULL | PK | 投票ID |
| post_id | INTEGER | NOT NULL | UNIQUE, FK | 対象投稿 |
| expires_at | TEXT | NULL |  | 期限 |
| multiple | INTEGER | NOT NULL |  | 複数選択可否 |
| votes_count | INTEGER | NULL |  | 総投票数 |
| voters_count | INTEGER | NULL |  | 投票者数 |

### 6.3.10 `poll_options`

| 項目 | 内容 |
|---|---|
| 役割 | 投票選択肢 |
| 主キー | `poll_option_id` |
| 一意制約 | `(poll_id, option_index)` |
| 外部キー | `poll_id -> polls.poll_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| poll_option_id | INTEGER | NOT NULL | PK | 投票選択肢ID |
| poll_id | INTEGER | NOT NULL | FK | 対象投票 |
| option_index | INTEGER | NOT NULL |  | 選択肢順序 |
| title | TEXT | NOT NULL |  | 選択肢文言 |
| votes_count | INTEGER | NULL |  | 得票数 |

### 6.3.11 `link_cards`

| 項目 | 内容 |
|---|---|
| 役割 | OGP カードの正規化キャッシュ |
| 主キー | `link_card_id` |
| 一意制約 | `canonical_url` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| link_card_id | INTEGER | NOT NULL | PK | リンクカードID |
| canonical_url | TEXT | NOT NULL | UNIQUE | 正規化URL |
| title | TEXT | NULL |  | タイトル |
| description | TEXT | NULL |  | 説明 |
| image_url | TEXT | NULL |  | 画像URL |
| provider_name | TEXT | NULL |  | 提供元名 |
| fetched_at | TEXT | NOT NULL |  | 取得日時 |

### 6.3.12 `post_links`

| 項目 | 内容 |
|---|---|
| 役割 | 投稿に含まれる URL と OGP カードの対応 |
| 主キー | `(post_id, link_card_id, url_in_post)` |
| 外部キー | `post_id -> posts.post_id`, `link_card_id -> link_cards.link_card_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| post_id | INTEGER | NOT NULL | PK, FK | 投稿ID |
| link_card_id | INTEGER | NOT NULL | PK, FK | リンクカードID |
| url_in_post | TEXT | NOT NULL | PK | 投稿中に記載されたURL |
| sort_order | INTEGER | NULL |  | 出現順 |

### 6.3.13 `post_stats`

| 項目 | 内容 |
|---|---|
| 役割 | 投稿ごとの統計情報 |
| 主キー | `post_id` |
| 外部キー | `post_id -> posts.post_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| post_id | INTEGER | NOT NULL | PK, FK | 対象投稿 |
| replies_count | INTEGER | NULL |  | 返信数 |
| reblogs_count | INTEGER | NULL |  | ブースト数 |
| favourites_count | INTEGER | NULL |  | お気に入り数 |
| reactions_count | INTEGER | NULL |  | リアクション総数 |
| quotes_count | INTEGER | NULL |  | 引用数 |
| fetched_at | TEXT | NOT NULL |  | 統計取得日時 |

---

## 6.4 タイムライン・フィード系

### 6.4.1 `timelines`

| 項目 | 内容 |
|---|---|
| 役割 | ローカルアカウントごとの論理タイムライン定義 |
| 主キー | `timeline_id` |
| 一意制約 | `(local_account_id, channel_kind_id, server_id, hashtag_id, conversation_id, name)` |
| 外部キー | `local_account_id -> local_accounts.local_account_id`, `channel_kind_id -> channel_kinds.channel_kind_id`, `server_id -> servers.server_id`, `hashtag_id -> hashtags.hashtag_id`, `conversation_id -> conversations.conversation_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| timeline_id | INTEGER | NOT NULL | PK | タイムラインID |
| local_account_id | INTEGER | NOT NULL | FK | 所有アカウント |
| channel_kind_id | INTEGER | NOT NULL | FK | タイムライン種別 |
| server_id | INTEGER | NULL | FK | 対象サーバー |
| hashtag_id | INTEGER | NULL | FK | 対象タグ |
| conversation_id | INTEGER | NULL | FK | 対象会話 |
| name | TEXT | NOT NULL |  | 識別名または表示名 |
| created_at | TEXT | NOT NULL |  | 作成日時 |
| updated_at | TEXT | NOT NULL |  | 更新日時 |

### 6.4.2 `timeline_items`

| 項目 | 内容 |
|---|---|
| 役割 | タイムラインへの帰属情報 |
| 主キー | `timeline_item_id` |
| 一意制約 | `(timeline_id, timeline_item_kind_id, post_id, notification_id, sort_key)` |
| 外部キー | `timeline_id -> timelines.timeline_id`, `timeline_item_kind_id -> timeline_item_kinds.timeline_item_kind_id`, `post_id -> posts.post_id`, `notification_id -> notifications.notification_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| timeline_item_id | INTEGER | NOT NULL | PK | タイムライン要素ID |
| timeline_id | INTEGER | NOT NULL | FK | 対象タイムライン |
| timeline_item_kind_id | INTEGER | NOT NULL | FK | 要素種別 |
| post_id | INTEGER | NULL | FK | 投稿要素時の投稿ID |
| notification_id | INTEGER | NULL | FK | 通知要素時の通知ID |
| sort_key | TEXT | NOT NULL |  | 並び順キー |
| inserted_at | TEXT | NOT NULL |  | タイムラインへ投入した日時 |

### 6.4.3 `feed_events`

| 項目 | 内容 |
|---|---|
| 役割 | 投稿・通知・補助イベントの時系列統合表示用イベント |
| 主キー | `feed_event_id` |
| 外部キー | `local_account_id -> local_accounts.local_account_id`, `post_id -> posts.post_id`, `notification_id -> notifications.notification_id`, `actor_profile_id -> profiles.profile_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| feed_event_id | INTEGER | NOT NULL | PK | フィードイベントID |
| local_account_id | INTEGER | NOT NULL | FK | 表示対象アカウント |
| event_type | TEXT | NOT NULL |  | `post`, `notification`, `actor_post_after_notification` など |
| post_id | INTEGER | NULL | FK | 関連投稿 |
| notification_id | INTEGER | NULL | FK | 関連通知 |
| actor_profile_id | INTEGER | NULL | FK | 関連主体プロフィール |
| occurred_at | TEXT | NOT NULL |  | 発生日時 |
| sort_key | TEXT | NOT NULL |  | 並び順キー |

---

## 6.5 ログインアカウントごとの状態

### 6.5.1 `post_engagements`

| 項目 | 内容 |
|---|---|
| 役割 | お気に入り・ブースト・ブックマーク・絵文字リアクションの統一管理 |
| 主キー | `post_engagement_id` |
| 一意制約 | `reaction` 以外は `(local_account_id, post_id, engagement_type_id)`、`reaction` は `(local_account_id, post_id, engagement_type_id, emoji_id)` 相当 |
| 外部キー | `local_account_id -> local_accounts.local_account_id`, `post_id -> posts.post_id`, `engagement_type_id -> engagement_types.engagement_type_id`, `emoji_id -> custom_emojis.emoji_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| post_engagement_id | INTEGER | NOT NULL | PK | 投稿アクションID |
| local_account_id | INTEGER | NOT NULL | FK | 操作主体アカウント |
| post_id | INTEGER | NOT NULL | FK | 対象投稿 |
| engagement_type_id | INTEGER | NOT NULL | FK | アクション種別 |
| emoji_id | INTEGER | NULL | FK | リアクション時の絵文字ID |
| created_at | TEXT | NOT NULL |  | 操作日時 |

> 実装上は SQLite の nullable 複合PK運用を避けるため、代理キー方式を採用する。

### 6.5.2 `notifications`

| 項目 | 内容 |
|---|---|
| 役割 | 通知本体 |
| 主キー | `notification_id` |
| 一意制約 | `(local_account_id, remote_notification_id)` |
| 外部キー | `local_account_id -> local_accounts.local_account_id`, `server_id -> servers.server_id`, `notification_type_id -> notification_types.notification_type_id`, `actor_profile_id -> profiles.profile_id`, `post_id -> posts.post_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| notification_id | INTEGER | NOT NULL | PK | 通知ID |
| local_account_id | INTEGER | NOT NULL | FK | 受信アカウント |
| server_id | INTEGER | NOT NULL | FK | 通知取得元サーバー |
| remote_notification_id | TEXT | NOT NULL |  | サーバー依存通知ID |
| notification_type_id | INTEGER | NOT NULL | FK | 通知種別 |
| actor_profile_id | INTEGER | NULL | FK | 通知発生主体プロフィール |
| post_id | INTEGER | NULL | FK | 関連投稿 |
| created_at | TEXT | NOT NULL |  | 通知発生日時 |
| is_read | INTEGER | NOT NULL |  | 既読フラグ |

### 6.5.3 `conversations`

| 項目 | 内容 |
|---|---|
| 役割 | DM 会話スレッド |
| 主キー | `conversation_id` |
| 一意制約 | `(local_account_id, remote_conversation_id)` |
| 外部キー | `local_account_id -> local_accounts.local_account_id`, `server_id -> servers.server_id`, `last_post_id -> posts.post_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| conversation_id | INTEGER | NOT NULL | PK | 会話ID |
| local_account_id | INTEGER | NOT NULL | FK | 所有アカウント |
| server_id | INTEGER | NOT NULL | FK | 所属サーバー |
| remote_conversation_id | TEXT | NOT NULL |  | サーバー依存会話ID |
| last_post_id | INTEGER | NULL | FK | 最新投稿 |
| unread_count | INTEGER | NOT NULL |  | 未読件数 |
| updated_at | TEXT | NOT NULL |  | 最終更新日時 |

### 6.5.4 `conversation_members`

| 項目 | 内容 |
|---|---|
| 役割 | DM 参加者 |
| 主キー | `(conversation_id, profile_id)` |
| 外部キー | `conversation_id -> conversations.conversation_id`, `profile_id -> profiles.profile_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| conversation_id | INTEGER | NOT NULL | PK, FK | 会話ID |
| profile_id | INTEGER | NOT NULL | PK, FK | 参加プロフィール |

### 6.5.5 `conversation_posts`

| 項目 | 内容 |
|---|---|
| 役割 | 会話を構成する投稿 |
| 主キー | `(conversation_id, post_id)` |
| 外部キー | `conversation_id -> conversations.conversation_id`, `post_id -> posts.post_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| conversation_id | INTEGER | NOT NULL | PK, FK | 会話ID |
| post_id | INTEGER | NOT NULL | PK, FK | 投稿ID |

### 6.5.6 `tag_history`

| 項目 | 内容 |
|---|---|
| 役割 | アカウント単位のタグ履歴 |
| 主キー | `(local_account_id, hashtag_id)` |
| 外部キー | `local_account_id -> local_accounts.local_account_id`, `hashtag_id -> hashtags.hashtag_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| local_account_id | INTEGER | NOT NULL | PK, FK | ローカルアカウントID |
| hashtag_id | INTEGER | NOT NULL | PK, FK | ハッシュタグID |
| last_used_at | TEXT | NOT NULL |  | 最終利用日時 |
| use_count | INTEGER | NOT NULL |  | 利用回数 |

---

## 6.6 取り込み・同期管理

### 6.6.1 `ingest_channels`

| 項目 | 内容 |
|---|---|
| 役割 | ストリーミングおよび REST 取り込みの論理チャネル |
| 主キー | `channel_id` |
| 一意制約 | `(server_id, local_account_id, channel_kind_id, hashtag_id, conversation_id)` |
| 外部キー | `server_id -> servers.server_id`, `local_account_id -> local_accounts.local_account_id`, `channel_kind_id -> channel_kinds.channel_kind_id`, `hashtag_id -> hashtags.hashtag_id`, `conversation_id -> conversations.conversation_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| channel_id | INTEGER | NOT NULL | PK | チャネルID |
| server_id | INTEGER | NOT NULL | FK | 対象サーバー |
| local_account_id | INTEGER | NULL | FK | 対象アカウント |
| channel_kind_id | INTEGER | NOT NULL | FK | チャネル種別 |
| hashtag_id | INTEGER | NULL | FK | タグチャネル時のタグ |
| conversation_id | INTEGER | NULL | FK | 会話チャネル時の会話 |

### 6.6.2 `ingest_checkpoints`

| 項目 | 内容 |
|---|---|
| 役割 | 差分取得位置の保持 |
| 主キー | `channel_id` |
| 外部キー | `channel_id -> ingest_channels.channel_id` |

| 列名 | 型 | NULL | 制約 | 説明 |
|---|---|---|---|---|
| channel_id | INTEGER | NOT NULL | PK, FK | チャネルID |
| newest_remote_id | TEXT | NULL |  | 最新側の取得位置 |
| oldest_remote_id | TEXT | NULL |  | 過去側の取得位置 |
| last_event_at | TEXT | NULL |  | 最終イベント受信日時 |
| last_backfill_at | TEXT | NULL |  | 最終バックフィル日時 |

---

## 7. リレーション要約

### 7.1 1対多

- `software_types` 1 : N `servers`
- `servers` 1 : N `profiles`
- `profiles` 1 : N `profile_fields`
- `profiles` 1 : N `posts`
- `posts` 1 : N `post_media`
- `posts` 1 : 1 `polls`
- `posts` 1 : 1 `post_stats`
- `polls` 1 : N `poll_options`
- `local_accounts` 1 : N `notifications`
- `local_accounts` 1 : N `conversations`
- `local_accounts` 1 : N `timelines`
- `timelines` 1 : N `timeline_items`

### 7.2 多対多

- `posts` N : N `hashtags` → `post_hashtags`
- `posts` N : N `profiles` → `post_mentions`
- `conversations` N : N `profiles` → `conversation_members`
- `conversations` N : N `posts` → `conversation_posts`
- `local_accounts` N : N `hashtags` → `tag_history`
- `local_accounts` N : N `profiles` → `follows`

### 7.3 同一実体統合

- `profiles` とサーバー依存 account ID の統合 → `profile_aliases`
- `posts` とサーバー依存 status ID の統合 → `post_aliases`

### 7.4 帰属と表示

- `timelines` と `posts` / `notifications` の帰属 → `timeline_items`
- 統合表示イベント → `feed_events`

---

## 8. 制約設計

### 8.1 一意制約

以下は特に重要な一意制約である。

- `servers.host`
- `profiles.actor_uri`
- `posts.object_uri`
- `software_types.code`
- `visibility_types.code`
- `notification_types.code`
- `media_types.code`
- `engagement_types.code`
- `channel_kinds.code`
- `timeline_item_kinds.code`
- `profile_aliases(server_id, remote_account_id)`
- `post_aliases(server_id, remote_status_id)`
- `profile_fields(profile_id, sort_order)`
- `local_accounts(server_id, profile_id)`
- `follows(local_account_id, target_profile_id)`
- `post_media(post_id, sort_order)`
- `polls.post_id`
- `poll_options(poll_id, option_index)`
- `notifications(local_account_id, remote_notification_id)`
- `conversations(local_account_id, remote_conversation_id)`
- `timeline_items(timeline_id, timeline_item_kind_id, post_id, notification_id, sort_key)`

### 8.2 想定 CHECK 制約

SQLite では厳密型制約が弱いため、必要に応じて以下を CHECK 制約で補う。

- 真偽値列は `0` または `1`
- `sort_order >= 0`
- `option_index >= 0`
- `votes_count >= 0`
- `voters_count >= 0`
- `unread_count >= 0`
- `use_count >= 0`
- `replies_count >= 0`
- `reblogs_count >= 0`
- `favourites_count >= 0`
- `reactions_count >= 0`
- `quotes_count >= 0`
- `width > 0`、`height > 0` は値がある場合のみ
- `duration_ms >= 0`

---

## 9. インデックス設計

一覧表示・絞り込み・差分取得・時系列結合を考慮し、以下のインデックスを推奨する。

### 9.1 投稿系

- `posts(created_at DESC)`
- `posts(author_profile_id, created_at DESC)`
- `posts(origin_server_id, created_at DESC)`
- `posts(visibility_id, created_at DESC)`
- `posts(language_code, created_at DESC)`
- `posts(reply_to_post_id, created_at DESC)`
- `posts(repost_of_post_id, created_at DESC)`
- `post_hashtags(hashtag_id, post_id)`
- `post_mentions(mentioned_profile_id, post_id)`
- `post_media(post_id)`
- `post_aliases(post_id)`
- `post_aliases(server_id, remote_status_id)`
- `post_stats(favourites_count, post_id)`
- `post_stats(reblogs_count, post_id)`

### 9.2 タイムライン・イベント系

- `timelines(local_account_id, channel_kind_id)`
- `timeline_items(timeline_id, sort_key DESC)`
- `timeline_items(post_id)`
- `timeline_items(notification_id)`
- `feed_events(local_account_id, sort_key DESC)`
- `feed_events(notification_id)`
- `feed_events(post_id)`
- `feed_events(actor_profile_id, occurred_at DESC)`

### 9.3 通知・状態系

- `notifications(local_account_id, created_at DESC)`
- `notifications(local_account_id, notification_type_id, created_at DESC)`
- `notifications(actor_profile_id, created_at DESC)`
- `post_engagements(local_account_id, engagement_type_id, created_at DESC)`
- `conversations(local_account_id, updated_at DESC)`
- `tag_history(local_account_id, last_used_at DESC)`

### 9.4 フォロー・所属系

- `profiles(home_server_id, profile_id)`
- `follows(local_account_id, target_profile_id)`
- `follows(target_profile_id, local_account_id)`

### 9.5 取り込み系

- `ingest_channels(server_id, channel_kind_id)`
- `ingest_channels(local_account_id, channel_kind_id)`
- `ingest_checkpoints(last_event_at)`

---

## 10. この設計で表現しやすいクエリ

### 10.1 特定ユーザーの投稿

- `posts.author_profile_id`
- `profiles.profile_id`

### 10.2 添付メディアが存在する投稿

- `EXISTS` + `post_media`

### 10.3 メディアが2つ以上ある投稿

- `post_media` を `GROUP BY post_id`
- `COUNT(*) >= 2`

### 10.4 ブースト投稿

- `posts.repost_of_post_id IS NOT NULL`

### 10.5 ブースト除外

- `posts.repost_of_post_id IS NULL`

### 10.6 CW付き投稿

- `posts.spoiler_text IS NOT NULL`
- 必要なら空文字除外

### 10.7 リプライ除外

- `posts.reply_to_post_id IS NULL`

### 10.8 日本語投稿

- `posts.language_code = 'ja'`
- 実装次第で `ja-%` も扱う

### 10.9 公開投稿のみ

- `visibility_types.code = 'public'`

### 10.10 未収載を含む公開投稿

- `visibility_types.code IN ('public', 'unlisted')`

### 10.11 ふぁぼ数が10以上の投稿

- `post_stats.favourites_count >= 10`

### 10.12 特定ユーザーへのメンションを含む投稿

- `post_mentions.mentioned_profile_id = ?`

### 10.13 ホームタイムライン

- `timelines.channel_kind_id = home`
- `timeline_items` 経由で取得
- もしくは `follows` と `posts` から再構成

### 10.14 指定タグの投稿

- `hashtags.normalized_name = ?`
- `post_hashtags` で絞り込み

### 10.15 ローカルタイムラインで特定タグの投稿

- `profiles.home_server_id = 対象サーバー`
- `post_hashtags`
- `timelines` / `timeline_items` でローカルTL集合に限定

### 10.16 フォロー通知のみ

- `notification_types.code = 'follow'`

### 10.17 メンション通知のみ

- `notification_types.code = 'mention'`

### 10.18 お気に入りとブースト通知

- `notification_types.code IN ('favourite', 'reblog')`

### 10.19 特定ユーザーからの通知

- `notifications.actor_profile_id = ?`

### 10.20 ホームTLとお気に入り・ブースト通知の混合表示

- `feed_events`
- または `timeline_items` に投稿と通知を混載

### 10.21 通知元ユーザーの直後の1投稿（3分以内）

- `notifications.actor_profile_id`
- `posts.author_profile_id`
- `posts.created_at` と `notifications.created_at` の時刻条件
- 必要なら結果を `feed_events` に格納

### 10.22 特定ユーザーがリブログした投稿

- `posts.author_profile_id = ?`
- `posts.repost_of_post_id IS NOT NULL`

---

## 11. 代表的な利用パターン

### 11.1 複数サーバーの同一投稿統合

1. 受信した `remote_status_id` と `server_id` から `post_aliases` を引く
2. 既存があれば対応する `post_id` を得る
3. なければ `object_uri` から `posts` を検索する
4. 見つかれば alias のみ追加する
5. 見つからなければ `posts` を新規作成して alias を追加する

### 11.2 タグタイムラインの取得

- `hashtags.normalized_name` から `hashtag_id` を解決
- `post_hashtags` で投稿集合を抽出
- `posts` と結合して `created_at DESC` で取得
- 必要なら `timelines` / `timeline_items` で事前構築した結果集合を使う

### 11.3 メディア付き投稿絞り込み

- `post_media` の `EXISTS` で判定する
- `posts` に `has_media` のような導出列は原則持たせない

### 11.4 アカウントごとのブックマーク取得

- `post_engagements`
- `engagement_types`
- `posts`
を結合し、`engagement_types.code = 'bookmark'` で抽出する

### 11.5 DM 一覧取得

- `conversations` を起点に `conversation_members` と `profiles` を参照
- 最新投稿は `last_post_id` から `posts` を引く
- 未読件数は `conversations.unread_count` を利用する

### 11.6 ホームTL再構成

- `follows` から対象プロフィール集合を取得
- `posts.author_profile_id` で結合
- visibility 条件やブースト除外条件を加える
- 運用上必要なら `timeline_items` に投入して一覧取得を高速化する

### 11.7 通知 + 投稿の時系列統合

- `notifications` と `posts` を都度 `UNION ALL` してもよい
- 表示頻度が高い場合は `feed_events` に格納して安定的に取得する

---

## 12. 非正規化を見送る項目

以下は導出可能なため、初期設計では保持しない。

- 投稿のメディア有無
- 投稿のタグ数
- 投稿のメンション数
- 会話参加者名の連結文字列
- プロフィールの完全修飾アカウント文字列の表示専用加工結果

ただし、以下は**導出可能ではあるがコストが高く、複雑クエリで多用されるため補助表として保持する**。

- 投稿統計値 → `post_stats`
- タイムライン帰属 → `timeline_items`
- 混合表示イベント → `feed_events`

---

## 13. 実装上の注意点

### 13.1 SQLite での日時表現

- `TEXT` の ISO 8601 形式で統一する
- 例: `2025-01-01T12:34:56.000Z`

### 13.2 真偽値表現

- SQLite では `INTEGER` として `0` / `1` を使う

### 13.3 外部キー

- SQLite では外部キー制約を有効化して利用する前提
- 開発時・テスト時ともに外部キー無効状態での利用を避ける

### 13.4 `post_engagements` のキー設計

本設計書では SQLite 実装上の安全性を優先し、代理キー `post_engagement_id` を採用する。
`reaction` とそれ以外で一意条件が変わるため、実装時はアプリケーション制御または追加 UNIQUE 制約で補完する。

### 13.5 `timeline_items` の nullable 列

`post_id` と `notification_id` はどちらか一方のみ入る運用を前提とする。
必要なら CHECK 制約で「少なくとも一方は非NULL」を課す。

### 13.6 `feed_events` の役割

`feed_events` は業務事実そのものではなく、**表示統合のための補助イベント** である。
真の業務データは `posts` と `notifications` に保持し、`feed_events` は再構築可能な構造として扱う。

---

## 14. 将来拡張

以下の追加に耐えるよう設計している。

- 新しい Fediverse 実装の追加
- quote 投稿表現の拡張
- 通知種別の増加
- 反応種別ごとの統計保持
- 集計専用キャッシュテーブルの追加
- UI 設定の SQLite 移行
- 高度な検索用の全文検索補助構造追加
- ユーザー定義 SQL フィルタの保存
- タイムラインごとの絞り込みプリセット保存

将来 SQLite 側に UI 関連設定を寄せる場合は、以下のような別系統スキーマを追加する。

- `ui_preferences`
- `timeline_definitions`
- `tab_groups`
- `saved_filters`

---

## 15. 本設計で満たす要件

- 複数サーバー統合表示
- タイムライン表示
- 投稿・通知・プロフィールの蓄積
- タグ・メディア・通知種別によるフィルタリング
- ブックマーク・リアクション・ブーストのアカウント単位管理
- DM 会話管理
- タグ履歴保持
- OGP カード保持
- 取り込み再開位置の保持
- ホームタイムラインの再構成
- ローカルタイムライン判定
- 投稿統計値による絞り込み
- 投稿と通知の混合表示
- 複雑なSQLクエリへの対応

---

## 16. テーブル総覧

| 区分 | テーブル名 | 役割 |
|---|---|---|
| 共通マスター | `software_types` | サーバーソフト種別 |
| 共通マスター | `visibility_types` | 公開範囲 |
| 共通マスター | `notification_types` | 通知種別 |
| 共通マスター | `media_types` | メディア種別 |
| 共通マスター | `engagement_types` | アクション種別 |
| 共通マスター | `channel_kinds` | 取り込みチャネル種別 |
| 共通マスター | `timeline_item_kinds` | タイムライン要素種別 |
| サーバー・アカウント | `servers` | サーバーマスター |
| サーバー・アカウント | `profiles` | canonical プロフィール |
| サーバー・アカウント | `profile_aliases` | サーバー依存 account ID 対応 |
| サーバー・アカウント | `profile_fields` | プロフィール拡張項目 |
| サーバー・アカウント | `local_accounts` | ログイン済みアカウント参照 |
| サーバー・アカウント | `follows` | フォロー関係 |
| 投稿系 | `posts` | canonical 投稿 |
| 投稿系 | `post_aliases` | サーバー依存 status ID 対応 |
| 投稿系 | `post_media` | 添付メディア |
| 投稿系 | `hashtags` | ハッシュタグ辞書 |
| 投稿系 | `post_hashtags` | 投稿とタグの対応 |
| 投稿系 | `post_mentions` | 投稿内メンション |
| 投稿系 | `custom_emojis` | カスタム絵文字 |
| 投稿系 | `post_custom_emojis` | 投稿における絵文字使用 |
| 投稿系 | `polls` | 投票本体 |
| 投稿系 | `poll_options` | 投票選択肢 |
| 投稿系 | `link_cards` | OGP カード |
| 投稿系 | `post_links` | 投稿内URLとカード対応 |
| 投稿系 | `post_stats` | 投稿統計 |
| タイムライン・フィード系 | `timelines` | 論理タイムライン定義 |
| タイムライン・フィード系 | `timeline_items` | タイムライン帰属 |
| タイムライン・フィード系 | `feed_events` | 混合表示イベント |
| 状態系 | `post_engagements` | アカウントごとの投稿アクション |
| 状態系 | `notifications` | 通知 |
| 状態系 | `conversations` | DM 会話 |
| 状態系 | `conversation_members` | DM 参加者 |
| 状態系 | `conversation_posts` | 会話投稿対応 |
| 状態系 | `tag_history` | タグ履歴 |
| 同期系 | `ingest_channels` | 取り込みチャネル |
| 同期系 | `ingest_checkpoints` | 取り込み位置 |

---

## 17. 補足

- 初期リリースでは正規化優先とする
- 性能ボトルネックが実測で確認された場合のみ補助構造を追加する
- 認証トークンや UI 設定は本書の DB 対象外とする
- 本書は論理設計書であり、物理 DDL は別途作成する
- 複雑なクエリを重視するため、`post_stats`、`timeline_items`、`feed_events` は本書では正式な設計要素として扱う
