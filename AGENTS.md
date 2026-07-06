# PROJECT KNOWLEDGE BASE

**Generated:** 2026-07-06T10:45:21+09:00
**Commit:** f2a4751
**Branch:** main

## OVERVIEW

miyulab-fe is a multi-account Fediverse web client for Mastodon/Pleroma/Friendica/Firefish/Misskey-style backends. It is a Next.js 16 + React 19 + TypeScript 6 app whose main data path is Fediverse API/WebSocket -> browser SQLite WASM/OPFS -> React timelines.

## STRUCTURE

```text
miyulab-fe/
|-- src/app/              # App Router shell, timeline UI, panels, attachment route
|-- src/util/             # Providers, hooks, streaming, backend adapters, shared logic
|   `-- db/               # SQLite worker, Query IR, schema, migrations, queueing
|-- src/types/            # Timeline, backend, account, and status types
|-- src/components/ui/    # shadcn-generated UI; excluded from Biome edits
|-- docs/domain/          # Current domain model extracted from implementation
|-- docs/timeline/        # Timeline architecture and data-flow references
|-- .github/workflows/    # CI plus issue/review automation workflows
`-- scripts/              # Build helpers such as SQLite WASM asset copy
```

## AGENTS HIERARCHY

```text
./AGENTS.md
|-- src/app/AGENTS.md
`-- src/util/AGENTS.md
    `-- src/util/db/AGENTS.md
```

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| App shell/provider order | `src/app/layout.tsx`, `src/util/provider/` | Provider nesting is startup-critical. |
| Timeline rendering | `src/app/page.tsx`, `src/app/_components/*Timeline*.tsx`, `src/app/_parts/Status.tsx` | Columns are grouped by `TimelineConfigV2.tabGroup`. |
| Timeline data hooks | `src/util/hooks/useTimelineData.ts`, `src/util/hooks/useTimelineDataSource.ts`, `src/util/hooks/timelineList/` | DB subscriptions and cursor fetch logic live here. |
| SQLite storage | `src/util/db/sqlite/` | Worker first, fallback path in `initSqlite.ts`. |
| Query builder/IR | `src/util/db/query-ir/`, `src/app/_components/FlowEditor/` | FlowEditor converts graph UI to QueryPlanV2. |
| Streaming | `src/util/provider/StreamingManagerProvider.tsx`, `src/util/streaming/` | Streams are derived from settings, not subscribed from components. |
| Fediverse adapters | `src/util/GetClient.ts`, `src/util/misskey/` | Misskey compatibility is wrapped behind megalodon-like APIs. |
| Attachment proxy | `src/app/api/attachment/[...path]/route.ts`, `src/util/attachmentProxy.ts` | Security checks and allowed host logic matter. |
| Domain docs | `docs/domain/`, `docs/timeline/` | Read before touching data flow, filters, or migrations. |

## CODE MAP

TypeScript LSP and codegraph were unavailable in this harness; refs below are from structure/export scans, so centrality is unmeasured.

| Symbol | Type | Location | Refs | Role |
|---|---|---|---|---|
| `RootLayout` | React component | `src/app/layout.tsx` | unmeasured | Owns global provider chain and analytics/toaster wiring. |
| `Home` | React component | `src/app/page.tsx` | unmeasured | Builds visible timeline columns and tab groups. |
| `TimelineConfigV2` | type | `src/types/types.ts` | unmeasured | Main persisted timeline configuration contract. |
| `StartupCoordinator` | provider | `src/util/provider/StartupCoordinator.tsx` | unmeasured | Gates DB/account resolver/timeline/REST/streaming phases. |
| `StreamingManagerProvider` | provider | `src/util/provider/StreamingManagerProvider.tsx` | unmeasured | Derives, connects, retries, and stops WebSocket streams. |
| `useTimelineDataSource` | hook | `src/util/hooks/useTimelineDataSource.ts` | unmeasured | Builds QueryPlanV2, subscribes to DB tables, executes timeline fetches. |
| `configToQueryPlanV2` | function | `src/util/db/query-ir/configToQueryPlanV2.ts` | unmeasured | Converts timeline config into graph query plans. |
| `executeGraphPlan` | worker API | `src/util/db/sqlite/workerClient/publicApi.ts` | unmeasured | Runs serialized graph plans through the SQLite worker queue. |
| `notifyChange` / `subscribe` | functions | `src/util/db/sqlite/connection.ts` | unmeasured | Debounced table notification system using `ChangeHint`. |
| `TableName` / `changedTables` | protocol | `src/util/db/sqlite/protocol.ts` | unmeasured | Contract between worker handlers and reactive UI refresh. |

## CONVENTIONS

- Imports use `src` as `baseUrl`: prefer `util/...`, `types/...`, `app/...`, `components/...`; `@public/*` maps to `public/`.
- Page features live in `src/app/_components/`; lower-level reusable UI for this app lives in `src/app/_parts/`.
- `src/components/ui/**` is generated shadcn code and is excluded from Biome.
- Global state is React Context under `src/util/provider/`; no external state store is used.
- Timeline data should flow through SQLite and Query IR, not ad hoc in-memory timeline arrays.
- Backend identity should use `backendUrl`; array index based APIs are legacy bridge points only.
- SQLite WASM assets must exist in `public/`; `yarn dev` and `yarn build` run `copy:sqlite-wasm`.

## ANTI-PATTERNS (THIS PROJECT)

- Do not use `npx` for build, checks, or tests; use yarn scripts or local binaries.
- Do not edit `src/zenstack/**`; files are generated and say `DO NOT MODIFY`.
- Do not treat `post_interactions` as optional for status freshness; favorite/reblog/bookmark/reaction state depends on it.
- Do not drop `backendUrl`, `changedTables`, or `ChangeHint` when adding write paths; both worker and fallback paths need them.
- Do not add component-level stream subscriptions; `StreamingManagerProvider` centralizes stream lifecycle.
- Do not remove COOP/COEP headers casually; SQLite WASM/OPFS behavior depends on cross-origin isolation.

## COMMANDS

```bash
yarn check        # Biome lint and format check
yarn test:run     # Vitest run
yarn build        # Production build; prebuild may need DATABASE_URL
yarn dev          # HTTPS dev server, includes SQLite WASM copy
./node_modules/.bin/next dev --port 3000  # headless/local HTTP dev server
```

Node.js 24 is expected in CI. In Ubuntu-style cloud shells, put `/home/ubuntu/.nvm/versions/node/v24.16.0/bin` before `/exec-daemon/node` on `PATH`.

## NOTES

- `prebuild` runs ZenStack generation/migration and needs `DATABASE_URL`; it is production-build related, not required for plain dev-server startup.
- Vitest is Node environment only and includes `src/**/*.test.ts`; coverage targets `src/util/db/sqlite/**`.
- Browser SQLite uses worker/OPFS first and can fall back to memory; test changes around storage with focused sqlite tests.
- Existing `.codex-worktrees/` checkouts are nested worktrees, not source directories for this root.
