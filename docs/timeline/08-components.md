# 08. UI コンポーネント

## コンポーネント階層

```
TimelineManagement       ← タイムライン管理（設定ページ）
  ├── TimelineEditPanel  ← 個別タイムライン設定

DynamicTimeline          ← ルーター（設定に応じた実装選択）
  ├── UnifiedTimeline    ← メインタイムライン（home/local/public/tag）
  ├── MixedTimeline      ← 投稿+通知混合表示
  └── NotificationTimeline ← 通知専用

TabbedTimeline           ← タブグループのラッパー
  └── DynamicTimeline[]  ← 各タブが DynamicTimeline
```

## DynamicTimeline（ルーター）

タイムラインの設定（`TimelineConfigV2`）に基づいて適切な実装コンポーネントを選択する。

```typescript
function DynamicTimeline({ config }: Props) {
  // Advanced Query の場合、クエリ内容でルーティング
  if (config.advancedQuery && config.customQuery) {
    if (isMixedQuery(config.customQuery)) return <MixedTimeline />
    if (isNotificationQuery(config.customQuery)) return <NotificationTimeline />
  }

  // 通知タイプ
  if (config.type === 'notification') return <NotificationTimeline />

  // その他（home, local, public, tag）
  return <UnifiedTimeline />
}
```

**設計判断**: 表示ロジックの分岐をルーターに集約し、各タイムライン実装は自身の表示に専念する。Advanced Query では SQL の内容によって表示形式が変わるため、クエリ解析結果でルーティングする。

## UnifiedTimeline（メインタイムライン）

home / local / public / tag タイムラインおよび status-only の Advanced Query を表示する主要コンポーネント。

### 仮想スクロール（Virtuoso）

`react-virtuoso` の `Virtuoso` コンポーネントを使用した仮想スクロール。

```typescript
<Virtuoso
  data={statuses}
  itemContent={(index, status) => <StatusCard status={status} />}
  endReached={handleEndReached}    // 末尾到達 → loadMore
  // スクロール位置の復元、初期インデックス等
/>
```

**なぜ Virtuoso か**:
- 大量の投稿（数千件）を効率的にレンダリング
- 可変高さアイテムのサポート（投稿の高さは内容によって異なる）
- 無限スクロールの組み込みサポート

### 無限スクロール

```
ユーザーが末尾に到達
    ↓
endReached コールバック
    ↓
loadMore()  ← Hook から提供
    ↓
Phase 1: DB 内でさらに古い投稿を取得
    ↓
DB 内データ枯渇？
    ↓ Yes
fetchMoreData()  ← API から追加取得
    ↓
bulkUpsert → subscribe → 再クエリ
    ↓
UI 自動更新
```

### バックエンドごとの枯渇追跡

```typescript
const [exhaustedBackends, setExhaustedBackends] = useState<Set<string>>(new Set())

// fetchMoreData の結果が FETCH_LIMIT 未満の場合
if (fetchedCount < FETCH_LIMIT) {
  setExhaustedBackends(prev => new Set([...prev, backendUrl]))
}
```

全バックエンドが枯渇した場合、ページネーションを停止する。

### スクロールトップ

新しい投稿が到着した場合、タイムラインの先頭にスクロールするボタンを表示。`TimelineIcon` がパルスアニメーションで新着を通知する。

## MixedTimeline（混合タイムライン）

Advanced Query で投稿と通知の両方を参照するクエリの結果を表示する。

```typescript
function MixedTimeline({ config }: Props) {
  const { items } = useCustomQueryTimeline(config)

  return (
    <Virtuoso
      data={items}
      itemContent={(index, item) => {
        // _type フィールドで判別
        if (item._type === 'notification') {
          return <NotificationCard notification={item} />
        }
        return <StatusCard status={item} />
      }}
    />
  )
}
```

**設計判断**: `_type` ディスクリミネータフィールドにより、同じリスト内で投稿と通知を混在表示できる。`created_at_ms` でソートされているため、時系列で自然な表示になる。

## NotificationTimeline（通知タイムライン）

通知専用の表示。ランタイム型ガードで通知以外のアイテムをフィルタする。

```typescript
function NotificationTimeline({ config }: Props) {
  const { notifications } = useTimelineData(config)

  // ランタイム型ガード
  const validNotifications = notifications.filter(isNotification)

  return (
    <Virtuoso
      data={validNotifications}
      itemContent={(index, notification) => (
        <NotificationCard notification={notification} />
      )}
    />
  )
}
```

## TabbedTimeline（タブグループ）

同じ `tabGroup` を持つ複数のタイムラインを 1 つのカラムにまとめて表示する。

```typescript
function TabbedTimeline({ configs }: Props) {
  const [activeTab, setActiveTab] = useState(0)

  return (
    <div>
      {/* タブバー */}
      <div role="tablist">
        {configs.map((config, i) => (
          <button
            key={config.id}
            role="tab"
            aria-selected={i === activeTab}
            onClick={() => setActiveTab(i)}
          >
            {config.label || getDisplayName(config)}
          </button>
        ))}
      </div>

      {/* 全タイムラインを DOM に維持（非アクティブは hidden） */}
      {configs.map((config, i) => (
        <div key={config.id} hidden={i !== activeTab}>
          <DynamicTimeline config={config} />
        </div>
      ))}
    </div>
  )
}
```

**設計判断**:
- **全タイムラインを DOM に維持**: 非アクティブタブも `hidden` で隠すだけ。マウント解除しないため、各タイムラインの Hook が継続してデータを購読する。タブ切り替え時にスクロール位置やデータが保持される。
- **キーボードナビゲーション**: 矢印キーでタブを切り替え可能。アクセシビリティ対応。

## TimelineManagement（管理 UI）

タイムラインの追加・削除・並べ替え・フォルダ管理を行う設定ページ。

### ドラッグ&ドロップ並べ替え

`@dnd-kit/core` + `@dnd-kit/sortable` を使用。

```typescript
<DndContext onDragEnd={handleDragEnd}>
  <SortableContext items={timelines}>
    {timelines.map(config => (
      <SortableTimelineItem key={config.id} config={config} />
    ))}
  </SortableContext>
</DndContext>
```

### タイムライン追加

新規タイムラインを追加する際の選択肢：

| 種別 | デフォルト設定 |
|------|-------------|
| Home | `type: 'home'` |
| Local | `type: 'local'` |
| Public | `type: 'public'` |
| Notification | `type: 'notification'` |
| Tag | `type: 'tag'`, tagConfig 設定画面を表示 |

### フォルダ管理

- フォルダの作成・削除・リネーム
- タイムラインのフォルダへの移動
- フォルダごとの色分け（6 色パレット）
- フォルダ内タイムラインの一括表示/非表示

## TimelineEditPanel（設定パネル）

個別タイムラインの詳細設定。

### UI モードの設定項目

| 設定 | UI 要素 |
|------|---------|
| バックエンドフィルタ | ラジオボタン（全部/単一/複合） |
| メディアフィルタ | チェックボックス + 数値入力 |
| 可視性フィルタ | マルチセレクト |
| 言語フィルタ | マルチセレクト |
| 除外フィルタ | チェックボックス群 |
| アカウントフィルタ | テキスト入力 + include/exclude 切替 |
| ミュート/ブロック適用 | チェックボックス（デフォルト ON） |
| タグ設定 | タグ入力 + OR/AND 切替 |
| 通知タイプ | マルチセレクト |

### Advanced Query モード

トグルで Advanced Query を有効化すると、SQL WHERE 句のテキストエディタが表示される。

```
┌─ Advanced Query ──────────────────────┐
│ ck.code = 'local'                     │
│ AND p.has_media = 1                   │
│ AND p.language = 'ja'                 │
│ AND NOT EXISTS (                      │
│   SELECT 1 FROM muted_accounts ma     │
│   WHERE ma.account_acct = pr.acct     │
│ )                                     │
└───────────────────────────────────────┘
```

UI モードに戻す際はパース警告が表示される（カスタム SQL は UI 設定に逆変換されない）。

## TimelineSummary（サマリー表示）

タイムライン一覧で設定の概要をコンパクトに表示する。

```
ホーム 📷🌐          ← メディアフィルタ + 可視性フィルタ
├── Backend: mastodon.social
├── Media: メディアあり
└── Folder: メイン
```

アイコンとテキストの組み合わせで、設定を一目で把握できる。

## TimelineIcon（ストリームアイコン）

ストリーミングでデータが到着した際にパルスアニメーションを表示するアイコン。タイムラインカラムの右上に配置。

```
[●] ← パルスアニメーション中（新着あり）
[ ] ← 通常状態
```

クリックでスクロールトップ。
