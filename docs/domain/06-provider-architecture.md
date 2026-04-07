# Provider構成

miyulab-fe は外部状態管理ライブラリ（Redux / Zustand / Jotai 等）を一切使用せず、**React Context のみ**でアプリケーション全体の状態を管理している。本ドキュメントでは Provider チェーンの全体像、各 Provider の責務、起動シーケンス、および依存関係を解説する。

---

## 目次

1. [Provider チェーン全体像](#provider-チェーン全体像)
2. [各 Provider の責務](#各-provider-の責務)
3. [StartupCoordinator の初期化シーケンス](#startupcoordinator-の初期化シーケンス)
4. [Provider 間の依存関係](#provider-間の依存関係)
5. [状態管理の設計方針](#状態管理の設計方針)
6. [新規 Provider 追加のガイドライン](#新規-provider-追加のガイドライン)
7. [次に読むべきドキュメント](#次に読むべきドキュメント)

---

## Provider チェーン全体像

`src/app/layout.tsx` にて 14 層の Provider がネストされている。外側から内側への順序は以下の通り。

```
<html>
  <body>
    ① SuspenseProvider
      ② AppsProvider
        ③ PostAccountProvider
          ④ SettingProvider
            ⑤ TimelineProvider
              <Suspense>          ← React 標準の Suspense バウンダリ
                ⑥ ResourceProvider
                  ⑦ ReplyToProvider
                    ⑧ DetailProvider
                      ⑨ MediaModalProvider
                        ⑩ PlayerProvider
                          ⑪ StartupCoordinator
                            ⑫ StatusStoreProvider
                              ⑬ StreamingManagerProvider
                                ⑭ HomeTimelineProvider
                                  <Toaster />
                                  {children}
    <QueryLogBridge />
    <Analytics />
```

> **設計意図**: 外側の Provider ほど基盤的な役割を持ち、内側の Provider がそのコンテキストを `useContext` で参照する。`<Suspense>` は ⑤ TimelineProvider と ⑥ ResourceProvider の間に挿入され、ResourceProvider 以下の非同期初期化をサスペンドできるようにしている。

**ソースファイル**: `src/app/layout.tsx`

---

## 各 Provider の責務

### 一覧テーブル

| # | Provider | ファイル | 提供する Context | 主要な機能 |
|---|----------|----------|-----------------|-----------|
| ① | SuspenseProvider | `SuspenseProvider.tsx` | なし（React `<Suspense>` ラッパー） | AppsProvider 内で `useSearchParams()` を使用するために必要な Suspense バウンダリを提供 |
| ② | AppsProvider | `AppsProvider.tsx` | `AppsContext`, `UpdateAppsContext` | ログイン済み Fediverse アカウント (App[]) の管理、OAuth フロー、トークンリフレッシュ |
| ③ | PostAccountProvider | `PostAccountProvider.tsx` | `PostAccountContext`, `SelectedAppIndexContext`, `SetSelectedAppIndexContext` | 投稿時のアカウント選択、アカウントクレデンシャル検証 |
| ④ | SettingProvider | `SettingProvider.tsx` | `SettingContext`, `SetSettingContext` | アプリ全体の設定（センシティブ表示、プレイヤーサイズ、デフォルト公開範囲、リアクション絵文字など） |
| ⑤ | TimelineProvider | `TimelineProvider.tsx` | `TimelineContext`, `SetTimelineContext` | タイムライン設定 (TimelineSettings V2) の管理・永続化 |
| ⑥ | ResourceProvider | `ResourceProvider.tsx` | `InstanceContext`, `EmojiContext`, `EmojiCatalogContext`, `UsersContext`, `SetUsersContext`, `TagsContext`, `SetTagsContext` | 絵文字カタログ（サーバ別）、インスタンス情報、ユーザーオートコンプリート候補、ハッシュタグ履歴 |
| ⑦ | ReplyToProvider | `ReplyToProvider.tsx` | `ReplyToContext`, `SetReplyToContext` | リプライ先ステータスの保持 |
| ⑧ | DetailProvider | `DetailProvider.tsx` | `DetailContext`, `SetDetailContext` | 右パネルで表示中の詳細（Account / Status / SearchUser / Hashtag）、URL 同期・popstate ハンドリング |
| ⑨ | MediaModalProvider | `ModalProvider.tsx` | `MediaModalContext`, `SetMediaModalContext` | メディアライトボックスの表示対象 (Attachment[] + index) |
| ⑩ | PlayerProvider | `PlayerProvider.tsx` | `PlayerContext`, `SetPlayerContext`, `PlayerSettingContext`, `SetPlayerSettingContext` | オーディオ/ビデオ再生状態、音量設定の永続化 |
| ⑪ | StartupCoordinator | `StartupCoordinator.tsx` | `StartupCoordinatorContext` | マルチフェーズ初期化シーケンスの管理（DB → 表示 → REST → Streaming） |
| ⑫ | StatusStoreProvider | `StatusStoreProvider.tsx` | `StatusStoreActionsContext` | SQLite への投稿データ CRUD、userStreaming の管理、定期クリーンアップ / エクスポート |
| ⑬ | StreamingManagerProvider | `StreamingManagerProvider.tsx` | `StreamingManagerContext` | local / public / tag ストリームの一元管理、タイムライン設定変更時のストリーム同期 |
| ⑭ | HomeTimelineProvider | `HomeTimelineProvider.tsx` | `HomeTimelineContext`, `NotificationsContext`, `SetActionsContext` | レガシー互換のホームタイムライン / 通知データ提供、appIndex → backendUrl 変換 |

> すべての Provider ファイルは `src/util/provider/` に配置されている。

### 各 Provider の詳細

#### ① SuspenseProvider

- **ファイル**: `src/util/provider/SuspenseProvider.tsx`
- **Context**: なし
- **役割**: React の `<Suspense>` をラップするだけのコンポーネント。AppsProvider 内で Next.js の `useSearchParams()` が使用されており、これには祖先に Suspense バウンダリが必要なため、最外層に配置されている。
- **依存**: なし

#### ② AppsProvider

- **ファイル**: `src/util/provider/AppsProvider.tsx`
- **Context**:
  - `AppsContext` — `App[]`（ログイン済みアカウントの配列）
  - `UpdateAppsContext` — `(data: App[]) => void`
- **役割**:
  - localStorage からアカウント情報を復元
  - OAuth コールバック（`code` / `session` パラメータ）処理
  - アクセストークンのリフレッシュ（有効期限24時間以内の場合）
  - megalodon による SNS 種別の自動検出、Misskey の MiAuth 対応
  - 未ログイン時はログイン画面を表示し、`children` をレンダリングしない（**ゲート Provider**）
- **依存**: なし（最外層）

#### ③ PostAccountProvider

- **ファイル**: `src/util/provider/PostAccountProvider.tsx`
- **Context**:
  - `PostAccountContext` — `VerifiedAccount[]`
  - `SelectedAppIndexContext` — `number`（現在選択中のアカウントインデックス）
  - `SetSelectedAppIndexContext` — `Dispatch<SetStateAction<number>>`
- **役割**:
  - `AppsContext` の各アカウントに対して `verifyAccountCredentials` を呼び出し、有効なアカウント一覧を構築
  - 投稿フォームでのアカウント切り替え機能を提供
  - apps 変更時にアカウント一覧をリセットし、stale な参照を防止
- **依存**: `AppsContext`

#### ④ SettingProvider

- **ファイル**: `src/util/provider/SettingProvider.tsx`
- **Context**:
  - `SettingContext` — `SettingData`
  - `SetSettingContext` — `Dispatch<SetStateAction<SettingData>>`
- **SettingData の型**:
  ```typescript
  type SettingData = {
    showSensitive: boolean
    playerSize: 'small' | 'medium' | 'large'
    defaultStatusVisibility: Entity.StatusVisibility
    recentHashtagsCount: number
    reactionEmojis: string[]
    captureRawData: boolean
  }
  ```
- **役割**: localStorage との双方向同期、`captureRawData` フラグによるデバッグ用 raw データキャプチャの連動
- **依存**: なし（独立）

#### ⑤ TimelineProvider

- **ファイル**: `src/util/provider/TimelineProvider.tsx`
- **Context**:
  - `TimelineContext` — `TimelineSettings`
  - `SetTimelineContext` — `Dispatch<SetStateAction<TimelineSettings>>`
- **役割**:
  - タイムライン設定（V2 形式）の管理と localStorage への永続化
  - V2 以外の古い形式の検出時にデフォルト設定へフォールバック
  - 非 Advanced Query モードの `customQuery` を自動クリーンアップ
- **依存**: なし（独立）

#### ⑥ ResourceProvider

- **ファイル**: `src/util/provider/ResourceProvider.tsx`
- **Context（7つ）**:
  - `InstanceContext` — `PleromaInstance | null`
  - `EmojiContext` — `Entity.Emoji[]`（ピッカー用、最初のアカウントのカスタム絵文字 + Unicode 絵文字）
  - `EmojiCatalogContext` — `Map<string, Entity.Emoji[]>`（backendUrl → 絵文字リストのマップ）
  - `UsersContext` / `SetUsersContext` — ユーザーオートコンプリート候補
  - `TagsContext` / `SetTagsContext` — ハッシュタグ履歴（長さ順ソート済み）
- **役割**:
  - 全アカウントのサーバからカスタム絵文字を取得し、SQLite と React state にキャッシュ
  - Unicode 絵文字を `node-emoji` + `unicode-emoji-json` から構築
  - インスタンス情報を取得（upload_limit 等の Pleroma 拡張フィールド対応）
  - ユーザー / タグ情報の localStorage 永続化
- **依存**: `AppsContext`

#### ⑦ ReplyToProvider

- **ファイル**: `src/util/provider/ReplyToProvider.tsx`
- **Context**:
  - `ReplyToContext` — `Entity.Status | undefined`
  - `SetReplyToContext` — `Dispatch<SetStateAction<Entity.Status | undefined>>`
- **役割**: リプライ先ステータスの一時保持。投稿フォームとタイムライン間の連携に使用
- **依存**: なし（独立）

#### ⑧ DetailProvider

- **ファイル**: `src/util/provider/DetailProvider.tsx`
- **Context**:
  - `DetailContext` — `SetDetailParams`（`Account | Status | SearchUser | Hashtag | null` の判別共用体）
  - `SetDetailContext` — `Dispatch<SetStateAction<SetDetailParams>>`
- **役割**:
  - 右パネルに表示する詳細コンテンツの管理
  - `setDetail` 呼び出し時に URL を `history.pushState` で同期更新
  - ブラウザの戻る/進む（`popstate`）ハンドリングと `history.state` からの復元
  - 直接 URL アクセス時のフォールバック（ホームへリダイレクト）
- **依存**: なし（独立、ただし `util/panelNavigation` を使用）

#### ⑨ MediaModalProvider

- **ファイル**: `src/util/provider/ModalProvider.tsx`
- **Context**:
  - `MediaModalContext` — `{ attachment: Entity.Attachment[], index: number | null }`
  - `SetMediaModalContext` — 対応する setter
- **役割**: メディアライトボックス（画像/動画のフルスクリーン表示）の表示状態管理
- **依存**: なし（独立）

#### ⑩ PlayerProvider

- **ファイル**: `src/util/provider/PlayerProvider.tsx`
- **Context（4つ）**:
  - `PlayerContext` — `{ attachment: Entity.Attachment[], index: number | null }`
  - `SetPlayerContext` — 対応する setter
  - `PlayerSettingContext` — `{ volume: number }`
  - `SetPlayerSettingContext` — 対応する setter
- **役割**:
  - オーディオ/ビデオの再生状態管理
  - 音量設定の localStorage 永続化
- **依存**: なし（独立）

#### ⑪ StartupCoordinator

- **ファイル**: `src/util/provider/StartupCoordinator.tsx`
- **Context**:
  - `StartupCoordinatorContext` — `StartupCoordinatorValue`
    ```typescript
    type StartupCoordinatorValue = {
      phase: StartupPhase
      isPhaseReached: (target: StartupPhase) => boolean
      advanceTo: (target: StartupPhase) => void
    }
    ```
- **役割**: アプリケーションの起動を 5 段階のフェーズで制御。詳細は[後述](#startupcoordinator-の初期化シーケンス)
- **依存**: `AppsContext`

#### ⑫ StatusStoreProvider

- **ファイル**: `src/util/provider/StatusStoreProvider.tsx`
- **Context**:
  - `StatusStoreActionsContext` — `StatusStoreActions`
    ```typescript
    type StatusStoreActions = {
      setFavourited: (backendUrl: string, statusId: string, value: boolean) => void
      setReblogged: (backendUrl: string, statusId: string, value: boolean) => void
      setBookmarked: (backendUrl: string, statusId: string, value: boolean) => void
    }
    ```
- **役割**:
  - **userStreaming のみ**を管理（update / status_update / notification / delete イベント）
  - REST API による初回データ取得（ホームタイムライン + 通知、各 40 件）
  - SQLite への一括書き込み（`bulkUpsertStatuses`, `bulkAddNotifications`）
  - ユーザー情報・タグ情報の収集（ResourceProvider の SetUsers / SetTags を使用）
  - 定期クリーンアップ・定期エクスポートの起動
  - フェーズ連動: `timeline-displayed` → REST 取得 → `rest-fetched` → userStreaming 接続
- **依存**: `AppsContext`, `SetUsersContext`, `SetTagsContext`, `StartupCoordinatorContext`

#### ⑬ StreamingManagerProvider

- **ファイル**: `src/util/provider/StreamingManagerProvider.tsx`
- **Context**:
  - `StreamingManagerContext` — `{ getStatus: (key: string) => StreamEntry['status'] | null }`
- **役割**:
  - local / public / tag ストリームの一元管理
  - `TimelineSettings` の変更に連動した diff ベースのストリーム同期（`syncStreamsEvent`）
  - `deriveRequiredStreams` で必要ストリームの集合を算出し、不要なストリームを切断・新規ストリームを接続
  - 初期データ取得の並行度制限（`INITIAL_FETCH_CONCURRENCY`）
  - WebSocket のリトライ管理（指数バックオフ）
- **依存**: `AppsContext`, `TimelineContext`, `StartupCoordinatorContext`

#### ⑭ HomeTimelineProvider

- **ファイル**: `src/util/provider/HomeTimelineProvider.tsx`
- **Context（3つ）**:
  - `HomeTimelineContext` — `StatusAddAppIndex[]`
  - `NotificationsContext` — `NotificationAddAppIndex[]`
  - `SetActionsContext` — `SetActions`（appIndex ベースの互換 API）
- **役割**:
  - レガシー互換のデータ提供（`useTimelineData` Hook 経由で SQLite からデータ取得）
  - `db-ready` フェーズゲート: DB が初期化されるまでデータ取得を無効化
  - 初回データ取得完了時に `advanceTo('timeline-displayed')` を呼び出し
  - `appIndex → backendUrl` 変換を行い、新旧 API の橋渡し
- **依存**: `AppsContext`, `StatusStoreActionsContext`, `StartupCoordinatorContext`

---

## StartupCoordinator の初期化シーケンス

### フェーズ定義

アプリケーションの起動は以下の 5 フェーズで順次進行する。各フェーズは前のフェーズの完了を待ってから開始される。

```
init → db-ready → timeline-displayed → rest-fetched → streaming
 ①       ②             ③                   ④            ⑤
```

| フェーズ | 担当 Provider | 内容 |
|---------|--------------|------|
| `init` | — | 初期状態。アプリ起動直後 |
| `db-ready` | StartupCoordinator | SQLite Wasm の接続・マイグレーション完了、`accountResolver` の初期化完了 |
| `timeline-displayed` | HomeTimelineProvider | DB キャッシュからホームタイムラインと通知の初回表示完了（ユーザーに最初のコンテンツが見える状態） |
| `rest-fetched` | StatusStoreProvider | REST API でホームタイムライン（40件）と通知（40件）を取得し DB に書き込み完了 |
| `streaming` | StreamingManagerProvider | WebSocket ストリーミング接続完了（user / local / public / tag） |

### API

```typescript
// 指定フェーズ以上に到達しているか判定
const reached = isPhaseReached('db-ready')  // boolean

// フェーズを進める（逆行は自動的に無視される）
advanceTo('rest-fetched')
```

- `advanceTo()` は現在のフェーズより後段のフェーズのみ受け付ける。すでに到達済みのフェーズへの呼び出しは無視される。
- 各フェーズ遷移時に `performance.now()` ベースの経過時間がコンソールにログ出力される。

### なぜフェーズ管理が必要か

1. **体感速度の最適化**: DB キャッシュから即座にタイムラインを表示し（Phase 2）、その後 REST API で最新データを取得する（Phase 3）。ユーザーは DB キャッシュの内容をすぐに閲覧できる。
2. **リソース競合の回避**: SQLite Wasm の初期化、REST API 呼び出し、WebSocket 接続を同時に行うと、ブラウザのリソース（Worker スレッド、ネットワーク接続）が枯渇する。フェーズ分離により段階的にリソースを確保する。
3. **依存関係の明示**: `local_accounts` テーブルが存在しないと `bulkUpsertStatuses` が `timeline_entries` を作成できない。フェーズにより前提条件の充足を保証する。
4. **デバッグ容易性**: コンソールログでフェーズ遷移と所要時間を確認でき、パフォーマンスボトルネックの特定が容易。

### 各 Provider のフェーズ連携

```
StartupCoordinator
  └─ Phase 1: DB 初期化 + accountResolver → advanceTo('db-ready')

HomeTimelineProvider
  └─ Phase 2: db-ready を待って DB キャッシュ表示 → advanceTo('timeline-displayed')

StatusStoreProvider
  └─ Phase 3: timeline-displayed を待って REST 取得 → advanceTo('rest-fetched')
  └─ Phase 4: rest-fetched を待って userStreaming 接続

StreamingManagerProvider
  └─ Phase 4: rest-fetched を待って local/public/tag ストリーム同期 → advanceTo('streaming')
```

---

## Provider 間の依存関係

内側の Provider が外側の Provider の Context を `useContext` で参照している関係を示す。

### 依存グラフ

```
AppsContext ─────────────────────────────────────────────┐
  │                                                      │
  ├──→ PostAccountProvider (AppsContext)                  │
  │                                                      │
  ├──→ ResourceProvider (AppsContext)                     │
  │       │                                              │
  │       ├── SetUsersContext ──→ StatusStoreProvider     │
  │       └── SetTagsContext  ──→ StatusStoreProvider     │
  │                                                      │
  ├──→ StartupCoordinator (AppsContext)                   │
  │       │                                              │
  │       └── StartupCoordinatorContext                   │
  │             ├──→ StatusStoreProvider                  │
  │             ├──→ StreamingManagerProvider             │
  │             └──→ HomeTimelineProvider                 │
  │                                                      │
  ├──→ StatusStoreProvider (AppsContext)                  │
  │       │                                              │
  │       └── StatusStoreActionsContext                   │
  │             └──→ HomeTimelineProvider                 │
  │                                                      │
  ├──→ StreamingManagerProvider (AppsContext)              │
  │                                                      │
  └──→ HomeTimelineProvider (AppsContext) ────────────────┘

TimelineContext ──→ StreamingManagerProvider
```

### 依存の方向（まとめ）

| Provider | 依存する Context |
|----------|-----------------|
| SuspenseProvider | なし |
| AppsProvider | なし |
| PostAccountProvider | `AppsContext` |
| SettingProvider | なし |
| TimelineProvider | なし |
| ResourceProvider | `AppsContext` |
| ReplyToProvider | なし |
| DetailProvider | なし |
| MediaModalProvider | なし |
| PlayerProvider | なし |
| StartupCoordinator | `AppsContext` |
| StatusStoreProvider | `AppsContext`, `SetUsersContext`, `SetTagsContext`, `StartupCoordinatorContext` |
| StreamingManagerProvider | `AppsContext`, `TimelineContext`, `StartupCoordinatorContext` |
| HomeTimelineProvider | `AppsContext`, `StatusStoreActionsContext`, `StartupCoordinatorContext` |

---

## 状態管理の設計方針

### React Context のみを使用

本プロジェクトでは Redux, Zustand, Jotai などの外部状態管理ライブラリを一切使用していない。すべてのグローバル状態は React Context + `useState` / `useRef` で管理されている。

### 実装から読み取れる事実

1. **永続化は localStorage で直接行う**: `SettingProvider`, `TimelineProvider`, `PlayerProvider`, `ResourceProvider` はいずれも `localStorage.getItem` / `setItem` で初期化・同期を行っている。ストレージアクセスは各 Provider 内に閉じている。

2. **重いデータは SQLite Wasm に格納**: タイムラインのステータスや通知は `localStorage` ではなく SQLite Wasm（Worker 経由）に格納される。React state にはデータそのものではなく、取得済みかどうかのフラグやアクション関数のみが保持される。

3. **getter / setter パターンの一貫性**: ほぼすべての Provider が `XxxContext`（値）と `SetXxxContext`（setter）のペアで Context を公開している。これにより、値の読み取りだけが必要なコンポーネントが setter の変更で再レンダリングされることを防いでいる。

4. **ゲート Provider パターン**: `AppsProvider` はログイン完了まで `children` をレンダリングしない。これにより、内側のすべての Provider は「少なくとも 1 つの認証済みアカウントが存在する」ことを前提にできる。

5. **useEffectEvent による安定化**: `StatusStoreProvider` と `StreamingManagerProvider` は `useEffectEvent` を使用して、イベントハンドラの参照を安定化している。これにより、コールバック内で常に最新の state を参照しつつ、useEffect の依存配列を最小限に保っている。

6. **StrictMode ガード**: 開発環境の React StrictMode では Effect が2回実行される。`StatusStoreProvider`, `StreamingManagerProvider`, `StartupCoordinator` は `refFirstRef` パターンで初回の二重実行を防止している。

---

## 新規 Provider 追加のガイドライン

### ファイル配置

- `src/util/provider/` ディレクトリに `XxxProvider.tsx` として配置する
- ファイル先頭に `'use client'` ディレクティブを記述する（すべての Provider は Client Component）

### Context 作成パターン

既存の Provider に倣い、以下のパターンで作成する:

```typescript
'use client'

import { createContext, type Dispatch, type ReactNode, type SetStateAction, useState } from 'react'

// 1. 型定義
type MyData = { /* ... */ }

// 2. Context 作成（値と setter を分離）
export const MyContext = createContext<MyData>(/* 初期値 */)
export const SetMyContext = createContext<Dispatch<SetStateAction<MyData>>>(() => {})

// 3. Provider コンポーネント
export const MyProvider = ({ children }: Readonly<{ children: ReactNode }>) => {
  const [data, setData] = useState<MyData>(/* 初期値 */)

  return (
    <MyContext.Provider value={data}>
      <SetMyContext.Provider value={setData}>
        {children}
      </SetMyContext.Provider>
    </MyContext.Provider>
  )
}
```

### layout.tsx への追加位置の決め方

1. **他の Provider に依存しない場合**: 独立した Provider は比較的自由に配置できる。UI 関連のシンプルな状態であれば、⑦〜⑩ の層（ReplyTo / Detail / MediaModal / Player 付近）に配置する。

2. **他の Provider の Context を使用する場合**: 依存する Provider よりも**内側**に配置する必要がある。例えば `AppsContext` を使用する Provider は `AppsProvider` の内側に置く。

3. **フェーズ制御が必要な場合**: `StartupCoordinatorContext` を使用する Provider は `StartupCoordinator` の内側（⑪〜⑭の範囲）に配置する。

4. **インポートの追加**: `layout.tsx` の import セクションに追加する。既存のインポートはアルファベット順に並んでいる。

---

## 次に読むべきドキュメント

- [`07-component-architecture.md`](./07-component-architecture.md) — コンポーネントアーキテクチャ（`_components/` と `_parts/` の使い分け、ページ構成）
