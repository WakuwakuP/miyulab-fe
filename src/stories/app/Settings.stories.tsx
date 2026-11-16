import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AccountsPanel } from 'app/_components/AccountsPanel'
import { CloudBackupSection } from 'app/_components/CloudBackupSection'
import { DatabaseStatsPanel } from 'app/_components/DatabaseStatsPanel'
import { DbDiagnosticsSection } from 'app/_components/DbDiagnosticsSection'
import { SettingPanel } from 'app/_components/SettingPanel'
import { TimelineManagement } from 'app/_components/TimelineManagement'
import { Panel } from 'app/_parts/Panel'
import { AppColumn } from '../support/StoryEnvironment'

const meta = {
  decorators: [
    (Story) => (
      <AppColumn>
        <Panel className="overflow-y-auto" name="Settings">
          <Story />
        </Panel>
      </AppColumn>
    ),
  ],
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
  title: 'App/Panels/Settings',
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const General: Story = { render: () => <SettingPanel /> }
export const Timelines: Story = { render: () => <TimelineManagement /> }
export const Accounts: Story = { render: () => <AccountsPanel /> }
export const Database: Story = { render: () => <DatabaseStatsPanel /> }
export const CloudBackup: Story = {
  render: () => (
    <div className="p-2">
      <CloudBackupSection />
    </div>
  ),
}
export const Diagnostics: Story = {
  render: () => (
    <div className="p-2">
      <DbDiagnosticsSection />
    </div>
  ),
}
