import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from 'components/ui/context-menu'

const meta = { component: ContextMenu, title: 'UI/ContextMenu' } satisfies Meta<
  typeof ContextMenu
>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger className="flex h-40 w-80 items-center justify-center rounded border border-dashed">
        右クリックでメニューを表示
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem>投稿を開く</ContextMenuItem>
        <ContextMenuItem>リンクをコピー</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled>削除する</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}
