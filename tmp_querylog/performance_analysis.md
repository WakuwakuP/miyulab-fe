# タイムライン生成 SQL パフォーマンス分析レポート

## 目次

- [全体サマリー](#全体サマリー)
- [深刻度マトリクス](#深刻度マトリクス)
- [問題 1: posts テーブルの FULL TABLE SCAN](#問題-1-posts-テーブルの-full-table-scan)
- [問題 2: timeline_entries に恒久インデックスが無い](#問題-2-timeline_entries-に恒久インデックスが無い)
- [問題 3: 大量の相関サブクエリ (1行あたり最大24個)](#問題-3-大量の相関サブクエリ-1行あたり最大24個)
- [問題 4: timelineTypes サブクエリのフルスキャン](#問題-4-timelinetypes-サブクエリのフルスキャン)
- [問題 5: post_backend_ids の JOIN が server_id 起点になる](#問題-5-post_backend_ids-の-join-が-server_id-起点になる)
- [問題 6: notifications のソートに TEMP B-TREE が使われる](#問題-6-notifications-のソートに-temp-b-tree-が使われる)
- [問題 7: blocked_instances の LIKE パターンマッチ](#問題-7-blocked_instances-の-like-パターンマッチ)
- [問題 8: 空中リプライクエリの全テーブルスキャン × 時間窓相関](#問題-8-空中リプライクエリの全テーブルスキャン--時間窓相関)
- [問題 9: local_accounts 起点のフルスキャン](#問題-9-local_accounts-起点のフルスキャン)
- [問題 10: GROUP BY / ORDER BY の TEMP B-TREE](#問題-10-group-by--order-by-の-temp-b-tree)
- [クエリ別 影響マップ](#クエリ別-影響マップ)
- [推奨インデックス一覧](#推奨インデックス一覧)
- [構造改善の提案](#構造改善の提案)

---

## 全体サマリー

| 観点 | 状態 |
|------|------|
| 分析対象クエリ数 | 8 |
| 検出した問題数 | 10 |
| 🔴 Critical (即対応推奨) | 3 |
| 🟠 High (早期対応推奨) | 4 |
| 🟡 Medium (改善推奨) | 3 |

全クエリに共通する構造的特徴として、**1つの SELECT 文で投稿のすべての関連データ（メディア・メンション・絵文字・投票・リブログ先の同データ）を相関サブクエリで取得している**点がある。これにより1行あたりの処理コストが極めて高く、駆動表の選択とフィルタリング効率がパフォーマンスに直結する。

---

## 深刻度マトリクス

| # | 問題 | 深刻度 | 影響クエリ | データ増加時の悪化度 |
|---|------|--------|-----------|-------------------|
| 1 | posts FULL TABLE SCAN | 🔴 Critical | home_single, local_single, 空中リプライ | O(n) → テーブル全行 |
| 2 | timeline_entries にインデックス不足 | 🔴 Critical | home, local, public | 毎回 TEMP INDEX 再構築 |
| 3 | 相関サブクエリ ×24/行 | 🟠 High | 全タイムライン系 | O(結果行数 × 24) |
| 4 | timelineTypes フルスキャン | 🟠 High | 全タイムライン系 | O(timeline_entries全行/行) |
| 5 | post_backend_ids の JOIN 方向 | 🟡 Medium | 全クエリ | 接続バックエンド数に依存 |
| 6 | notifications ソート | 🟠 High | notification | O(n log n) TEMP B-TREE |
| 7 | blocked_instances LIKE | 🟡 Medium | home_single_backend | O(blocked行 × 結果行) |
| 8 | 空中リプライ 二重全スキャン | 🔴 Critical | 空中リプライ | O(posts + notifications) |
| 9 | local_accounts 起点スキャン | 🟠 High | home(multi), public | local_accounts 全行 |
| 10 | GROUP BY / ORDER BY TEMP B-TREE | 🟡 Medium | ほぼ全クエリ | 中間結果セット全体 |

---

## 問題 1: posts テーブルの FULL TABLE SCAN

### 深刻度: 🔴 Critical

### 該当クエリ

- **home_and_local_single_backend.txt** (local タイムライン)
- **home_single_backend.txt** (home タイムライン / 単一バックエンド)
- **空中リプライ.txt**

### EXPLAIN の該当箇所

```
-- home_and_local_single_backend.txt / home_single_backend.txt
SCAN p                          ← posts テーブル全行を走査

-- 空中リプライ.txt
SCAN p                          ← 1つ目の UNION ALL メンバー
SCAN n2                         ← 2つ目の UNION ALL メンバー (notifications全行)
```

### 問題の詳細

SQLite のオプティマイザが `posts` テーブル（別名 `p`）を**駆動表**として選択し、全行を走査している。`timeline_entries` との INNER JOIN や `WHERE` 条件でフィルタすべきだが、単一バックエンドのケースでは `local_accounts` テーブルの行が1行しかなく、`IN (?)` の選択性が高いにも関わらず、オプティマイザがそれを活用できていない。

`posts` テーブルはデータが最も多いテーブルであるため、全行走査のコストはデータ量に比例して劣化する。

### 原因の推定

- 単一バックエンドの場合、`IN` 句の値が1つになり、`local_accounts` テーブルとの結合順序の評価が変わる
- `timeline_entries` に `(timeline_key, post_id)` の恒久インデックスが無いため、timeline_entries 起点の結合が選ばれにくい
- SQLite の統計情報がテーブル構造に対して最適な結合順序を導けていない

### 改善案

1. `timeline_entries` に複合インデックスを作成（→ 問題2で詳述）
2. クエリを CTE / サブクエリで分割し、まず `timeline_entries` から対象 `post_id` を特定してから詳細を取得する構造にする

```sql
-- 改善例: まず対象post_idを絞り込み
WITH target_posts AS (
  SELECT DISTINCT te.post_id
  FROM timeline_entries te
  INNER JOIN post_backend_ids pbi ON te.post_id = pbi.post_id
  INNER JOIN local_accounts la ON pbi.local_account_id = la.id
  WHERE te.timeline_key = ?
    AND la.backend_url IN (?)
)
SELECT ...
FROM target_posts tp
INNER JOIN posts p ON p.id = tp.post_id
...
ORDER BY p.created_at_ms DESC
LIMIT ?;
```

---

## 問題 2: timeline_entries に恒久インデックスが無い

### 深刻度: 🔴 Critical

### 該当クエリ

- **home.txt**
- **home_and_local_single_backend.txt**
- **public.txt**

### EXPLAIN の該当箇所

```
-- home.txt
SEARCH te USING AUTOMATIC PARTIAL COVERING INDEX (timeline_key=?)

-- home_and_local_single_backend.txt
BLOOM FILTER ON te (timeline_key=? AND post_id=?)
SEARCH te USING AUTOMATIC PARTIAL COVERING INDEX (timeline_key=? AND post_id=?)
```

### 問題の詳細

`AUTOMATIC PARTIAL COVERING INDEX` は、SQLite がクエリ実行時に**その場で一時的なインデックスを構築**していることを示す。これは毎回のクエリ実行で再構築コストが発生する。`BLOOM FILTER` はその前段の近似フィルタだが、根本的にはインデックスが無いことが問題。

`timeline_entries` はタイムライン系クエリの中核テーブルであり、ここのインデックスが無いことは全体に波及する。

### 改善案

```sql
-- 最優先で作成すべきインデックス
CREATE INDEX idx_timeline_entries_key_post
  ON timeline_entries (timeline_key, post_id);
```

さらに `ORDER BY p.created_at_ms DESC` のソートを回避したい場合:

```sql
-- created_at_ms を含めたカバリングインデックス（要検討）
-- timeline_entries にタイムスタンプ列がある場合
CREATE INDEX idx_timeline_entries_key_created
  ON timeline_entries (timeline_key, created_at_ms DESC, post_id);
```

---

## 問題 3: 大量の相関サブクエリ (1行あたり最大24個)

### 深刻度: 🟠 High

### 該当クエリ

- **全タイムライン系クエリ** (home, local, public, tag, tag_multi)

### EXPLAIN の該当箇所

```
CORRELATED SCALAR SUBQUERY 1   -- backendUrl
CORRELATED SCALAR SUBQUERY 2   -- engagements_csv
CORRELATED SCALAR SUBQUERY 3   -- media_type name (media_json 内部)
CORRELATED SCALAR SUBQUERY 4   -- media_json
CORRELATED SCALAR SUBQUERY 5   -- mentions_json
CORRELATED SCALAR SUBQUERY 6   -- timelineTypes (内部)
CORRELATED SCALAR SUBQUERY 7   -- timelineTypes (外側)
CORRELATED SCALAR SUBQUERY 8   -- belongingTags
CORRELATED SCALAR SUBQUERY 9   -- status_emojis_json
CORRELATED SCALAR SUBQUERY 10  -- account_emojis_json
CORRELATED SCALAR SUBQUERY 11  -- poll_options (poll_json 内部)
CORRELATED SCALAR SUBQUERY 12  -- poll_json
CORRELATED SCALAR SUBQUERY 13-23 -- rb_* (リブログ先の同種データ)
CORRELATED SCALAR SUBQUERY 24  -- spb MIN(server_id)
```

### 問題の詳細

結果の **1行ごと** に最大24個の相関サブクエリが実行される。LIMIT 50 の場合、最大で **50 × 24 = 1,200回** のサブクエリが走る。各サブクエリはインデックスを使っているため個別の実行は速いが、累積コストは無視できない。

特にリブログ（ブースト）ありの投稿では、元投稿とリブログ先の両方についてメディア・メンション・絵文字・投票のサブクエリが走るため、実質的にコストが2倍になる。

### 改善案

#### 短期: CASE WHEN による早期打ち切りの確認

リブログ先のサブクエリは `CASE WHEN rs.id IS NOT NULL` で囲まれており、SQLite が short-circuit 評価するなら非リブログ投稿では実行されない。ただし SQLite のバージョンによって挙動が異なるため、実際のクエリ時間の計測を推奨。

#### 中長期: クエリ分割アーキテクチャ

```
Step 1: メインクエリで post_id リスト + 基本情報を取得 (JOIN のみ)
Step 2: post_id IN (...) で関連データを一括取得
Step 3: アプリケーション側でマージ
```

```sql
-- Step 1: 対象投稿の特定（サブクエリなし）
SELECT p.id, p.created_at_ms, p.reblog_of_post_id, ...
FROM posts p
INNER JOIN timeline_entries te ON ...
WHERE ...
ORDER BY p.created_at_ms DESC
LIMIT 50;

-- Step 2: メディアを一括取得
SELECT pm.post_id, json_group_array(...)
FROM post_media pm
WHERE pm.post_id IN (?, ?, ..., ?)
GROUP BY pm.post_id;

-- Step 2b: メンションを一括取得 (同様のパターン)
-- Step 2c: 絵文字を一括取得 ...
```

---

## 問題 4: timelineTypes サブクエリのフルスキャン

### 深刻度: 🟠 High

### 該当クエリ

- **全タイムライン系クエリ**

### EXPLAIN の該当箇所

```
CORRELATED SCALAR SUBQUERY 7
  CO-ROUTINE (subquery-6)
    SCAN te USING COVERING INDEX sqlite_autoindex_timeline_entries_1
    USE TEMP B-TREE FOR DISTINCT
  SCAN (subquery-6)
```

### 問題の詳細

`timelineTypes` カラムの取得で、各投稿に対して以下のサブクエリが実行される:

```sql
(SELECT json_group_array(tk)
 FROM (SELECT DISTINCT te.timeline_key AS tk
       FROM timeline_entries te
       WHERE te.post_id = p.id))
```

EXPLAIN を見ると、`SCAN te USING COVERING INDEX sqlite_autoindex_timeline_entries_1` となっており、`post_id` でのフィルタが効いていない。`sqlite_autoindex_timeline_entries_1` は `(timeline_key, post_id)` の順序である可能性が高く、`post_id` だけでの検索には使えない。

これが **結果の全行に対して** 実行されるため、`timeline_entries` テーブルが大きくなると深刻なボトルネックになる。

### 改善案

```sql
-- post_id 起点で timeline_key を引けるインデックス
CREATE INDEX idx_timeline_entries_post_key
  ON timeline_entries (post_id, timeline_key);
```

このインデックスがあれば `SEARCH te USING INDEX ... (post_id=?)` に変わり、DISTINCT も小さなセットに対して行われる。

---

## 問題 5: post_backend_ids の JOIN が server_id 起点になる

### 深刻度: 🟡 Medium

### 該当クエリ

- **全クエリ** (`spb` の JOIN)

### EXPLAIN の該当箇所

```
SEARCH spb USING INDEX idx_post_backend_ids_server (server_id=?) LEFT-JOIN
```

### 問題の詳細

`spb`（投稿の代表バックエンドIDを取得する JOIN）が `idx_post_backend_ids_server (server_id=?)` を使っている。このインデックスは `server_id` カラムのみをリーディングキーとしているため、特定のサーバーに紐づく **全ての投稿** のバックエンドIDを返した上で `post_id` でフィルタしている可能性がある。

JOIN 条件は `spb.post_id = p.id AND spb.server_id = (SELECT MIN(...))` だが、`post_id` が先にフィルタされるべき。

### 改善案

```sql
-- post_id → server_id の順序の複合インデックス
CREATE INDEX idx_post_backend_ids_post_server
  ON post_backend_ids (post_id, server_id);
```

既存の `idx_post_backend_ids_post` がカバリングインデックスとして使われている箇所もあるため、既存インデックスとの役割を整理した上で追加すること。

---

## 問題 6: notifications のソートに TEMP B-TREE が使われる

### 深刻度: 🟠 High

### 該当クエリ

- **notification.txt**

### EXPLAIN の該当箇所

```
SCAN n USING INDEX idx_notifications_account_created
...
USE TEMP B-TREE FOR ORDER BY
```

### 問題の詳細

`SCAN n USING INDEX idx_notifications_account_created` は SCAN（走査）であり SEARCH（検索）ではない。インデックスは使われているが、`local_account_id` でフィルタした上での `created_at_ms` 順の走査ではなく、インデックスを順番に全て舐めている可能性が高い。

さらに `ORDER BY n.created_at_ms DESC` に対して `USE TEMP B-TREE FOR ORDER BY` が出現しており、インデックスのソート順が活かされていない。

WHERE 条件 `la.backend_url IN (?,?)` は `local_accounts` テーブル経由の間接フィルタであるため、SQLite が `notifications` 側のインデックスで直接フィルタできない。

### 改善案

1. `local_account_id` を事前に解決して直接フィルタする:

```sql
-- アプリ側で先にlocal_account_idを取得
SELECT id FROM local_accounts WHERE backend_url IN (?, ?);

-- 取得したidで直接フィルタ
SELECT ...
FROM notifications n
WHERE n.local_account_id IN (?, ?)
  AND ...
ORDER BY n.created_at_ms DESC
LIMIT 50;
```

2. インデックスの最適化:

```sql
-- local_account_id + created_at_ms の複合インデックス
CREATE INDEX idx_notifications_account_created_desc
  ON notifications (local_account_id, created_at_ms DESC);
```

---

## 問題 7: blocked_instances の LIKE パターンマッチ

### 深刻度: 🟡 Medium

### 該当クエリ

- **home_single_backend.txt**

### SQL の該当箇所

```sql
AND NOT EXISTS (
  SELECT 1 FROM blocked_instances bi
  WHERE (SELECT acct FROM profiles WHERE id = p.author_profile_id)
    LIKE '%@' || REPLACE(REPLACE(bi.instance_domain, '%', '\%'), '_', '\_') ESCAPE '\'
)
```

### EXPLAIN の該当箇所

```
CORRELATED SCALAR SUBQUERY 29
  SCAN bi USING COVERING INDEX sqlite_autoindex_blocked_instances_1
CORRELATED SCALAR SUBQUERY 28
  SEARCH profiles USING INTEGER PRIMARY KEY (rowid=?)
```

### 問題の詳細

- `blocked_instances` テーブルを **結果行ごとにフルスキャン** している（SCAN）
- `LIKE '%@' || domain` はワイルドカードが先頭にあるため、インデックスが一切効かない
- `profiles` テーブルへの追加サブクエリ（acct取得）が行ごとに発生

### 改善案

1. **アプリケーション側でブロックリストをキャッシュ** し、SQLクエリからは除外する
2. `profiles` テーブルにドメイン部分を分離したカラムを追加する（正規化）:

```sql
-- profiles にドメインカラムを追加
ALTER TABLE profiles ADD COLUMN account_domain TEXT;
CREATE INDEX idx_profiles_domain ON profiles (account_domain);

-- 判定をシンプルに
AND pr.account_domain NOT IN (SELECT instance_domain FROM blocked_instances)
```

3. 短期対策として、`muted_accounts` と同様に acct ベースで事前解決:

```sql
-- ブロックドメイン一覧を先に取得しアプリ側でフィルタ
SELECT instance_domain FROM blocked_instances;
```

---

## 問題 8: 空中リプライクエリの全テーブルスキャン × 時間窓相関

### 深刻度: 🔴 Critical

### 該当クエリ

- **空中リプライ.txt**

### EXPLAIN の該当箇所

```
-- 1つ目の UNION ALL メンバー
SCAN p                          ← posts 全行スキャン
  CORRELATED SCALAR SUBQUERY 7
    SEARCH ntf USING INDEX idx_notifications_actor (actor_profile_id=?)
    CORRELATED SCALAR SUBQUERY 6   ← 時間窓内の最小created_at_msを求めるサブクエリ
      SEARCH p2 USING INDEX idx_posts_author (author_profile_id=?)

-- 2つ目の UNION ALL メンバー
SCAN n2                         ← notifications 全行スキャン
  SCAN p LEFT-JOIN              ← 空のマテリアライズドテーブル
```

### 問題の詳細

このクエリは**最も深刻なパフォーマンス問題**を抱えている:

1. **`posts` テーブルの全行スキャン**: UNION ALL の1つ目のメンバーで `posts` を全行走査し、各行に対して通知との時間窓（180秒）相関を確認する
2. **`notifications` テーブルの全行スキャン**: UNION ALL の2つ目のメンバーで全通知を走査
3. **多重ネストの相関サブクエリ**: 時間窓の判定に `EXISTS` → `notifications` 検索 → `MIN(created_at_ms)` の3段階ネスト
4. **空のマテリアライズドテーブル**: `LIMIT 0` で空テーブルを生成して LEFT JOIN している箇所が複数あり、クエリビルダーの構造的制約と思われるが無駄なオーバーヘッドがある

計算量は概算で **O(|posts| × |notifications_per_author|)** + **O(|notifications|)** であり、両テーブルの増加とともに急激に悪化する。

### 改善案

#### 根本改善: マテリアライズドビューまたはイベントテーブル

空中リプライの判定は INSERT 時に行い、専用テーブルに結果を格納する:

```sql
CREATE TABLE aerial_replies (
  post_id INTEGER PRIMARY KEY,
  notification_id INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_aerial_replies_created
  ON aerial_replies (created_at_ms DESC);
```

投稿の挿入時・通知の挿入時に180秒窓の判定を行い、該当すれば `aerial_replies` に INSERT する。

#### 短期改善: 時間範囲の制限

全件スキャンを避けるため、最低限の時間範囲制限を追加する:

```sql
-- 例: 直近24時間に限定
WHERE p.created_at_ms > ? -- (現在時刻 - 24h)
  AND ...
```

```sql
CREATE INDEX idx_posts_created
  ON posts (created_at_ms DESC);
```

---

## 問題 9: local_accounts 起点のフルスキャン

### 深刻度: 🟠 High

### 該当クエリ

- **home.txt** (マルチバックエンド)
- **public.txt**

### EXPLAIN の該当箇所

```
SCAN la
SEARCH te USING AUTOMATIC PARTIAL COVERING INDEX (timeline_key=?)
SEARCH p USING INTEGER PRIMARY KEY (rowid=?)
```

### 問題の詳細

SQLite のオプティマイザが `local_accounts`（別名 `la`）を駆動表として選択し、全行スキャンしている。`la.backend_url IN (?, ?)` のフィルタは `SCAN` の中で行われるが、`local_accounts` の行数が多い場合には非効率。

その後 `timeline_entries` に AUTOMATIC PARTIAL COVERING INDEX で検索し、`posts` を PRIMARY KEY で引いている。`local_accounts` → `timeline_entries` → `posts` の結合順序は一見合理的だが、`local_accounts` の起点がフルスキャンである点が問題。

### 改善案

```sql
-- backend_url にインデックスを作成
CREATE INDEX idx_local_accounts_backend_url
  ON local_accounts (backend_url);
```

これにより `SCAN la` が `SEARCH la USING INDEX idx_local_accounts_backend_url (backend_url=?)` に変わる。

---

## 問題 10: GROUP BY / ORDER BY の TEMP B-TREE

### 深刻度: 🟡 Medium

### 該当クエリ

- **ほぼ全クエリ**

### EXPLAIN の該当箇所

```
USE TEMP B-TREE FOR GROUP BY
USE TEMP B-TREE FOR ORDER BY
```

### 問題の詳細

多くのクエリで `GROUP BY p.id` と `ORDER BY p.created_at_ms DESC` の両方にテンポラリ B-TREE が使われている。これは中間結果セットをメモリ上（またはディスク上）でソートすることを意味する。

LIMIT 50 に対して、GROUP BY 前の中間結果がどれだけ大きいかによってコストが変わる。`post_backend_ids` との LEFT JOIN により1投稿が複数行に膨らんだ後に GROUP BY で集約しているため、中間結果は実際の投稿数よりも大きくなる。

### 改善案

1. `post_backend_ids` との重複 JOIN を整理する（`pb`, `spb`, `pbi` の3回 JOIN されている）
2. サブクエリで先に対象 post_id を LIMIT 付きで確定し、外側で詳細を取得する構造にすれば GROUP BY 自体が不要になる

---

## クエリ別 影響マップ

| 問題 | home (multi) | home (single) | local (single) | public | tag | tag_multi | notification | 空中リプライ |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1. posts SCAN | | ✅ | ✅ | | | | | ✅ |
| 2. timeline_entries INDEX 不足 | ✅ | ✅ | ✅ | ✅ | | | | |
| 3. 相関サブクエリ ×24 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | |
| 4. timelineTypes SCAN | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | | |
| 5. post_backend_ids JOIN方向 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | | |
| 6. notifications ソート | | | | | | | ✅ | |
| 7. blocked_instances LIKE | | ✅ | | | | | | |
| 8. 空中リプライ全スキャン | | | | | | | | ✅ |
| 9. local_accounts SCAN | ✅ | | | ✅ | | | | |
| 10. GROUP BY/ORDER BY TEMP | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## 推奨インデックス一覧

優先度順に列挙する。

### 最優先 (🔴)

```sql
-- 1. timeline_entries の複合インデックス（問題2, 4の解消）
CREATE INDEX idx_timeline_entries_key_post
  ON timeline_entries (timeline_key, post_id);

CREATE INDEX idx_timeline_entries_post_key
  ON timeline_entries (post_id, timeline_key);

-- 2. posts の created_at_ms インデックス（問題1, 8のソート最適化）
CREATE INDEX idx_posts_created_desc
  ON posts (created_at_ms DESC);
```

### 高優先 (🟠)

```sql
-- 3. local_accounts の backend_url インデックス（問題9の解消）
CREATE INDEX idx_local_accounts_backend_url
  ON local_accounts (backend_url);

-- 4. notifications の最適化インデックス（問題6の解消）
CREATE INDEX idx_notifications_account_type_created
  ON notifications (local_account_id, notification_type_id, created_at_ms DESC);
```

### 通常優先 (🟡)

```sql
-- 5. post_backend_ids の複合インデックス（問題5の解消）
CREATE INDEX idx_post_backend_ids_post_server
  ON post_backend_ids (post_id, server_id, local_account_id);

-- 6. profiles のドメインカラム追加検討（問題7の解消）
```

---

## 構造改善の提案

### 提案A: クエリ分割パターン（短期〜中期）

現在の「1つの巨大SELECTで全データを取得」するパターンから、「対象IDの特定」→「詳細の一括取得」に分割する。

```
[現在]
1クエリ = 駆動表スキャン + 12テーブルJOIN + 24相関サブクエリ

[改善後]
Query 1: 対象 post_id を50件取得（JOINは最小限）
Query 2: post_media を一括取得 (WHERE post_id IN (...))
Query 3: post_mentions を一括取得
Query 4: post_custom_emojis を一括取得
Query 5: polls + poll_options を一括取得
→ アプリ側でマージ
```

メリット:
- 各クエリがシンプルになり、インデックスが効きやすい
- 相関サブクエリが無くなるため、1行あたりのコストが一定
- 個別にキャッシュ可能

デメリット:
- アプリケーションコードの複雑化
- ラウンドトリップの増加（ただしローカルSQLiteなら無視できる）

### 提案B: post_backend_ids JOIN の整理（短期）

現在のタイムライン系クエリでは `post_backend_ids` が3つの別名で JOIN されている:

| 別名 | 目的 | 種別 |
|------|------|------|
| `pb` | 不明（SELECT句で未使用の場合あり） | LEFT JOIN |
| `spb` | 代表バックエンドIDの取得 | LEFT JOIN + サブクエリ |
| `pbi` | backend_url でのフィルタ | LEFT JOIN → INNER JOIN相当 |

`pb` が SELECT 句で使われていない場合は削除可能。`spb` と `pbi` を統合できないか検討する。これにより `GROUP BY` が不要になる可能性がある。

### 提案C: 空中リプライの事前計算（中長期）

問題8で述べた通り、空中リプライの判定を投稿/通知の INSERT 時にトリガーまたはアプリケーションロジックで行い、専用テーブルに格納する。クエリは単純な `SELECT ... ORDER BY created_at_ms DESC LIMIT 50` になる。

---

> **注記**: 本分析は EXPLAIN QUERY PLAN の出力に基づく静的分析である。実際のパフォーマンスはデータ量・データ分布・SQLiteのバージョン・キャッシュ状態に依存するため、改善後は必ず実測での検証を推奨する。
