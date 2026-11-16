import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Visibility } from 'app/_parts/Visibility'

const meta = {
  args: { visibility: 'public' },
  argTypes: {
    visibility: {
      control: 'select',
      options: ['public', 'unlisted', 'private', 'direct'],
    },
  },
  component: Visibility,
  title: 'App/Status/Visibility',
} satisfies Meta<typeof Visibility>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = { args: { visibility: 'public' } }
export const All: Story = {
  render: () => (
    <div className="flex gap-6">
      {(['public', 'unlisted', 'private', 'direct'] as const).map(
        (visibility) => (
          <div className="flex items-center gap-2" key={visibility}>
            <Visibility visibility={visibility} />
            {visibility}
          </div>
        ),
      )}
    </div>
  ),
}
