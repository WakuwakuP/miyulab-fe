import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { type ReactNode, Suspense } from 'react'

import { Toaster } from 'react-hot-toast'

import { APP_NAME } from 'util/environment'
import { AppsProvider } from 'util/provider/AppsProvider'
import { DetailProvider } from 'util/provider/DetailProvider'
import { HomeTimelineProvider } from 'util/provider/HomeTimelineProvider'
import { MediaModalProvider } from 'util/provider/ModalProvider'
import { PlayerProvider } from 'util/provider/PlayerProvider'
import { ReplyToProvider } from 'util/provider/ReplyToProvider'
import { ResourceProvider } from 'util/provider/ResourceProvider'
import { SettingProvider } from 'util/provider/SettingProvider'
import { StatusStoreProvider } from 'util/provider/StatusStoreProvider'
import { SuspenseProvider } from 'util/provider/SuspenseProvider'
import { TimelineProvider } from 'util/provider/TimelineProvider'

import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  description: 'This is Pleroma client application for web.',
  title: APP_NAME,
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
          <AppsProvider>
            <SettingProvider>
              <TimelineProvider>
                <Suspense>
                  <ResourceProvider>
                    <ReplyToProvider>
                      <DetailProvider>
                        <MediaModalProvider>
                          <PlayerProvider>
                            <StatusStoreProvider>
                              <HomeTimelineProvider>
                                <Toaster
                                  position="bottom-left"
                                  reverseOrder={false}
                                />
                                {children}
                              </HomeTimelineProvider>
                            </StatusStoreProvider>
                          </PlayerProvider>
                        </MediaModalProvider>
                      </DetailProvider>
                    </ReplyToProvider>
                  </ResourceProvider>
                </Suspense>
              </TimelineProvider>
            </SettingProvider>
          </AppsProvider>
        </SuspenseProvider>
      </body>
    </html>
  )
}
