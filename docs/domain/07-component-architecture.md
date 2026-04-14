# コンポーネント設計

miyulab-fe のコンポーネントアーキテクチャを解説する。ディレクトリ構成、データフロー、主要コンポーネントの責務と入出力を実装に基づいて記述する。

---

## 1. ディレクトリ構成と使い分け

```text
src/
├── app/
│   ├── layout.tsx              # Provider chain（14層）+ 全体レイアウト
│   ├── page.tsx                # ホームページ — タイムラインカラム配置
│   ├── _components/            # ページレベル機能コンポーネント
│   │   ├── DynamicTimeline.tsx
│   │   ├── UnifiedTimeline.tsx
│   │   ├── MixedTimeline.tsx
│   │   ├── NotificationTimeline.tsx
│   │   ├── TabbedTimeline.tsx
│   │   ├── MainPanel.tsx
│   │   ├── DetailPanel.tsx
│   │   ├── MediaModal.tsx
│   │   ├── Player.tsx
│   │   ├── FlowEditor/         # ビジュアルクエリビルダー
│   │   ├── NodeEditor/         # ノードベースフィルタエディタ
│   │   ├── TimelineManagement/ # タイムライン管理UI
│   │   └── ...
│   └── _parts/                 # 再利用可能な低レベルUI部品
│       ├── Status.tsx
│       ├── Actions.tsx
│       ├── UserInfo.tsx
│       ├── MediaAttachments.tsx
│       ├── Media.tsx
│       ├── Poll.tsx
│       ├── EmojiReactions.tsx
│       ├── EmojiReactionPicker.tsx
│       ├── Card.tsx
│       ├── Notification.tsx
│       ├── Panel.tsx
│       └── ...
├── components/
│   └── ui/                     # shadcn/ui 生成コンポーネント（編集禁止）
│       ├── button.tsx
│       ├── dialog.tsx
│       ├── select.tsx
│       ├── tabs.tsx
│       └── ...
└── util/
    └── provider/               # React Context Provider 群
```

### 配置基準

| ディレクトリ | 役割 | 配置基準 |
|---|---|---|
| `app/_components/` | ページレベル機能コンポーネント | 特定の機能・画面領域に紐づく大きな単位。タイムライン、パネル、エディタなど |
| `app/_parts/` | 再利用可能な低レベルUI部品 | 複数の `_components/` から参照される汎用パーツ。投稿表示、メディア、アクションボタンなど |
| `components/ui/` | shadcn/ui 生成コンポーネント | `npx shadcn-ui` で生成。**手動編集禁止**。Biome lint 対象外 |
| `util/provider/` | React Context Provider | グローバル状態管理。外部状態ライブラリは不使用 |

---

## 2. レイアウト構成

### Provider Chain（`src/app/layout.tsx`）

`layout.tsx` は14層の Provider をネストし、アプリケーション全体の状態を提供する。

```text
<html>
  <body>
    SuspenseProvider
    └── AppsProvider                    # アプリ（アカウント）一覧
        └── PostAccountProvider         # 投稿用アカウント管理
            └── SettingProvider          # ユーザー設定
                └── TimelineProvider    # タイムライン構成(TimelineConfigV2[])
                    └── <Suspense>
                        └── ResourceProvider    # 絵文字・ユーザー・タグ
                            └── ReplyToProvider # リプライ対象
                                └── DetailProvider      # 詳細パネル状態
                                    └── MediaModalProvider  # メディアモーダル
                                        └── PlayerProvider      # 動画プレイヤー
                                            └── StartupCoordinator  # 起動フェーズ管理
                                                └── StatusStoreProvider     # 投稿ストア操作
                                                    └── StreamingManagerProvider # WebSocket
                                                        └── HomeTimelineProvider    # ホームTL データ
                                                            └── <Toaster />
                                                            └── {children}
    QueryLogBridge        # クエリログブリッジ（Provider外）
    <Analytics />         # Vercel Analytics
  </body>
</html>
```

### ホームページ構成（`src/app/page.tsx`）

```text
<main>  (横スクロールの flex レイアウト、各カラム幅 = 100vw/6, min-width: 60)
├── InitialProgressBar          # 初期ロード進捗バー
├── MainPanel                   # 投稿フォーム + アカウント選択
├── [columns...]                # タイムラインカラム群
│   ├── DynamicTimeline         # 単独タイムライン (tabGroup なし)
│   └── TabbedTimeline          # タブグループ (同一 tabGroup をまとめて表示)
├── DetailPanel                 # 詳細表示（投稿スレッド/ユーザー/ハッシュタグ）
├── MediaModal                  # メディアモーダル（カルーセル）
└── Player                      # 動画/音声プレイヤー（ポータル）
```

`page.tsx` の `groupTimelines()` 関数が `TimelineConfigV2[]` を以下のルールでカラムに分割する:

- `tabGroup` が未設定 → 単独カラム（`DynamicTimeline`）
- 同一 `tabGroup` → 1つのカラム内でタブ切替（`TabbedTimeline`）
- ソート順は `order` フィールドで決定

---

## 3. タイムライン表示コンポーネント群

### コンポーネントツリー

```text
page.tsx
├── DynamicTimeline ─── タイムラインルーター
│   ├── UnifiedTimeline ─── 投稿タイムライン（デフォルト）
│   ├── MixedTimeline ──── 投稿＋通知の混合表示
│   ├── NotificationTimeline ── 通知専用表示
│   └── MediaGalleryTimeline ── メディアギャラリー表示
└── TabbedTimeline ──── タブグループ
    └── DynamicTimeline × N（タブごとに1つ）
```

### DynamicTimeline（`src/app/_components/DynamicTimeline.tsx`）

タイムラインルーターとして機能し、`TimelineConfigV2` の内容に応じて適切なコンポーネントに描画を委譲する。

**ルーティングロジック:**

1. Output ノードの `displayMode === 'media-gallery'` → **MediaGalleryTimeline**
2. `queryPlan` が QueryPlanV2 で `posts` と `notifications` 両方のテーブルを参照 → **MixedTimeline**
3. `customQuery` が混合クエリ (`isMixedQuery`) → **MixedTimeline**
4. `type === 'notification'` または `customQuery` が通知クエリ → **NotificationTimeline**
5. 上記以外 → **UnifiedTimeline**

| props | 型 | 説明 |
|---|---|---|
| `config` | `TimelineConfigV2` | タイムライン設定（種別、フィルタ、カスタムクエリ等） |
| `headerOffset?` | `string` | ヘッダーオフセット（TabbedTimeline 内で使用: `"2rem"`） |

### UnifiedTimeline（`src/app/_components/UnifiedTimeline.tsx`）

メインのタイムライン表示コンポーネント。`react-virtuoso` の `Virtuoso` で仮想スクロールを実現する。

**データフロー:**

```text
TimelineConfigV2
  → useTimelineData(config)
    → useTimelineList(config)
      → useTimelineDataSource(config)
        → SQLite クエリ実行
  → StatusAddAppIndex[]
    → Virtuoso (仮想スクロール)
      → Status コンポーネント (各アイテム描画)
```

**主な機能:**
- `useTimelineData(config)` からデータ・ページネーション情報を取得
- `endReached` で `loadOlder()` を呼び出し、過去の投稿を追加読み込み
- `enableScrollToTop` フラグで新着到着時の自動スクロール制御
- `bottomExpansionRef` で末尾追加時の `firstItemIndex` を安定化（Virtuoso のプリペンド誤判定防止）
- スクロール中は `scrolling` フラグで子コンポーネントの画像読み込みを抑制

| props | 型 | 説明 |
|---|---|---|
| `config` | `TimelineConfigV2` | タイムライン設定 |
| `headerOffset?` | `string` | ヘッダーオフセット |

| 使用 Context | Provider | 用途 |
|---|---|---|
| — | `useTimelineData` (hook) | データ取得・ページネーション |
| — | `useOtherQueueProgress` (hook) | 初期化状態の判定 |

### MixedTimeline（`src/app/_components/MixedTimeline.tsx`）

投稿と通知の両方を含むクエリ結果を表示する。各アイテムの `type` フィールドで `Status` / `Notification` を描き分ける。

```text
useTimelineData(config)
  → (StatusAddAppIndex | NotificationAddAppIndex)[]
    → Virtuoso
      → 'type' in item ? <Notification /> : <Status />
```

構造は UnifiedTimeline とほぼ同一だが、`itemContent` 内でアイテムの型に応じた分岐が入る。

### NotificationTimeline（`src/app/_components/NotificationTimeline.tsx`）

通知専用の表示コンポーネント。`useTimelineData` の結果を `NotificationAddAppIndex` にフィルタリングして表示する。

```text
useTimelineData(config)
  → rawData.filter(item => 'type' in item)  # NotificationAddAppIndex のみ
    → Virtuoso
      → <Notification />
```

### TabbedTimeline（`src/app/_components/TabbedTimeline.tsx`）

同一 `tabGroup` を持つ複数のタイムラインをタブUIで切り替えて1カラム内に表示する。

| props | 型 | 説明 |
|---|---|---|
| `configs` | `TimelineConfigV2[]` | 同一 tabGroup のタイムライン設定配列 |

- WAI-ARIA 準拠のタブ操作（ArrowLeft/Right でキーボードナビゲーション）
- 非アクティブタブは `hidden` 属性で非表示（DOM は維持）
- 各タブの中身は `DynamicTimeline` に `headerOffset="2rem"` を渡して描画

### TimelineManagement（`src/app/_components/TimelineManagement/`）

タイムラインの追加・削除・並び替え・フォルダ管理UIを提供する。

```text
TimelineManagement/
├── TimelineManagement.tsx    # メインコンポーネント (dnd-kit ドラッグ&ドロップ)
├── TimelineItem.tsx          # 各タイムラインの設定行
├── FolderSection.tsx         # フォルダ（タブグループ）セクション
├── SortableFolderWrapper.tsx # ドラッグ可能なフォルダラッパー
├── AddTagTimelineDialog.tsx  # ハッシュタグTL追加ダイアログ
├── constants.ts              # 定数・ID生成
└── index.ts                  # エクスポート
```

- `@dnd-kit/core` と `@dnd-kit/sortable` によるドラッグ&ドロップ並び替え
- `FlowQueryEditorModal` と連携してカスタムクエリの編集が可能
- `TimelineContext` / `SetTimelineContext` で設定の読み書き

---

## 4. 投稿関連の低レベルコンポーネント

### Status コンポーネントツリー

```text
Status (src/app/_parts/Status.tsx)
├── UserInfo                    # ユーザー情報（アバター、表示名、acct）
│   ├── ProxyImage              # プロキシ経由の画像表示
│   └── Visibility              # 公開範囲アイコン
├── EditedAt                    # 編集日時表示
├── [content]                   # HTML本文（html-react-parser でパース）
├── Poll                        # 投票インターフェース
├── Card                        # リンクプレビューカード
├── MediaAttachments            # メディア添付ファイル群
│   └── Media × N               # 個別メディア（画像/動画/GIF/音声）
├── EmojiReactions              # カスタム絵文字リアクション表示
└── Actions                     # アクションボタン行
    └── EmojiReactionPicker     # 絵文字リアクション選択（条件表示）
```

### Status（`src/app/_parts/Status.tsx`）

個別投稿の表示コンポーネント。ブーストされた投稿の場合は元投稿者情報 + リブーストバーを表示する。

| props | 型 | 説明 |
|---|---|---|
| `status` | `StatusAddAppIndex` | 投稿データ（`appIndex` 付き） |
| `className?` | `string` | 追加CSSクラス |
| `small?` | `boolean` | コンパクト表示（通知内の引用等）。`max-h-24 overflow-clip` |
| `scrolling?` | `boolean` | スクロール中フラグ（画像読み込み抑制） |

| 使用 Context | Provider | 用途 |
|---|---|---|
| `SetDetailContext` | `DetailProvider` | 投稿/ユーザー/ハッシュタグの詳細パネル表示 |
| `SetPlayerContext` | `PlayerProvider` | 動画プレイヤー起動 |
| `AppsContext` | `AppsProvider` | アカウント情報参照 |
| `EmojiCatalogContext` | `ResourceProvider` | サーバー絵文字カタログ |
| `EmojiContext` | `ResourceProvider` | 絵文字フォールバック |

**主な処理:**
- カスタム絵文字の `<img>` 置換（`display_name`、`spoiler_text`、`content` 内の `:shortcode:`）
- `html-react-parser` による HTML コンテンツのパースとリンクのカスタマイズ
  - メンション → `SetDetailContext` で `SearchUser` 詳細表示
  - ハッシュタグ → `SetDetailContext` で `Hashtag` 詳細表示
  - 再生可能なURL → `SetPlayerContext` でプレイヤー起動
- `localReactions` のローカル状態管理（楽観的UI更新）

### Actions（`src/app/_parts/Actions.tsx`）

投稿に対するアクションボタン群。

| props | 型 | 説明 |
|---|---|---|
| `status` | `StatusAddAppIndex` | 対象投稿 |
| `onReactionAdd?` | `(emoji: string) => void` | リアクション追加時のコールバック |

**アクション一覧:**

| ボタン | 機能 | API呼び出し |
|---|---|---|
| リプライ | `SetReplyToContext` で対象投稿を設定 | — |
| ブースト | `client.reblogStatus` / `unreblogStatus` | megalodon |
| お気に入り | `client.favouriteStatus` / `unfavouriteStatus` | megalodon |
| 絵文字リアクション | `EmojiReactionPicker` を表示 → `client.createEmojiReaction` | megalodon |
| ブックマーク | `client.bookmarkStatus` / `unbookmarkStatus` | megalodon |

- `SetActionsContext` 経由で `StatusStoreProvider` の状態を同期更新
- private 投稿はブーストボタン無効化（`FaLock` アイコン表示）
- 絵文字リアクションは `REACTION_BACKENDS` に含まれるバックエンドのみ対応

### MediaAttachments（`src/app/_parts/MediaAttachments.tsx`）

メディア添付ファイルのレイアウト管理。

| props | 型 | 説明 |
|---|---|---|
| `sensitive` | `boolean` | センシティブコンテンツフラグ |
| `mediaAttachments` | `Entity.Attachment[]` | 添付メディア配列 |
| `scrolling?` | `boolean` | スクロール中フラグ |

- メディア数に応じたグリッドレイアウト（1枚: 全幅、2/4枚: 2列、3/5/6枚: 3列、7枚以上: 6枚目以降は `+N` 表示）
- `sensitive: true` の場合、ブラーオーバーレイで非表示（クリックで表示切替）
- 動画/GIF/音声 → `SetPlayerContext` でプレイヤー起動
- 画像 → `SetMediaModalContext` でモーダル表示

### Media（`src/app/_parts/Media.tsx`）

個別メディアの表示。`media.type` に応じて描画を切り替える。

| props | 型 | 説明 |
|---|---|---|
| `media` | `Entity.Attachment` | メディアデータ |
| `onClick?` | `() => void` | クリックハンドラ |
| `scrolling?` | `boolean` | `true` の場合プレースホルダーを表示（画像読み込み抑制） |
| `className?` | `string` | CSSクラス |
| `fullSize?` | `boolean` | フルサイズ表示（`remote_url` 使用） |

**メディアタイプ別レンダリング:**
- `image` → `<img>` タグ（`preview_url` または `url`）
- `video` / `gifv` → `<video>` + 再生オーバーレイ
- `audio` → `<audio>` コントロール
- `unknown` → `null`

### Poll（`src/app/_parts/Poll.tsx`）

投票インターフェース。未投票時は選択UI、投票済み/終了時は結果バーを表示する。

| props | 型 | 説明 |
|---|---|---|
| `poll?` | `PollAddAppIndex & { own_votes: number[] \| undefined } \| null` | 投票データ |

- `poll.multiple` に応じてラジオボタン/チェックボックスを切替
- 投票済み・期限切れ判定（`isPollClosed`）で結果表示モードに遷移
- 投票結果はパーセンテージのグラデーションバーで可視化

### EmojiReactions（`src/app/_parts/EmojiReactions.tsx`）

投稿に付いたカスタム絵文字リアクションの表示と操作。

| props | 型 | 説明 |
|---|---|---|
| `status` | `StatusAddAppIndex` | 対象投稿 |
| `reactions` | `Entity.Reaction[]` | リアクション配列 |
| `onToggle` | `(reactionName: string, currentlyMine: boolean) => void` | トグルコールバック |

- `REACTION_BACKENDS` に含まれるバックエンド（Pleroma/Firefish等）でのみリアクション操作が可能
- 絵文字URLが無い場合、`EmojiCatalogContext` からフォールバック解決
- `toggleReactionInDb` でローカル DB にもリアクション状態を永続化

### EmojiReactionPicker（`src/app/_parts/EmojiReactionPicker.tsx`）

絵文字リアクション選択UI。`emoji-picker-react` を動的インポートし、ポータルで表示する。

| props | 型 | 説明 |
|---|---|---|
| `onSelect` | `(emoji: string) => void` | 絵文字選択コールバック |
| `onClose` | `() => void` | ピッカーを閉じるコールバック |
| `triggerRect` | `DOMRect` | トリガーボタンの位置情報 |
| `reactions?` | `string[]` | クイックリアクション絵文字リスト |
| `backendUrl?` | `string` | バックエンドURL（カスタム絵文字取得用） |

### Card（`src/app/_parts/Card.tsx`）

リンクプレビューカード。メディア添付がない場合にのみ表示される。

| props | 型 | 説明 |
|---|---|---|
| `card` | `Entity.Card \| null` | カードデータ |

- 再生可能なURLの場合、クリックで `SetPlayerContext` によりプレイヤー起動
- OGP 画像、タイトル、説明、URLを表示

### Notification（`src/app/_parts/Notification.tsx`）

通知アイテムの表示。通知タイプに応じた色分けとレイアウトを適用する。

| props | 型 | 説明 |
|---|---|---|
| `notification` | `NotificationAddAppIndex` | 通知データ |
| `scrolling?` | `boolean` | スクロール中フラグ |

**通知タイプ別の表示:**

| 通知タイプ | ボーダー色 | 表示内容 |
|---|---|---|
| `mention` | 緑 (`border-green-500`) | 投稿全文 |
| `reblog` | 青 (`border-blue-500`) | ユーザー情報 + 投稿（small） |
| `favourite` | オレンジ (`border-orange-300`) | ユーザー情報 + ★ + 投稿（small） |
| `emoji_reaction` | オレンジ (`border-orange-300`) | ユーザー情報 + リアクション画像 + 投稿（small） |
| `follow` | ピンク (`border-pink-300`) | "Follow" + ユーザー情報 |
| `follow_request` | ピンク (`border-pink-500`) | "Follow request" + ユーザー情報 |
| `poll_expired` | ティール (`border-teal-300`) | 投稿全文 |
| `status` | 緑 (`border-green-500`) | 投稿全文 |

---

## 5. 主要パネルコンポーネント

### MainPanel（`src/app/_components/MainPanel.tsx`）

投稿フォームとアカウント選択を提供する。

**機能:**
- アカウント切り替え（`select` + `Ctrl+1`〜`Ctrl+9` ショートカット）
- 投稿テキスト入力（`StatusRichTextarea` — オートコンプリート対応）
- 公開範囲選択（public / unlisted / private / direct）
- CW（Content Warning）トグルと注釈テキスト
- リプライ先表示と解除
- メディアアップロード（`Dropzone` コンポーネント）
- メディアリンク入力（再生可能URL検出で再生ボタン有効化）

| 使用 Context | Provider | 用途 |
|---|---|---|
| `AppsContext` | `AppsProvider` | アプリ一覧 |
| `PostAccountContext` | `PostAccountProvider` | 投稿可能アカウント一覧 |
| `SelectedAppIndexContext` | `PostAccountProvider` | 選択中アカウントインデックス |
| `ReplyToContext` | `ReplyToProvider` | リプライ対象投稿 |
| `SetPlayerContext` | `PlayerProvider` | メディア再生 |
| `SettingContext` | `SettingProvider` | デフォルト公開範囲 |

### DetailPanel（`src/app/_components/DetailPanel.tsx`）

投稿スレッド、ユーザープロフィール、ハッシュタグの詳細を表示するパネル。

**表示タイプ:**

| `detail.type` | 表示コンポーネント | 内容 |
|---|---|---|
| `null` | `GettingStarted` | 初期表示（はじめに） |
| `'Status'` | `Virtuoso` + `Status` | 投稿スレッド（ancestors + 対象 + descendants） |
| `'Account'` | `AccountDetail` | ユーザープロフィール |
| `'SearchUser'` | → `Account` に解決 | ユーザー検索 → プロフィール表示 |
| `'Hashtag'` | `HashtagDetail` | ハッシュタグ関連投稿 |

- `Status` 詳細表示時は `client.getStatusContext` でスレッドを取得
- `SearchUser` は ID/acct/URL から `getAccount` または `searchAccount` で解決

---

## 6. FlowEditor（ビジュアルクエリビルダー）

### ディレクトリ構成

```text
src/app/_components/FlowEditor/
├── FlowQueryEditorModal.tsx    # メインモーダル（状態管理 + React Flow Provider）
├── FlowCanvas.tsx              # React Flow キャンバス（controlled）
├── FlowNodePanel.tsx           # ノード設定パネル
├── GetIdsPanel.tsx             # GetIds ノード設定UI
├── MergePanelV2.tsx            # Merge ノード設定UI
├── LookupRelatedPanel.tsx      # LookupRelated ノード設定UI
├── OutputPanelV2.tsx           # Output ノード設定UI
├── flowToQueryPlanV2.ts        # FlowGraphState → QueryPlanV2 変換
├── queryPlanToFlow.ts          # QueryPlanV2 → FlowGraphState 変換
├── flowPresets.ts              # フロープリセット
├── addMenuItems.tsx            # ノード追加メニュー
├── DebugResultPanel.tsx        # テスト実行結果表示
├── debugResultHelpers.ts       # デバッグヘルパー
├── inferFlowSourceType.ts      # フローソースタイプ推定
├── planHelpers.ts              # QueryPlan ヘルパー
├── types.ts                    # 型定義
├── nodes/                      # カスタムノード React Flow コンポーネント
│   ├── GetIdsFlowNode
│   ├── LookupRelatedFlowNode
│   ├── MergeFlowNodeV2
│   └── OutputFlowNodeV2
├── __tests__/                  # テスト
└── index.ts                    # エクスポート
```

### データフローと双方向変換

```text
TimelineConfigV2.queryPlan (QueryPlanV2)
  ↓ queryPlanToFlow()
FlowGraphState { nodes: FlowNode[], edges: FlowEdge[] }
  ↕ React Flow キャンバスで編集
FlowGraphState
  ↓ flowToQueryPlanV2()
QueryPlanV2
  → タイムライン設定に保存
```

### ノードタイプ

| ノードタイプ | パネルUI | 説明 |
|---|---|---|
| `get-ids` | `GetIdsPanel` | テーブル選択、フィルタ条件、EXISTS条件、ソート設定 |
| `lookup-related` | `LookupRelatedPanel` | 関連テーブル参照（JOIN相当）、時間条件 |
| `merge-v2` | `MergePanelV2` | 複数入力のマージ戦略（union / intersect） |
| `output-v2` | `OutputPanelV2` | 最終出力のソート方向・上限数 |

### FlowCanvas（`src/app/_components/FlowEditor/FlowCanvas.tsx`）

React Flow のキャンバスコンポーネント。状態は親 (`FlowQueryEditorModal`) が管理する controlled コンポーネント。

- `FlowActionsContext` でカスタムノードから削除等の操作を提供
- `viewportCenterRef` で親がビューポート中央座標を取得可能
- `FlowExecStatus` でテスト実行状態を子ノードに伝播

---

## 7. NodeEditor（ノードベースフィルタエディタ）

```text
src/app/_components/NodeEditor/
├── NodeEditorPanel.tsx         # メインパネル
├── NodeCard.tsx                # ノードカード表示
├── AddFilterMenu.tsx           # フィルタ追加メニュー
├── AerialReplyBody.tsx         # エアリプフィルタ
├── BackendFilterBody.tsx       # バックエンドフィルタ
├── ExistsFilterBody.tsx        # EXISTS フィルタ
├── RawSQLBody.tsx              # 生SQL入力
├── TableFilterBody.tsx         # テーブルフィルタ
├── TimelineScopeBody.tsx       # タイムラインスコープ
├── ValueInput.tsx              # 値入力コンポーネント
├── nodeCardMeta.tsx            # ノードカードメタ情報
├── nodeCardTypes.ts            # 型定義
└── index.ts                    # エクスポート
```

---

## 8. 状態管理パターン

### 原則

miyulab-fe はグローバル状態管理に **React Context のみ** を使用し、外部状態ライブラリ（Redux, Zustand 等）は不使用。

### Provider 一覧と役割

| Provider | ファイル | 主な Context | 用途 |
|---|---|---|---|
| `SuspenseProvider` | `SuspenseProvider.tsx` | — | Suspense 境界 |
| `AppsProvider` | `AppsProvider.tsx` | `AppsContext` | 登録済みアプリ（アカウント）一覧 |
| `PostAccountProvider` | `PostAccountProvider.tsx` | `PostAccountContext`, `SelectedAppIndexContext` | 投稿用アカウント管理 |
| `SettingProvider` | `SettingProvider.tsx` | `SettingContext` | ユーザー設定（公開範囲、リアクション絵文字等） |
| `TimelineProvider` | `TimelineProvider.tsx` | `TimelineContext`, `SetTimelineContext` | タイムライン構成の読み書き |
| `ResourceProvider` | `ResourceProvider.tsx` | `EmojiContext`, `EmojiCatalogContext`, `SetTagsContext`, `SetUsersContext` | 絵文字・タグ・ユーザーリソース |
| `ReplyToProvider` | `ReplyToProvider.tsx` | `ReplyToContext`, `SetReplyToContext` | リプライ対象投稿 |
| `DetailProvider` | `DetailProvider.tsx` | `DetailContext`, `SetDetailContext` | 詳細パネル表示状態 |
| `MediaModalProvider` | `ModalProvider.tsx` | `MediaModalContext`, `SetMediaModalContext` | メディアモーダル状態 |
| `PlayerProvider` | `PlayerProvider.tsx` | `PlayerContext`, `SetPlayerContext` | 動画/音声プレイヤー状態 |
| `StartupCoordinator` | `StartupCoordinator.tsx` | `StartupCoordinatorContext` | 起動フェーズ管理（`isPhaseReached`, `advanceTo`） |
| `StatusStoreProvider` | `StatusStoreProvider.tsx` | `StatusStoreActionsContext` | 投稿ストア操作（お気に入り/ブースト/ブックマーク） |
| `StreamingManagerProvider` | `StreamingManagerProvider.tsx` | — | WebSocket ストリーム管理 |
| `HomeTimelineProvider` | `HomeTimelineProvider.tsx` | `HomeTimelineContext`, `SetActionsContext` | ホームTLデータ + アクション委譲 |

### StatusStoreActionsContext の使い方

投稿のお気に入り・ブースト・ブックマーク状態の更新は以下のパターンで行う:

```text
Actions コンポーネント
  ↓ ボタンクリック
SetActionsContext.setFavourited(appIndex, statusId, true)
  ↓ HomeTimelineProvider 内で変換
StatusStoreActionsContext.setFavourited(backendUrl, statusId, true)
  ↓ StatusStoreProvider 内で
SQLite DB に状態を書き込み
```

`SetActionsContext`（`HomeTimelineProvider`）は既存 API との互換性のため `appIndex` を受け取り、内部で `apps[appIndex].backendUrl` に変換して `StatusStoreActionsContext` に委譲する。

### コンポーネントからの Context 使用パターン

```typescript
// 1. 読み取り専用 — 値のみ取得
const apps = useContext(AppsContext)
const setting = useContext(SettingContext)

// 2. 読み書きペア — 値と更新関数を別 Context に分離
const detail = useContext(DetailContext)        // 現在の値
const setDetail = useContext(SetDetailContext)  // 更新関数

// 3. アクション呼び出し — 状態操作関数のみ
const setActions = useContext(SetActionsContext)
setActions.setFavourited(appIndex, statusId, true)
```

---

## 9. 主要データフローまとめ

```text
Fediverse Server
  ↓ megalodon ライブラリ（REST API / WebSocket）
StreamingManagerProvider（ストリーム管理）
  ↓ upsertStatus / addNotification
SQLite Wasm（ブラウザ内DB）
  ↓ クエリ実行
useTimelineDataSource → useTimelineList → useTimelineData
  ↓ StatusAddAppIndex[] / NotificationAddAppIndex[]
UnifiedTimeline / MixedTimeline / NotificationTimeline
  ↓ react-virtuoso（仮想スクロール）
Status / Notification コンポーネント
  ↓ ユーザー操作
Actions → megalodon API + StatusStoreProvider（DB同期）
```

---

## 次に読むべきドキュメント

- [`08-migration-system.md`](./08-migration-system.md) — マイグレーションシステムの設計と実装
