# タイムライン表示パフォーマンス最適化計画

## 1. 背景

posts テーブルに 5 万レコード程度蓄積された環境において、初回起動時にタイムラインが表示されるまで体感で数秒の遅延が発生している。

miyulab-fe の最大の目的は **ユーザーが自由な SQL WHERE 句でタイムラインを作成できること** であり、正規化されたテーブル構造はその柔軟性の根幹を成す。したがって、本計画では **テーブル構造の非正規化を行わず、クエリ実行戦略とリアクティブ更新の効率化** によってパフォーマンスを改善する。

---

## 2. 現状分析

### 2.1 データフロー

```
Fediverse Server
  → megalodon (REST / WebSocket)
  → SQLite Worker (bulkUpsert → notifyChange)
  → subscribe('posts', fetchData) でリスナー発火
  → Phase1 クエリ (ID フィルタ)
  → Phase2 クエリ (詳細取得 — STATUS_SELECT)
  → React Hooks → Virtuoso → 画面表示
```

### 2.2 ボトルネック一覧

| # | 箇所 | 深刻度 | 概要 |
|---|------|--------|------|
| A | Phase2 `STATUS_SELECT` の相関サブクエリ | 🔴 高 | 1 行あたり最大 21 個の相関サブクエリ。50 件取得で約 1,050 回実行 |
| B | `notifyChange` に debounce がない | 🔴 高 | ストリーミング受信のたびに全リスナーが即時発火。throttle も未実装 |
| C | `useNotifications` に configType ガードがない | 🔴 高 | `config.type !== 'notification'` でも通知テーブルへのクエリが実行される |
| D | `useTimelineData` で 4 Hook が常に全実行 | 🟡 中 | Hook ルール上の制約で不要な Hook も subscribe + 初期化処理が走る |
| E | `TabbedTimeline` が非表示タブもフルマウント | 🟡 中 | CSS `hidden` で隠しているだけで全タブの Hook・リスナー・クエリが稼働 |
| F | Phase1 カスタムクエリの互換サブクエリ | 🟡 中 | `STATUS_COMPAT_FROM` が全 posts を派生テーブル化し、インデックス push down が効かない場合がある |

### 2.3 初回起動時の推定コスト

| ステップ | 処理 | 推定時間 |
|----------|------|----------|
| 1 | SQLite Worker 起動 + OPFS 読み込み | 500ms–2s |
| 2 | Provider チェーン初期化 (13 層) | 50–100ms |
| 3 | `verifyAccountCredentials` × N アプリ | 200–500ms |
| 4 | Phase1 (5 テーブル JOIN, 5 万行) × 全カラム | 50–300ms/各 |
| 5 | Phase2 (50 件 × 21 サブクエリ) × 全カラム | 100–500ms/各 |
| 6 | ストリーミング受信 → `notifyChange` → 全 Hook 再クエリ | 累積遅延 |

---

## 3. 設計原則

1. **テーブル構造を変更しない** — 正規化された構造はカスタムクエリの柔軟性の根幹
2. **Phase2 は全クエリパスで共通** — カスタムクエリが影響するのは Phase1 のみ。Phase2 の最適化はカスタムクエリの自由度に影響しない
3. **段階的に適用可能な改善** — 各施策は独立しており、1 つずつマージできる
4. **計測駆動** — 既存の `explainLogger.ts` (SLOW_QUERY_THRESHOLD_MS = 2000) を活用し、改善前後で計測する

---

## 4. 改善施策

### 4.1 Phase2: `post_stats` を LEFT JOIN に変換

**対象**: `STATUS_SELECT` 内の `post_stats` 相関サブクエリ 6 本 (本投稿 3 + リブログ元 3)

**根拠**: `post_stats` は `post_id` が PRIMARY KEY であり、`posts` と **厳密に 1:1** の関係。JOIN しても行が膨張せず、既存の `GROUP BY s.post_id` に影響しない。

**現状** (サブクエリ 3 本):

```sql
COALESCE((SELECT ps.replies_count FROM post_stats ps WHERE ps.post_id = s.post_id), 0) AS replies_count,
COALESCE((SELECT ps.reblogs_count FROM post_stats ps WHERE ps.post_id = s.post_id), 0) AS reblogs_count,
COALESCE((SELECT ps.favourites_count FROM post_stats ps WHERE ps.post_id = s.post_id), 0) AS favourites_count,
```

**変更後** (LEFT JOIN):

```sql
-- STATUS_BASE_JOINS に追加
LEFT JOIN post_stats ps ON s.post_id = ps.post_id
LEFT JOIN post_stats rps ON rs.post_id = rps.post_id

-- STATUS_SELECT で直接参照
COALESCE(ps.replies_count, 0) AS replies_count,
COALESCE(ps.reblogs_count, 0) AS reblogs_count,
COALESCE(ps.favourites_count, 0) AS favourites_count,
-- リブログ元
COALESCE(rps.replies_count, 0) AS rb_replies_count,
COALESCE(rps.reblogs_count, 0) AS rb_reblogs_count,
COALESCE(rps.favourites_count, 0) AS rb_favourites_count,
```

**効果**: 相関サブクエリ 6 本削減。50 件取得時に 300 回のサブクエリ実行が 0 回になる。

**影響範囲**: `statusStore.ts` の `STATUS_SELECT` / `STATUS_BASE_JOINS` のみ。Phase1 やカスタムクエリには無関係。

**リスク**: 低。1:1 JOIN のため結果セットは変わらない。

---

### 4.2 Phase2: 子テーブルごとのバッチクエリ化

**対象**: `STATUS_SELECT` 内の 1:N 相関サブクエリ全般

**根拠**: 現在は 1 行ごとに個別のサブクエリで子テーブルを引いているが、Phase2 の入力は Phase1 で確定した `post_id` リスト (最大 50 件) である。`WHERE post_id IN (...)` で子テーブルをまとめて取得し、JS 側で `post_id` をキーにマージすれば、クエリ回数を劇的に削減できる。

**現状**: 1 つの SQL 文内に 21 個の相関サブクエリが埋め込まれている。

```
50 件 × 21 サブクエリ = 約 1,050 回のサブクエリ実行
```

**変更後**: Phase2 を以下の個別バッチクエリに分解する。

```
Phase2-A: posts 本体 + 1:1 JOIN (profiles, visibility_types, posts_backends, post_stats)
Phase2-B: SELECT * FROM post_media WHERE post_id IN (?) ORDER BY sort_order
Phase2-C: SELECT * FROM posts_mentions WHERE post_id IN (?)
Phase2-D: SELECT pe.post_id, group_concat(et.code, ',') ...
           FROM post_engagements pe JOIN engagement_types et ...
           WHERE pe.post_id IN (?) GROUP BY pe.post_id
Phase2-E: SELECT * FROM post_custom_emojis pce JOIN custom_emojis ce ...
           WHERE pce.post_id IN (?)
Phase2-F: SELECT * FROM polls pl LEFT JOIN poll_options po ...
           WHERE pl.post_id IN (?)
Phase2-G: SELECT ti.post_id, json_group_array(ck.code) ...
           FROM timeline_items ti JOIN timelines t JOIN channel_kinds ck
           WHERE ti.post_id IN (?) GROUP BY ti.post_id
Phase2-H: SELECT * FROM posts_belonging_tags WHERE post_id IN (?)
```

```
合計: 8 回のクエリ + JS 側マージ
```

**JS 側マージの擬似コード**:

```ts
// 各バッチクエリの結果を Map<post_id, ...> に変換
const mediaMap = groupBy(mediaRows, 'post_id')
const mentionsMap = groupBy(mentionRows, 'post_id')
const engagementsMap = new Map(engagementRows.map(r => [r.post_id, r.csv]))
// ...

// 本体クエリの結果に子データをマージ
const statuses = baseRows.map(row => ({
  ...rowToBaseStatus(row),
  media_attachments: mediaMap.get(row.post_id) ?? [],
  mentions: mentionsMap.get(row.post_id) ?? [],
  engagements_csv: engagementsMap.get(row.post_id) ?? null,
  // ...
}))
```

**リブログ元の処理**: Phase2-A で `reblog_of_uri` JOIN により得られたリブログ元の `post_id` を収集し、同じバッチクエリの IN 句にまとめて含める。マージ時に本投稿 / リブログ元を区別する。

**効果**: 約 1,050 回 → 8 回。Wasm SQLite の per-query オーバーヘッドが支配的な環境では劇的な改善が期待できる。

**影響範囲**: `statusStore.ts` の `fetchStatusesByIds` を新しい `fetchStatusesByIdsBatch` に置き換え。`rowToStoredStatus` のマッピングロジックを変更。`useCustomQueryTimeline.ts` 内のインライン Phase2 も同様に変更。

**リスク**: 中。`rowToStoredStatus` の変更はテスト必須。Phase1 やカスタムクエリの WHERE 句には影響しない。

---

### 4.3 `notifyChange` に debounce を導入

**対象**: `connection.ts` の `notifyChange`

**根拠**: 現在、`notifyChange('posts')` は同期的に全リスナーを即時呼び出す。ストリーミングで短時間に複数の投稿が到着すると、リスナーが連続発火しクエリが多重実行される。debounce も throttle も一切ない。

**変更方針**:

```ts
const pendingNotifications = new Set<TableName>()
let timerId: ReturnType<typeof setTimeout> | null = null

export function notifyChange(table: TableName): void {
  pendingNotifications.add(table)
  if (timerId != null) return
  timerId = setTimeout(() => {
    timerId = null
    const tables = [...pendingNotifications]
    pendingNotifications.clear()
    for (const t of tables) {
      const set = listeners.get(t)
      if (set) {
        for (const fn of set) {
          try { fn() } catch (e) { console.error('Change listener error:', e) }
        }
      }
    }
  }, 80)
}
```

**debounce 値**: 80ms。ストリーミングのバースト（数十 ms 間隔）を吸収しつつ、ユーザーの操作（ふぁぼ・ブースト等）のフィードバックが遅延しすぎない値。

**効果**: ストリーミング高頻度時のクエリ発行回数を大幅に削減。

**影響範囲**: `connection.ts` のみ。

**リスク**: 低。最大 80ms の表示遅延が発生するが、タイムラインの性質上問題ない。ユーザー操作 (ふぁぼ等) の即時フィードバックは `optimistic update` で対応済みであれば影響なし。未対応の場合は、ユーザー操作トリガーの `notifyChange` だけ即時発火するオプションを検討する。

---

### 4.4 `useNotifications` に configType ガードを追加

**対象**: `useNotifications.ts` の `fetchData`

**根拠**: 現在、`useNotifications` の `fetchData` には `config.type` によるスキップ条件がない。そのため `config.type === 'home'` のカラムでも通知テーブルへの SQL クエリが実行されてしまう。他の 3 Hook (`useFilteredTimeline`, `useFilteredTagTimeline`, `useCustomQueryTimeline`) にはすべて configType チェックがあり、これは実装漏れと考えられる。

**変更方針**:

```ts
// fetchData の冒頭に追加
const fetchData = useCallback(async () => {
  void refreshToken

  // notification タイプ以外ではスキップ
  if (config?.type !== 'notification') {
    setNotifications([])
    return
  }

  if (targetBackendUrls.length === 0 || config?.customQuery?.trim()) {
    setNotifications([])
    return
  }
  // ... 以下既存処理
}, [/* ... */])
```

**効果**: `notification` 以外の全タイムラインカラムで通知クエリが走らなくなる。

**影響範囲**: `useNotifications.ts` のみ。

**リスク**: 極低。バグ修正に近い。`useCustomQueryTimeline` が notification モードを担当するため、カスタムクエリ経由の通知取得には影響しない。

---

### 4.5 `TabbedTimeline` の遅延マウント

**対象**: `TabbedTimeline.tsx`

**根拠**: 現在は全タブの `DynamicTimeline` を同時にマウントし、CSS `hidden` で非表示にしている。タブ 3 つの場合、非アクティブなタブ 2 つ分の Hook・リスナー・クエリが無駄に稼働している。

**変更方針**: 一度もアクティブにされていないタブはマウントせず、一度アクティブにされたタブは `hidden` で保持する (再マウントによるデータロスを防ぐ)。

```tsx
const [mountedIndices, setMountedIndices] = useState<Set<number>>(
  () => new Set([0]),
)

useEffect(() => {
  setMountedIndices((prev) => {
    if (prev.has(safeIndex)) return prev
    return new Set([...prev, safeIndex])
  })
}, [safeIndex])

// ...
{configs.map((config, index) => {
  const isActive = index === safeIndex
  const isMounted = mountedIndices.has(index)
  if (!isMounted) return null
  return (
    <div hidden={!isActive} /* ... */>
      <DynamicTimeline config={config} headerOffset="2rem" />
    </div>
  )
})}
```

**効果**: 初回起動時は 1 タブ分の Hook・クエリのみ実行。タブ 4 つなら初期コストが 1/4 に。

**影響範囲**: `TabbedTimeline.tsx` のみ。

**リスク**: 低。タブ切り替え時に初回マウントの遅延が発生するが、それ以降はキャッシュされる。

---

### 4.6 不要な Hook の subscribe 回避

**対象**: `useFilteredTimeline.ts`, `useFilteredTagTimeline.ts`, `useNotifications.ts`, `useCustomQueryTimeline.ts`

**根拠**: `useTimelineData` が 4 Hook を常に呼び出す制約上、不要な Hook も `subscribe('posts', fetchData)` でリスナー登録される。早期リターンする Hook であっても `subscribe` / `unsubscribe` のセットアップコストとリスナー発火時の関数呼び出しコストがかかる。

**変更方針**: 各 Hook の `useEffect` 内で、自身が対象の configType でない場合は `subscribe` 自体をスキップする。

```ts
useEffect(() => {
  // このHookの対象でない場合は subscribe しない
  if (configType !== 'home' && configType !== 'local' && configType !== 'public') {
    setStatuses([])
    return
  }
  fetchData()
  return subscribe('posts', fetchData)
}, [configType, fetchData])
```

**効果**: `posts` テーブルのリスナー数が 1 カラムあたり最大 3 個 → 1 個に削減。`notifyChange` 発火時の不要な関数呼び出しが消える。

**影響範囲**: 各 Hook ファイル。

**リスク**: 低。configType が動的に変わるケースは `TimelineConfigV2` の設計上想定されていない（config 変更時は configId ごとリセットされる）。

---

### 4.7 Phase1: `STATUS_COMPAT_FROM` の改善 (将来検討)

**対象**: `useCustomQueryTimeline.ts` の `STATUS_COMPAT_FROM`, `statusStore.ts` の `getStatusesByCustomQuery`

**根拠**: カスタムクエリの Phase1 で `FROM (SELECT p.*, ... FROM posts p LEFT JOIN ...) s` という派生テーブルを使用しており、SQLite オプティマイザが外側の WHERE 条件を内側に push down できないケースがある。5 万件すべてに対して `post_stats`, `profiles`, `servers`, `visibility_types` の JOIN + サブクエリが実行されてからフィルタリングされる可能性がある。

**検討案**:

- **案 A**: 互換サブクエリを VIEW に置き換え、SQLite の VIEW 最適化（マージアルゴリズム）に期待する
- **案 B**: `s.favourites_count` 等の互換カラム参照を検出した場合のみ派生テーブルを使い、それ以外は直接 `posts p` を FROM に使う
- **案 C**: GENERATED COLUMN として `posts` テーブルに追加する（ただし「テーブル構造を変更しない」原則との兼ね合い）

**現時点では保留**。4.1〜4.6 の施策適用後に再計測し、Phase1 がボトルネックとして残る場合に着手する。

---

## 5. 実施順序

施策を影響範囲の小ささ・即効性・リスクの低さで並べる。

| フェーズ | 施策 | 見込み効果 | 変更ファイル数 |
|----------|------|------------|----------------|
| **Phase I** | 4.4 `useNotifications` ガード追加 | 不要クエリ除去 | 1 |
| **Phase I** | 4.3 `notifyChange` debounce | バースト時クエリ削減 | 1 |
| **Phase I** | 4.1 `post_stats` LEFT JOIN 化 | サブクエリ 6 本削減 | 1 |
| **Phase II** | 4.5 タブ遅延マウント | 初期クエリ 1/N 化 | 1 |
| **Phase II** | 4.6 不要 Hook の subscribe 回避 | リスナー数 1/3 化 | 4 |
| **Phase III** | 4.2 子テーブルバッチクエリ化 | サブクエリ 1,050→8 回 | 2–3 |
| **将来** | 4.7 互換サブクエリ改善 | Phase1 高速化 | 2 |

Phase I は低リスクで即座に適用可能。Phase II は小〜中規模の変更。Phase III は `fetchStatusesByIds` と `rowToStoredStatus` の書き換えを伴う中規模リファクタリング。

---

## 6. 計測方法

### 6.1 既存インフラの活用

- `explainLogger.ts` の `SLOW_QUERY_THRESHOLD_MS` を一時的に `0` に設定し、全クエリの実行時間を記録する
- 各 Hook の `queryDuration` state を使い、UI 上でクエリ時間を確認する

### 6.2 計測シナリオ

| シナリオ | 条件 |
|----------|------|
| 初回起動 | 5 万 posts, タブ 3 個 (各 2–3 カラム), ストリーミング未接続 |
| ストリーミングバースト | 1 秒間に 10 件の投稿受信 |
| タブ切り替え | 非アクティブ → アクティブ切り替え時の表示完了時間 |
| カスタムクエリ | `s.has_media = 1 AND s.favourites_count >= 5` のようなフィルタ |

### 6.3 目標値

| 指標 | 現状推定 | 目標 |
|------|----------|------|
| 初回タイムライン表示 (Worker 起動後) | 500ms–1.5s | 200ms 以下 |
| Phase2 クエリ実行時間 (50 件) | 100–500ms | 50ms 以下 |
| ストリーミング受信から表示更新 | 即時〜数百ms (多重発火) | 80–150ms (debounce 分のみ) |
| `posts` リスナー数 / カラム | 3 個 | 1 個 |

---

## 7. 変更しないもの

以下は本計画のスコープ外とし、変更しない。

- **テーブル構造** — 正規化された設計はカスタムクエリの自由度に不可欠
- **2 段階クエリ戦略** — Phase1 (ID フィルタ) → Phase2 (詳細取得) の分離は正しい設計
- **`STATUS_COMPAT_FROM` の互換カラム** — `s.favourites_count` 等をカスタムクエリで使っている既存ユーザーを壊さない
- **`useTimelineData` の 4 Hook 呼び出し構造** — Hook ルールの制約上、条件付き呼び出しは不可。subscribe スキップで対処する
- **react-virtuoso** — 仮想スクロール自体はボトルネックではない
- **Provider 階層** — 13 層の Context は初期化コストが小さく、ボトルネックではない
