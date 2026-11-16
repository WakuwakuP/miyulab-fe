import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Panel } from 'app/_parts/Panel'
import { TimelineLoading } from 'app/_parts/TimelineLoading'
import { fn } from 'storybook/test'

const meta = {
  args: {
    children: <p className="p-4">新しい投稿はありません。</p>,
    className: 'bg-gray-900 text-gray-100',
    name: 'ホーム',
    onClickHeader: fn(),
  },
  component: Panel,
  decorators: [
    (Story) => (
      <div className="max-w-md text-gray-100">
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'fullscreen' },
  title: 'App/Timeline/Panel',
} satisfies Meta<typeof Panel>
export default meta
type Story = StoryObj<typeof meta>
export const Empty: Story = {}
export const Loading: Story = { args: { children: <TimelineLoading /> } }
export const LongTitle: Story = {
  args: {
    name: 'とても長いタイムライン名の表示を確認するためのサンプル',
    queryDuration: 12.34,
  },
}
