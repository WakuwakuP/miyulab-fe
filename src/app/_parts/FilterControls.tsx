import type { TimelineConfigV2 } from 'types/types'
import { AccountFilterEditor } from './AccountFilterEditor'
import { CollapsibleSection } from './CollapsibleSection'
import { LanguageFilter } from './LanguageFilter'
import { MediaFilterControls } from './MediaFilterControls'
import { NotificationTypeFilter } from './NotificationTypeFilter'
import { TimelineTypeSelector } from './TimelineTypeSelector'
import { ToggleFilters } from './ToggleFilters'
import { VisibilityFilter } from './VisibilityFilter'

export { MuteBlockControls } from './MuteBlockControls'

type FilterControlsProps = {
  config: TimelineConfigV2
  onChange: (updates: Partial<TimelineConfigV2>) => void
}

export function FilterControls({ config, onChange }: FilterControlsProps) {
  return (
    <div className="space-y-3">
      <CollapsibleSection defaultOpen title="Sources">
        <TimelineTypeSelector
          configType={config.type}
          onChange={(timelineTypes) => onChange({ timelineTypes })}
          value={config.timelineTypes}
        />
        <NotificationTypeFilter
          onChange={(notificationFilter) => onChange({ notificationFilter })}
          value={config.notificationFilter}
        />
      </CollapsibleSection>

      <CollapsibleSection defaultOpen={false} title="Media">
        <MediaFilterControls config={config} onChange={onChange} />
      </CollapsibleSection>

      <CollapsibleSection defaultOpen={false} title="Filters">
        <VisibilityFilter
          onChange={(visibilityFilter) => onChange({ visibilityFilter })}
          value={config.visibilityFilter}
        />

        <LanguageFilter
          onChange={(languageFilter) => onChange({ languageFilter })}
          value={config.languageFilter}
        />

        <ToggleFilters config={config} onChange={onChange} />

        <AccountFilterEditor
          onChange={(accountFilter) => onChange({ accountFilter })}
          value={config.accountFilter}
        />
      </CollapsibleSection>
    </div>
  )
}
