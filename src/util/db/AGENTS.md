# src/util/db KNOWLEDGE BASE

## OVERVIEW

`src/util/db` owns browser persistence and query execution: priority queues, SQLite WASM worker RPC, OPFS fallback behavior, schema/migrations, status/notification stores, and Query IR graph execution.

## STRUCTURE

```text
src/util/db/
|-- dbQueue.ts              # Priority/timeline/other queue accounting
|-- sqlite/                 # SQLite WASM connection, worker, schema, stores, tests
|   |-- connection.ts       # Debounced table subscriptions and ChangeHint
|   |-- protocol.ts         # Main thread <-> worker request/response types
|   |-- initSqlite.ts       # Worker-first DB init and fallback path
|   |-- worker/             # Worker entry, handlers, recovery, export, cleanup
|   |-- workerClient/       # Queueing RPC client and message handler
|   |-- queries/            # SQL builders and row mappers
|   |-- stores/             # Browser-facing status read/write APIs
|   |-- schema/             # Table definitions and version constants
|   `-- migrations/         # Versioned schema migrations
`-- query-ir/               # QueryPlanV2 nodes, compiler, graph executor, registry
```

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Worker protocol | `sqlite/protocol.ts` | Add request/response types and `TableName` coverage here first. |
| Change notifications | `sqlite/connection.ts`, `sqlite/workerClient/messageHandler.ts` | Worker responses drive `notifyChange(table, hint)`. |
| Worker handlers | `sqlite/worker/handlers/`, `sqlite/workerStatusStore.ts`, `workerNotificationStore.ts` | Every write path must report changed tables. |
| Public DB API | `sqlite/stores/`, `sqlite/workerClient/publicApi.ts`, `sqlite/statusStore.ts` | Keep caller-facing APIs typed and queue-aware. |
| QueryPlanV2 | `query-ir/nodes.ts`, `configToQueryPlanV2.ts`, `executor/`, `registry/` | Registry metadata controls filters, joins, lookup tables, and output. |
| SQL status reads | `sqlite/queries/status*.ts`, `sqlite/stores/statusReadStore.ts` | Interactions and backend scoping are assembled here. |
| Migrations | `sqlite/schema/`, `sqlite/migrations/` | Bump schema version and add tests together. |
| Queue behavior | `dbQueue.ts`, `sqlite/workerClient/queueManager.ts` | Timeline queue has dedupe/saturation behavior. |

## CONVENTIONS

- Worker mode is canonical; fallback code in `initSqlite.ts` must preserve the same observable `changedTables` and `ChangeHint` semantics.
- Write handlers return affected `TableName[]`; aggregate in a `Set<TableName>` when multiple tables can change.
- `post_interactions` is the source for favorite/reblog/bookmark/reaction state and must be included in timeline subscriptions and query assembly.
- `backendUrl` is part of identity. Do not substitute host, app index, or local account id unless a local table explicitly requires it.
- Query IR V2 changes should update compiler, executor, registry/completion, FlowEditor conversion, and tests as a set.
- SQL string generation should stay in query builder modules; callers pass structured config/plans.

## ANTI-PATTERNS

- Do not return `changedTables: []` after a write that should refresh UI.
- Do not add a worker request without updating both worker dispatch and worker-client public/fallback behavior.
- Do not build raw SQL in React components or providers.
- Do not bypass `executeGraphPlan`/Query IR for timeline fetches unless the feature is explicitly a low-level DB tool.
- Do not edit generated ZenStack output under `src/zenstack/**` while working on DB code.
- Do not remove OPFS/worker recovery paths without testing memory fallback and corrupted DB recovery behavior.

## TESTING NOTES

- Focused tests live heavily under `sqlite/__tests__` and `query-ir/__tests__`; run the smallest matching file first.
- Interaction freshness needs tests for `post_interactions`, `changedTables`, and `backendUrl` hints, not only API toggle success.
- Migration changes need schema creation tests plus versioned migration tests.

## DIAGNOSTICS

- Continuous queue/worker diagnostics use `dbDiagnostics.ts`, `dbDiagnosticTransport.ts`, `dbDiagnosticUploader.ts`, and `src/app/actions/dbDiagnostics.server.ts`; Developer settings can load the current or a pasted session UUID.
- Diagnostic windows use `QueryLog` rows with `DB_DIAGNOSTICS_V1:<session UUID>` markers, zero SQL duration, and validated JSON in `bind`; keep them separate from slow SQL analysis. Session/zero-padded sequence primary keys make retries idempotent and latest-window reads bounded.
- Diagnostic save/read server actions require the signed owner cookie `__Host-miyulab-db-diag` (HttpOnly, Secure, SameSite=strict, Path=/, 8-hour maxAge). The browser obtains it by proving the configured Fediverse owner account via `verify_credentials` against `https://pl.waku.dev` (default owner account id `AY71rP68i6pkmSPd1k`); both can be overridden only together via `DB_DIAGNOSTICS_OWNER_BACKEND_URL` + `DB_DIAGNOSTICS_OWNER_ACCOUNT_ID` (a single override fails closed). The cookie MAC key is derived server-side as `HMAC-SHA256(DATABASE_URL, 'miyulab-fe:db-diag-auth:key:v1')`, so it needs no extra secret and rotates with the database URL; never log tokens, cookies, or the derived key.
- Set both `NEXT_PUBLIC_DB_DIAGNOSTICS_ENABLED=false` and `DB_DIAGNOSTICS_ENABLED=false` and redeploy to stop client uploads and disable server reads/writes. `DATABASE_URL` stays server-only.
- Verify telemetry arithmetic with `yarn test:run src/util/db/__tests__/dbDiagnostics.test.ts`; `yarn typecheck` covers app and worker interfaces. Never test a production build's database migration against a shared database unintentionally.
- For direct Neon diagnostic investigations, use a read-only transaction and filter `sql` by the literal `DB_DIAGNOSTICS_V1:` prefix before decoding `bind`. Preserve a fixed snapshot; group by session UUID and sequence, and take the per-session maximum of cumulative loss counters rather than summing every window. `sourceId` aliases are session-local, not stable backend identities.
- Diagnostic `queue`/`queueMax` count waiting RPCs only; Queue Stats also counts the active RPC. Status/notification buffers before RPC enqueue are outside these queue-wait metrics. Aggregated windows do not provide request latency percentiles or exact event ordering, and may exceed 10 seconds when browser timers are delayed.
- Use diagnostic `capturedAt` for client chronology. Neon `query_logs.createdAt` is a PostgreSQL timestamp without time zone; when needed, retrieve it as text with the database time zone recorded, rather than relying on node-postgres's machine-local Date conversion.
- Worker Graph/Query IR SQL executes directly through `db.exec` and does not pass through the generic `handleExec` slow-query logger. Zero non-diagnostic QueryLog rows does not establish that Graph queries are fast; diagnosis of individual Graph SQL needs additional identifying/timing evidence.
