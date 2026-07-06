# src/util KNOWLEDGE BASE

## OVERVIEW

`src/util` owns client orchestration: providers, timeline hooks, streaming lifecycle, Fediverse adapters, local settings migration, environment constants, and shared helpers.

## STRUCTURE

```text
src/util/
|-- provider/          # React Context providers and startup orchestration
|-- hooks/             # Timeline data hooks, list reducer, refresh logic
|-- streaming/         # Stream keys, required stream derivation, handlers, retries
|-- db/                # SQLite/Query IR/data queues; see nested AGENTS.md
|-- misskey/           # Misskey API and mapper compatibility layer
|-- migration/         # Local settings/timeline migration helpers
|-- queryBuilder/      # Advanced query parsing/building helpers
`-- environment.ts     # Public env defaults and timeline limits
```

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Global state | `provider/*.tsx` | Provider order is declared in `src/app/layout.tsx`. |
| Startup sequencing | `provider/StartupCoordinator.tsx` | Phases: `init`, `db-ready`, `timeline-displayed`, `rest-fetched`, `streaming`. |
| Timeline fetch/list state | `hooks/useTimelineData.ts`, `hooks/useTimelineDataSource.ts`, `hooks/useTimelineList.ts`, `hooks/timelineList/` | Source hook fetches pages; list hook owns reducer/scrollback. |
| Change hint matching | `hooks/timelineList/hintMatching.ts`, `hooks/timelineList/streamingHelpers.ts` | Used to avoid unnecessary DB re-query. |
| Streaming lifecycle | `provider/StreamingManagerProvider.tsx`, `streaming/*` | Settings -> required streams -> connect/retry/stop. |
| Backend client creation | `GetClient.ts`, `misskey/*` | Keep Misskey behavior megalodon-compatible at the boundary. |
| Env defaults | `environment.ts` | Defaults include remote backend URL and query limit. |

## CONVENTIONS

- Context providers are the state-management layer; avoid adding a separate global store.
- Prefer `backendUrl` for backend identity. `appIndex` exists in status types for legacy/UI bridge code and should not become a new persistence key.
- `StreamingManagerProvider` derives streams from `AppsContext` + `TimelineContext`; components only read connection state.
- `StartupCoordinator` should unblock later phases on recoverable DB errors rather than freezing the app.
- Hooks should subscribe to table changes through `util/db/sqlite/connection`, then route relevance through `ChangeHint`.
- Misskey mapper changes need both API-shape compatibility and Fediverse entity semantics checked.

## ANTI-PATTERNS

- Do not make hooks depend on raw timeline arrays when the same result should come from SQLite/Query IR.
- Do not treat hintless DB notifications as safe to ignore; they mean refresh all subscribers for that table.
- Do not add stream keys with ad hoc string concatenation; use `streaming/streamKey.ts`.
- Do not perform new SQLite writes directly from providers or components; use store/worker APIs under `util/db`.
- Do not weaken `TimelineConfigV2` migration/normalization when adding config fields.

## TESTING NOTES

- Timeline hooks and streaming helpers can be unit-tested in `src/util/**/__tests__` or colocated `*.test.ts`.
- Adapter changes need representative Mastodon-compatible and Misskey cases because `GetClient` hides backend differences from callers.
