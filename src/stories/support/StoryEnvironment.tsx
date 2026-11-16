import {
  type ComponentProps,
  type ContextType,
  type ReactNode,
  useContext,
  useState,
} from 'react'
import type { App } from 'types/types'
import { AppsContext, UpdateAppsContext } from 'util/provider/AppsProvider'
import {
  DetailContext,
  SetDetailContext,
  type SetDetailParams,
} from 'util/provider/DetailProvider'
import {
  PostAccountContext,
  SelectedAppIndexContext,
  SetSelectedAppIndexContext,
} from 'util/provider/PostAccountProvider'
import {
  ReplyToContext,
  SetReplyToContext,
} from 'util/provider/ReplyToProvider'
import { TagsContext, UsersContext } from 'util/provider/ResourceProvider'
import {
  SetSettingContext,
  SettingContext,
} from 'util/provider/SettingProvider'
import {
  SetTimelineContext,
  TimelineContext,
} from 'util/provider/TimelineProvider'
import {
  account,
  apps as fixtureApps,
  otherAccount,
  timelines,
} from './fixtures'

export function StoryEnvironment({
  children,
  initialDetail = { content: null, type: null },
  initialReply,
  initialApps = fixtureApps,
}: {
  children: ReactNode
  initialDetail?: SetDetailParams
  initialReply?: ContextType<typeof ReplyToContext>
  initialApps?: App[]
}) {
  const defaults = useContext(SettingContext)
  const [setting, setSetting] = useState(defaults)
  const [apps, setApps] = useState(initialApps)
  const [detail, setDetail] = useState(initialDetail)
  const [reply, setReply] = useState(initialReply)
  const [selected, setSelected] = useState(0)
  const [timelineState, setTimelines] = useState<
    ContextType<typeof TimelineContext>
  >({ timelines, version: 2 })
  return (
    <AppsContext value={apps}>
      <UpdateAppsContext value={setApps}>
        <SettingContext value={setting}>
          <SetSettingContext value={setSetting}>
            <TimelineContext value={timelineState}>
              <SetTimelineContext value={setTimelines}>
                <DetailContext value={detail}>
                  <SetDetailContext value={setDetail}>
                    <PostAccountContext
                      value={apps.map((_, index) => ({
                        account: index === 0 ? account : otherAccount,
                        index,
                      }))}
                    >
                      <SelectedAppIndexContext value={selected}>
                        <SetSelectedAppIndexContext value={setSelected}>
                          <ReplyToContext value={reply}>
                            <SetReplyToContext value={setReply}>
                              <UsersContext value={[account, otherAccount]}>
                                <TagsContext value={['写真', '日常', '開発']}>
                                  {children}
                                </TagsContext>
                              </UsersContext>
                            </SetReplyToContext>
                          </ReplyToContext>
                        </SetSelectedAppIndexContext>
                      </SelectedAppIndexContext>
                    </PostAccountContext>
                  </SetDetailContext>
                </DetailContext>
              </SetTimelineContext>
            </TimelineContext>
          </SetSettingContext>
        </SettingContext>
      </UpdateAppsContext>
    </AppsContext>
  )
}
export function AppColumn({
  children,
  ...props
}: ComponentProps<typeof StoryEnvironment>) {
  return (
    <StoryEnvironment {...props}>
      <div className="min-h-screen w-full max-w-[420px] bg-gray-900 text-gray-100">
        {children}
      </div>
    </StoryEnvironment>
  )
}
