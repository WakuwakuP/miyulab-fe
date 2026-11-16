import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { DetailPanel } from 'app/_components/DetailPanel'
import { account, status } from '../support/fixtures'
import { AppColumn } from '../support/StoryEnvironment'

const meta = {
  component: DetailPanel,
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
  title: 'App/Panels/Detail',
} satisfies Meta<typeof DetailPanel>
export default meta
type Story = StoryObj<typeof meta>
export const UserProfile: Story = {
  render: () => (
    <AppColumn
      initialDetail={{ content: { ...account, appIndex: 0 }, type: 'Account' }}
    >
      <DetailPanel />
    </AppColumn>
  ),
}
export const PostThread: Story = {
  render: () => (
    <AppColumn initialDetail={{ content: status, type: 'Status' }}>
      <DetailPanel />
    </AppColumn>
  ),
}

export const FollowingUser: Story = {
  ...UserProfile,
  beforeEach: async () => {
    const { client, response } = await import(
      '../../../.storybook/mocks/client'
    )
    const { relationship } = await import('../support/fixtures')
    client.getRelationship.mockResolvedValue(
      response({ ...relationship, following: true }),
    )
    return () => client.getRelationship.mockReset()
  },
}
