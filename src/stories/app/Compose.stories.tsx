import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { MainPanel } from 'app/_components/MainPanel'
import { status } from '../support/fixtures'
import { AppColumn } from '../support/StoryEnvironment'

const meta = {
  component: MainPanel,
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
  title: 'App/Panels/Compose',
} satisfies Meta<typeof MainPanel>
export default meta
type Story = StoryObj<typeof meta>
export const NewPost: Story = {
  render: () => (
    <AppColumn>
      <MainPanel />
    </AppColumn>
  ),
}
export const Reply: Story = {
  render: () => (
    <AppColumn initialReply={status}>
      <MainPanel />
    </AppColumn>
  ),
}

export const Draft: Story = {
  ...NewPost,
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByPlaceholderText("What's happening?"),
      '今日はいい天気ですね。写真を撮りに出かけます。',
    )
  },
}
export const ContentWarning: Story = {
  ...NewPost,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByText('CW', { selector: 'span' }))
    await userEvent.type(
      canvas.getByPlaceholderText('CW'),
      '映画の感想（ネタバレあり）',
    )
    await userEvent.type(
      canvas.getByPlaceholderText("What's happening?"),
      'ラストシーンがとても印象的でした。',
    )
  },
}
