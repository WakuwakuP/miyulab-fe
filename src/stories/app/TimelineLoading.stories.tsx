import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { TimelineLoading } from 'app/_parts/TimelineLoading'

const meta = {
  component: TimelineLoading,
  decorators: [
    (Story) => (
      <div className="h-80 w-80 bg-gray-900">
        <Story />
      </div>
    ),
  ],
  title: 'App/Timeline/Loading',
} satisfies Meta<typeof TimelineLoading>
export default meta
export const Default: StoryObj<typeof meta> = {}
