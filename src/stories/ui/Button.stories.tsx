import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Button } from 'components/ui/button'

const meta = {
  argTypes: {
    size: { control: 'select', options: ['sm', 'default', 'lg', 'icon'] },
    variant: {
      control: 'select',
      options: [
        'default',
        'secondary',
        'outline',
        'ghost',
        'link',
        'destructive',
      ],
    },
  },
  component: Button,
  title: 'UI/Button',
} satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = { args: { children: '投稿する' } }
export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      {(
        [
          'default',
          'secondary',
          'outline',
          'ghost',
          'link',
          'destructive',
        ] as const
      ).map((variant) => (
        <Button key={variant} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  ),
}
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      {(['sm', 'default', 'lg', 'icon'] as const).map((size) => (
        <Button aria-label={size} key={size} size={size}>
          {size === 'icon' ? '+' : size}
        </Button>
      ))}
    </div>
  ),
}
export const Disabled: Story = { args: { children: '送信中…', disabled: true } }
