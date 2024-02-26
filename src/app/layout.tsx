import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ReactNode, Suspense } from 'react'

import { AppProvider } from 'util/provider/AppProvider'
import { HomeTimelineProvider } from 'util/provider/HomeTimelineProvider'
import { SuspenseProvider } from 'util/provider/SuspenseProvider'

import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Miyulab-FE',
  description: 'This is Pleroma client application for web.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="ja">
      <body className={inter.className}>
        <SuspenseProvider>
          <AppProvider>
            <Suspense>
              <HomeTimelineProvider>{children}</HomeTimelineProvider>
            </Suspense>
          </AppProvider>
        </SuspenseProvider>
      </body>
    </html>
  )
}
