import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'components/ui/select'

const meta = { component: Select, title: 'UI/Select' } satisfies Meta<
  typeof Select
>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Select defaultValue="public">
      <SelectTrigger aria-label="公開範囲" className="w-60">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="public">公開</SelectItem>
        <SelectItem value="unlisted">未収載</SelectItem>
        <SelectItem value="private">フォロワー限定</SelectItem>
      </SelectContent>
    </Select>
  ),
}
