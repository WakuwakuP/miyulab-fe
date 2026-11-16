import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { FlowQueryEditorModal } from 'app/_components/FlowEditor'
import { InstanceBlockManager } from 'app/_parts/InstanceBlockManager'
import { MuteManager } from 'app/_parts/MuteManager'
import { fn } from 'storybook/test'
import { timelines } from '../support/fixtures'
import { StoryEnvironment } from '../support/StoryEnvironment'

const meta = {
  args: { config: timelines[0], onOpenChange: fn(), onSave: fn(), open: true },
  component: FlowQueryEditorModal,
  decorators: [
    (Story) => (
      <StoryEnvironment>
        <Story />
      </StoryEnvironment>
    ),
  ],
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
  title: 'App/Settings/TimelineEditor',
} satisfies Meta<typeof FlowQueryEditorModal>
export default meta
type Story = StoryObj<typeof meta>
export const Home: Story = {}
export const MediaHashtag: Story = { args: { config: timelines[2] } }
export const Notifications: Story = { args: { config: timelines[1] } }
export const MutedAccounts: Story = {
  render: () => <MuteManager onClose={fn()} />,
}
export const BlockedInstances: Story = {
  render: () => <InstanceBlockManager onClose={fn()} />,
}
