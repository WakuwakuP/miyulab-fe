import { dirname, resolve } from 'node:path'
import type { StorybookConfig } from '@storybook/nextjs-vite'

const config: StorybookConfig = {
  addons: ['@storybook/addon-docs', '@storybook/addon-themes'],
  core: { disableTelemetry: true },
  framework: { name: '@storybook/nextjs-vite', options: {} },
  staticDirs: ['../public', { from: './assets', to: '/storybook-assets' }],
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  async viteFinal(config) {
    // Resolve both absolute/baseUrl and relative imports at the I/O boundary.
    const replacements = new Map(
      [
        ['util/GetClient', 'client.ts'],
        ['megalodon', 'registration.ts'],
        ['util/misskey/MisskeyAdapter', 'registration.ts'],
        ['util/misskey/auth', 'registration.ts'],
        ['util/environment', 'environment.ts'],
        ['util/debug/rawDataCapture', 'capture.ts'],
        ['util/db/sqlite/connection', 'database.ts'],
        ['util/db/sqlite/initSqlite', 'database.ts'],
        ['util/db/dbDiagnosticUploader', 'diagnostics.ts'],
        ...[
          'settingsBackup',
          'dbDiagnostics',
          'dbDiagnosticsAuth',
          'queryLog',
        ].map((name) => [`app/actions/${name}.server`, 'serverActions.ts']),
      ].map(([source, mock]) => [
        resolve('src', source),
        resolve('.storybook/mocks', mock),
      ]),
    )
    config.plugins = [
      ...(config.plugins ?? []),
      {
        enforce: 'pre',
        name: 'storybook-service-fixtures',
        resolveId(source, importer) {
          const absolute =
            source.startsWith('.') && importer
              ? resolve(dirname(importer.split('?')[0]), source)
              : source.startsWith('/')
                ? source
                : resolve('src', source)
          return replacements.get(absolute.replace(/\.tsx?$/, ''))
        },
      },
    ]
    return config
  },
}

export default config
