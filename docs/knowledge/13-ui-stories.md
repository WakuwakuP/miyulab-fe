# 共通UIのStory

Storybookの起動・使い方は [README](../../README.md#storybookでuiを確認する) を参照。

`src/stories/ui/` は、本番画面から参照される共通部品だけを収録する。

| Story | 本番での利用箇所 |
| --- | --- |
| Button / Carousel | MediaModal（画像ビューアー） |
| Input / Select / Combobox | Flow Editorの条件・値入力 |
| Switch | Flow Editorの条件・関連投稿設定 |
| Dialog | FlowQueryEditorModal |
| ContextMenu | ProxyImageの画像メニュー |

共通部品を追加する前に、`src/app/page.tsx`・`layout.tsx` からの参照を確認する。ファイルが存在することだけを理由にStoryを追加しない。

新しいStoryは `@storybook/nextjs-vite` の `Meta` / `StoryObj` を使い、`satisfies Meta<typeof Component>` で型を検証する。CSSは `.storybook/preview.tsx` が本番の `globals.css` を読み込む。生成UIのソースをStory都合で変更しない。

旧NodeEditor・旧フィルターUIと、それらだけが使用していたBadge / Checkbox / Popover、および未使用のCard / Command / Tabs / Tooltipは削除済み。現在の条件編集はFlow Editorを参照する。
