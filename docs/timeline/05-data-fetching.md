# 05. データ取得 (Fetcher)

## 概要

miyulab-fe のタイムラインデータ取得は、REST API を通じた初期データ取得と追加読み込み（ページネーション）の 2 段階で構成されます。取得したデータは SQLite に蓄積され、React Hooks が `subscribe()` で変更を検知して UI を更新します。

ストリーミング（WebSocket）によるリアルタイム受信とは別に、REST API による取得が必要な場面は以下の通りです。

| 場面 | 説明 |
|---|---|
| アプリ起動時 | ストリーム接続前の初期データ確保 |
| タイムライン設定変更時 | 新しいタイムラインの初期データ取得 |
| スクロール末尾到達時 | 過去の投稿の追加読み込み |
| ストリーム欠損補完時 | ストリーム接続の隙間に投稿された投稿の補完 |

## 関連ファイル

| ファイル | 説明 |
|---|---|
| `src/util/timelineFetcher.ts` | `fetchInitialData` / `fetchMoreData` |
| `src/util/provider/StreamingManagerProvider.tsx` | `fetchInitialDataForTimelines` |
| `src/app/_components/UnifiedTimeline.tsx` | `moreLoad`（スクロール末尾の追加読み込み） |
| `src/util/db/sqlite/statusStore.ts` | `bulkUpsertStatuses` / `upsertStatus` |

## 初期データ取得 (fetchInitialData)

### 概要

`fetchInitialData()` はタイムライン種別に応じた REST API を呼び出し、取得した投稿を `bulkUpsertStatuses()` で SQLite に一括書き込みします。

```typescript
async function fetchInitialData(
  client: MegalodonInterface,
  config: TimelineConfigV2,
  backendUrl: string,
): Promise<void>
```

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `client` | `MegalodonInterface` | megalodon クライアントインスタンス |
| `config` | `TimelineConfigV2` | タイムライン設定 |
| `backendUrl` | `string` | 対象バックエンドの URL |

### 種別ごとの動作

| タイムライン種別 | API | `only_media` パラメータ | 備考 |
|---|---|---|---|
| `home` | - | - | **対象外**: `StatusStoreProvider` が `userStreaming()` + `getHomeTimeline()` で管理 |
| `local` | `client.getLocalTimeline()` | ✅ 対応 | API 側でメディアフィルタ可能 |
| `public` | `client.getPublicTimeline()` | ✅ 対応 | API 側でメディアフィルタ可能 |
| `tag` | `client.getTagTimeline(tag)` | ❌ 非対応 | メディアフィルタは表示層（SQL）で実施 |

### 取得件数

すべての種別で `limit: 40` を使用します。

### API パラメータと表示層フィルタの使い分け

Mastodon API の `only_media` パラメータは `getLocalTimeline` と `getPublicTimeline` でのみサポートされています。`getTagTimeline` ではサポートされないため、全件取得して SQLite の正規化カラム（`has_media`, `media_count`）でフィルタします。

```
┌──────────────────────────────────────────────────────────┐
│                    フィルタの適用箇所                      │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  API レベル (only_media)                                  │
│  └── local / public: API パラメータで事前フィルタ          │
│      → 取得データ量を削減（帯域節約）                      │
│                                                          │
│  SQL レベル (WHERE 句)                                    │
│  └── 全種別: 正規化カラムで精密フィルタ                    │
│      → LIMIT の精度が高い                                 │
│      → visibility, language, excludeReblogs 等も対応      │
│                                                          │
│  ※ JS レベルのフィルタは不要                               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Home タイムラインが対象外である理由

Home タイムラインの初期データ取得は `StatusStoreProvider` が全アカウントに対して `userStreaming()` + `getHomeTimeline()` を実行することで既に担当しています。`fetchInitialData()` では `home` を扱いません。

呼び出し側（`StreamingManagerProvider.fetchInitialDataForTimelines`）でも `config.type === 'home'` の場合はスキップするようガードされています。

```typescript
// StreamingManagerProvider.tsx
for (const config of timelineSettings.timelines) {
  // home は StatusStoreProvider が担当、notification は対象外
  if (config.type === 'home' || config.type === 'notification') continue
  // ...
}
```

### タグタイムラインの取得

タグタイムラインでは、`tagConfig.tags` の各タグに対して個別に API を呼び出します。

```typescript
case 'tag': {
  const tags = config.tagConfig?.tags ?? []
  for (const tag of tags) {
    const res = await client.getTagTimeline(tag, { limit })
    await bulkUpsertStatuses(res.data, backendUrl, 'tag', tag)
  }
  break
}
```

- 各タグの結果は `bulkUpsertStatuses()` の第 4 引数（`tag`）で `statuses_belonging_tags` テーブルに関連付けられます
- OR / AND の結合は取得時ではなく、表示時（`useFilteredTagTimeline` の SQL クエリ）で行われます

### 呼び出しタイミング

`fetchInitialData()` は `StreamingManagerProvider` の `fetchInitialDataForTimelines()` から呼び出されます。

```
fetchInitialDataForTimelines()
  │
  ├── timelineSettings.timelines をイテレート
  │
  ├── home / notification はスキップ
  │
  └── 各タイムライン設定について:
      ├── normalizeBackendFilter() で BackendFilter を正規化
      ├── resolveBackendUrls() で対象 URL 配列を取得
      │
      └── 各 backendUrl について:
          ├── apps から App オブジェクトを検索
          ├── GetClient(app) で megalodon クライアントを作成
          └── fetchInitialData(client, config, url) を実行
              └── エラー時はコンソール出力（TL 全体の停止は防ぐ）
```

## 追加データ取得 (fetchMoreData)

### 概要

`fetchMoreData()` はスクロール末尾に到達した際に、過去の投稿を追加で取得します。`max_id` パラメータによるカーソルベースのページネーションを使用します。

```typescript
async function fetchMoreData(
  client: MegalodonInterface,
  config: TimelineConfigV2,
  backendUrl: string,
  maxId: string,
): Promise<number>
```

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `client` | `MegalodonInterface` | megalodon クライアントインスタンス |
| `config` | `TimelineConfigV2` | タイムライン設定 |
| `backendUrl` | `string` | 対象バックエンドの URL |
| `maxId` | `string` | この ID より古い投稿を取得 |

### 戻り値

取得した投稿の件数（`number`）を返します。呼び出し側はこの値を使って追加読み込みの終了判定（件数が 0 なら末尾に到達）を行えます。

### 種別ごとの動作

| タイムライン種別 | API | `only_media` | `max_id` |
|---|---|---|---|
| `home` | `client.getHomeTimeline()` | ❌ | ✅ |
| `local` | `client.getLocalTimeline()` | ✅ | ✅ |
| `public` | `client.getPublicTimeline()` | ✅ | ✅ |
| `tag` | `client.getTagTimeline(tag)` | ❌ | ✅（タグごとに個別） |

### タグタイムラインの max_id 処理

タグタイムラインでは、各タグごとに異なるページネーション位置が存在します。同じ `maxId` を全タグに使うと、タグごとにタイムラインが異なるため一部の投稿がスキップされる可能性があります。

```typescript
case 'tag': {
  const tags = config.tagConfig?.tags ?? []
  let total = 0

  for (const tag of tags) {
    // このタグの最古の投稿を SQLite から取得
    const rows = handle.db.exec(
      `SELECT s.json FROM statuses s
       INNER JOIN statuses_belonging_tags sbt ON s.compositeKey = sbt.compositeKey
       WHERE sbt.tag = ? AND s.backendUrl = ?
       ORDER BY s.created_at_ms ASC
       LIMIT 1;`,
      { bind: [tag, backendUrl], returnValue: 'resultRows' },
    )

    let tagMaxId = maxId
    if (rows.length > 0) {
      const oldest = JSON.parse(rows[0][0])
      tagMaxId = oldest.id // タグごとの最古 ID を使用
    }

    const res = await client.getTagTimeline(tag, {
      limit,
      max_id: tagMaxId,
    })
    await bulkUpsertStatuses(res.data, backendUrl, 'tag', tag)
    total += res.data.length
  }
  return total
}
```

## UnifiedTimeline での追加読み込み (moreLoad)

### 概要

`UnifiedTimeline` コンポーネントの `moreLoad` コールバックは、Virtuoso の `endReached` イベントで発火し、マルチバックエンド対応の追加読み込みを実行します。

### 処理フロー

```
Virtuoso: endReached イベント
  │
  ▼
moreLoad() コールバック
  │
  ├── apps が空 or timeline が空 → 早期リターン
  │
  ├── resolveBackendUrls() で対象バックエンドを特定
  │
  └── Promise.all() で各バックエンドを並列処理:
      │
      ├── 1. 表示中のタイムラインから該当バックエンドの最古投稿を検索
      │   └── timeline.filter(s => apps[s.appIndex]?.backendUrl === url).at(-1)
      │
      ├── 2. 表示上に見つからない場合 → SQLite から直接取得
      │   ├── tag TL: statuses_belonging_tags JOIN で検索
      │   └── その他: statuses_timeline_types JOIN で検索
      │
      ├── 3. それでも見つからない場合 → fetchInitialData() で初期データ取得
      │
      └── 4. 最古投稿が見つかった場合 → fetchMoreData() で追加取得
          └── 取得件数を返す

totalFetched = 全バックエンドの取得件数合計
setMoreCount(prev => prev + totalFetched)
```

### なぜ表示データから最古投稿を探すのか

フィルタリングにより、SQLite に存在するが表示されていない投稿があり得ます。表示中のデータから最古投稿を探すことで、ユーザーが実際に見ている位置の続きを正確に取得できます。

### SQLite フォールバック

表示中のタイムラインに該当バックエンドの投稿が 1 件もない場合（例: 厳しいフィルタ設定により全投稿がフィルタアウトされた場合）、SQLite から直接最古の投稿を検索します。

```sql
-- 通常のタイムラインの場合
SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
FROM statuses s
INNER JOIN statuses_timeline_types stt ON s.compositeKey = stt.compositeKey
WHERE s.backendUrl = ? AND stt.timelineType = ?
ORDER BY s.created_at_ms ASC
LIMIT 1;

-- タグタイムラインの場合
SELECT s.compositeKey, s.backendUrl, s.created_at_ms, s.storedAt, s.json
FROM statuses s
INNER JOIN statuses_belonging_tags sbt ON s.compositeKey = sbt.compositeKey
WHERE sbt.tag = ? AND s.backendUrl = ?
ORDER BY s.created_at_ms ASC
LIMIT 1;
```

### マルチバックエンドでの並列取得

複数のバックエンドが対象の場合、`Promise.all()` で並列に追加データを取得します。各バックエンドの最古投稿 ID は独立しており、バックエンドごとに異なるページネーション位置を持ちます。

```
例: バックエンド A の最古投稿 ID = "100"
    バックエンド B の最古投稿 ID = "200"

→ Promise.all([
    fetchMoreData(clientA, config, urlA, "100"),
    fetchMoreData(clientB, config, urlB, "200"),
  ])
```

### moreCount の管理

`moreCount` は追加読み込みした投稿の累積数を追跡し、Virtuoso の `firstItemIndex` の算出に使用されます。

```typescript
const internalIndex = useMemo(() => {
  return CENTER_INDEX - timeline.length + moreCount
}, [timeline.length, moreCount])
```

これにより、追加読み込みによってリストの先頭インデックスが変動しても、現在のスクロール位置が維持されます。

## bulkUpsertStatuses

### 概要

REST API で取得した投稿を SQLite に一括書き込みする関数です。`fetchInitialData` と `fetchMoreData` の両方から使用されます。

```typescript
async function bulkUpsertStatuses(
  statuses: Entity.Status[],
  backendUrl: string,
  timelineType: 'home' | 'local' | 'public' | 'tag',
  tag?: string,
): Promise<void>
```

### 引数

| 引数 | 型 | 説明 |
|---|---|---|
| `statuses` | `Entity.Status[]` | 書き込む投稿の配列 |
| `backendUrl` | `string` | 取得元バックエンドの URL |
| `timelineType` | `string` | タイムライン種別 |
| `tag` | `string?` | タグ名（`timelineType === 'tag'` の場合） |

### 処理内容

各投稿に対して以下を実行します。

```
各投稿について:
  │
  ├── uri から既存 compositeKey を解決（URI ベース重複排除）
  │   ├── 既存あり → UPDATE（正規化カラム + json + storedAt）
  │   └── 既存なし → INSERT
  │
  ├── statuses_timeline_types に timelineType を INSERT OR IGNORE
  ├── statuses_backends に backendUrl + local_id を INSERT OR IGNORE
  ├── tag が指定されている場合 → statuses_belonging_tags に INSERT OR IGNORE
  ├── statuses_mentions にメンション情報を INSERT OR IGNORE
  │
  └── URI キャッシュを更新（同一バッチ内の重複排除）

全投稿の処理後:
  └── notify('statuses') で変更を一括通知
```

### URI キャッシュ

同一バッチ内で同じ URI を持つ投稿が複数含まれる場合、`resolveCompositeKey()` の呼び出しを最小限に抑えるためにメモリ内キャッシュを使用します。

```typescript
const uriCache = new Map<string, string>() // uri → compositeKey

// キャッシュから検索
const cachedKey = uriCache.get(uri)
if (cachedKey) {
  compositeKey = cachedKey
} else {
  // SQLite から検索
  compositeKey = resolveCompositeKey(db, uri) ?? createCompositeKey(backendUrl, status.id)
  uriCache.set(uri, compositeKey)
}
```

## エラーハンドリング

### 初期データ取得のエラー

`fetchInitialDataForTimelines()` では、個々のタイムラインの取得エラーが他のタイムラインに影響しないよう、`.catch()` でエラーをキャッチしてコンソール出力に留めます。

```typescript
fetchInitialData(client, config, url).catch((error) => {
  console.error(
    `Failed to fetch initial data for ${config.type} (${url}):`,
    error,
  )
})
```

### 追加読み込みのエラー

`moreLoad()` でも同様に、各バックエンドの取得エラーを `try/catch` で個別にキャッチし、エラーが発生したバックエンドの取得件数を 0 として扱います。

```typescript
try {
  return await fetchMoreData(client, config, url, oldestStatus.id)
} catch (error) {
  console.error(`Failed to fetch more data for ${url}:`, error)
  return 0
}
```

### エラー時の挙動

- 取得に失敗したバックエンドのデータは更新されない
- 他のバックエンドの取得は影響を受けない
- ユーザーは再度スクロール末尾に到達することでリトライ可能
- アプリ全体のクラッシュは発生しない

## データフロー図（全体）

```
┌─────────────────────────────────────────────────────────────────┐
│                       トリガー                                   │
│                                                                 │
│  アプリ起動 ──┐                                                  │
│  設定変更 ───┤ StreamingManagerProvider                          │
│              └─→ fetchInitialDataForTimelines()                 │
│                    │                                            │
│                    └─→ fetchInitialData(client, config, url)    │
│                         │                                       │
│                         ├── getLocalTimeline({limit, only_media})│
│                         ├── getPublicTimeline({limit, only_media})│
│                         └── getTagTimeline(tag, {limit})        │
│                              │                                  │
│                              ▼                                  │
│                         bulkUpsertStatuses()                    │
│                              │                                  │
│                              ▼                                  │
│                         SQLite (statuses)                       │
│                              │                                  │
│                              ▼                                  │
│                         notify('statuses')                      │
│                              │                                  │
│                              ▼                                  │
│                         React Hooks → UI 更新                   │
│                                                                 │
│  スクロール末尾 ──→ UnifiedTimeline.moreLoad()                   │
│                      │                                          │
│                      ├── 最古投稿 ID を算出                      │
│                      │   ├── 表示中データから検索                 │
│                      │   ├── SQLite から検索                     │
│                      │   └── 初期データ取得にフォールバック       │
│                      │                                          │
│                      └── fetchMoreData(client, config, url, maxId)│
│                           │                                     │
│                           ├── getHomeTimeline({limit, max_id})  │
│                           ├── getLocalTimeline({limit, max_id}) │
│                           ├── getPublicTimeline({limit, max_id})│
│                           └── getTagTimeline(tag, {limit, max_id})│
│                                │                                │
│                                ▼                                │
│                           bulkUpsertStatuses()                  │
│                                │                                │
│                                ▼                                │
│                           SQLite → notify → Hooks → UI          │
└─────────────────────────────────────────────────────────────────┘
```

## パフォーマンス考慮事項

### 取得件数 (limit)

現在は全種別で `limit: 40` を使用しています。この値は以下のバランスで決定されています。

- **大きすぎる**: API レスポンスが遅くなる、SQLite への書き込み量が増える
- **小さすぎる**: スクロール時の追加読み込み頻度が増える、ユーザー体験が悪化
- **40**: Mastodon のデフォルト上限に近く、1 回の取得で画面を埋めるのに十分な量

### 並列取得

マルチバックエンドの追加読み込みは `Promise.all()` で並列化されているため、バックエンド数が増えてもレイテンシの増加は最も遅いバックエンドに律速されます（直列の場合は合計値になる）。

### bulkUpsertStatuses の効率

`bulkUpsertStatuses` は個々の投稿ごとに SQL 文を実行しますが、`notify('statuses')` はバッチ全体で 1 回のみ発火します。これにより、40 件の投稿を書き込んでも React Hooks の再実行は 1 回に抑えられます。
