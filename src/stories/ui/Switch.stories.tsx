import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Switch } from 'components/ui/switch'

const meta = { component: Switch, title: 'UI/Switch' } satisfies Meta<
  typeof Switch
>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { 'aria-label': '通知を有効にする' } }
export const Checked: Story = {
  args: { ...Default.args, defaultChecked: true },
}
export const Disabled: Story = { args: { ...Checked.args, disabled: true } }
