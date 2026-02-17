# 04. ストリーミング管理

## 概要

miyulab-fe のストリーミングシステムは、Fediverse サーバーからの WebSocket Streaming API を通じてリアルタイムに投稿を受信し、SQLite に蓄積します。ストリームのライフサイクルは `StreamingManagerProvider` が `TimelineSettingsV2` の変更に連動して**宣言的に一元管理**します。

## ストリーム種別と担当

| ストリーム種別 | WebSocket API | 管理者 | 対象タイムライン |
|---|---|---|---|
| userStreaming | `client.userStreaming()` | `StatusStoreProvider` | home / notification |
| localStreaming | `client.localStreaming()` | `StreamingManagerProvider` | local |
| publicStreaming | `client.publicStreaming()` | `StreamingManagerProvider` | public |
| tagStreaming | `client.tagStreaming(tag)` | `StreamingManagerProvider` | tag |

### なぜ userStreaming だけ別管理なのか

`userStreaming` は Home タイムラインと通知を 1 つの WebSocket 接続で同時に受信します。アカウントごとに 1 接続で済むため、タイムライン設定の変更に影響されず常時接続しておくのが効率的です。そのため `StatusStoreProvider` がアカウントの登録・削除に連動して管理します。

一方、local / public / tag ストリームはタイムライン設定の追加・削除・変更に応じて動的に接続・切断する必要があるため、`StreamingManagerProvider` が一元管理します。

## 設計思想: 宣言的ストリーム管理

### 従来のイベント駆動型（不採用）

```
コンポーネントマウント → subscribe(streamKey)
コンポーネントアンマウント → unsubscribe(streamKey)
```

この方式では、コンポーネントのマウント順序やアンマウントのタイミングにより参照カウントの不整合が発生しやすく、メモリリークや切断漏れの原因となります。

### 採用した宣言的同期モデル

```
TimelineSettingsV2 が変更される
  ↓
deriveRequiredStreams() が「あるべきストリームの集合」を算出
  ↓
syncStreamsEvent() が現在のレジストリと差分比較
  ├── 不要なストリーム → 切断・レジストリから削除
  └── 未接続のストリーム → レジストリに登録・新規接続
```

この設計のメリット:

- **SSOT**: `TimelineSettingsV2` が唯一の信頼できる情報源
- **冪等性**: `syncStreamsEvent()` を何度呼んでも同じ結果（差分のみ適用）
- **シンプルさ**: コンポーネントからの subscribe/unsubscribe が不要
- **整合性**: 設定変更時のストリーム状態の不整合が原理的に発生しない

## StreamingManagerProvider

### 責務

1. `TimelineSettingsV2` と `apps` の変更を監視
2. `deriveRequiredStreams()` で必要なストリームの集合を算出
3. `syncStreamsEvent()` で現在の接続状態との差分を解消
4. 初期データ取得（`fetchInitialDataForTimelines()`）
5. 接続状態の公開（`getStatus()` via Context）

### Context API

```typescript
type StreamingManagerActions = {
  /**
   * 特定ストリームの接続状態を取得する
   */
  getStatus: (key: string) => StreamEntry['status'] | null
}
```

コンポーネントが必要とするのは接続状態の参照のみであるため、Context には `getStatus` のみを公開しています。ストリームの接続・切断はすべて内部で管理されます。

### ライフサイクル

```
apps / timelineSettings が変更される
  │
  ▼
useEffect 発火
  │
  ├── syncStreamsEvent()
  │   │
  │   ├── deriveRequiredStreams() で必要キーを算出
  │   │
  │   ├── レジストリを走査:
  │   │   └── 必要キーに含まれないエントリ → stream.stop() + clearTimeout + delete
  │   │
  │   └── 必要キーを走査:
  │       └── レジストリに存在しないキー → プレースホルダー登録 + initializeStream()
  │
  └── fetchInitialDataForTimelines()
      └── 各タイムライン設定の対象バックエンドに対して fetchInitialData() を実行

クリーンアップ（アンマウント時）:
  └── 全ストリーム切断 + 全タイマークリア + レジストリクリア
```

### useEffectEvent の活用

`syncStreamsEvent` と `fetchInitialDataForTimelines` は `useEffectEvent` として定義されています。これにより:

- 関数内で最新の `timelineSettings` と `apps` を常に参照できる
- `useEffect` の依存配列に関数自体を含める必要がない
- 不要な再実行が防がれる

```typescript
const syncStreamsEvent = useEffectEvent(() => {
  // 最新の timelineSettings と apps を参照
  const requiredKeys = deriveRequiredStreams(timelineSettings.timelines, apps)
  // ...
})

useEffect(() => {
  if (apps.length <= 0) return
  syncStreamsEvent()
  fetchInitialDataForTimelines()
  return () => { /* cleanup */ }
}, [apps, timelineSettings])
```

## ストリームキー (StreamKey)

### 形式

ストリーム接続の一意識別子として、パイプ区切りのキー文字列を使用します。

```
local|${backendUrl}
public|${backendUrl}
tag|${backendUrl}|${tagName}
```

### セパレータに `|` を使う理由

- URL にはコロン（`:`）が含まれる（`https://...`）
- ハッシュタグ名にもコロンが含まれ得る
- `|` は URL やハッシュタグに出現しないため安全なセパレータ

### 生成と解析

```typescript
// streamKey.ts

export type StreamType = 'local' | 'public' | 'tag'

export function createStreamKey(
  type: StreamType,
  backendUrl: string,
  tag?: string,
): string {
  if (type === 'tag' && tag != null) {
    return [type, backendUrl, tag].join('|')
  }
  return [type, backendUrl].join('|')
}

export function parseStreamKey(key: string): {
  backendUrl: string
  tag?: string
  type: StreamType
} {
  const parts = key.split('|')
  const type = parts[0] as StreamType

  if (type === 'tag') {
    return { backendUrl: parts[1], tag: parts[2], type }
  }
  return { backendUrl: parts[1], type }
}
```

### 例

| タイムライン設定 | 生成されるキー |
|---|---|
| local TL (mastodon.social) | `local\|https://mastodon.social` |
| public TL (mstdn.jp) | `public\|https://mstdn.jp` |
| #cat タグ TL (mastodon.social) | `tag\|https://mastodon.social\|cat` |
| #cat + #dog タグ TL (mastodon.social) | `tag\|https://mastodon.social\|cat`, `tag\|https://mastodon.social\|dog` |

## deriveRequiredStreams

### 算出ルール

`deriveRequiredStreams()` は `TimelineConfigV2[]` と `App[]` から、必要なストリーム接続キーの `Set<string>` を算出します。

```typescript
export function deriveRequiredStreams(
  timelines: TimelineConfigV2[],
  apps: App[],
): Set<string> {
  const keys = new Set<string>()

  for (const config of timelines) {
    // home / notification は userStreaming（StatusStoreProvider）で管理
    if (config.type === 'home' || config.type === 'notification') continue

    const filter = normalizeBackendFilter(config.backendFilter, apps)
    const backendUrls = resolveBackendUrls(filter, apps)

    for (const url of backendUrls) {
      if (config.type === 'tag' && config.tagConfig) {
        for (const tag of config.tagConfig.tags) {
          keys.add(createStreamKey('tag', url, tag))
        }
      } else if (config.type === 'local' || config.type === 'public') {
        keys.add(createStreamKey(config.type, url))
      }
    }
  }

  return keys
}
```

### 算出ルール詳細

| タイムライン種別 | ストリーム | 算出 |
|---|---|---|
| `home` | userStreaming | **対象外**（StatusStoreProvider 管理） |
| `notification` | userStreaming | **対象外**（StatusStoreProvider 管理） |
| `local` | localStreaming | 各対象 backendUrl に 1 キー |
| `public` | publicStreaming | 各対象 backendUrl に 1 キー |
| `tag` | tagStreaming | 各対象 backendUrl × 各タグに 1 キー |

### 非表示タイムラインの扱い

`visible === false` のタイムラインについても、ストリーム接続は維持します。

**理由:** 非表示中にストリームを切断すると、その間の投稿が取得されず、表示に切り替えた際にデータの欠損が発生するためです。

### 重複排除

`Set` の性質により、複数のタイムライン設定が同一のストリームキーを必要とする場合でも、自然に重複が排除されます。

```
例: 2つの local TL（同一バックエンド、異なるフィルタ設定）
  → 生成されるキー: local|https://mastodon.social（1つのみ）
  → WebSocket 接続: 1 本のみ
```

## ストリームレジストリ (StreamRegistry)

### 型定義

```typescript
export type StreamEntry = {
  /** 現在のリトライ回数 */
  retryCount: number
  /** リトライタイマー ID */
  retryTimer: ReturnType<typeof setTimeout> | null
  /** 接続状態 */
  status: 'connected' | 'connecting' | 'disconnected' | 'error'
  /** WebSocket ストリームインスタンス（初期化中はnull） */
  stream: WebSocketInterface | null
}

export type StreamRegistry = Map<string, StreamEntry>
```

### 状態遷移

```
         ┌──────────────────────────────────────┐
         │                                      │
         ▼                                      │
    connecting ──── connect イベント ──→ connected
         │                                      │
         │                                      │
    error イベント                          error イベント
         │                                      │
         ▼                                      ▼
       error ←──── error イベント ─────── error
         │
         │  リトライタイマー発火
         ▼
    connecting (再接続)
         │
         │  MAX_RETRY_COUNT 超過
         ▼
       error (最終状態 - 手動リロード促す)
```

### 参照カウントが不要な理由

> 注: 参照カウント（refCount）は不要。
> syncStreamsEvent が deriveRequiredStreams の結果に基づいて
> ストリームのライフサイクルを一元管理するため、
> 同一キーの重複は Set の性質により自然に排除される。

## ストリームの初期化

### initializeStream

```
initializeStream(key, type, backendUrl, app, options?)
  │
  ├── GetClient(app) で megalodon クライアントを取得
  │
  ├── type に応じて WebSocket ストリームを作成:
  │   ├── 'local'  → client.localStreaming()
  │   ├── 'public' → client.publicStreaming()
  │   └── 'tag'    → client.tagStreaming(tag)
  │
  ├── レジストリにまだ必要か確認（非同期処理中に syncStreamsEvent が発火した可能性）
  │   └── 不要 → stream.stop() して終了
  │
  ├── レジストリを更新（stream インスタンスを登録）
  │
  └── setupStreamHandlers() でイベントハンドラを登録
```

### 重複接続防止

`initializeStream()` は非同期処理のため、呼び出しから完了までの間に `syncStreamsEvent()` が再発火する可能性があります。これに対する防御:

1. **プレースホルダーエントリ**: `initializeStream()` 呼び出し前にレジストリにプレースホルダーを登録
2. **存在チェック**: WebSocket 作成後にレジストリにまだ存在するか確認
3. **不要な場合は即座に切断**: `stream.stop()` して終了

```typescript
// プレースホルダーエントリを先に登録（重複接続防止）
registry.set(key, {
  retryCount: 0,
  retryTimer: null,
  status: 'connecting',
  stream: null, // まだ null
})
initializeStream(key, type, backendUrl, app, { tag })
```

## イベントハンドラ

### setupStreamHandlers

各ストリームに以下のイベントハンドラを登録します。

| イベント | 処理 |
|---|---|
| `update` | `upsertStatus(status, backendUrl, timelineType, tag)` で SQLite に書き込み |
| `delete` | `handleDeleteEvent(backendUrl, id, timelineType, tag)` で SQLite から削除 |
| `connect` | ステータスを `'connected'` に更新、リトライカウントをリセット |
| `error` | ステータスを `'error'` に更新、`scheduleRetry()` でリトライをスケジュール |

### データフロー

```
WebSocket: update イベント (Entity.Status)
  │
  │  upsertStatus(status, backendUrl, 'local', undefined)
  ▼
SQLite: statuses テーブルに UPSERT
  │
  │  notify('statuses')
  ▼
React Hooks: subscribe('statuses', fetchData) のコールバックが発火
  │
  │  SQL クエリ再実行
  ▼
UI: 新しい投稿が表示される
```

## リトライ戦略

### エクスポネンシャルバックオフ

WebSocket 接続が切断された場合、エクスポネンシャルバックオフでリトライを行います。

```typescript
/** リトライ待機時間の初期値（ミリ秒） */
export const RETRY_DELAY_MS = 1000

/** エクスポネンシャルバックオフの最大待機時間（ミリ秒） */
export const MAX_RETRY_DELAY_MS = 30000

/** 最大リトライ回数 */
export const MAX_RETRY_COUNT = 10

/**
 * エクスポネンシャルバックオフによるリトライ待機時間を計算する。
 * retryCount が増えるごとに待機時間が倍増し、MAX_RETRY_DELAY_MS で上限を設ける。
 */
export const getRetryDelay = (retryCount: number): number =>
  Math.min(RETRY_DELAY_MS * 2 ** Math.min(retryCount, 15), MAX_RETRY_DELAY_MS)
```

### 待機時間の推移

| リトライ回数 | 待機時間 |
|---|---|
| 1 | 1,000ms (1 秒) |
| 2 | 2,000ms (2 秒) |
| 3 | 4,000ms (4 秒) |
| 4 | 8,000ms (8 秒) |
| 5 | 16,000ms (16 秒) |
| 6〜10 | 30,000ms (30 秒, 上限) |

### scheduleRetry

```
scheduleRetry(key, stream)
  │
  ├── レジストリにまだ存在するか確認
  │   └── 存在しない → 何もしない（syncStreamsEvent により削除済み）
  │
  ├── stream.stop() で既存接続を切断
  │
  ├── retryCount をインクリメント
  │
  ├── MAX_RETRY_COUNT 超過チェック
  │   └── 超過 → ステータスを 'error' にして終了（手動リロード促す）
  │
  └── setTimeout で遅延後に再接続:
      ├── レジストリにまだ存在するか再確認
      └── 存在する → stream.start() で再接続
```

### リトライ中の syncStreamsEvent 安全性

リトライタイマーが発火する前に `syncStreamsEvent()` によりそのストリームが不要になった場合:

1. `syncStreamsEvent()` がレジストリからエントリを削除する際に `clearTimeout(entry.retryTimer)` を実行
2. タイマーが発火しても `registryRef.current.has(key)` で存在チェックを行い、不要なら何もしない

### 初期化失敗時のリトライ

`initializeStream()` 自体が失敗した場合（例: サーバーが一時的にダウン）も、同じリトライロジックが適用されます。`initializeStream()` を再帰的に呼び出すことでリトライを実現します。

## WebSocket 接続数の制限

### ブラウザの制約

- Chrome: 同一ドメインに対する WebSocket 同時接続数は約 6 本
- 全体の上限: 一般的に 256 本

### 警告閾値

```typescript
/**
 * ストリーム接続数の警告閾値
 *
 * タグタイムライン × 複数バックエンドで接続数が急増するため、
 * UI 側でのタグ数上限（推奨: 5 タグ以内）と併せて運用する。
 */
export const MAX_STREAM_COUNT_WARNING = 20
```

### 接続数の急増パターン

タグタイムライン × 複数バックエンドの組み合わせで接続数が急増します。

```
例: 5 タグ × 4 バックエンド = 20 タグストリーム
   + 4 local ストリーム + 4 public ストリーム
   = 合計 28 ストリーム（警告対象）
```

### 対策

1. **UI 側**: タグ数を最大 5 つに制限（`AddTagTimelineDialog`）
2. **警告ログ**: `MAX_STREAM_COUNT_WARNING` を超えた場合にコンソール警告を出力
3. **ストリーム共有**: `Set` による自然な重複排除で、同一キーの接続は 1 本に統合

```typescript
if (requiredKeys.size > MAX_STREAM_COUNT_WARNING) {
  console.warn(
    `StreamingManager: ${requiredKeys.size} streams required, ` +
    `exceeds recommended limit of ${MAX_STREAM_COUNT_WARNING}. ` +
    'Consider reducing timeline or tag count.',
  )
}
```

## 初期データ取得との連携

### fetchInitialDataForTimelines

ストリーム接続と同時に、REST API による初期データ取得も実行します。

```
fetchInitialDataForTimelines()
  │
  ├── timelineSettings.timelines をイテレート
  │
  ├── home / notification はスキップ（StatusStoreProvider が担当）
  │
  └── 各タイムライン設定について:
      ├── normalizeBackendFilter() で対象 backendUrl を算出
      ├── resolveBackendUrls() で URL 配列を取得
      │
      └── 各 backendUrl について:
          ├── apps から App を検索
          ├── GetClient(app) でクライアントを作成
          └── fetchInitialData(client, config, url) を実行
```

### ストリーミングと初期データの整合性

```
時刻 T0: アプリ起動
時刻 T1: REST API で初期データを取得（投稿 A, B, C）
時刻 T2: WebSocket が接続完了
時刻 T3: WebSocket で投稿 D を受信
```

T1〜T2 の間に投稿された投稿は、REST API の結果にも WebSocket のイベントにも含まれない可能性があります。これは Mastodon の Streaming API の仕様上避けられないため、許容しています。ユーザーがスクロールして追加読み込み（`fetchMoreData`）を行うことで、欠損した投稿が補完されます。

## 関連ファイル

| ファイル | 説明 |
|---|---|
| `src/util/provider/StreamingManagerProvider.tsx` | ストリーム一元管理 Provider |
| `src/util/streaming/deriveRequiredStreams.ts` | 必要ストリームの算出 |
| `src/util/streaming/streamKey.ts` | ストリームキーの生成・パース |
| `src/util/streaming/streamRegistry.ts` | ストリーム状態管理の型定義 |
| `src/util/streaming/constants.ts` | リトライ定数 |
| `src/util/provider/StatusStoreProvider.tsx` | userStreaming の管理 |
| `src/util/timelineFetcher.ts` | REST API による初期データ取得 |
