# ローカルDB パフォーマンス調査・改善案

- 調査日: 2026-09-30
- 対象コミット: `2b95af10f200c093f407f920ab79135a8b053d06`
- 対象: ブラウザ内 SQLite WASM / OPFS、Worker RPC、Query IR V2、タイムライン更新通知
- スキーマ: `2.0.7`。説明ドキュメントの一部は `2.0.5` 等の旧状態を記述しているため、判断は現行実装を優先した。
- 実施範囲: 実装追跡、隔離した再現検証、改善案の整理まで。アプリ実装・スキーマ・設定の修正は行っていない。

## 1. 結論

今回特定した問題は、SQLite WASM自体の速度ではなく、**実行順序・SQLとインデックスの不一致・更新処理の増幅**にある。

まず対応すべきものは、(1) 緊急クリーンアップの削減目標がバッチごとに動く問題、(2) 投稿削除の未索引FK、(3) URI検索の部分インデックス条件漏れ、(4) SQL実行後に行われるキャッシュ判定である。

緊急クリーンアップは性能問題に加えてキャッシュ履歴を意図以上に失う問題を伴う。今回、**実ユーザーのローカルDBにはアクセスしておらず、実データの削除は行っていない**。

### 優先順位

P0は意図しない削減を防ぐ最優先、P1は主要読み書き経路の不要処理、P2は長時間利用・大量データ時の改善対象。実測ミリ秒による順位ではなく、実行頻度・増幅構造・安全性に基づく判断である。

| ID | 優先度 | 問題 | 根拠の種類 |
|---|---|---|---|
| F1 | P0 | 緊急cleanupで「残す50%」を毎バッチ再計算 | 現行ハンドラを実DBで再現 |
| F2 | P1 | posts削除時、display_post_idの未索引FKがtimeline_entriesを走査 | 現行スキーマ＋EXPLAIN QUERY PLAN |
| F3 | P1 | 頻出URI検索が部分インデックスを利用できずpostsをSCAN | 現行スキーマ＋同一SQLの実行計画 |
| F4 | P1 | get-ids / lookup-relatedのキャッシュ判定がSQL実行後 | 現行グラフ実行のSQL回数を観測 |
| F5 | P1 | テーブル別通知が同じパネルの余分な再取得を発生させる | 通知3回を再現、controllerの制御を追跡 |
| F6 | P1 | 同一投稿の再受信でも関連データを再書き込み・広範囲無効化 | 現行書き込み経路を確認、時間寄与は未測定 |
| F7 | P2 | 1件のinteraction変更で蓄積済みリスト相当を再取得 | 現行hook/helperを確認、時間寄与は未測定 |
| F8 | P2 | WorkerノードキャッシュとdurationMapが上限なく蓄積 | 現行クラス・handlerで保持件数を再現 |
| F9 | P2 | cleanupの全体時刻順と既存複合インデックスが不一致 | 現行スキーマ＋実行計画で追加ソート確認 |

**確定した構造上の無駄と、実ブラウザ上でどれが支配的かは別問題である。改善率・体感遅延・OPFSの実時間は今回測定していない。**

## 2. 追跡した実行経路

### 書き込みと通知

```text
WebSocket update
  → setupStreamHandlers.ts
  → statusStore.upsertStatus
  → 100ms / 20件のマイクロバッチ（backendUrl・timelineType・tag別）
  → Worker other queue
  → handleBulkUpsertStatuses
  → 各投稿をSAVEPOINTで隔離して正規化テーブルへ書き込み
  → changedTablesを返しテーブルversionを更新
  → messageHandlerがテーブルごとにnotifyChange
  → connectionの80ms通知バッチ（飽和時300ms）
  → パネルのテーブル別subscribe
  → streaming controller
  → 再取得
```

関連: [stream handlers](../src/util/streaming/setupStreamHandlers.ts)、[status store](../src/util/db/sqlite/stores/statusStore.ts)、[worker handlers](../src/util/db/sqlite/worker/handlers/statusHandlers.ts)、[通知](../src/util/db/sqlite/connection.ts)。

### タイムライン読み込み

```text
useTimelineDataSource.fetchPage
  → configToQueryPlanV2 / cursor・limitパッチ
  → executeGraphPlan RPC（timeline queue、同時実行1件）
  → Workerでget-ids → lookup/merge → output
  → 投稿詳細と関連テーブル8種のbatch、または通知詳細
  → postMessage
  → メインスレッドでEntity構築・リストmerge
```

関連: [data source](../src/util/hooks/useTimelineDataSource.ts)、[graph executor](../src/util/db/query-ir/executor/graphExecutor.ts)、[output executor](../src/util/db/query-ir/executor/outputExecutor.ts)、[queue](../src/util/db/sqlite/workerClient/queueManager.ts)。

### cleanup

```text
起動120秒後 / 10分周期、または飽和が5秒継続
  → enforceMaxLength（priority queue）
  → timeline / notificationの超過削減
  → postsの孤立削除・関連テーブルFK処理
  → hasMoreなら次バッチ（最大100回）
```

既定上限はtimeline_entries 100,000件、notifications 10,000件、posts 100,000件。1バッチはtimeline＋notification側2,000件、posts側にも別に2,000件の枠がある。これらは現行設定の記載であり、変更していない。

## 3. 問題の詳細と改善案

### F1. 緊急cleanupの削減目標がバッチごとに縮む

**箇所**

- [cleanup.ts](../src/util/db/sqlite/cleanup.ts) L277–323: `hasMore`中は同じ`targetRatio`で繰り返す。
- [workerCleanup.ts](../src/util/db/sqlite/worker/workerCleanup.ts) L148–157、209–217、295–304: 各呼び出しで現在件数を数え、`floor(cnt * targetRatio)`を新たな目標にする。
- [同ファイル](../src/util/db/sqlite/worker/workerCleanup.ts) L429–460、518–529: 削除残量やバッチ枠の消費により継続する。

**問題・影響**

最初の件数の半分を固定目標として残すのではなく、削除後の件数の半分が次の目標になる。複数バッチが必要な場合に目標を通り越して削除を続け、SELECT・DELETE・FK処理・通知の総量が増える。priority queueなので読み書きを待たせる条件にもなる。

**再現結果**

実スキーマに各8件を入れ、`emergency / targetRatio=0.5 / batchLimit=2`で現行ハンドラを`hasMore=false`まで実行した。8バッチで終了した。

| バッチ | timeline_entries | notifications | posts | hasMore |
|---|---:|---:|---:|---|
| 初期 | 8 | 8 | 8 | — |
| 1 | 6 | 8 | 8 | true |
| 2 | 4 | 8 | 8 | true |
| 3 | 2 | 8 | 8 | true |
| 4 | 1 | 7 | 7 | true |
| 5 | 0 | 6 | 6 | true |
| 6 | 0 | 4 | 4 | true |
| 7 | 0 | 2 | 2 | true |
| 8 | 0 | 1 | 1 | false |

「常に全件が消える」とは断定しない。結果はバッチ枠、参照関係、途中の流入で変わるが、開始時の半分を保持する保証はない。

**改善案**

cleanup開始時に対象テーブルごとの削減目標を一度だけ決め、全バッチで固定する。終了条件を固定目標への到達・削除可能行の枯渇に合わせる。`posts`の参照保護は維持する。性能改善より先に、バッチ分割しても保持目標を下回らない契約を追加する。

**改善後の検証**

小さいbatchLimitと既定値の双方、参照付きposts、継続中の追加投稿を対象に、固定目標未満まで削減しないことと有限回で停止することを確認する。

### F2. posts削除のFK処理に未索引display_post_idがある

**箇所**

- [timeline schema](../src/util/db/sqlite/schema/tables/timeline.ts) L10–15: `display_post_id REFERENCES posts(id) ON DELETE SET NULL`。
- 同ファイルL19–31: 索引はfeed用と`post_id`用で、`display_post_id`用がない。
- [cleanup worker](../src/util/db/sqlite/worker/workerCleanup.ts) L343–358: postsをバッチ削除する。
- [worker init](../src/util/db/sqlite/worker/workerInit.ts) L18–24: 外部キーを有効化。

**問題・影響**

孤立投稿の選別JOINに索引があっても、DELETEに付随する子テーブルFKの探索は別である。投稿1件ごとの参照確認・SET NULL対象探索でtimeline_entriesを走査し得る。posts削除件数をD、timeline_entries件数をTとすると、この部分の仕事量が概ねD×Tに増え得る。

**再現結果**

現行スキーマ・foreign_keys=ONで`EXPLAIN QUERY PLAN DELETE FROM posts WHERE id = ?`を実行すると、`post_id`側の`SEARCH ... idx_timeline_entries_post`とは別に**`SCAN timeline_entries`**が出る。`WHERE display_post_id = ?`単独でもSCANを確認した。EXPLAINのみで実投稿の削除は行っていない。

**改善案**

`timeline_entries(display_post_id)`の索引を追加する。NULLを除く部分索引も候補だが、FKの生成SQLで確実に利用されることをEXPLAINで確認する。fresh schemaと既存DBのmigrationの両方に入れる。既存`idx_timeline_entries_post`の代替にはしない。

**改善後の検証**

実DELETEの実行計画でSCANが消えること、参照あり/なしの両方でSET NULLとCASCADEの意味が保たれること、大量データのpostsDelete時間が減ることを確認する。

### F3. URI検索の条件が部分インデックスと合っていない

**箇所**

- [posts schema](../src/util/db/sqlite/schema/tables/posts.ts) L36–38: `object_uri != ''`の行のみを含むUNIQUE索引。
- [statusHandlers.ts](../src/util/db/sqlite/worker/handlers/statusHandlers.ts) L152–160、237–256: URI検索をlocal ID検索より先に実行。バッチ内uriCacheにない投稿で通る。
- [postSync.ts](../src/util/db/sqlite/worker/handlers/postSync.ts) L239–248: リブログ元も同じ検索。
- [statusUpdateHandler.ts](../src/util/db/sqlite/worker/handlers/statusUpdateHandler.ts) L44–54、[workerNotificationStore.ts](../src/util/db/sqlite/worker/workerNotificationStore.ts) L134–140にも同形の検索。

**問題・影響**

JavaScriptでURIが非空だと確認しても、SQLの`WHERE object_uri = ?`だけでは部分索引の非空条件をSQLiteが利用できない。新規投稿・別バッチの再受信・新しいURIごとに蓄積済みpostsを走査する。バッチ内のuriCacheは別バッチや新規URIのSCANを避けない。

**再現した実行計画**

```sql
SELECT id, is_reblog FROM posts WHERE object_uri = ?;
-- SCAN posts

SELECT id, is_reblog FROM posts
WHERE object_uri = ? AND object_uri != '';
-- SEARCH posts USING INDEX idx_posts_object_uri (object_uri=?)
```

非空URIを入力した2つのクエリは同じ結果になった。アプリのSQLは変更していない。

**改善案**

非空URIの検索に`AND object_uri != ''`を明示する形を共通化し、書き込み・編集・通知・リブログ元の経路を揃える。`resolveRepostOfPostId`には既にこの形がある。空URIはリブログ重複処理で意味があるため、空URIの検索へ一律適用したり、部分UNIQUEを通常UNIQUEへ置き換えたりしない。

**改善後の検証**

sqlite-wasm実機でも同じbindでSEARCHになること、新規URI・既存URI・空URI・リブログ重複の意味が変わらないことを確認する。

### F4. キャッシュヒットでも先にSQLを実行している

**箇所**

- [graphExecutor.ts](../src/util/db/query-ir/executor/graphExecutor.ts) L171–190: `executeGetIds`の後に`cache.get`。
- 同ファイルL221–244: `executeLookupRelated`も同じ順序。
- [getIdsExecutor.ts](../src/util/db/query-ir/executor/getIdsExecutor.ts) L334–356、[lookupRelatedExecutor.ts](../src/util/db/query-ir/executor/lookupRelatedExecutor.ts) L232–244、429–441で実際にSQLと行変換を実行。

**問題・影響**

`cacheHit=true`でもDBアクセス、結果配列の生成、ハッシュ生成は済んでいる。変更のないノードをキャッシュで省略する設計になっていない。lookupに時間窓・ウィンドウ関数等がある場合も、その仕事を毎回行う。

**再現結果**

`get-ids(posts) → lookup-related(notifications) → output(notifications)`のグラフをDB変更なしで2回実行した。2回目のsourceとlookupは両方`cacheHit=true`だが、SQLは**3本**実行された。内訳はID取得、lookup、通知詳細。後者の詳細取得は必要であり、改善で省く対象は前2本。

**改善案**

SQL生成とDB実行を分離し、`SQL＋binds＋upstreamHash`を生成した時点でキャッシュを見る。get-idsは既存`compileGetIds`を利用できる。lookup側もコンパイルと実行を分離する。ヒットなら必要な出力メタデータをキャッシュ由来で復元し、DBを呼ばない。

キャッシュ前倒し時は依存テーブルと上流変更の無効化が正しいことを必ず検証する。Workerだけでなく、同じexecutorを使うmain-thread fallbackの無効化も整える。SQL実行を消すだけで古い結果を返す変更にしない。

**改善後の検証**

グラフのcold/warmを実行し、warm時に対象2ノードのSQLが0本になること、関連テーブルの変更後には再実行されて結果が更新されることを確認する。UIのcacheHit率だけを成功条件にしない。

### F5. 同じ通知バッチがパネルを繰り返し再取得させる

**箇所**

- [messageHandler.ts](../src/util/db/sqlite/workerClient/messageHandler.ts) L62–69: 同一enrichedHintをchangedTablesの各テーブルへ配信。
- [connection.ts](../src/util/db/sqlite/connection.ts) L107–123: debounce後もテーブルごとにcallbackを実行。
- [useTimelineDataSource.ts](../src/util/hooks/useTimelineDataSource.ts) L133–149、237–260: posts、post_interactions、timeline_entries等を個別購読。
- [streaming controller](../src/util/hooks/timelineList/useTimelineStreamingController.ts) L64–94、111–124: 最初の通知で直ちにfetchし、続く通知を保留して完了後に再fetch。

**問題・影響**

同一書き込みが購読テーブル3種を変更すると、1回の通知flushで3callbacksになることを再現した。通常の初期化済み・scrollbackなしのパネルでは、最初でfetch開始、残りでcoalescedChangedTables設定、完了後にもう1回fetchする経路になる。コアレッシングにより3回のfetchにはならないが、同じ書き込みに対する余分な2回目は残る。

callback回数は再現済み。React実機でのfetch回数・時間は未計測であり、上記2回の経路はコード追跡による結論である。scrollback中・初期化前などは挙動が異なる。

sessionTagによる置換は待機中のみが対象で、既に開始済みのfetchを止めない。またgraph RPCは通常SQLのdedup対象に含まれない。

**改善案**

パネル単位で同じ通知flushのchangedTablesをまとめ、flush内でfetchは1回だけ起動する。connectionのbatch購読API、またはパネルcallbackのmicrotask集約などで通知世代を区別する。実行中に別世代の変更が来た場合の追随fetch、hintlessの全体無効化、scrollback中の保留は維持する。

**改善後の検証**

同一バッチで3テーブル変更→fetch1回、fetch中に後続の別バッチ→追加fetch1回、hintless混在→安全な全体再取得、を確認する。

### F6. 同一投稿の再受信でも関連データ全体を再同期する

**箇所**

- [statusHandlers.ts](../src/util/db/sqlite/worker/handlers/statusHandlers.ts) L286–337、435–450、453–497、591–636。
- [postSync.ts](../src/util/db/sqlite/worker/handlers/postSync.ts) L94–146: mediaはDELETE＋INSERT。L153–197: statsを無条件UPSERT。
- [profile.ts](../src/util/db/sqlite/helpers/profile.ts) L98–153、[emoji.ts](../src/util/db/sqlite/helpers/emoji.ts) L31–51: IDキャッシュがあってもプロフィール・絵文字UPSERTは先に実行。
- [interaction.ts](../src/util/db/sqlite/helpers/interaction.ts) L60–77: favourite/reblog/bookmarkをそれぞれUPSERT。
- [workerMessageHelpers.ts](../src/util/db/sqlite/worker/workerMessageHelpers.ts) L15–16: collectorの全changedTablesでversionを更新。

**問題・影響**

同一投稿がhome/local/tag等で再受信されても、本文・プロフィール・stats・media・mentions・絵文字・tags等を再同期する。既存と同じ値、空の関連配列、INSERT OR IGNOREが実際には追加しない場合もcollectorへテーブルを追加する箇所がある。

結果としてSQL prepare/実行・索引更新・OPFS書き込みの機会が増え、関係するノードキャッシュも広く無効化される。テーブルversionはアカウント・投稿単位ではないため、別アカウントの変更も依存するキャッシュを無効化する。

既存のマイクロバッチはトランザクション回数を削減しているが、各投稿の再同期量を削減してはいない。scrollbackの`skipProfileUpdate=true`は既に存在する最適化で、通常ストリームの全同期問題とは分けて扱う。

**改善案**

投稿本文・統計・アカウント別interaction・関連配列を別の更新単位にし、同じ値の再同期を避ける。media/poll options等は変更時のみ差分更新または置換する。同じ受信データの複数timelineへの所属登録と、投稿本体の更新を分離する。

`changedTables`は必要な内容変化を反映し、IGNORE/空DELETE等の無変更で不必要にversionを進めない。SQLiteの`changes()`は同値UPDATEでも更新件数として数える場合があるため、それだけでは内容差分の判定にならない。鮮度時刻・編集・投票・リアクション・最近のローカル操作保護は落とさない。

**改善後の検証**

同一payload再受信、別timelineへの追加、statsのみ変更、編集、interaction変更を分け、SQL回数・実変更数・version・表示鮮度を確認する。OPFS上の寄与は実測が必要。

### F7. interaction1件の変更で大きく育ったリストを再取得する

**箇所**

- [interactionHandlers.ts](../src/util/db/sqlite/worker/handlers/interactionHandlers.ts) L150–175: アクション変更で`post_interactions`を通知。
- [streamingHelpers.ts](../src/util/hooks/timelineList/streamingHelpers.ts) L64–83: interactionのみの変更はカーソルなし、`limit=max(pageSize, sortedItems.length+pageSize)`。
- [reducer.ts](../src/util/hooks/timelineList/reducer.ts) L155–183: 蓄積済みitems全体を保持しmerge後に再ソート。
- [outputExecutor.ts](../src/util/db/query-ir/executor/outputExecutor.ts) L150–190、[statusBatch.ts](../src/util/db/sqlite/queries/statusBatch.ts) L143–246: 投稿本体と8種の関連データを取得。

**問題・影響**

50件単位のページングでも、スクロールバックで蓄積した件数に応じて1回のinteraction更新の取得件数が増える。対象投稿のinteractionだけでなく、投稿詳細・関連テーブル・Worker転送・Entity構築までまとめてやり直す。複数パネルで同じbackendを表示している場合は各パネルで発生し得る。

これは古い投稿の操作状態を新規投稿用カーソルで落とさないための処理であり、単純にカーソルを復活させたり50件に固定したりすると鮮度を壊す。

**改善案**

変更した内部post ID群を通知に持たせ、表示済み対象のinteractionを更新する。必要ならQuery IRのID指定による部分再取得を用意し、SQLiteを正とするデータフローは維持する。リブログ元・同一投稿の別表現・複数アカウントを含む関連IDを漏らさない。

**改善後の検証**

古い表示投稿への操作、リブログ、複数パネル、interactionがフィルタ条件である場合の追加/除外も確認する。表示蓄積件数を増やしたときのSQL行数・転送量・UI処理時間を比較する。

### F8. キャッシュと計測Mapが長時間利用で蓄積する

**A: Workerノードキャッシュ**

[workerNodeCache.ts](../src/util/db/query-ir/executor/workerNodeCache.ts) L31–38、50–87、90–102。

キーにbinds/cursorを含むMapで、上限・TTL・LRUがない。version更新時も、そのキーを次にgetするまで古いentryを保持する。時刻カーソルが前進して使わなくなったキーは参照されず残る。200種のキーを作りversionを進めて別キーを保存すると、entryは201件のまま残ることを確認した。

**B: durationForId**

[messageHandler.ts](../src/util/db/sqlite/workerClient/messageHandler.ts) L71–74でduration付き成功レスポンスをすべて保存するが、[publicApi.ts](../src/util/db/sqlite/workerClient/publicApi.ts) L184–190で消費・削除するのは`execAsyncTimed`。graph/flatFetch/通常execの取得では消費しない。通常のduration付きレスポンス200件を処理後、pending=0でもdurationMap=200を確認した。

**改善案**

ノードキャッシュに件数/行数/バイト予算による上限を設け、LRU等で旧cursorキーを退避する。version更新による古いentryの回収も行う。durationは必要なリクエストだけに保存するか、Promiseのレスポンスに含め、共有Mapへ残さない。Worker終了時の清掃も対象とする。

**改善後の検証**

多数のcursor、設定切替、version更新、Worker終了、通常/Timed RPC混在で保持上限を確認する。今回の件数検証はヒープのMB量やGC停止時間の測定ではない。

### F9. cleanupの全体時刻順に対応する索引がない

**箇所**

- [workerCleanup.ts](../src/util/db/sqlite/worker/workerCleanup.ts) L170–177、229–236: テーブル全体から時刻ASCの上位を削除。
- [timeline schema](../src/util/db/sqlite/schema/tables/timeline.ts) L19–22: `(local_account_id, timeline_key, created_at_ms DESC)`。
- [notification schema](../src/util/db/sqlite/schema/tables/notifications.ts) L24–29: アカウントを先頭にした複合索引。

**問題・再現結果**

現行cleanupのサブクエリ`SELECT id ... ORDER BY created_at_ms ASC LIMIT ?`は、両テーブルとも索引全体のSCANに加えて**`USE TEMP B-TREE FOR ORDER BY`**になった。batchLimitは削除行数を制限するが、候補を選ぶための走査・ソートまでは制限しない。複数バッチで再び同じ選別をする。

**改善案**

全体時刻順の索引`(created_at_ms, id)`等を検討し、選別を軽くする。アカウント別feed索引は通常の読み込みに必要なので削除しない。索引追加による書き込みコストと削除頻度のトレードオフを確認する。F1/F2を直した上で、cleanupをpriorityで連続実行する時間予算・譲り方も検討する。

**改善後の検証**

候補SELECTから追加ソートが消えること、古い順の保持ポリシーが変わらないこと、cleanup中のtimeline queue待ち時間を確認する。

## 4. 計測の見落としと、まだ断定しない項目

### 現行の計測だけでは見落とすもの

- [useTimelineDataSource.ts](../src/util/hooks/useTimelineDataSource.ts) L197–219で返すdurationはWorkerの`meta.totalDurationMs`。キュー待ち、postMessageの転送、メインスレッドのEntity構築・React更新を含まない。
- [graphExecutor.ts](../src/util/db/query-ir/executor/graphExecutor.ts) L294–304ではtotalDurationMsの算出後にnodeOutputIdsを構築するため、その出力準備分も外れる。
- Workerの通常exec / execBatchは[workerExecHandlers.ts](../src/util/db/sqlite/worker/workerExecHandlers.ts) L10–28のslow SQL loggerを通るが、graphのSQLと専用書き込みhandlerは直接db.execを使い、このloggerを通らない。全ノードが短くてもSQL総本数や重複fetchで遅いケースを切り分けにくい。
- `cacheHit=true`はF4の通りDB実行を省いたことの証拠にならない。

**必要な観測**: queue待ち・Worker時間・SQL本数/行数・通知世代ごとのfetch回数・転送サイズ・Entity構築時間・実heap・cleanup phaseTimingsを分けて集計する。SQLログでトークンや本文等の個人情報を露出しない。

### 未測定の仮説・改善を急がない項目

- 通知の相関JSONサブクエリ、Phase2のpb/spb JOIN＋GROUP BYによる行の増幅、lookupのROW_NUMBER/時間窓がどの程度支配的かは、実データ分布とプランごとのEXPLAIN/計測が必要。
- prepared statement再利用、cache_sizeの増減、ANALYZE/PRAGMA optimizeの効果は未測定。F3のような部分索引条件漏れを統計調整だけで解決できるとはしない。
- initはWAL等のPRAGMAを要求するが、実際のVFSでの有効値は確認していない。SAH Poolか通常OPFSか、journal_modeの実値を記録して比較する。WALが必ず有効という前提で改善案を組まない。
- 通常のget-idsにはOutputのlimitが伝わっている（graphExecutor L336–339、getIdsExecutor L297）。「毎回全IDを無制限取得している」とは判断していない。SCANは戻り行数の無制限とは別である。
- 既に存在するマイクロバッチ、8種のbatch読取、cursor push-down、queue上限/飽和debounceは維持すべき最適化。取り除いて性能を改善する方針ではない。

## 5. 改善の実施順序

1. **保持契約を固定**: F1の固定目標と停止条件。テストで意図以上に削減しないことを先に保証する。
2. **既存SQLが索引を使えるようにする**: F3の非空URI条件、F2のFK索引。fresh schema / migration / fallbackの整合を保つ。
3. **不要な読取を削減**: F4のcache-before-exec、F5の通知世代単位の集約。無効化・後続変更の取りこぼしを同時検証する。
4. **書き込みとinteraction更新を狭くする**: F6・F7。投稿やアカウントの同一性、編集・統計・操作状態の鮮度を維持する。
5. **長時間利用とcleanupを整える**: F8の保持上限、F9の時刻索引/時間予算。実ブラウザで効果を判断する。

実装段階では、アカウント数・パネル数・データ量・受信頻度を固定した合成データで変更前後を比較する。通常OPFS/SAH Pool、低負荷/バースト、初期表示/streaming/scrollback/interaction/cleanupを分け、p50/p95・最大値、SQL回数、queue待ち、メモリを記録する。環境差のあるNode測定をそのままブラウザの性能値として提示しない。

## 6. 今回の検証と限界

### 実行環境

- Node: `v24.21.0`
- native SQLite (`node:sqlite`): `3.53.4`
- Vitest: `4.1.10`
- OS: Windows
- アプリの依存指定: `@sqlite.org/sqlite-wasm ^3.53.0-build1`

現行のcreateFreshSchemaとexecutor/handlerを使う、各テスト専用のインメモリDBで検証した。内部モジュールをモックせず、db.execアダプタで実SQLの呼び出しを記録した。通知検証にはVitestのfake timerを使った。

### 実行コマンド

```bash
yarn test:run src/util/db/sqlite/__tests__/localDbPerformanceAudit.test.ts src/util/db/query-ir/__tests__/workerNodeCache.test.ts src/util/db/query-ir/__tests__/getIdsExecutor.test.ts src/util/db/sqlite/__tests__/changeHint.test.ts
```

最終結果は**4ファイル・95 tests passed**。内訳は今回のcharacterization probe 7件、既存WorkerNodeCache 54件、getIdsExecutor 29件、changeHint 5件。既存88件の成功は今回の性能問題がないことを意味しない。

最初のprobe実行は6件成功・1件失敗だった。緊急cleanupの終了状態を「全表0件」と置いた検証側の想定が誤り、実際は`0/1/1`だった。現行の終了条件と参照関係を確認しアサーションを修正して再実行した。アプリの挙動は一切変更していない。

### 証拠の要約（固定結果）

| 検証 | 観測 |
|---|---|
| 同じグラフを再実行 | source/lookupともcacheHit=true、SQL3本（前2本を省略できていない） |
| 非空URIのbind検索 | 現行SCAN posts、非空条件を明示した比較SQLはidx_posts_object_uriでSEARCH |
| posts DELETEのEXPLAIN | FK経路にSCAN timeline_entries。post_id経路のSEARCHとは別に存在 |
| 全体時刻順cleanup候補 | timeline / notificationsともUSE TEMP B-TREE FOR ORDER BY |
| 緊急cleanup | 各8件→8バッチ後0/1/1、hasMore=false |
| 3購読テーブルへの通知 | 1flushで3callback |
| cursor別cache保持 | 200キー→version更新＋別キーで201entry |
| durationMap | 200レスポンス後pending=0、durationMap=200 |

この検証はSQL実行計画・回数・保持量・制御フローの再現であり、大量データによる時間ベンチマークではない。ブラウザSQLite WASM/OPFSでの最終的な速度、端末差、実アカウントのワークロードは未測定。実ユーザーのOPFSデータ・アクセストークン・投稿内容は取得していない。

## 付録: 調査に使った検証コード

以下を一時的に src/util/db/sqlite/__tests__/localDbPerformanceAudit.test.ts として保存し、上記の yarn コマンドで実行する。問題が存在する現在の挙動を確認する characterization test であり、改善後にはアサーションを改善後の契約に変更する。実データ・OPFSを使わず、DBは各テスト専用の :memory: で生成・破棄する。調査完了時には一時テストをリポジトリから除去し、この付録だけを残した。

```typescript
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { clearGraphCache, executeGraphPlan } from '../../query-ir/executor/graphExecutor'
import type { SerializedGraphPlan } from '../../query-ir/executor/types'
import { WorkerNodeCache } from '../../query-ir/executor/workerNodeCache'
import { notifyChange, subscribe } from '../connection'
import { createFreshSchema } from '../schema'
import { handleEnforceMaxLength } from '../worker/workerCleanup'
import { handleMessage } from '../workerClient/messageHandler'
import { durationForId, pending } from '../workerClient/state'

type Bind = string | number | null

function makeDb() {
  const native = new DatabaseSync(':memory:')
  const statements: string[] = []
  const db = {
    exec(sql: string, opts?: { bind?: Bind[]; returnValue?: 'resultRows' }): Bind[][] {
      statements.push(sql)
      if (opts?.returnValue === 'resultRows') {
        const stmt = native.prepare(sql)
        stmt.setReturnArrays(true)
        return stmt.all(...(opts.bind ?? [])) as unknown as Bind[][]
      }
      if (opts?.bind) native.prepare(sql).run(...opts.bind)
      else native.exec(sql)
      return []
    },
  }
  native.exec('PRAGMA foreign_keys=ON;')
  createFreshSchema({ db })
  native.exec(`
    INSERT INTO servers(id, host) VALUES(1, 'example.test');
    INSERT INTO profiles(id, username, server_id, acct, canonical_acct)
      VALUES(1, 'tester', 1, 'tester', 'tester@example.test');
    INSERT INTO local_accounts(id, server_id, backend_url, backend_type, acct, remote_account_id, created_at, updated_at)
      VALUES(1, 1, 'https://example.test', 'mastodon', 'tester', '1', 0, 0);
    WITH RECURSIVE seq(id) AS (SELECT 1 UNION ALL SELECT id+1 FROM seq WHERE id<8)
      INSERT INTO posts(id, object_uri, origin_server_id, author_profile_id, created_at_ms, visibility_id)
      SELECT id, 'urn:probe:' || id, 1, 1, id*1000, 1 FROM seq;
    INSERT INTO timeline_entries(local_account_id, timeline_key, post_id, created_at_ms)
      SELECT 1, 'home', id, created_at_ms FROM posts;
    INSERT INTO notifications(local_account_id, local_id, notification_type_id, created_at_ms, related_post_id)
      SELECT 1, CAST(id AS TEXT), 2, created_at_ms, id FROM posts;
  `)
  return { native, db, statements }
}

describe('local DB implementation performance probes', () => {
  let fixture: ReturnType<typeof makeDb>

  beforeEach(() => {
    fixture = makeDb()
    clearGraphCache()
    onTestFinished(() => {
      fixture.native.close()
      clearGraphCache()
    })
  })

  it('同じグラフを再実行した時、cacheHitでもID取得とlookupのSQLを実行すること', () => {
    const plan: SerializedGraphPlan = {
      version: 2,
      nodes: [
        { id: 'source', node: { kind: 'get-ids', table: 'posts', filters: [] } },
        { id: 'lookup', node: { kind: 'lookup-related', lookupTable: 'notifications', joinConditions: [{ inputColumn: 'id', lookupColumn: 'related_post_id' }] } },
        { id: 'output', node: { kind: 'output-v2', sort: { field: 'created_at_ms', direction: 'DESC' }, pagination: { limit: 2 } } },
      ],
      edges: [{ source: 'source', target: 'lookup' }, { source: 'lookup', target: 'output' }],
    }
    const first = executeGraphPlan(fixture.db, plan, { backendUrls: ['https://example.test'] }, () => ({}))
    fixture.statements.length = 0

    const second = executeGraphPlan(fixture.db, plan, { backendUrls: ['https://example.test'] }, () => ({}))

    expect(second.meta.nodeStats.source.cacheHit).toBe(true)
    expect(second.meta.nodeStats.lookup.cacheHit).toBe(true)
    expect(fixture.statements).toHaveLength(3)
    expect(second.displayOrder).toEqual(first.displayOrder)
    console.log('PERF_PROBE cache', JSON.stringify({ cacheHit: [second.meta.nodeStats.source.cacheHit, second.meta.nodeStats.lookup.cacheHit], sqlCountOnSecondExecution: fixture.statements.length, sql: fixture.statements }))
  })

  it('URIをパラメータ検索した時、部分インデックスの条件不足でSCANになること', () => {
    const sql = 'SELECT id, is_reblog FROM posts WHERE object_uri = ?;'
    const fixedSql = "SELECT id, is_reblog FROM posts WHERE object_uri = ? AND object_uri != '';"

    const original = fixture.db.exec(`EXPLAIN QUERY PLAN ${sql}`, { bind: ['urn:probe:8'], returnValue: 'resultRows' })
    const proposed = fixture.db.exec(`EXPLAIN QUERY PLAN ${fixedSql}`, { bind: ['urn:probe:8'], returnValue: 'resultRows' })

    expect(original.map((r) => r[3]).join(' ')).toContain('SCAN posts')
    expect(proposed.map((r) => r[3]).join(' ')).toContain('idx_posts_object_uri')
    expect(fixture.db.exec(sql, { bind: ['urn:probe:8'], returnValue: 'resultRows' })).toEqual(fixture.db.exec(fixedSql, { bind: ['urn:probe:8'], returnValue: 'resultRows' }))
    console.log('PERF_PROBE uri', JSON.stringify({ original, proposed }))
  })

  it('全体の古い順を検索した時、feed用複合インデックスでは追加ソートすること', () => {
    const timelineSql = 'SELECT id FROM timeline_entries ORDER BY created_at_ms ASC LIMIT ?;'
    const notificationSql = 'SELECT id FROM notifications ORDER BY created_at_ms ASC LIMIT ?;'

    const timeline = fixture.db.exec(`EXPLAIN QUERY PLAN ${timelineSql}`, { bind: [2], returnValue: 'resultRows' })
    const notifications = fixture.db.exec(`EXPLAIN QUERY PLAN ${notificationSql}`, { bind: [2], returnValue: 'resultRows' })
    const displayReference = fixture.db.exec('EXPLAIN QUERY PLAN SELECT rowid FROM timeline_entries WHERE display_post_id = ?;', { bind: [1], returnValue: 'resultRows' })
    const postDelete = fixture.db.exec('EXPLAIN QUERY PLAN DELETE FROM posts WHERE id = ?;', { bind: [1], returnValue: 'resultRows' })

    expect(timeline.map((r) => r[3]).join(' ')).toContain('USE TEMP B-TREE FOR ORDER BY')
    expect(notifications.map((r) => r[3]).join(' ')).toContain('USE TEMP B-TREE FOR ORDER BY')
    expect(displayReference.map((r) => r[3]).join(' ')).toContain('SCAN timeline_entries')
    expect(postDelete.map((r) => r[3]).join(' ')).toContain('SCAN timeline_entries')
    console.log('PERF_PROBE cleanupPlans', JSON.stringify({ timeline, notifications, displayReference, postDelete }))
  })

  it('緊急cleanupを継続した時、毎回50%目標を再計算し初期件数の半分で停止しないこと', () => {
    const history: { timeline: number; notifications: number; posts: number; hasMore: boolean }[] = []

    for (let iteration = 0; iteration < 30; iteration++) {
      const result = handleEnforceMaxLength(fixture.db, 100_000, 10_000, 100_000, { mode: 'emergency', targetRatio: 0.5, batchLimit: 2 })
      const counts = fixture.db.exec('SELECT (SELECT COUNT(*) FROM timeline_entries), (SELECT COUNT(*) FROM notifications), (SELECT COUNT(*) FROM posts);', { returnValue: 'resultRows' })[0]
      history.push({ timeline: counts[0] as number, notifications: counts[1] as number, posts: counts[2] as number, hasMore: result.hasMore })
      if (!result.hasMore) break
    }

    expect(history.length).toBeLessThan(30)
    expect(history.at(-1)).toEqual({ timeline: 0, notifications: 1, posts: 1, hasMore: false })
    console.log('PERF_PROBE emergencyCleanup', JSON.stringify({ initialCounts: [8, 8, 8], batchLimit: 2, targetRatio: 0.5, history }))
  })

  it('同じ変更を複数購読テーブルへ通知した時、debounce後も購読テーブル数だけcallbackが来ること', async () => {
    vi.useFakeTimers()
    const tables = ['posts', 'post_interactions', 'timeline_entries'] as const
    const calls: string[] = []
    const unsubs = tables.map((table) => subscribe(table, () => calls.push(table)))
    onTestFinished(() => {
      for (const unsub of unsubs) unsub()
      vi.useRealTimers()
    })

    for (const table of tables) notifyChange(table, { timelineType: 'home', backendUrl: 'https://example.test', changedTables: [...tables] })
    await vi.advanceTimersByTimeAsync(80)

    expect(calls).toEqual([...tables])
    console.log('PERF_PROBE notificationFanout', JSON.stringify({ callbackCount: calls.length, tables: calls }))
  })

  it('異なるcursorのcacheを作ってversionを進めた時、未再参照の古いentryが保持されること', () => {
    const cache = new WorkerNodeCache()
    for (let cursor = 0; cursor < 200; cursor++) cache.set({ nodeId: 'source', sql: 'SELECT id FROM posts WHERE created_at_ms > ?', binds: [cursor] }, [{ table: 'posts', id: 1, createdAtMs: 1000 }], ['posts'])

    cache.bumpVersion('posts')
    cache.set({ nodeId: 'source', sql: 'SELECT id FROM posts WHERE created_at_ms > ?', binds: [200] }, [], ['posts'])

    expect(cache.size).toBe(201)
    console.log('PERF_PROBE retainedCache', JSON.stringify({ cursorKeys: 200, sizeAfterVersionBumpAndNewKey: cache.size }))
  })

  it('通常のtimed responseを受信した時、消費しないdurationMapが増え続けること', () => {
    durationForId.clear()
    onTestFinished(() => {
      durationForId.clear()
      for (const req of pending.values()) clearTimeout(req.timer)
      pending.clear()
    })

    for (let id = 0; id < 200; id++) {
      const timer = setTimeout(() => undefined, 60_000)
      pending.set(id, { kind: 'timeline', resolve: () => clearTimeout(timer), reject: () => clearTimeout(timer), timer })
      handleMessage({ data: { type: 'response', id, result: {}, durationMs: 1 } } as MessageEvent)
    }

    expect(pending.size).toBe(0)
    expect(durationForId.size).toBe(200)
    console.log('PERF_PROBE retainedDuration', JSON.stringify({ handledResponses: 200, pending: pending.size, durationMapSize: durationForId.size }))
  })
})
```
