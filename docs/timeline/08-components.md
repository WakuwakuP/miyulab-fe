# 08. UI コンポーネント

## コンポーネント階層

TimelineManagement       ← タイムライン管理（設定ページ）
  ├── TimelineEditPanel  ← 個別タイムライン設定
  │    ├── BackendFilterSelector  ← バックエンドフィルタ
  │    ├── FilterControls         ← v2 フィルタ UI
  │    ├── MuteBlockControls      ← ミュート/ブロック設定
  │    ├── TagConfigEditor        ← タグ設定
  │    ├── QueryEditor            ← Advanced Query エディタ
  │    ├── MuteManager            ← ミュート管理モーダル
  │    └── InstanceBlockManager   ← インスタンスブロック管理モーダル

DynamicTimeline          ← ルーター（設定に応じた実装選択 + visible チェック）
  ├── UnifiedTimeline    ← メインタイムライン（home/local/public/tag）
  ├── MixedTimeline      ← 投稿+通知混合表示
  └── NotificationTimeline ← 通知専用

TabbedTimeline           ← タブグループのラッパー
  └── DynamicTimeline[]  ← 各タブが DynamicTimeline

## DynamicTimeline（ルーター）

タイムラインの設定（`TimelineConfigV2`）に基づいて適切な実装コンポーネントを選択する。

function DynamicTimeline({ config, headerOffset }: Props) {
  // 非表示のタイムラインはレンダリングしない
  if (!config.visible) return null

  const query = config.customQuery ?? ''

  // 混合クエリ: statuses と notifications の両方を参照する場合は MixedTimeline
  if (isMixedQuery(query)) return <MixedTimeline />

  // 通知タイプ、または Advanced Query で n.* テーブルを参照している場合
  if (config.type === 'notification' || isNotificationQuery(query))
    return <NotificationTimeline />

  // その他（home, local, public, tag）
  return <UnifiedTimeline />
}

**設計判断**:
- **`visible` チェック**: 非表示タイムラインの DOM ノードとクエリ実行をスキップ。
- 表示ロジックの分岐をルーターに集約し、各タイムライン実装は自身の表示に専念。
- Advanced Query では SQL の内容（`isMixedQuery` / `isNotificationQuery`）によって表示形式が変わるため、クエリ解析結果でルーティング。

## UnifiedTimeline（メインタイムライン）

home / local / public / tag タイムラインおよび status-only の Advanced Query を表示する主要コンポーネント。

### 仮想スクロール（Virtuoso）

`react-virtuoso` の `Virtuoso` コンポーネントを使用した仮想スクロール。

<Virtuoso
  data={timeline}
  itemContent={(_, status) => <Status status={status} scrolling={...} />}
  endReached={moreLoad}
  firstItemIndex={internalIndex}
  increaseViewportBy={200}
  atTopStateChange={atTopStateChange}
  atTopThreshold={20}
  isScrolling={setIsScrolling}
/>

**なぜ Virtuoso か**:
- 大量の投稿（数千件）を効率的にレンダリング
- 可変高さアイテムのサポート（投稿の高さは内容によって異なる）
- 無限スクロールの組み込みサポート

### 初期ロード中の表示

`useOtherQueueProgress()` で初期化状態を監視し、データが空かつ初期化中の場合は `TimelineLoading` を表示。

{timeline.length === 0 && initializing ? (
  <TimelineLoading />
) : (
  <Virtuoso ... />
)}

### 無限スクロール（moreLoad）

2 つのページネーション機構を並行して実行：

1. `loadMore()`: SQLite クエリの LIMIT を拡張（DB 内の既存データを追加表示）
2. `fetchMoreData()`: API から max_id ベースで追加データを取得（DB にない古い投稿を補充）

両者は独立して動作し、DB への upsert は subscribe 経由で自動反映される。

### バックエンドごとの枯渇追跡

const exhaustedBackendsRef = useRef(new Set<string>())

if (fetchedCount < FETCH_LIMIT) {
  exhaustedBackendsRef.current.add(backendUrl)
}

全バックエンドが枯渇した場合、API ページネーションを停止する。

### スクロールトップ

新しい投稿が到着した場合、`TimelineStreamIcon` がパルスアニメーションで新着を通知。タイムラインの先頭にスクロールするボタンとして機能する。

## MixedTimeline（混合タイムライン）

Advanced Query で投稿と通知の両方を参照するクエリの結果を表示する。

function MixedTimeline({ config, headerOffset }: Props) {
  const { data: timeline, queryDuration, loadMore } = useTimelineData(config)

  return (
    <Virtuoso
      data={timeline}
      itemContent={(_, item) => {
        // _type フィールドで判別
        if ('_type' in item && item._type === 'notification')
          return <Notification notification={item} />
        return <Status status={item} />
      }}
    />
  )
}

**設計判断**: `_type` ディスクリミネータフィールドにより、同じリスト内で投稿と通知を混在表示できる。`created_at_ms` でソートされているため、時系列で自然な表示になる。

## NotificationTimeline（通知タイムライン）

通知専用の表示。ランタイム型ガードで通知以外のアイテムをフィルタする。

function NotificationTimeline({ config, headerOffset }: Props) {
  const { data: rawData, queryDuration, loadMore } = useTimelineData(config)
  // Runtime type guard
  const notifications = rawData.filter(
    (item): item is NotificationAddAppIndex => 'type' in item
  )
  // ...
}

## TabbedTimeline（タブグループ）

同じ `tabGroup` を持つ複数のタイムラインを 1 つのカラムにまとめて表示する。

function TabbedTimeline({ configs }: Props) {
  const [activeIndex, setActiveIndex] = useState(0)

  return (
    <section>
      {/* タブヘッダー */}
      <div role="tablist">
        {configs.map((config, i) => (
          <button role="tab" aria-selected={i === activeIndex} ...>
            {config.label || getDefaultTimelineName(config)}
          </button>
        ))}
      </div>
      {/* 全タイムラインを DOM に維持（非アクティブは hidden） */}
      {configs.map((config, i) => (
        <div hidden={i !== safeIndex} role="tabpanel">
          <DynamicTimeline config={config} headerOffset="2rem" />
        </div>
      ))}
    </section>
  )
}

**設計判断**:
- **全タイムラインを DOM に維持**: 非アクティブタブも `hidden` で隠すだけ。マウント解除しないため、各タイムラインの Hook が継続してデータを購読する。タブ切り替え時にスクロール位置やデータが保持される。
- **キーボードナビゲーション**: 矢印キーでタブを切り替え可能。アクセシビリティ対応。
- **safeIndex**: activeIndex が範囲外になった場合の安全策（0 にフォールバック）。

## TimelineManagement（管理 UI）

タイムラインの追加・削除・並べ替え・フォルダ管理を行う設定ページ。

### ドラッグ&ドロップ並べ替え

`@dnd-kit/core` + `@dnd-kit/sortable` を使用。フォルダとタイムラインの両方がドラッグ可能。

<DndContext onDragEnd={handleDragEnd} onDragOver={handleDragOver}>
  <SortableContext items={sortableIdsWithFolders}>
    {columnsWithEmptyFolders.map(column => ...)}
  </SortableContext>
</DndContext>

### タイムライン追加

| 種別 | デフォルト設定 |
|------|-------------|
| Home | `type: 'home'` |
| Local | `type: 'local'` |
| Public | `type: 'public'`, `onlyMedia: true` |
| Notification | `type: 'notification'`, `notificationFilter: ALL_NOTIFICATION_TYPES` |
| Tag | `type: 'tag'`, ダイアログで tagConfig を設定（最大 5 タグ） |

### フォルダ管理

- フォルダの作成・削除・リネーム
- タイムラインのフォルダへのドラッグ&ドロップ移動
- フォルダごとの色分け（6 色パレット）
- フォルダの折りたたみ（collapsedFolders）
- 空フォルダのサポート
- EXPLAIN QUERY PLAN のクリップボードコピー

## TimelineEditPanel（設定パネル）

個別タイムラインの詳細設定。

### UI モードの設定項目

| 設定 | UI 要素 |
|------|---------| 
| 表示名 | テキスト入力 |
| バックエンドフィルタ | BackendFilterSelector（全部/単一/複合） |
| フィルタ設定 | FilterControls（メディア, 可視性, 言語, 除外, アカウント） |
| ミュート/ブロック | MuteBlockControls + MuteManager / InstanceBlockManager モーダル |
| タグ設定 | TagConfigEditor（タグ入力 + OR/AND 切替） |

### Advanced Query モード

トグルスイッチで Advanced Query を有効化すると、`QueryEditor` が表示される。

**UI → Advanced**: `buildQueryFromConfig()` で現在の設定から SQL を生成。
**Advanced → UI**: `parseQueryToConfig()` がベストエフォートで SQL を解析。`canParseQuery()` でラウンドトリップ忠実度を検証し、復元不完全な場合は警告を表示。

### 保存ロジック

Advanced Query モード時:
- `backendFilter` は `{ mode: 'all' }` にリセット（クエリに含まれるため）
- `customQuery` は文字列として保存

通常 UI モード時:
- `customQuery` は `undefined` に設定（個別設定プロパティが正として機能）

## TimelineSummary（サマリー表示）

タイムライン一覧で設定の概要をコンパクトに表示する。アイコンとテキストの組み合わせで設定を一目で把握できる。
