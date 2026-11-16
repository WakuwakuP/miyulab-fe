import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Input } from 'components/ui/input'

const meta = { component: Input, title: 'UI/Input' } satisfies Meta<
  typeof Input
>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { 'aria-label': 'サーバーURL', placeholder: 'https://example.social' },
}
export const Disabled: Story = { args: { ...Default.args, disabled: true } }
export const Invalid: Story = {
  args: {
    ...Default.args,
    'aria-invalid': true,
    className: 'border-destructive',
    defaultValue: 'invalid url',
  },
}
export const Filled: Story = {
  args: { ...Default.args, defaultValue: 'https://example.social' },
}
