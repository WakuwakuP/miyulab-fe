# アプリ画面のStory

実際のコンポーネントをそのまま描画し、API・SQLite・サーバー処理の境界だけをStory用データに置き換える。

## 収録対象

- `App/Status/Post`: Status全体。通常、画像、Reblog、Fav済み、Reblog済み、ブックマーク、CW、非公開、DM、投票・投票結果、絵文字リアクション、長文。
- `App/Status/Notification`: お気に入り、Reblog、メンション、フォロー、フォローリクエスト、絵文字リアクション、既読。
- `App/Panels/Detail`: DetailPanel内のユーザープロフィール（投稿・メディアタブ、フォロー状態）と投稿スレッド。
- `App/Panels/Compose`: MainPanelの新規投稿、返信、入力済み、CW付き投稿。
- `App/Panels/Settings`: Getting Startedメニュー、一般設定、タイムライン管理、アカウント、DB統計、クラウドバックアップ、DB診断。
- `App/Settings/TimelineEditor`: 本番のFlowQueryEditorModal（ホーム、通知、画像付きハッシュタグ）、ミュートアカウント、ブロックインスタンス。

## データと副作用

`src/stories/support/fixtures.ts` は型付きの架空アカウント・投稿・設定を持つ。画像は `.storybook/assets/` から配信し、外部サイトに依存しない。

`StoryEnvironment` は本番のContextにメモリ内の状態を供給する。RootLayout、AppsProvider、StartupCoordinator、StreamingManagerProviderなどの起動処理はマウントしない。設定の変更はStoryを再マウントすると戻る。

`.storybook/main.ts` のViteプラグインは、絶対importと相対importの両方で以下を差し替える。この差し替えはStorybookだけで有効。

- Fediverseクライアントと登録・認証処理: `.storybook/mocks/client.ts` / `registration.ts`。送信、Fav、Reblog、フォローなどは `fn()` でActionsに記録。未定義APIは明示的なエラーにする。
- SQLite接続: `database.ts`。統計とミュート／ブロック一覧はfixture。グラフのテスト実行は0件の固定結果であり、SQLの正しさを検証するものではない。永続DBやWorkerは起動しない。
- サーバーアクション、診断アップロード、データ収集: `serverActions.ts` / `diagnostics.ts` / `capture.ts`。クラウド保存・復元と実アカウントのログインは実行しない。
- 公開環境設定: `environment.ts`。開発者の実サーバーURLを使用しない。

バックアップのStoryは現在のBackup／Restore操作と、保存済み・空のリストア一覧を表示する。認証状態と一覧はフィクスチャで、保存・復元の実行は無効化している。DB診断は無効状態を表示する。外部サービスの成功フローは別途統合テストで確認する。

StoryごとのAPI状態を変える場合は `beforeEach` でmockを設定し、戻り値のcleanupで `mockReset()` する。設定フォームやタイムライン管理は実際に操作できる。データ取得が必要な画面を追加するときは本番UIをコピーせず、必要なサービスfixtureを追加する。

## 検証

`yarn typecheck`、`yarn check`、`yarn build-storybook` を実行する。ブラウザーではPC／モバイル幅で描画エラー、画像ロード、横はみ出し、操作後の表示を確認する。`play` を持つStoryは入力完了まで待って確認する。
