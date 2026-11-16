import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Status } from 'app/_parts/Status'
import { fn } from 'storybook/test'
import {
  boostedStatus,
  mediaStatus,
  pollStatus,
  status,
} from '../support/fixtures'
import { AppColumn } from '../support/StoryEnvironment'

const meta = {
  args: { onStatusChange: fn(), status },
  component: Status,
  decorators: [
    (Story) => (
      <AppColumn>
        <Story />
      </AppColumn>
    ),
  ],
  parameters: { layout: 'fullscreen' },
  title: 'App/Status/Post',
} satisfies Meta<typeof Status>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const WithImage: Story = { args: { status: mediaStatus } }
export const Reblog: Story = { args: { status: boostedStatus } }
export const Favourited: Story = {
  args: { status: { ...status, favourited: true } },
}
export const Reblogged: Story = {
  args: { status: { ...status, reblogged: true } },
}
export const Bookmarked: Story = {
  args: { status: { ...status, bookmarked: true } },
}
export const ContentWarning: Story = {
  args: {
    status: {
      ...mediaStatus,
      sensitive: true,
      spoiler_text: '写真を含む投稿です',
    },
  },
}
export const Private: Story = {
  args: { status: { ...status, visibility: 'private' } },
}
export const Direct: Story = {
  args: { status: { ...status, visibility: 'direct' } },
}
export const Poll: Story = { args: { status: pollStatus } }
export const PollResults: Story = {
  args: {
    status: {
      ...pollStatus,
      poll: { ...pollStatus.poll, expired: true, voted: true },
    },
  },
}
export const EmojiReactions: Story = {
  args: {
    status: {
      ...status,
      appIndex: 1,
      emoji_reactions: [
        { count: 12, me: true, name: '👍' },
        { count: 8, me: false, name: '❤️' },
      ],
    },
  },
}
export const LongContent: Story = {
  args: {
    status: {
      ...status,
      account: {
        ...status.account,
        display_name:
          'とても長い表示名を設定しているユーザー 🌷 写真と開発の記録',
      },
      content: '<p>長い文章の折り返しとカラム内の表示を確認します。</p>'.repeat(
        12,
      ),
      edited_at: '2026-07-06T10:00:00Z',
    },
  },
}
