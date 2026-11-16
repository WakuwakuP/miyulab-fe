import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Notification } from 'app/_parts/Notification'
import { otherAccount, status } from '../support/fixtures'
import { AppColumn } from '../support/StoryEnvironment'

const meta = {
  args: {
    notification: {
      account: otherAccount,
      appIndex: 0,
      created_at: '2026-07-06T10:00:00Z',
      id: 'notification-1',
      isRead: false,
      status,
      type: 'favourite',
    },
  },
  component: Notification,
  decorators: [
    (Story) => (
      <AppColumn>
        <Story />
      </AppColumn>
    ),
  ],
  parameters: { layout: 'fullscreen' },
  title: 'App/Status/Notification',
} satisfies Meta<typeof Notification>
export default meta
type Story = StoryObj<typeof meta>
export const Favourite: Story = {}
export const Reblog: Story = {
  args: { notification: { ...meta.args.notification, type: 'reblog' } },
}
export const Mention: Story = {
  args: { notification: { ...meta.args.notification, type: 'mention' } },
}
export const Follow: Story = {
  args: {
    notification: {
      ...meta.args.notification,
      status: undefined,
      type: 'follow',
    },
  },
}
export const FollowRequest: Story = {
  args: {
    notification: {
      ...meta.args.notification,
      status: undefined,
      type: 'follow_request',
    },
  },
}
export const EmojiReaction: Story = {
  args: {
    notification: {
      ...meta.args.notification,
      appIndex: 1,
      reaction: { count: 1, me: false, name: '❤️' },
      type: 'emoji_reaction',
    },
  },
}
export const Read: Story = {
  args: { notification: { ...meta.args.notification, isRead: true } },
}
