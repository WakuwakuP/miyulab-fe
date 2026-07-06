# src/app KNOWLEDGE BASE

## OVERVIEW

`src/app` owns the Next.js App Router shell, single-page timeline workspace, panels, reusable app parts, server actions, and attachment route.

## STRUCTURE

```text
src/app/
|-- layout.tsx                  # Provider chain and global shell
|-- page.tsx                    # Client-side home workspace
|-- _components/                # Feature-level panels and timeline containers
|   |-- FlowEditor/             # QueryPlanV2 visual editor
|   |-- NodeEditor/             # Query node editing forms
|   `-- TimelineManagement/     # Timeline/folder drag management
|-- _parts/                     # Lower-level status, media, filters, modal parts
|-- actions/                    # Server actions, currently query log writes
`-- api/attachment/[...path]/   # Media proxy route
```

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Provider ordering | `layout.tsx` | Keep `StartupCoordinator`, SQLite, status store, streaming, and timeline providers in their current dependency order unless verified. |
| Main workspace columns | `page.tsx` | `groupTimelines` turns visible `TimelineConfigV2` items into single/tabbed columns. |
| Timeline rendering | `_components/DynamicTimeline.tsx`, `UnifiedTimeline.tsx`, `MixedTimeline.tsx`, `NotificationTimeline.tsx`, `TimelinePresenter.tsx` | Containers produce `TimelineViewModel`; presenter handles list UI. |
| Status row behavior | `_parts/Status.tsx`, `_parts/Actions.tsx`, `_parts/MediaAttachments.tsx`, `_parts/EmojiReactions.tsx` | Action state must resync from refreshed status props. |
| Timeline settings UI | `_components/TimelineManagement/`, `_components/NodeEditor/`, `_components/FlowEditor/` | FlowEditor maps visual graph nodes to QueryPlanV2. |
| Attachment proxy | `api/attachment/[...path]/route.ts` | Pair route changes with `util/attachmentProxy.ts`. |

## CONVENTIONS

- Keep `page.tsx` as a client workspace; route rewrites in `next.config.mjs` send many app paths back to `/`.
- Put page-specific feature components in `_components`; put reusable app-level building blocks in `_parts`.
- Prefer existing icon libraries already used in the local file (`react-icons` in `_parts`, Lucide/shadcn where already present).
- Components should consume timeline data via hooks from `util/hooks`, not by querying SQLite directly.
- UI that changes timeline config should update `TimelineProvider` state and let hooks/streaming react to that state.
- Server-only writes belong in `actions/`; browser storage writes belong in `util/db/sqlite`.

## ANTI-PATTERNS

- Do not import generated `src/components/ui/**` into this folder and then edit generated UI code to make behavior fit.
- Do not add new top-level pages for paths already handled by the rewrite-to-home pattern unless routing behavior is intentionally changing.
- Do not cache status action booleans without `useEffect` resync from `status` props.
- Do not bypass `TimelinePresenter` for main timeline list rendering without checking Virtuoso scroll behavior.
- Do not make timeline components own WebSocket lifecycle; streaming is centralized in `util/provider/StreamingManagerProvider.tsx`.

## TESTING NOTES

- Component-adjacent tests are sparse; risky UI state changes need manual browser QA.
- For data-driven timeline UI bugs, pair UI verification with focused `src/util/db/sqlite` or `src/util/hooks` tests where the state originates.
