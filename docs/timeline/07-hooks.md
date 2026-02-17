# 07. React Hooks

## 概要

miyulab-fe のタイムライン表示は、SQLite のデータをリアクティブに取得する React Hooks によって実現されています。各 Hook は `subscribe()` を使って SQLite の変更通知を購読し、データが更新されるたびに自動的に再クエリを実行します。

Hook の設計は**ファサードパターン**を採用しており、`useTimelineData` が `TimelineConfigV2` に基づいて適切な Hook を選択し、呼び出し側は種別ごとの違いを意識する必要がありません。

## 関連ファイル

| ファイル | 説明 |
|---|---|
| `src/util/hooks/useTimelineData.ts` | ファサード Hook（Hook 選択ロジック） |
| `src/util/hooks/useFilteredTimeline.ts` | home / local / public 用 Hook |
| `src/util/hooks/useFilteredTagTimeline.ts` | tag 用 Hook |
| `src/util/hooks/useCustomQueryTimeline.ts` | カスタムクエリ用 Hook |
| `src/util/hooks/useTimeline.ts` | 旧 Hook（deprecated） |
| `src/util/hooks/timelineFilterBuilder.ts` | SQL WHERE 句生成 |
| `src/util/db/sqlite/connection.ts` | `subscribe()` / `notify()` |

## Hook 一覧

| Hook | 対象 | 使用テーブル | JOIN 方式 |
|---|---|---|---|
| `useFilteredTimeline` | home / local / public | `statuses_timeline_types` | INNER JOIN |
| `useFilteredTagTimeline` | tag | `statuses_belonging_tags` | INNER JOIN |
| `useCustomQueryTimeline` | カスタムクエリ | 全テーブル | LEFT JOIN |
| `useNotifications` | notification | `notifications` | - |
| `useTimeline` | home / local / public | `statuses_timeline_types` | INNER JOIN |
| `useTagTimeline` | tag | `statuses_belonging_tags` | INNER JOIN |

※ `useTimeline` / `useTagTimeline` は **deprecated** です。`useFilteredTimeline` / `useFilteredTagTimeline` を使用してください。

## useTimelineData（ファサード Hook）

### 概要

`useTimelineData` は `TimelineConfigV2` を受け取り、`type` と `customQuery` に基づいて適切な Hook の結果を返すファサードです。

```typescript
export function useTimelineData(
  config: TimelineConfigV2,
): NotificationAddAppIndex[] | StatusAddAppIndex[]
```

### Hook ルールの遵守

React の Hook ルールにより、条件分岐内で Hook を呼び出すことは禁止されています。`useTimelineData` はこの制約を以下の設計で回避しています。

1. **全 Hook を無条件に呼び出す**
2. **各 Hook 内部で早期リターンする**（自分が担当しない type の場合は空配列を返す）
3. **type に応じて結果を選択する**

```typescript
export function useTimelineData(
  config: TimelineConfigV2,
): NotificationAddAppIndex[] | StatusAddAppIndex[] {
  // 全 Hook を無条件に呼び出す（Hook ルール遵守）
  const filteredTimeline = useFilteredTimeline(config)
  const filteredTagTimeline = useFilteredTagTimeline(config)
  const notifications = useNotifications(config)
  const customQueryTimeline = useCustomQueryTimeline(config)

  // customQuery が設定されている場合は優先して使用
  if (config.customQuery?.trim()) {
    return customQueryTimeline
  }

  switch (config.type) {
    case 'home':
    case 'local':
    case 'public':
      return filteredTimeline
    case 'notification':
      return notifications
    case 'tag':
      return filteredTagTimeline
    default:
      return []
  }
}
```

### パフォーマンスへの影響

全 Hook を無条件に呼び出しても、各 Hook 内部で `config.type` をチェックして早期に空配列を返すため、不要な DB クエリは発行されません。

```
useTimelineData(config: { type: 'local', ... })
  │
  ├── useFilteredTimeline(config)
  │   → type === 'local' → SQL クエリ実行 ✅
  │
  ├── useFilteredTagTimeline(config)
  │   → type !== 'tag' → setStatuses([]), return ❌ (スキップ)
  │
  ├── useNotifications(config)
  │   → type !== 'notification' → setStatuses([]), return ❌ (スキップ)
  │
  └── useCustomQueryTimeline(config)
      → customQuery が空 → setStatuses([]), return ❌ (スキップ)
```

### 優先順位

`customQuery` が設定されている場合は、`type` に関係なく `useCustomQueryTimeline` の結果が返されます。

```
優先順位:
  1. customQuery が truthy → useCustomQueryTimeline
  2. type === 'home' | 'local' | 'public' → useFilteredTimeline
  3. type === 'notification' → useNotifications
  4. type === 'tag' → useFilteredTagTimeline
  5. その他 → 空配列
```

## useFilteredTimeline

### 概要

home / local / public タイムライン用の Hook です。`statuses_timeline_types` テーブルとの INNER JOIN で対象タイムライン種別の投稿を取得し、`buildFilterConditions()` のフィルタ条件を WHERE 句に適用します。

```typescript
export function useFilteredTimeline(
  config: TimelineConfigV2,
): StatusAddAppIndex[]
```

### 処理フロー

```
useFilteredTimeline(config)
  │
  ├── 1. BackendFilter から対象 backendUrls を解決
  │   normalizeBackendFilter(config.backendFilter, apps)
  │   resolveBackendUrls(filter, apps)
  │
  ├── 2. フィルタ条件を事前計算（useMemo）
  │   buildFilterConditions(config, targetBackendUrls)
  │   → { conditions: string[], binds: (string|number)[] }
  │
  ├── 3. SQLite からデータ取得（useCallback: fetchData）
  │   │
  │   ├── 早期リターン判定:
  │   │   ├── configType === 'tag' → 空配列
  │   │   ├── configType === 'notification' → 空配列
  │   │   ├── customQuery?.trim() → 空配列
  │   │   └── targetBackendUrls.length === 0 → 空配列
  │   │
  │   └── SQL クエリ実行:
  │       SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
  │              s.created_at_ms, s.storedAt, s.json
  │       FROM statuses s
  │       INNER JOIN statuses_timeline_types stt ...
  │       INNER JOIN statuses_backends sb ...
  │       WHERE stt.timelineType = ?
  │         AND sb.backendUrl IN (?, ...)
  │         AND /* filterConditions */
  │       GROUP BY s.compositeKey
  │       ORDER BY s.created_at_ms DESC
  │       LIMIT ?
  │
  ├── 4. useEffect: 初回取得 + subscribe 登録
  │   fetchData()
  │   return subscribe('statuses', fetchData)
  │
  └── 5. appIndex を付与（useMemo）
      statuses.map(s => ({ ...s, appIndex: resolveAppIndex(s.backendUrl, apps) }))
      .filter(s => s.appIndex !== -1)
```

### バインド変数の順序

```typescript
const binds: (string | number)[] = [
  configType as DbTimelineType,  // 1. stt.timelineType = ?
  ...targetBackendUrls,          // 2. sb.backendUrl IN (?, ...)
  ...filterBinds,                // 3. buildFilterConditions の変数
  MAX_LENGTH,                    // 4. LIMIT ?
]
```

### GROUP BY の理由

`statuses_backends` テーブルとの JOIN により、同一投稿が複数のバックエンドに関連付けられている場合に複数行が返り得ます。`GROUP BY s.compositeKey` で重複を排除し、`MIN(sb.backendUrl)` で代表的な backendUrl を 1 つ選択します。

## useFilteredTagTimeline

### 概要

タグタイムライン用の Hook です。`statuses_belonging_tags` テーブルとの INNER JOIN でタグフィルタを適用し、OR / AND モードに応じた SQL クエリを生成します。

```typescript
export function useFilteredTagTimeline(
  config: TimelineConfigV2,
): StatusAddAppIndex[]
```

### OR モード（いずれかのタグを含む）

`sbt.tag IN (?, ?, ...)` で候補を絞り込み、`GROUP BY s.compositeKey` で重複を排除します。

```sql
SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
       s.created_at_ms, s.storedAt, s.json
FROM statuses s
INNER JOIN statuses_belonging_tags sbt ON s.compositeKey = sbt.compositeKey
INNER JOIN statuses_backends sb ON s.compositeKey = sb.compositeKey
WHERE sbt.tag IN (?, ?)
  AND sb.backendUrl IN (?)
  AND /* filterConditions */
GROUP BY s.compositeKey
ORDER BY s.created_at_ms DESC
LIMIT ?;
```

**バインド変数の順序（OR モード）:**

```typescript
binds.push(...tags, ...targetBackendUrls, ...filterBinds, MAX_LENGTH)
```

### AND モード（すべてのタグを含む）

`HAVING COUNT(DISTINCT sbt.tag) = ?` で、すべてのタグを含む投稿のみを取得します。

```sql
SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
       s.created_at_ms, s.storedAt, s.json
FROM statuses s
INNER JOIN statuses_belonging_tags sbt ON s.compositeKey = sbt.compositeKey
INNER JOIN statuses_backends sb ON s.compositeKey = sb.compositeKey
WHERE sbt.tag IN (?, ?)
  AND sb.backendUrl IN (?)
  AND /* filterConditions */
GROUP BY s.compositeKey
HAVING COUNT(DISTINCT sbt.tag) = ?
ORDER BY s.created_at_ms DESC
LIMIT ?;
```

**バインド変数の順序（AND モード）:**

```typescript
binds.push(
  ...tags,              // 1. sbt.tag IN (?, ...)
  ...targetBackendUrls, // 2. sb.backendUrl IN (?, ...)
  ...filterBinds,       // 3. buildFilterConditions の変数
  tags.length,          // 4. HAVING COUNT(DISTINCT sbt.tag) = ?
  MAX_LENGTH,           // 5. LIMIT ?
)
```

### AND モードの仕組み

1. `IN (tag1, tag2, tag3)` で 3 つのタグのいずれかを持つ投稿を候補として抽出
2. `GROUP BY s.compositeKey` で投稿ごとにグループ化
3. 各グループ内の `DISTINCT sbt.tag` の数をカウント
4. カウントが 3（= タグの総数）に一致する投稿のみを返す

```
例: #cat #dog #bird のAND条件

投稿 A: #cat #dog #bird → COUNT(DISTINCT tag) = 3 ✅
投稿 B: #cat #dog       → COUNT(DISTINCT tag) = 2 ❌
投稿 C: #cat             → COUNT(DISTINCT tag) = 1 ❌
```

### 早期リターン条件

```typescript
if (configType !== 'tag' || customQuery?.trim()) {
  setStatuses([])
  return
}
if (targetBackendUrls.length === 0 || tags.length === 0) {
  setStatuses([])
  return
}
```

- `type !== 'tag'` → この Hook の担当外
- `customQuery` が設定されている → `useCustomQueryTimeline` に委譲
- タグが 0 件 → 結果なし
- バックエンドが 0 件 → 結果なし

## useCustomQueryTimeline

### 概要

ユーザーが記述したカスタム SQL WHERE 句でフィルタする Hook です。`buildFilterConditions()` は使用せず、WHERE 句をサニタイズした上でそのまま実行します。

```typescript
export function useCustomQueryTimeline(
  config: TimelineConfigV2,
): StatusAddAppIndex[]
```

### セキュリティ設計

カスタムクエリはユーザー入力を含むため、厳格なサニタイズ処理を行います。

#### 1. DML/DDL 拒否

以下のキーワードが含まれる場合はクエリを実行せず、空配列を返します。

```
DROP, DELETE, INSERT, UPDATE, ALTER, CREATE, ATTACH, DETACH, PRAGMA, VACUUM, REINDEX
```

#### 2. SQL コメント拒否

`--`（行コメント）と `/* */`（ブロックコメント）を拒否します。

**理由:** コメントにより後続の WHERE 条件がバイパスされるリスクを防止します。

```sql
-- 攻撃例: コメントで後続条件をバイパス
1=1 -- AND s.backendUrl = ?
```

#### 3. セミコロン除去

複数の SQL 文が実行されることを防止します。

#### 4. LIMIT / OFFSET 除去

ユーザー指定の LIMIT / OFFSET を除去し、システムが自動設定する値（`MAX_LENGTH`）を使用します。

### LEFT JOIN の使用

通常の Hook（`useFilteredTimeline` / `useFilteredTagTimeline`）では `INNER JOIN` を使用しますが、`useCustomQueryTimeline` では `LEFT JOIN` を使用します。

**理由:** ユーザーが任意のテーブルを参照する可能性があるため、関連レコードが存在しない投稿もクエリ結果に含める必要があります。

```sql
SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
       s.created_at_ms, s.storedAt, s.json
FROM statuses s
LEFT JOIN statuses_timeline_types stt ON s.compositeKey = stt.compositeKey
LEFT JOIN statuses_belonging_tags sbt ON s.compositeKey = sbt.compositeKey
LEFT JOIN statuses_mentions sm ON s.compositeKey = sm.compositeKey
LEFT JOIN statuses_backends sb ON s.compositeKey = sb.compositeKey
WHERE (/* ユーザーのカスタムクエリ */)
  AND s.has_media = 1  -- onlyMedia フィルタ（該当時のみ）
GROUP BY s.compositeKey
ORDER BY s.created_at_ms DESC
LIMIT ?;
```

### onlyMedia / minMediaCount の自動適用

カスタムクエリモードでも、`onlyMedia` と `minMediaCount` は自動的に追加条件として付与されます。

```typescript
if (minMediaCount != null && minMediaCount > 0) {
  additionalConditions += '\n          AND s.media_count >= ?'
  additionalBinds.push(minMediaCount)
} else if (onlyMedia) {
  additionalConditions += '\n          AND s.has_media = 1'
}
```

### ミュート・ブロックの非適用

カスタムクエリモードでは `applyMuteFilter` / `applyInstanceBlock` は適用されません。ユーザーが完全な制御を持つ Advanced Query モードでは、フィルタの自動適用が意図しない結果を招く可能性があるためです。

### backendUrl フィルタの非適用

カスタムクエリモードでは `backendUrl` フィルタは自動付与されません。ユーザーが必要に応じて `sb.backendUrl = '...'` を自分で記述します。

```sql
-- ユーザーが記述するカスタムクエリの例
sb.backendUrl = 'https://mastodon.social' AND s.language = 'ja'
```

## subscribe() によるリアクティブ更新

### 仕組み

SQLite の書き込み操作（`upsertStatus`, `bulkUpsertStatuses`, `handleDeleteEvent` 等）の末尾で `notify('statuses')` が呼ばれると、`subscribe('statuses', callback)` で登録された全コールバックが実行されます。

```typescript
// connection.ts（概念コード）
const listeners = new Map<string, Set<() => void>>()

export function subscribe(table: string, callback: () => void): () => void {
  if (!listeners.has(table)) listeners.set(table, new Set())
  listeners.get(table)!.add(callback)
  return () => listeners.get(table)?.delete(callback) // cleanup 関数を返す
}

export function notify(table: string): void {
  listeners.get(table)?.forEach((cb) => cb())
}
```

### Hook での利用パターン

すべてのタイムライン Hook で同一のパターンが使用されています。

```typescript
// 初回取得 + 変更通知で再取得
useEffect(() => {
  fetchData()                             // 初回データ取得
  return subscribe('statuses', fetchData) // 変更通知で再取得（cleanup で購読解除）
}, [fetchData])
```

### 更新の流れ

```
WebSocket: update イベント受信
  │
  │  upsertStatus(status, backendUrl, 'local')
  ▼
SQLite: INSERT OR UPDATE
  │
  │  notify('statuses')
  ▼
subscribe('statuses', fetchData) のコールバック群が発火
  │
  ├── useFilteredTimeline の fetchData → SQL クエリ再実行
  ├── useFilteredTagTimeline の fetchData → 早期リターン（type !== 'tag'）
  ├── useCustomQueryTimeline の fetchData → 早期リターン（customQuery が空）
  └── useNotifications の fetchData → 早期リターン（テーブルが異なる）
  │
  ▼
setStatuses(results) → React 再レンダリング → UI 更新
```

### notify の発火頻度

- `upsertStatus()`（ストリーミング）: 投稿 1 件ごとに 1 回
- `bulkUpsertStatuses()`（REST API）: バッチ全体で 1 回
- `handleDeleteEvent()`: 削除 1 件ごとに 1 回
- `updateStatusAction()`: アクション 1 件ごとに 1 回

`bulkUpsertStatuses()` がバッチ全体で 1 回のみ通知する設計により、40 件の投稿を書き込んでも React Hooks の再実行は 1 回に抑えられます。

## resolveAppIndex

### 概要

`backendUrl` から `appIndex`（`apps` 配列のインデックス）を算出するヘルパー関数です。全タイムライン Hook で共通して使用されています。

```typescript
function resolveAppIndex(
  backendUrl: string,
  apps: { backendUrl: string }[],
): number {
  return apps.findIndex((app) => app.backendUrl === backendUrl)
}
```

### 設計判断

#### なぜ DB に永続化しないのか

`appIndex` は `apps` 配列の並び順に依存するため、アカウントの追加・削除・並び替えで値が変わります。DB に永続化すると整合性の維持が困難になるため、表示時に都度算出します。

#### なぜ -1 を返すのか

`backendUrl` が `apps` に見つからない場合（例: アカウント削除後）、`-1` を返します。`0` を返すと別アカウント扱いになり、誤った権限で操作されるリスクがあります。

#### フィルタリング

`appIndex === -1` の投稿は `.filter(s => s.appIndex !== -1)` で除外されます。これにより、削除されたアカウントの投稿が誤って表示されることを防ぎます。

```typescript
return useMemo(
  () =>
    statuses
      .map((s) => ({
        ...s,
        appIndex: resolveAppIndex(s.backendUrl, apps),
      }))
      .filter((s) => s.appIndex !== -1),
  [statuses, apps],
)
```

## useMemo / useCallback によるメモ化戦略

### メモ化の全体像

各 Hook は複数の `useMemo` と `useCallback` でメモ化を行い、不要な再計算・再クエリ・再購読を防いでいます。

```
useMemo: targetBackendUrls
  依存: [config.backendFilter, apps]
  │
  ▼
useMemo: filterResult (conditions, binds)
  依存: [config, targetBackendUrls]
  │
  ▼
useCallback: fetchData
  依存: [configType, customQuery, targetBackendUrls, filterConditions, filterBinds]
  │
  ▼
useEffect: subscribe 登録
  依存: [fetchData]
  │
  ▼
useMemo: appIndex 付与 + フィルタ
  依存: [statuses, apps]
```

### 安定性チェーン

各レベルのメモ化が次のレベルの安定性を保証します。

1. `targetBackendUrls` が安定 → `filterResult` が安定
2. `filterResult` が安定 → `fetchData` が安定
3. `fetchData` が安定 → `useEffect` が再実行されない（再購読なし）
4. `statuses` が変わった場合のみ `appIndex` 付与が再実行される

### メモ化なしの場合の問題

```
レンダリングのたびに:
  ├── buildFilterConditions() が新しい配列を生成
  │   └── filterConditions の参照が変わる
  │       └── fetchData の参照が変わる
  │           └── useEffect が再実行される
  │               └── subscribe が解除・再登録される
  │                   └── fetchData が実行される（不要な DB クエリ）
  └── resolveBackendUrls() が新しい配列を生成
      └── 同上
```

## 旧 Hook（deprecated）

### useTimeline

```typescript
/** @deprecated useFilteredTimeline を使用してください */
export function useTimeline(timelineType: TimelineType): StatusAddAppIndex[]
```

`TimelineConfigV2` ではなく `timelineType` のみを受け取る旧 Hook です。以下の制限があります。

- v2 フィルタオプション（visibilityFilter, languageFilter 等）に非対応
- `BackendFilter` に非対応（常に全バックエンドが対象）
- `statuses_backends` テーブルを使用しない（v3 対応なし）
- `buildFilterConditions()` を使用しない

### useTagTimeline

```typescript
/** @deprecated useFilteredTagTimeline を使用してください */
export function useTagTimeline(
  tag: string,
  options?: { onlyMedia?: boolean },
): StatusAddAppIndex[]
```

単一タグのみをサポートする旧 Hook です。以下の制限があります。

- 複数タグ（OR / AND）に非対応
- v2 フィルタオプションに非対応
- `onlyMedia` フィルタは JS 側で実行（SQL フィルタではない）
- `BackendFilter` に非対応
- `statuses_backends` テーブルを使用しない

### マイグレーション方針

旧 Hook は後方互換性のために残されていますが、新規のタイムライン表示では `useTimelineData` ファサードまたは `useFilteredTimeline` / `useFilteredTagTimeline` を直接使用してください。

## エラーハンドリング

### DB クエリエラー

すべての Hook で DB クエリを `try/catch` で囲み、エラー時はコンソールにログ出力して空配列を返します。

```typescript
try {
  const rows = db.exec(sql, { bind: binds, returnValue: 'resultRows' })
  // ... 結果をパース
  setStatuses(results)
} catch (e) {
  console.error('useFilteredTimeline query error:', e)
  setStatuses([])
}
```

**設計判断:**
- エラー時にアプリ全体をクラッシュさせない
- 空のタイムラインが表示されるだけで、他のタイムラインに影響しない
- コンソールログにより開発時のデバッグが容易

### カスタムクエリエラー

`useCustomQueryTimeline` では、ユーザーが入力した SQL が構文エラーを含む可能性があります。同じ `try/catch` パターンでエラーをハンドリングし、空配列を返します。

カスタムクエリの構文エラーを事前に検出するには、`validateCustomQuery()` 関数（`statusStore.ts`）を使用できます。この関数は `EXPLAIN` 文でクエリの構文チェックのみを行い、実際のデータは読み込みません。

## 型定義

### StatusAddAppIndex

タイムライン Hook が返す投稿データの型です。Mastodon のステータスオブジェクトに `appIndex` 等のメタデータを追加しています。

```typescript
type StatusAddAppIndex = Entity.Status & {
  /** apps 配列のインデックス（UI 操作で使用） */
  appIndex: number
  /** 投稿の一意識別子（SQLite の主キー） */
  compositeKey: string
  /** 取得元バックエンドの URL */
  backendUrl: string
  /** 投稿日時（Unix ミリ秒） */
  created_at_ms: number
  /** SQLite への格納日時（Unix ミリ秒） */
  storedAt: number
}
```

### SqliteStoredStatus

SQLite のクエリ結果から構築される中間型です。`appIndex` は含まれておらず、Hook 内で `resolveAppIndex()` により付与されます。

```typescript
interface SqliteStoredStatus extends Entity.Status {
  compositeKey: string
  backendUrl: string
  created_at_ms: number
  storedAt: number
  timelineTypes: string[]
  belongingTags: string[]
}
```

### 型変換の流れ

```
SQLite クエリ結果 (row[])
  │
  │  JSON.parse(row[4]) → Entity.Status
  │  + compositeKey, backendUrl, created_at_ms, storedAt
  ▼
SqliteStoredStatus[]
  │
  │  + appIndex = resolveAppIndex(backendUrl, apps)
  │  .filter(s => s.appIndex !== -1)
  ▼
StatusAddAppIndex[] → UI コンポーネントに提供
```

## パフォーマンスまとめ

| 最適化 | 手法 | 効果 |
|---|---|---|
| SQL フィルタ | 正規化カラム + WHERE 句 | LIMIT の精度向上、JS フィルタ不要 |
| メモ化チェーン | useMemo / useCallback | 不要な再クエリ・再購読を防止 |
| 早期リターン | Hook 内の type チェック | 不要な DB クエリをスキップ |
| バッチ通知 | bulkUpsertStatuses で 1 回のみ | 再クエリ回数を最小化 |
| GROUP BY | compositeKey で重複排除 | マルチバックエンドの重複表示を防止 |
| appIndex 遅延算出 | resolveAppIndex() | DB 永続化の整合性問題を回避 |
