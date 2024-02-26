import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ReactNode, Suspense } from 'react'

import { Toaster } from 'react-hot-toast'

import { AppProvider } from 'util/provider/AppProvider'
import { DetailProvider } from 'util/provider/DetailProvider'
import { HomeTimelineProvider } from 'util/provider/HomeTimelineProvider'
import { SuspenseProvider } from 'util/provider/SuspenseProvider'

import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Miyulab-FE',
  description:
    'This is Pleroma client application for web.',
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
              <DetailProvider>
                <HomeTimelineProvider>
                  <Toaster
                    position="bottom-left"
                    reverseOrder={false}
                  />
                  {children}
                </HomeTimelineProvider>
              </DetailProvider>
            </Suspense>
          </AppProvider>
        </SuspenseProvider>
      </body>
    </html>
  )
}
