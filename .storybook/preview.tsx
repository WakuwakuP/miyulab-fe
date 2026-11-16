import { withThemeByClassName } from '@storybook/addon-themes'
import type { Preview } from '@storybook/nextjs-vite'
import { MINIMAL_VIEWPORTS } from 'storybook/viewport'
import '../src/app/globals.css'
import { resetDatabase } from './mocks/database'

const preview: Preview = {
  beforeEach: () => {
    resetDatabase()
  },
  decorators: [
    withThemeByClassName({
      defaultTheme: 'dark',
      themes: { dark: 'dark', light: '' },
    }),
  ],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    layout: 'centered',
    nextjs: { appDirectory: true },
    options: {
      storySort: {
        order: ['App', ['Status', 'Panels', 'Settings', 'Timeline'], 'UI'],
      },
    },
    viewport: { options: MINIMAL_VIEWPORTS },
  },
  tags: ['autodocs'],
}

export default preview
