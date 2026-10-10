# UI画像の生成条件

built-in image_genで編集。架空データによる設計モック。

## overview-all.png

```text
Edit this design board while preserving column layout, avatars, notification text, existing notification-type border colors, header check-check controls, tab placement and the all-account tooltip. In ALL application notification rows including the small narrow-column example, remove every visible status pill and every inline label 「未読」「既読」「未確認」. Replace unread row statuses with a single small solid blue circular dot, about 8px, at the top-right metadata position. Read rows have NO status indicator at all: no text, checkmark, pill or dot. Unknown rows have ONLY a small gray outlined circular ring of the same 8px size, no dash or text. Remove unread-only background tint so dot is the only new row emphasis; keep usual dark row background and original kind borders. Update right annotation 2's explanation to 「青い丸ポチのみ」 and right annotation 3's explanation to 「グレーの輪郭のみ」. Update bottom annotation to 「丸ポチで状態を区別」. Update bottom legend: first cell a blue solid dot, second cell blank, third cell a gray outlined circle, with captions outside the cells 「未読の通知」「既読の通知」「状態が未確認の通知」. Annotation text outside the application remains allowed. No new controls, counts, selections or dialogs. Exact all-account tooltip remains 「全アカウントの通知をすべて既読にする」.
```

## operation-all.png

```text
Edit this three-panel all-account notification operation design board. Preserve title, header buttons/spinner/tooltips, avatars, notification content, no-dialog flow, toast messages and retry button. Remove ALL inline status words 「未読」「既読」「未確認」, pills, dashes and checkmarks from the application notification rows. In panels 1 and 2 replace former unread indicators with ONLY a small solid blue 8px circular dot at the row top-right; replace former unknown indicators with ONLY a gray outlined 8px circular ring. In panel 3, successful rows have no status indicator whatsoever; keep one solid blue unread dot on the third notification row to show the failed account's notification remains unread. Do not add state text or background tint to rows. Toast text, toast icons, explanatory panel headings and action tooltips stay readable and unchanged. The successful toast at bottom is a separate all-success example; label it above with 「全件成功の例」, so it is not mistaken for a simultaneous result of the failure toast. No selection UI or confirmation modal.
```
