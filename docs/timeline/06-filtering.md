# 06. フィルタリングシステム

## 概要

miyulab-fe のフィルタリングシステムは、SQL の WHERE 句を動的に生成することで、データベースレベルでの精密なフィルタリングを実現します。JavaScript 側のフィルタが不要なため、`LIMIT` の精度が高く、常に指定件数ぶんの投稿を正確に取得できます。

フィルタリングの中核を担うのは `buildFilterConditions()` 関数であり、`TimelineConfigV2` のフィルタオプションから SQL WHERE 句の条件配列とバインド変数を生成します。

## 関連ファイル

| ファイル                                   | 説明                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `src/util/hooks/timelineFilterBuilder.ts`  | `buildFilterConditions()` — SQL WHERE 句の生成                                    |
| `src/util/queryBuilder.ts`                 | `buildMuteCondition()` / `buildInstanceBlockCondition()` — ミュート・ブロック条件 |
| `src/util/queryBuilder.ts`                 | `buildQueryFromConfig()` / `parseQueryToConfig()` — UI ↔ クエリ変換               |
| `src/util/hooks/useFilteredTimeline.ts`    | home / local / public のクエリ組み立て                                            |
| `src/util/hooks/useFilteredTagTimeline.ts` | tag のクエリ組み立て                                                              |
| `src/util/hooks/useCustomQueryTimeline.ts` | カスタムクエリのサニタイズと実行                                                  |

## アーキテクチャ

### フィルタ適用の流れ

```
TimelineConfigV2
  │
  ▼
buildFilterConditions(config, targetBackendUrls)
  │
  │  conditions: string[]   ← SQL WHERE 句の条件配列
  │  binds: (string|number)[] ← プリペアドステートメントのバインド変数
  ▼
useFilteredTimeline / useFilteredTagTimeline
  │
  │  backendUrl フィルタを追加
  │  timelineType / tag フィルタを追加
  │  ORDER BY / LIMIT を追加
  ▼
SQLite.exec(sql, { bind: binds })
  │
  ▼
StatusAddAppIndex[] → UI 表示
```

### 責務分離

| レイヤー                 | 担当するフィルタ                                                 | 理由                                |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------------- |
| API レベル               | `only_media`（local / public のみ）                              | 帯域節約のため API 側で事前フィルタ |
| `buildFilterConditions`  | メディア・公開範囲・言語・除外系・アカウント・ミュート・ブロック | 全種別共通のフィルタ条件            |
| 各 Hook                  | `backendUrl` / `timelineType` / `tag`                            | タイムライン種別固有の結合条件      |
| `useCustomQueryTimeline` | ユーザー定義の WHERE 句                                          | Advanced Query モード               |

`backendUrl` フィルタは各 Hook が個別に追加するため、`buildFilterConditions()` では生成しません。これにより、`buildFilterConditions()` はタイムライン種別に依存しない汎用的な関数として設計されています。

## buildFilterConditions

### シグネチャ

```typescript
export function buildFilterConditions(
  config: TimelineConfigV2,
  targetBackendUrls: string[],
): { conditions: string[]; binds: (string | number)[] };
```

### 引数

| 引数                | 型                 | 説明                                                    |
| ------------------- | ------------------ | ------------------------------------------------------- |
| `config`            | `TimelineConfigV2` | タイムライン設定（フィルタオプションを含む）            |
| `targetBackendUrls` | `string[]`         | 対象バックエンドの URL 配列（ミュート条件の生成に使用） |

### 戻り値

| フィールド   | 型                     | 説明                                           |
| ------------ | ---------------------- | ---------------------------------------------- |
| `conditions` | `string[]`             | SQL WHERE 句の条件式配列（`AND` で結合される） |
| `binds`      | `(string \| number)[]` | プリペアドステートメントのバインド変数配列     |

### 生成される条件の一覧

以下の表は、`TimelineConfigV2` の各フィルタオプションと、それに対応して生成される SQL 条件を示します。

| フィルタオプション             | 条件                     | 生成される SQL                                   | バインド変数            |
| ------------------------------ | ------------------------ | ------------------------------------------------ | ----------------------- |
| `minMediaCount >= 1`           | メディア枚数             | `s.media_count >= ?`                             | `[minMediaCount]`       |
| `onlyMedia === true`           | メディア有無             | `s.has_media = 1`                                | なし                    |
| `visibilityFilter` (1〜3 個)   | 公開範囲                 | `s.visibility IN (?, ?, ...)`                    | `[...visibilityFilter]` |
| `languageFilter` (1 個以上)    | 言語                     | `(s.language IN (?, ...) OR s.language IS NULL)` | `[...languageFilter]`   |
| `excludeReblogs === true`      | ブースト除外             | `s.is_reblog = 0`                                | なし                    |
| `excludeReplies === true`      | リプライ除外             | `s.in_reply_to_id IS NULL`                       | なし                    |
| `excludeSpoiler === true`      | CW 除外                  | `s.has_spoiler = 0`                              | なし                    |
| `excludeSensitive === true`    | センシティブ除外         | `s.is_sensitive = 0`                             | なし                    |
| `accountFilter` (include)      | アカウント包含           | `s.account_acct IN (?, ...)`                     | `[...accts]`            |
| `accountFilter` (exclude)      | アカウント除外           | `s.account_acct NOT IN (?, ...)`                 | `[...accts]`            |
| `applyMuteFilter !== false`    | ミュート除外             | サブクエリ（後述）                               | `[...backendUrls]`      |
| `applyInstanceBlock !== false` | インスタンスブロック除外 | サブクエリ（後述）                               | なし                    |

### 条件生成の優先順位

1. **`minMediaCount`** が指定されている場合、`onlyMedia` より優先されます
2. **`visibilityFilter`** が 4 種類すべて指定されている場合（= 全公開範囲）、条件を生成しません
3. **`applyMuteFilter`** が `true`（デフォルト）でも、`accountFilter.mode === 'include'` の場合はミュートを適用しません

## 各フィルタ条件の詳細

### メディアフィルタ

```typescript
// minMediaCount が指定されている場合（優先）
if (config.minMediaCount != null && config.minMediaCount > 0) {
  conditions.push("s.media_count >= ?");
  binds.push(config.minMediaCount);
}
// onlyMedia のみ指定されている場合
else if (config.onlyMedia) {
  conditions.push("s.has_media = 1");
}
```

**使い分け:**

- `onlyMedia: true` — メディアが 1 枚以上あれば表示
- `minMediaCount: 2` — メディアが 2 枚以上ある投稿のみ表示

**正規化カラム:**

- `has_media`: `(media_attachments?.length ?? 0) > 0 ? 1 : 0`
- `media_count`: `media_attachments?.length ?? 0`

### 公開範囲フィルタ

```typescript
if (
  config.visibilityFilter != null &&
  config.visibilityFilter.length > 0 &&
  config.visibilityFilter.length < 4 // 4つ全指定 = フィルタなし
) {
  const placeholders = config.visibilityFilter.map(() => "?").join(",");
  conditions.push(`s.visibility IN (${placeholders})`);
  binds.push(...config.visibilityFilter);
}
```

**公開範囲の種類:**

| 値         | 説明                 | アイコン |
| ---------- | -------------------- | -------- |
| `public`   | 公開                 | 🌐       |
| `unlisted` | 未収載               | 🔓       |
| `private`  | フォロワー限定       | 🔒       |
| `direct`   | ダイレクトメッセージ | ✉️       |

**最適化:** 4 種類すべてが指定された場合は WHERE 句を生成しません（全公開範囲 = フィルタなし）。

### 言語フィルタ

```typescript
if (config.languageFilter != null && config.languageFilter.length > 0) {
  const placeholders = config.languageFilter.map(() => "?").join(",");
  conditions.push(`(s.language IN (${placeholders}) OR s.language IS NULL)`);
  binds.push(...config.languageFilter);
}
```

**重要な設計判断:** 言語が未設定（`NULL`）の投稿は常に表示します。

**理由:**

- 多くの Mastodon インスタンスでは言語設定がオプショナル
- 言語未設定の投稿を除外すると、多数の投稿が不意に非表示になる
- ユーザーの期待: 「日本語フィルタ」は「日本語の投稿を表示」であり「日本語以外を除外」ではない

### 除外フィルタ

```typescript
// ブースト除外
if (config.excludeReblogs) {
  conditions.push("s.is_reblog = 0");
}

// リプライ除外
if (config.excludeReplies) {
  conditions.push("s.in_reply_to_id IS NULL");
}

// CW 付き除外
if (config.excludeSpoiler) {
  conditions.push("s.has_spoiler = 0");
}

// センシティブ除外
if (config.excludeSensitive) {
  conditions.push("s.is_sensitive = 0");
}
```

**正規化カラムのマッピング:**

| カラム           | 元データ                    | 値               |
| ---------------- | --------------------------- | ---------------- |
| `is_reblog`      | `status.reblog != null`     | `0` / `1`        |
| `in_reply_to_id` | `status.in_reply_to_id`     | `NULL` / 投稿 ID |
| `has_spoiler`    | `status.spoiler_text != ''` | `0` / `1`        |
| `is_sensitive`   | `status.sensitive`          | `0` / `1`        |

### アカウントフィルタ

```typescript
if (config.accountFilter != null && config.accountFilter.accts.length > 0) {
  const placeholders = config.accountFilter.accts.map(() => "?").join(",");
  if (config.accountFilter.mode === "include") {
    conditions.push(`s.account_acct IN (${placeholders})`);
  } else {
    conditions.push(`s.account_acct NOT IN (${placeholders})`);
  }
  binds.push(...config.accountFilter.accts);
}
```

**include モードの特別な挙動:**

- `include` モードでは、ユーザーが明示的に特定アカウントの投稿を見たいと指定しているため、ミュートフィルタ（`applyMuteFilter`）は自動的に無効化されます

## ミュート・インスタンスブロック

### ミュートアカウント除外

```typescript
const applyMute = config.applyMuteFilter ?? true;
if (applyMute && config.accountFilter?.mode !== "include") {
  const mute = buildMuteCondition(targetBackendUrls);
  conditions.push(mute.sql);
  binds.push(...mute.binds);
}
```

`buildMuteCondition()` は `muted_accounts` テーブルを使ったサブクエリを生成します。

```sql
-- 生成されるサブクエリ（概念）
s.account_acct NOT IN (
  SELECT account_acct FROM muted_accounts
  WHERE backendUrl IN (?, ?, ...)
)
```

**適用されない条件:**

1. `applyMuteFilter === false` — ユーザーが明示的に無効化
2. `accountFilter.mode === 'include'` — 特定アカウントの投稿を見たい場合

**`targetBackendUrls` を渡す理由:**

- ミュート設定はバックエンドごとに独立
- バックエンド A でミュートしたアカウントは、バックエンド B のタイムラインには影響しない
- 対象バックエンドに限定することで、正確なミュート適用が可能

### インスタンスブロック除外

```typescript
const applyBlock = config.applyInstanceBlock ?? true;
if (applyBlock) {
  conditions.push(buildInstanceBlockCondition());
}
```

`buildInstanceBlockCondition()` は `blocked_instances` テーブルを使ったサブクエリを生成します。投稿者の `account_acct` からドメインを抽出して照合します。

```sql
-- 生成されるサブクエリ（概念）
-- account_acct の @ 以降のドメイン部分を blocked_instances と照合
NOT EXISTS (
  SELECT 1 FROM blocked_instances
  WHERE instance_domain = substr(s.account_acct, instr(s.account_acct, '@') + 1)
)
```

**バインド変数なし:** `blocked_instances` はバックエンドに依存せず、グローバルに適用されるため、バインド変数は不要です。

## Hook 内でのクエリ組み立て

### useFilteredTimeline

home / local / public タイムライン用の Hook です。`statuses_timeline_types` テーブルとの JOIN で対象投稿を絞り込みます。

```sql
SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
       s.created_at_ms, s.storedAt, s.json
FROM statuses s
INNER JOIN statuses_timeline_types stt
  ON s.compositeKey = stt.compositeKey
INNER JOIN statuses_backends sb
  ON s.compositeKey = sb.compositeKey
WHERE stt.timelineType = ?                    -- 'home' / 'local' / 'public'
  AND sb.backendUrl IN (?, ?, ...)            -- 対象バックエンド
  AND /* buildFilterConditions の conditions */
GROUP BY s.compositeKey
ORDER BY s.created_at_ms DESC
LIMIT ?;
```

**バインド変数の順序:**

```typescript
const binds: (string | number)[] = [
  configType as DbTimelineType, // 1. timelineType
  ...targetBackendUrls, // 2. backendUrl IN (...)
  ...filterBinds, // 3. buildFilterConditions のバインド変数
  MAX_LENGTH, // 4. LIMIT
];
```

**GROUP BY の理由:** `statuses_backends` との JOIN により同一投稿が複数行になり得るため、`GROUP BY s.compositeKey` で重複を排除します。`MIN(sb.backendUrl)` で代表的な backendUrl を 1 つ選択します。

### useFilteredTagTimeline

タグタイムライン用の Hook です。`statuses_belonging_tags` テーブルとの JOIN でタグフィルタを適用します。

#### OR モード（いずれかのタグを含む）

```sql
SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
       s.created_at_ms, s.storedAt, s.json
FROM statuses s
INNER JOIN statuses_belonging_tags sbt
  ON s.compositeKey = sbt.compositeKey
INNER JOIN statuses_backends sb
  ON s.compositeKey = sb.compositeKey
WHERE sbt.tag IN (?, ?, ...)                  -- タグ OR 条件
  AND sb.backendUrl IN (?, ?, ...)            -- 対象バックエンド
  AND /* buildFilterConditions の conditions */
GROUP BY s.compositeKey
ORDER BY s.created_at_ms DESC
LIMIT ?;
```

#### AND モード（すべてのタグを含む）

```sql
SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
       s.created_at_ms, s.storedAt, s.json
FROM statuses s
INNER JOIN statuses_belonging_tags sbt
  ON s.compositeKey = sbt.compositeKey
INNER JOIN statuses_backends sb
  ON s.compositeKey = sb.compositeKey
WHERE sbt.tag IN (?, ?, ...)                  -- 対象タグを IN で絞り込み
  AND sb.backendUrl IN (?, ?, ...)            -- 対象バックエンド
  AND /* buildFilterConditions の conditions */
GROUP BY s.compositeKey
HAVING COUNT(DISTINCT sbt.tag) = ?            -- 全タグを含む投稿のみ
ORDER BY s.created_at_ms DESC
LIMIT ?;
```

**AND モードの仕組み:**

1. `IN (tag1, tag2, tag3)` で候補を絞り込み
2. `GROUP BY s.compositeKey` でグループ化
3. `HAVING COUNT(DISTINCT sbt.tag) = 3` で 3 つすべてのタグを持つ投稿のみを抽出

**バインド変数の順序（AND モード）:**

```typescript
const binds: (string | number)[] = [
  ...tags, // 1. sbt.tag IN (...)
  ...targetBackendUrls, // 2. sb.backendUrl IN (...)
  ...filterBinds, // 3. buildFilterConditions のバインド変数
  tags.length, // 4. HAVING COUNT(DISTINCT sbt.tag) = ?
  MAX_LENGTH, // 5. LIMIT
];
```

### useCustomQueryTimeline

カスタム SQL WHERE 句でフィルタする Hook です。`buildFilterConditions()` は使用せず、ユーザーが記述した WHERE 句をそのまま使用します。

```sql
SELECT s.compositeKey, MIN(sb.backendUrl) AS backendUrl,
       s.created_at_ms, s.storedAt, s.json
FROM statuses s
LEFT JOIN statuses_timeline_types stt
  ON s.compositeKey = stt.compositeKey
LEFT JOIN statuses_belonging_tags sbt
  ON s.compositeKey = sbt.compositeKey
LEFT JOIN statuses_mentions sm
  ON s.compositeKey = sm.compositeKey
LEFT JOIN statuses_backends sb
  ON s.compositeKey = sb.compositeKey
WHERE (/* ユーザーのカスタムクエリ */)
  AND s.has_media = 1                         -- onlyMedia フィルタ（該当時のみ）
GROUP BY s.compositeKey
ORDER BY s.created_at_ms DESC
LIMIT ?;
```

**INNER JOIN vs LEFT JOIN:**

- `useFilteredTimeline` / `useFilteredTagTimeline`: 特定のタイムライン種別やタグを持つ投稿のみが対象のため `INNER JOIN`
- `useCustomQueryTimeline`: ユーザーが任意のテーブルを参照する可能性があるため `LEFT JOIN`（関連レコードがない投稿もクエリ結果に含まれる）

## カスタムクエリのセキュリティ

### サニタイズ処理

`useCustomQueryTimeline` はユーザー入力の SQL を実行するため、厳格なサニタイズを行います。

```typescript
// 1. DML/DDL 拒否
const forbidden =
  /\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX)\b/i;
if (forbidden.test(customQuery)) {
  console.error("Custom query contains forbidden SQL statements.");
  setStatuses([]);
  return;
}

// 2. SQL コメント拒否（後続の条件のコメントアウト防止）
if (/--/.test(customQuery) || /\/\*/.test(customQuery)) {
  console.error("Custom query contains SQL comments.");
  setStatuses([]);
  return;
}

// 3. セミコロン除去（複文実行防止）
const sanitized = customQuery
  .replace(/;/g, "")
  .replace(/\bLIMIT\b\s+\d+/gi, "") // LIMIT 除去（自動設定）
  .replace(/\bOFFSET\b\s+\d+/gi, "") // OFFSET 除去（自動設定）
  .trim();
```

### 拒否される SQL パターン

| パターン                   | 理由               |
| -------------------------- | ------------------ |
| `DROP TABLE statuses`      | テーブル削除       |
| `DELETE FROM statuses`     | データ削除         |
| `INSERT INTO statuses ...` | データ挿入         |
| `UPDATE statuses SET ...`  | データ更新         |
| `ALTER TABLE statuses ...` | スキーマ変更       |
| `CREATE TABLE ...`         | テーブル作成       |
| `ATTACH DATABASE ...`      | 外部 DB 接続       |
| `PRAGMA ...`               | SQLite 設定変更    |
| `-- コメント`              | 後続条件のバイパス |
| `/* コメント */`           | 後続条件のバイパス |
| `;`                        | 複数文の実行       |
| `LIMIT N` / `OFFSET N`     | 自動設定値の上書き |

### カスタムクエリモードでの制限

- `applyMuteFilter` / `applyInstanceBlock` は適用されません
- `backendUrl` フィルタはクエリに含まれないため、ユーザーが自分で `sb.backendUrl = '...'` を記述する必要があります
- `onlyMedia` / `minMediaCount` のみ自動的に追加条件として付与されます

### バリデーション（validateCustomQuery）

`statusStore.ts` には `validateCustomQuery()` 関数があり、カスタムクエリを実際に `EXPLAIN` して構文エラーを事前に検出できます。

```typescript
async function validateCustomQuery(
  query: string,
): Promise<{ valid: boolean; error?: string }>;
```

内部では以下の手順でバリデーションを行います:

1. DML/DDL の禁止キーワードチェック
2. セミコロン・コメントの除去
3. `EXPLAIN` 文で構文チェック（実際のデータは読み込まない）

## queryBuilder との連携

### buildQueryFromConfig

`TimelineEditPanel` で使用される関数で、UI のフィルタ設定からカスタムクエリ文字列を生成します。Advanced Query モードのトグル時に、現在の UI 設定を SQL に変換するために使われます。

```
UI 設定 (TimelineConfigV2)
  │
  │  buildQueryFromConfig(config)
  ▼
SQL WHERE 句文字列
  │
  │  カスタムクエリエディタに表示
  ▼
ユーザーが編集可能
```

### parseQueryToConfig

逆方向の変換関数で、カスタムクエリ文字列から UI 設定を逆算します（ベストエフォート）。Advanced Query モードから通常 UI モードに切り替える際に使用されます。

```
SQL WHERE 句文字列
  │
  │  parseQueryToConfig(query)
  ▼
Partial<TimelineConfigV2>
  │
  │  UI のフィルタコントロールに反映
  ▼
ユーザーが GUI で編集可能
```

**ベストエフォートの意味:** 複雑なカスタムクエリ（サブクエリ、`json_extract`、`LIKE` 等）は完全に逆算できない場合があります。その場合はパース可能な部分のみを復元します。

## useMemo による安定化

### フィルタ条件のメモ化

`buildFilterConditions()` の結果は `useMemo` でメモ化されます。これにより、config や targetBackendUrls が変わらない限り、同じオブジェクト参照が維持されます。

```typescript
const filterResult = useMemo(
  () => buildFilterConditions(config, targetBackendUrls),
  [config, targetBackendUrls],
);
const filterConditions = filterResult.conditions;
const filterBinds = filterResult.binds;
```

### なぜメモ化が重要か

`fetchData` は `useCallback` でメモ化されており、`filterConditions` と `filterBinds` が依存配列に含まれています。メモ化しないと、レンダリングのたびに新しい配列オブジェクトが生成され、`fetchData` が再生成 → `useEffect` が再実行 → 不要な DB クエリが発生します。

```
レンダリング
  │
  ├── useMemo: filterResult を安定化
  │   └── config / targetBackendUrls が同じ → 同一参照を再利用
  │
  ├── useCallback: fetchData を安定化
  │   └── filterConditions / filterBinds が同一参照 → 同一関数を再利用
  │
  └── useEffect: subscribe 登録
      └── fetchData が同一参照 → 再購読なし
```

### targetBackendUrls のメモ化

```typescript
const targetBackendUrls = useMemo(() => {
  const filter = normalizeBackendFilter(config.backendFilter, apps);
  return resolveBackendUrls(filter, apps);
}, [config.backendFilter, apps]);
```

`normalizeBackendFilter()` と `resolveBackendUrls()` の結果もメモ化することで、BackendFilter の正規化と URL 解決の重複処理を防ぎます。

## 不要な Hook 呼び出しの回避

### 早期リターンパターン

各 Hook は `config.type` をチェックし、自分が担当しない種別の場合は DB クエリをスキップして空配列を返します。

```typescript
// useFilteredTimeline.ts
const fetchData = useCallback(async () => {
  // tag / notification はそれぞれ専用 Hook で処理するためスキップ
  // customQuery が設定されている場合も委譲するためスキップ
  if (
    configType === "tag" ||
    configType === "notification" ||
    customQuery?.trim()
  ) {
    setStatuses([]);
    return;
  }
  // ...
}, [configType, customQuery, targetBackendUrls, filterConditions, filterBinds]);
```

```typescript
// useFilteredTagTimeline.ts
const fetchData = useCallback(async () => {
  // tag 以外の type の場合は早期に空配列を返す
  if (configType !== "tag" || customQuery?.trim()) {
    setStatuses([]);
    return;
  }
  // ...
}, [
  tagMode,
  configType,
  customQuery,
  targetBackendUrls,
  tags,
  filterConditions,
  filterBinds,
]);
```

この設計により、`useTimelineData` ファサードで全 Hook を無条件に呼び出しても、実際に DB クエリを発行するのは 1 つの Hook のみとなります。

## customQuery の優先順位

`customQuery` が設定されている場合のフィルタ適用の優先順位:

```
1. useTimelineData: customQuery?.trim() が truthy → useCustomQueryTimeline の結果を返す
2. useFilteredTimeline: customQuery?.trim() が truthy → 早期リターン（空配列）
3. useFilteredTagTimeline: customQuery?.trim() が truthy → 早期リターン（空配列）
4. useCustomQueryTimeline: customQuery が空 → 早期リターン（空配列）
```

つまり、`customQuery` が設定されている場合は `buildFilterConditions()` は使用されず、ユーザーが記述した WHERE 句のみが適用されます（`onlyMedia` / `minMediaCount` を除く）。

## パフォーマンス考慮事項

### インデックスの活用

各フィルタ条件に対応するインデックスが `schema.ts` で定義されています。

| フィルタ           | 使用されるインデックス                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| メディアフィルタ   | `idx_statuses_media_filter (backendUrl, has_media, created_at_ms DESC)`       |
| 公開範囲フィルタ   | `idx_statuses_visibility_filter (backendUrl, visibility, created_at_ms DESC)` |
| 言語フィルタ       | `idx_statuses_language_filter (backendUrl, language, created_at_ms DESC)`     |
| ブーストフィルタ   | `idx_statuses_reblog_filter (backendUrl, is_reblog, created_at_ms DESC)`      |
| アカウントフィルタ | `idx_statuses_account_acct (account_acct)`                                    |

複数のフィルタが同時に適用される場合、SQLite のクエリプランナーが最適なインデックスを自動選択します。

### LIMIT の精度

SQL レベルでフィルタリングを行うため、`LIMIT 40` を指定すれば必ず条件に合致する 40 件が返ります。

**JS フィルタの場合の問題:**

```
100 件取得 → JS でメディアフィルタ → 5 件しか残らない → 再取得が必要
```

**SQL フィルタの場合:**

```
SQL: WHERE has_media = 1 LIMIT 40 → 必ず 40 件のメディア付き投稿が返る
```

### プリペアドステートメント

すべてのクエリでプリペアドステートメント（`?` プレースホルダー + バインド変数）を使用しています。これにより:

1. **SQL インジェクション防止**: ユーザー入力値が SQL 文に直接埋め込まれない
2. **パフォーマンス**: SQLite がクエリプランをキャッシュ可能
3. **型安全**: バインド変数が適切にエスケープされる

```typescript
// ✅ 安全: プリペアドステートメント
db.exec(sql, { bind: binds, returnValue: "resultRows" });

// ❌ 危険: 文字列結合（使用していない）
db.exec(`SELECT * FROM statuses WHERE account_acct = '${userInput}'`);
```
