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
