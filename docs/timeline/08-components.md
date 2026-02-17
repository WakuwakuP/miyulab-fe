# 08. UI コンポーネント

## 概要

miyulab-fe のタイムライン UI は、設定駆動のコンポーネント階層で構成されています。`TimelineSettingsV2` から各タイムラインの `TimelineConfigV2` を取り出し、種別に応じたコンポーネントに振り分けて表示します。

設定管理（追加・編集・削除・並び替え）は `TimelineManagement` と `TimelineEditPanel` が担当し、ユーザーが GUI 上でタイムラインをカスタマイズできます。

## 関連ファイル

| ファイル                                       | 説明                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| `src/app/_components/DynamicTimeline.tsx`      | タイムライン種別によるコンポーネント振り分け        |
| `src/app/_components/UnifiedTimeline.tsx`      | 統合タイムライン表示（home / local / public / tag） |
| `src/app/_components/NotificationTimeline.tsx` | 通知専用タイムライン表示                            |
| `src/app/_components/TimelineManagement.tsx`   | タイムライン設定管理 UI                             |
| `src/app/_components/TimelineEditPanel.tsx`    | 個別タイムラインのフィルタ編集パネル                |
| `src/app/_components/TimelineSummary.tsx`      | タイムライン設定のサマリー表示                      |
| `src/app/_parts/TimelineIcon.tsx`              | タイムライン関連アイコン                            |
| `src/util/timelineDisplayName.ts`              | 表示名の自動生成ロジック                            |

## コンポーネント階層

```
TimelineProvider (Context: TimelineSettingsV2)
  │
  ├── TimelineManagement (設定管理 UI)
  │   ├── SortableTimelineItem × N (各タイムラインの設定行)
  │   │   ├── TimelineSummary (設定サマリー)
  │   │   └── TimelineEditPanel (フィルタ編集パネル, 展開時のみ)
  │   │       ├── BackendFilterSelector
  │   │       ├── FilterControls (メディア・公開範囲・言語・除外系)
  │   │       ├── MuteBlockControls (ミュート・ブロック設定)
  │   │       ├── TagConfigEditor (タグ設定, tag TL のみ)
  │   │       └── QueryEditor (カスタムクエリエディタ, Advanced 時のみ)
  │   └── AddTagTimelineDialog (タグ TL 追加ダイアログ)
  │
  └── DynamicTimeline × N (各タイムラインの表示)
      ├── UnifiedTimeline (home / local / public / tag)
      │   ├── Panel (パネルフレーム)
      │   │   ├── TimelineStreamIcon (ストリーミング状態アイコン)
      │   │   └── Virtuoso (仮想スクロール)
      │   │       └── Status × N (個々の投稿)
      │   └── useTimelineData (データ取得 Hook)
      │
      └── NotificationTimeline (notification)
          ├── Panel (パネルフレーム)
          └── 通知固有の表示
```

## DynamicTimeline

### 概要

`DynamicTimeline` は `TimelineConfigV2` を受け取り、`type` と `visible` に基づいて適切なコンポーネントを選択・レンダリングする振り分けコンポーネントです。

```typescript
export const DynamicTimeline = ({ config }: { config: TimelineConfigV2 }) => {
  if (!config.visible) {
    return null
  }

  if (config.type === 'notification') {
    return <NotificationTimeline config={config} />
  }

  return <UnifiedTimeline config={config} />
}
```

### 振り分けルール

| 条件                                              | レンダリング結果           |
| ------------------------------------------------- | -------------------------- |
| `visible === false`                               | `null`（何も表示しない）   |
| `type === 'notification'`                         | `<NotificationTimeline />` |
| `type === 'home' \| 'local' \| 'public' \| 'tag'` | `<UnifiedTimeline />`      |

### notification を分離する理由

通知タイムラインは投稿タイムラインと表示形式が大きく異なります。

- 通知にはフォロー・お気に入り・ブースト等の種別がある
- 投稿本文だけでなく、アクションの種類や対象者の情報を表示する
- データソースが `notifications` テーブルであり、`statuses` テーブルとは異なる

このため、`NotificationTimeline` を専用コンポーネントとして分離し、`UnifiedTimeline` と責務を明確に分けています。

### 非表示タイムラインの扱い

`visible === false` のタイムラインは DOM にマウントされません。ただし、ストリーミング接続は `StreamingManagerProvider` が維持しているため、非表示中もデータの受信・蓄積は継続されます。表示に切り替えた際にデータの欠損が発生しません。

## UnifiedTimeline

### 概要

`UnifiedTimeline` は home / local / public / tag の全タイムライン種別を統一的に処理するコンポーネントです。以下の 3 つの責務を担います。

1. **データ取得**: `useTimelineData` Hook によるリアクティブなデータ取得
2. **追加読み込み**: スクロール末尾到達時の `fetchMoreData` による過去投稿の取得
3. **スクロール管理**: `react-virtuoso` による仮想スクロールと自動スクロール制御

### Props

```typescript
type Props = {
  config: TimelineConfigV2;
};
```

### 内部状態

| 状態                | 型        | 説明                                   |
| ------------------- | --------- | -------------------------------------- |
| `enableScrollToTop` | `boolean` | 新着投稿時に先頭へ自動スクロールするか |
| `isScrolling`       | `boolean` | 現在スクロール中か                     |
| `moreCount`         | `number`  | 追加読み込みした投稿の累積数           |

### データ取得

`useTimelineData` ファサード Hook を使用してデータを取得します。

```typescript
const timeline = useTimelineData(config) as StatusAddAppIndex[];
```

`useTimelineData` は `config.type` と `config.customQuery` に基づいて適切な Hook（`useFilteredTimeline` / `useFilteredTagTimeline` / `useCustomQueryTimeline`）を内部で選択します。

### 仮想スクロール (Virtuoso)

`react-virtuoso` ライブラリを使用して、大量の投稿を効率的にレンダリングします。

```tsx
<Virtuoso
  atTopStateChange={atTopStateChange}
  atTopThreshold={20}
  data={timeline}
  endReached={moreLoad}
  firstItemIndex={internalIndex}
  isScrolling={setIsScrolling}
  itemContent={(_, status) => (
    <Status
      key={status.id}
      scrolling={enableScrollToTop ? false : isScrolling}
      status={status}
    />
  )}
  onWheel={onWheel}
  ref={scrollerRef}
  totalCount={timeline.length}
/>
```

#### Virtuoso の主要プロパティ

| プロパティ         | 値                 | 説明                                                           |
| ------------------ | ------------------ | -------------------------------------------------------------- |
| `data`             | `timeline`         | 表示する投稿データの配列                                       |
| `endReached`       | `moreLoad`         | リスト末尾に到達した際のコールバック（追加読み込み）           |
| `firstItemIndex`   | `internalIndex`    | リスト先頭のインデックス（追加読み込み時のスクロール位置維持） |
| `atTopStateChange` | `atTopStateChange` | リスト先頭に到達/離脱した際のコールバック                      |
| `atTopThreshold`   | `20`               | 先頭到達と判定するスクロール位置の閾値（px）                   |
| `isScrolling`      | `setIsScrolling`   | スクロール状態の変更通知                                       |
| `itemContent`      | レンダラー関数     | 各投稿のレンダリング                                           |
| `onWheel`          | `onWheel`          | マウスホイールイベント                                         |
| `totalCount`       | `timeline.length`  | 投稿の総数                                                     |

#### firstItemIndex の計算

```typescript
const internalIndex = useMemo(() => {
  return CENTER_INDEX - timeline.length + moreCount;
}, [timeline.length, moreCount]);
```

`CENTER_INDEX` は仮想スクロールの基準インデックスです。追加読み込みにより `timeline.length` が増加しても、`moreCount` を加算することでスクロール位置が維持されます。

### 自動スクロール制御

新着投稿が到着した際の自動スクロール動作を制御します。

#### enableScrollToTop の制御ロジック

```
初期状態: enableScrollToTop = true

ユーザーが下方向にスクロール (onWheel: deltaY > 0)
  → enableScrollToTop = false（自動スクロール無効化）

ユーザーがリスト先頭に戻る (atTopStateChange: true)
  → enableScrollToTop = true（自動スクロール再有効化）
```

**設計意図:**

- ユーザーが過去の投稿を読んでいる最中に、新着投稿で勝手に先頭に戻らないようにする
- ユーザーが自発的に先頭に戻った場合は、自動スクロールを再有効化する

#### scrollToTop

```typescript
const scrollToTop = useCallback(() => {
  scrollerRef.current?.scrollToIndex({
    behavior: "smooth",
    index: 0,
  });
}, []);
```

- ヘッダーのクリックでも手動で先頭にスクロール可能
- `behavior: 'smooth'` でスムーズなアニメーション

#### 自動スクロールのタイミング

```typescript
useEffect(() => {
  void timeline.length;
  if (enableScrollToTop) {
    timer.current = setTimeout(() => {
      scrollToTop();
    }, 50);
  }
  return () => {
    if (timer.current != null) clearTimeout(timer.current);
  };
}, [enableScrollToTop, timeline.length, scrollToTop]);
```

- `timeline.length` が変化するたびに Effect が再実行される
- `enableScrollToTop` が `true` の場合のみ、50ms 後に先頭へスクロール
- 50ms の遅延は DOM の更新が完了するのを待つため
- cleanup 関数でタイマーをクリアし、メモリリークを防止

### 追加読み込み (moreLoad)

スクロール末尾に到達した際に `moreLoad` が呼ばれ、マルチバックエンド対応の追加データ取得を行います。

#### 処理フロー

```
moreLoad()
  │
  ├── ガード条件チェック:
  │   ├── apps.length <= 0 → return
  │   └── timeline.length === 0 → return
  │
  ├── 対象バックエンド URL を算出:
  │   resolveBackendUrls(normalizeBackendFilter(config.backendFilter, apps), apps)
  │
  └── Promise.all() で各バックエンドを並列処理:
      │
      ├── 1. 表示中のタイムラインから最古投稿を検索:
      │   timeline.filter(s => apps[s.appIndex]?.backendUrl === url).at(-1)
      │
      ├── 2. 見つからない場合 → SQLite から直接検索:
      │   ├── tag TL: statuses_belonging_tags JOIN
      │   └── その他: statuses_timeline_types JOIN
      │
      ├── 3. それでも見つからない場合 → fetchInitialData() で初期取得:
      │   return 0
      │
      └── 4. 見つかった場合 → fetchMoreData() で追加取得:
          return fetchedCount

totalFetched = sum(results)
setMoreCount(prev => prev + totalFetched)
```

#### 最古投稿の探索順序

1. **表示中のタイムラインから探索**: フィルタ結果として表示されている最古の投稿 ID を使用。ユーザーが実際に見ている位置の続きを正確に取得するため。
2. **SQLite から直接探索**: フィルタリングにより表示されていないが DB に存在する投稿から最古を取得。
3. **フォールバック**: DB にも投稿がない場合は `fetchInitialData()` を実行して初期データを確保。

#### エラーハンドリング

各バックエンドの取得エラーは個別にキャッチされ、他のバックエンドに影響しません。

```typescript
try {
  return await fetchMoreData(client, config, url, oldestStatus.id);
} catch (error) {
  console.error(`Failed to fetch more data for ${url}:`, error);
  return 0;
}
```

### 表示名の解決

```typescript
const displayName = useMemo(() => {
  if (config.label) return config.label;
  return getDefaultTimelineName(config);
}, [config]);
```

- `config.label` が設定されている場合はそのまま使用
- 未設定の場合は `getDefaultTimelineName()` で自動生成

### TimelineStreamIcon

```tsx
{
  enableScrollToTop && <TimelineStreamIcon />;
}
```

自動スクロールが有効な場合（= ユーザーがリスト先頭にいる場合）のみ、ストリーミング接続状態を示すアイコンを表示します。

### Panel コンポーネント

```tsx
<Panel
  className="relative"
  name={displayName}
  onClickHeader={() => scrollToTop()}
>
  {/* content */}
</Panel>
```

- `name`: パネルのヘッダーに表示される名前
- `onClickHeader`: ヘッダークリックで先頭へスクロール
- `className="relative"`: `TimelineStreamIcon` の絶対配置の基準

### Status コンポーネントへの props

```tsx
<Status
  key={status.id}
  scrolling={enableScrollToTop ? false : isScrolling}
  status={status}
/>
```

| prop        | 値                  | 説明                          |
| ----------- | ------------------- | ----------------------------- |
| `key`       | `status.id`         | React の key（投稿 ID）       |
| `status`    | `StatusAddAppIndex` | 投稿データ（`appIndex` 付き） |
| `scrolling` | `boolean`           | スクロール中かどうか          |

**`scrolling` の最適化:**

- 自動スクロール有効時（先頭にいる場合）: `scrolling = false`（スクロール中でも画像等を表示）
- 手動スクロール時: `scrolling = isScrolling`（スクロール中は重い描画を抑制）

## TimelineManagement

### 概要

`TimelineManagement` はタイムライン設定の一覧表示・追加・削除・並び替えを提供する管理 UI コンポーネントです。

### 機能一覧

| 機能            | 説明                                                                                   |
| --------------- | -------------------------------------------------------------------------------------- |
| **一覧表示**    | 全タイムライン設定を `order` 順にリスト表示                                            |
| **表示/非表示** | 👁 アイコンで `visible` を toggle                                                      |
| **編集**        | ✏️ アイコンで `TimelineEditPanel` を展開                                               |
| **並び替え**    | ドラッグ＆ドロップ（@dnd-kit）または ↑↓ ボタン                                         |
| **削除**        | 🗑 アイコンでタイムラインを設定から削除                                                |
| **追加**        | コアタイムライン（home/local/public/notification）はワンクリック、tag は専用ダイアログ |

### ドラッグ＆ドロップ

`@dnd-kit/core` と `@dnd-kit/sortable` を使用して、タイムラインの並び替えをドラッグ＆ドロップで実現しています。

```tsx
<DndContext onDragEnd={handleDragEnd} sensors={sensors}>
  <SortableContext
    items={sortedTimelines.map((t) => t.id)}
    strategy={verticalListSortingStrategy}
  >
    {sortedTimelines.map((timeline, index) => (
      <SortableTimelineItem key={timeline.id} timeline={timeline} ... />
    ))}
  </SortableContext>
</DndContext>
```

#### PointerSensor の設定

```typescript
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: {
      distance: 8, // 8px 以上ドラッグしないと発火しない
    },
  }),
);
```

`distance: 8` により、クリック操作とドラッグ操作を区別します。短い移動はクリックとして処理されます。

#### handleDragEnd

```typescript
const handleDragEnd = useCallback(
  (event: DragEndEvent) => {
    const { active, over } = event;

    if (over == null || active.id === over.id) return;

    const oldIndex = sortedTimelines.findIndex((t) => t.id === active.id);
    const newIndex = sortedTimelines.findIndex((t) => t.id === over.id);

    // 配列を並び替えて order を再割り当て
    const updatedTimelines = [...sortedTimelines];
    const [movedTimeline] = updatedTimelines.splice(oldIndex, 1);
    updatedTimelines.splice(newIndex, 0, movedTimeline);

    const newTimelineSettings = updatedTimelines.map((timeline, index) => ({
      ...timeline,
      order: index,
    }));

    setTimelineSettings((prev) => ({
      ...prev,
      timelines: newTimelineSettings,
    }));
  },
  [sortedTimelines, setTimelineSettings],
);
```

### SortableTimelineItem

各タイムライン設定行のコンポーネントです。`useSortable` Hook により、ドラッグ＆ドロップ対応のリストアイテムとして機能します。

#### 表示内容

```
┌─────────────────────────────────────────────────────┐
│ 👁  ⠿  Home 📷 🚫🔁                    ✏️  ↑  ↓  🗑 │
│      │  │                                │  │  │  │  │
│      │  │  displayName + サフィックス      │  │  │  │  │
│      │  └── TimelineSummary              │  │  │  │  │
│      └── ドラッグハンドル                  │  │  │  │  │
│                                          │  │  │  │  │
│  表示/非表示  ドラッグ  名前+サマリー     編集  上  下  削除│
└─────────────────────────────────────────────────────┘
```

#### 編集パネルの展開

```tsx
{
  isEditing && (
    <TimelineEditPanel
      config={timeline}
      onCancel={() => onToggleEdit(timeline.id)}
      onSave={(updates) => {
        onUpdate(timeline.id, updates);
        onToggleEdit(timeline.id);
      }}
    />
  );
}
```

- `editingId` 状態で現在編集中のタイムライン ID を管理
- 同時に 1 つのタイムラインのみ編集可能（他を開くと前のが閉じる）

### コアタイムラインの追加

```tsx
{
  (["home", "local", "public", "notification"] as TimelineType[]).map(
    (type) => (
      <button key={type} onClick={() => onAddCoreTimeline(type)}>
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </button>
    ),
  );
}
```

ボタンクリックで即座に新しいタイムライン設定が追加されます。ID は `crypto.randomUUID()` で生成されます。

### AddTagTimelineDialog

タグタイムラインの追加専用ダイアログです。

#### 機能

- テキスト入力でタグを追加（Enter キーまたはボタン）
- `#` プレフィックスの自動除去
- 小文字への自動変換
- 重複タグの防止
- 最大 5 タグまでの制限
- 追加済みタグの × ボタンによる個別削除

#### タグの正規化

```typescript
const addTag = useCallback(() => {
  const trimmed = tagInput.trim().toLowerCase().replace(/^#/, "");
  if (trimmed === "" || tags.includes(trimmed)) {
    setTagInput("");
    return;
  }
  if (tags.length >= 5) return;
  setTags((prev) => [...prev, trimmed]);
  setTagInput("");
}, [tagInput, tags]);
```

#### 作成される TimelineConfigV2

```typescript
const newConfig: TimelineConfigV2 = {
  backendFilter: { mode: "all" },
  id: generateId(),
  label: undefined,
  onlyMedia: false,
  order: 0, // 呼び出し側で上書きされる
  tagConfig: {
    mode: "or",
    tags,
  },
  type: "tag",
  visible: true,
};
```

### ID 生成

```typescript
function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // フォールバック: タイムスタンプ + ランダム文字列 + カウンター
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${fallbackIdCounter.toString(36)}`;
}
```

`crypto.randomUUID()` が使えない環境（古いブラウザ、非 HTTPS 環境）向けのフォールバックが用意されています。

## TimelineEditPanel

### 概要

`TimelineEditPanel` は個別のタイムライン設定を編集する展開可能なパネルです。通常 UI モードと Advanced Query モードの 2 つの編集モードを提供します。

### Props

```typescript
type TimelineEditPanelProps = {
  config: TimelineConfigV2;
  onCancel: () => void;
  onSave: (updates: Partial<TimelineConfigV2>) => void;
};
```

### 内部状態

| 状態               | 型                          | 初期値                                         | 説明                                    |
| ------------------ | --------------------------- | ---------------------------------------------- | --------------------------------------- |
| `label`            | `string`                    | `config.label ?? ''`                           | カスタム表示名                          |
| `backendFilter`    | `BackendFilter`             | `config.backendFilter ?? { mode: 'all' }`      | バックエンドフィルタ                    |
| `onlyMedia`        | `boolean`                   | `config.onlyMedia ?? false`                    | メディアフィルタ                        |
| `tagConfig`        | `TagConfig`                 | `config.tagConfig ?? { mode: 'or', tags: [] }` | タグ設定                                |
| `showAdvanced`     | `boolean`                   | `config.advancedQuery ?? false`                | Advanced Query モードの表示状態         |
| `filterUpdates`    | `Partial<TimelineConfigV2>` | `{}`                                           | v2 フィルタオプションの差分             |
| `customQuery`      | `string`                    | `config.customQuery ?? builtQuery`             | カスタムクエリ文字列                    |
| `showMuteManager`  | `boolean`                   | `false`                                        | MuteManager モーダルの表示状態          |
| `showBlockManager` | `boolean`                   | `false`                                        | InstanceBlockManager モーダルの表示状態 |

### 編集モード

#### 通常 UI モード (`showAdvanced === false`)

GUI ベースのフィルタ設定です。以下のコンポーネントを組み合わせて表示します。

```
┌─────────────────────────────────────────────┐
│ Edit: Home                                   │
│                                              │
│ Display Name: [________________]             │
│                                              │
│ Advanced Query: [OFF]                        │
│                                              │
│ Backend Filter: [All ▼]                      │
│                                              │
│ ┌── Filter Controls ──────────────────────┐ │
│ │ Media: [Only Media] [Min: 2]            │ │
│ │ Visibility: [✅ Public] [✅ Unlisted]    │ │
│ │ Language: [ja] [en]                     │ │
│ │ Exclude: [☐ Reblogs] [✅ Replies]       │ │
│ │ Account: [include/exclude] [accts...]   │ │
│ └─────────────────────────────────────────┘ │
│                                              │
│ ┌── Tag Config (tag TL のみ) ─────────────┐ │
│ │ Tags: #cat ×  #dog ×                    │ │
│ │ Mode: (●) OR  (○) AND                   │ │
│ └─────────────────────────────────────────┘ │
│                                              │
│ ┌── Mute / Block ─────────────────────────┐ │
│ │ [✅ Apply Mute] [Manage Mutes]          │ │
│ │ [✅ Apply Block] [Manage Blocks]        │ │
│ └─────────────────────────────────────────┘ │
│                                              │
│                          [Cancel] [Save]     │
└─────────────────────────────────────────────┘
```

#### Advanced Query モード (`showAdvanced === true`)

SQL ベースのカスタムクエリ編集です。

```
┌─────────────────────────────────────────────┐
│ Edit: Home                                   │
│                                              │
│ Display Name: [________________]             │
│                                              │
│ Advanced Query: [ON]                         │
│                                              │
│ ┌── Query Editor ─────────────────────────┐ │
│ │ SELECT ... WHERE                         │ │
│ │ s.language = 'ja'                        │ │
│ │ AND s.has_media = 1                      │ │
│ │ AND sb.backendUrl = 'https://...'        │ │
│ │                                          │ │
│ │ [Validate] [Format]                      │ │
│ └─────────────────────────────────────────┘ │
│                                              │
│                          [Cancel] [Save]     │
└─────────────────────────────────────────────┘
```

### Advanced Query モードの切り替え

#### 通常 → Advanced

```typescript
// 現在の UI 設定からクエリを生成して反映
setCustomQuery(builtQuery);
```

`buildQueryFromConfig()` が現在の UI 設定（フィルタオプション、タグ設定、バックエンドフィルタ）から対応する SQL WHERE 句を生成し、クエリエディタに表示します。

#### Advanced → 通常

```typescript
// クエリから UI 設定を逆算（ベストエフォート）
const parsed = parseQueryToConfig(customQuery);
if (parsed) {
  if (parsed.onlyMedia !== undefined) setOnlyMedia(parsed.onlyMedia);
  if (parsed.tagConfig) setTagConfig(parsed.tagConfig);
  if (parsed.backendFilter) setBackendFilter(parsed.backendFilter);
  // v2 フィルタオプションも逆算
  // ...
}
```

`parseQueryToConfig()` がカスタムクエリ文字列を解析し、対応する UI 設定に復元します。複雑なクエリ（サブクエリ、`json_extract` 等）は完全に逆算できない場合があり、パース可能な部分のみが復元されます。

### builtQuery の自動更新

通常 UI モードでは、UI の変更に連動してクエリ文字列が自動更新されます。

```typescript
const builtQuery = useMemo(
  () => buildQueryFromConfig({ ...mergedConfig, tagConfig }),
  [mergedConfig, tagConfig],
);

useEffect(() => {
  if (!showAdvanced) {
    setCustomQuery(builtQuery);
  }
}, [builtQuery, showAdvanced]);
```

これにより、通常 UI モードから Advanced に切り替えた際に、現在の設定が反映されたクエリが表示されます。

### 保存処理

```typescript
const handleSave = useCallback(
  () => {
    if (!isValid) return;

    const updates: Partial<TimelineConfigV2> = {
      advancedQuery: showAdvanced,
      backendFilter: showAdvanced ? { mode: "all" } : backendFilter,
      customQuery: customQuery.trim() || undefined,
      label: label.trim() || undefined,
      onlyMedia,
      ...filterUpdates,
    };

    if (isTagTimeline) {
      updates.tagConfig = tagConfig;
    }

    onSave(updates);
  },
  [
    /* deps */
  ],
);
```

**注意点:**

- Advanced Query モードでは `backendFilter` を `{ mode: 'all' }` にリセット（backendUrl フィルタはクエリに含まれるため）
- 空文字列の `label` は `undefined` に変換（自動生成名を使用）
- 空文字列の `customQuery` は `undefined` に変換

### バリデーション

```typescript
const isValid =
  !isTagTimeline ||
  (showAdvanced ? Boolean(customQuery.trim()) : tagConfig.tags.length > 0);
```

| 条件                   | 有効                             |
| ---------------------- | -------------------------------- |
| tag 以外のタイムライン | 常に有効                         |
| tag + 通常 UI          | タグが 1 つ以上あれば有効        |
| tag + Advanced Query   | カスタムクエリが非空であれば有効 |

### notification の特別扱い

`type === 'notification'` の場合、以下のコンポーネントは表示されません。

- Advanced Query トグル
- BackendFilterSelector
- FilterControls
- TagConfigEditor
- QueryEditor

通知タイムラインにはフィルタリング機能が適用されないためです。Display Name のみ編集可能です。

## 表示名の自動生成 (getDefaultTimelineName)

### 概要

`getDefaultTimelineName()` は `TimelineConfigV2` からデフォルトの表示名を生成する関数です。`config.label` が設定されている場合はそのまま返し、未設定の場合は `type` とフィルタオプションから名前を自動生成します。

### 基本名の生成

| type               | 基本名           | 例             |
| ------------------ | ---------------- | -------------- |
| `home`             | `Home`           | `Home`         |
| `local`            | `Local`          | `Local`        |
| `public`           | `Public`         | `Public`       |
| `notification`     | `Notification`   | `Notification` |
| `tag` (OR モード)  | `#tag1 \| #tag2` | `#cat \| #dog` |
| `tag` (AND モード) | `#tag1 & #tag2`  | `#cat & #dog`  |

### サフィックスの生成

フィルタオプションに応じて絵文字サフィックスが追加されます。

| フィルタオプション          | サフィックス                   |
| --------------------------- | ------------------------------ |
| `onlyMedia === true`        | `📷`                           |
| `minMediaCount >= 1`        | `📷{N}+`                       |
| `visibilityFilter`          | 各公開範囲の絵文字（🌐🔓🔒✉️） |
| `languageFilter`            | `🌍{codes}`                    |
| `excludeReblogs === true`   | `🚫🔁`                         |
| `excludeReplies === true`   | `🚫💬`                         |
| `excludeSpoiler === true`   | `🚫CW`                         |
| `excludeSensitive === true` | `🚫⚠️`                         |

### サフィックスの制限

サフィックスは最大 4 つまでに制限されます。5 つ以上のフィルタが有効な場合、末尾に `…` が追加されます。

```typescript
const maxSuffixes = 4;
const truncatedSuffixes = suffixes.slice(0, maxSuffixes);
const suffix =
  truncatedSuffixes.length > 0
    ? ` ${truncatedSuffixes.join(" ")}${suffixes.length > maxSuffixes ? "…" : ""}`
    : "";

return `${baseName}${suffix}`;
```

### 表示例

| 設定                                                                                | 生成される名前        |
| ----------------------------------------------------------------------------------- | --------------------- |
| `{ type: 'home' }`                                                                  | `Home`                |
| `{ type: 'public', onlyMedia: true }`                                               | `Public 📷`           |
| `{ type: 'local', excludeReblogs: true, excludeReplies: true }`                     | `Local 🚫🔁 🚫💬`     |
| `{ type: 'tag', tagConfig: { mode: 'or', tags: ['cat', 'dog'] } }`                  | `#cat \| #dog`        |
| `{ type: 'public', onlyMedia: true, languageFilter: ['ja'], excludeReblogs: true }` | `Public 📷 🌍ja 🚫🔁` |
| `{ type: 'home', label: 'My Feed' }`                                                | `My Feed`             |

## パフォーマンス最適化

### 仮想スクロール

`react-virtuoso` により、DOM に実際にマウントされるのは画面に表示される投稿のみです。タイムラインに数千件の投稿があっても、描画コストは一定です。

### isScrolling による描画抑制

```tsx
<Status scrolling={enableScrollToTop ? false : isScrolling} status={status} />
```

手動スクロール中は `scrolling = true` が渡され、`Status` コンポーネント内で重い描画（画像のデコード、埋め込みプレビュー等）を抑制できます。

### useMemo による計算キャッシュ

`displayName` と `internalIndex` は `useMemo` でメモ化されており、依存値が変わらない限り再計算されません。

```typescript
const displayName = useMemo(() => {
  if (config.label) return config.label;
  return getDefaultTimelineName(config);
}, [config]);

const internalIndex = useMemo(() => {
  return CENTER_INDEX - timeline.length + moreCount;
}, [timeline.length, moreCount]);
```

### useCallback による関数参照の安定化

`moreLoad`、`onWheel`、`atTopStateChange`、`scrollToTop` はすべて `useCallback` でメモ化されています。これにより、Virtuoso の不要な再レンダリングが防がれます。

## エラーハンドリング

### 追加読み込みエラー

各バックエンドの追加読み込みエラーは個別にキャッチされ、他のバックエンドや UI 全体に影響しません。

```typescript
try {
  return await fetchMoreData(client, config, url, oldestStatus.id);
} catch (error) {
  console.error(`Failed to fetch more data for ${url}:`, error);
  return 0;
}
```

### 初期データ取得エラー

初期データ取得に失敗した場合も、エラーをログ出力して処理を続行します。空のタイムラインが表示されますが、ストリーミング経由で後から投稿が到着すれば表示されます。

### バリデーションエラー

`TimelineEditPanel` でバリデーションエラーがある場合、Save ボタンが無効化され、エラーメッセージが表示されます。

```tsx
{
  !isValid && (
    <p className="text-xs text-red-400">
      Tag timeline requires at least one tag.
    </p>
  );
}
```
