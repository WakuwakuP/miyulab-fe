import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from 'components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from 'components/ui/dialog'

const meta = { component: Dialog, title: 'UI/Dialog' } satisfies Meta<
  typeof Dialog
>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger asChild>
        <Button>ダイアログを開く</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>設定の確認</DialogTitle>
          <DialogDescription>
            タイムラインの表示設定を変更します。
          </DialogDescription>
        </DialogHeader>
        <p>ダイアログの本文を確認できます。</p>
        <DialogFooter>
          <DialogClose asChild>
            <Button>閉じる</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
export const Open: Story = { ...Default, args: { defaultOpen: true } }
