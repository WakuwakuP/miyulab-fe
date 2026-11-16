import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from 'components/ui/combobox'

const meta = { component: Combobox, title: 'UI/Combobox' } satisfies Meta<
  typeof Combobox
>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Combobox items={['Mastodon', 'Misskey', 'Pleroma', 'Friendica']}>
      <ComboboxInput
        aria-label="バックエンド"
        placeholder="バックエンドを検索…"
        showClear
      />
      <ComboboxContent>
        <ComboboxEmpty>見つかりませんでした。</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  ),
}
