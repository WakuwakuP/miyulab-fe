import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { AccountsPanel } from 'app/_components/AccountsPanel'
import { CloudBackupSection } from 'app/_components/CloudBackupSection'
import { DatabaseStatsPanel } from 'app/_components/DatabaseStatsPanel'
import { DbDiagnosticsSection } from 'app/_components/DbDiagnosticsSection'
import { GettingStarted as GettingStartedPanel } from 'app/_components/GettingStarted'
import { SettingPanel } from 'app/_components/SettingPanel'
import { TimelineManagement } from 'app/_components/TimelineManagement'
import { Panel } from 'app/_parts/Panel'
import { expect, waitFor } from 'storybook/test'
import { navigatePanel } from 'util/panelNavigation'
import { AppColumn } from '../support/StoryEnvironment'

const meta = {
  decorators: [
    (Story, context) => (
      <AppColumn>
        {context.parameters.standalonePanel ? (
          <Story />
        ) : (
          <Panel className="overflow-y-auto" name="Settings">
            <Story />
          </Panel>
        )}
      </AppColumn>
    ),
  ],
  parameters: { layout: 'fullscreen' },
  tags: ['!autodocs'],
  title: 'App/Panels/Settings',
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const GettingStarted: Story = {
  beforeEach: () => {
    const originalUrl = window.location.href
    // The real menu navigates with history.pushState; restore the canvas URL
    // when leaving this story so settings routes cannot leak into other stories.
    return () => navigatePanel(originalUrl)
  },
  parameters: { standalonePanel: true },
  render: () => <GettingStartedPanel />,
}
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

// Keep the real dialog and list UI; restoring fixture data remains disabled.
export const CloudRestore: Story = {
  ...CloudBackup,
  play: async ({ canvas, userEvent }) => {
    const restore = canvas.getByRole('button', { name: 'Restore' })
    await waitFor(() => expect(restore).toBeEnabled())
    await userEvent.click(restore)
    await expect(
      await canvas.findByRole('dialog', { name: 'Restore' }),
    ).toBeVisible()
  },
}
export const CloudRestoreEmpty: Story = {
  ...CloudRestore,
  beforeEach: async () => {
    const { listSettingsBackups } = await import(
      '../../../.storybook/mocks/serverActions'
    )
    listSettingsBackups.mockResolvedValue({ backups: [], success: true })
    return () => listSettingsBackups.mockReset()
  },
}
