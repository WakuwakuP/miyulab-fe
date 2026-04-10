# Symphony Service Specification — GitHub Agentic Workflows Edition

Status: Draft v1 (gh-aw adaptation)

Purpose: Define a service that orchestrates coding agents to get project work done, implemented as
GitHub Agentic Workflows (gh-aw) on GitHub Actions.

## 1. Problem Statement

Symphony is a long-running automation service that continuously reads work from an issue tracker,
creates an isolated workspace for each issue, and runs a coding agent session for that issue inside
the workspace.

This edition adapts the Symphony specification to the **GitHub Agentic Workflows (gh-aw)**
platform. Instead of a standalone daemon process, orchestration is expressed as compiled markdown
workflows that run inside GitHub Actions with AI engines (Copilot, Claude, Codex, Gemini).

The gh-aw adaptation solves the same four operational problems as the original specification:

- It turns issue execution into a repeatable, event-driven workflow instead of manual scripts.
- It isolates agent execution inside the GitHub Actions runner sandbox (Agent Workflow Firewall).
- It keeps the workflow policy in-repo (`.github/workflows/*.md`) so teams version the agent prompt
  and runtime settings with their code.
- It provides enough observability to operate and debug concurrent workflow runs, through GitHub
  Actions logs, safe-output artifacts, and optional OTLP telemetry.

Important boundary:

- Symphony-AW is a dispatcher and scheduler expressed as gh-aw workflows.
- Ticket writes (state transitions, comments, PR links) are performed via **safe-outputs** — never
  by granting direct write permissions to the agent job.
- A successful run may end at a workflow-defined handoff state (for example a label change to
  `human-review`), not necessarily issue closure.

Note: Unlike the original Symphony specification which allows the agent to write via runtime tools,
gh-aw restricts all tracker writes to safe-outputs for auditability and blast-radius control.

Trust and safety posture:

- Each deployment MUST document its trust and safety posture explicitly — which roles can trigger
  workflows, what safe-outputs are available, how network access is scoped, and what content
  integrity guards are applied.
- The specification does not mandate a single approval, sandbox, or operator-confirmation policy.
  Implementations choose the combination of `roles:`, `safe-outputs:`, `network:`, `lockdown:`,
  and `min-integrity:` settings appropriate for their risk profile.

### 1.1 Architectural Mapping

| Symphony (Original)            | gh-aw Equivalent                                          |
| ------------------------------ | --------------------------------------------------------- |
| Standalone daemon process      | GitHub Actions workflow (`.md` → `.lock.yml`)             |
| `WORKFLOW.md` front matter     | gh-aw YAML frontmatter                                    |
| `WORKFLOW.md` prompt body      | gh-aw markdown body (runtime-editable)                    |
| Linear issue tracker           | GitHub Issues / GitHub Projects                           |
| Polling loop                   | `on:` triggers (`issues`, `schedule`, `workflow_dispatch`) |
| Workspace Manager              | GitHub Actions runner checkout + sandbox                  |
| Codex app-server subprocess    | `engine:` configuration (copilot, claude, codex, gemini)  |
| In-memory orchestrator state   | `cache-memory:` / `repo-memory:` persistence              |
| Agent Runner                   | gh-aw agent job (single-job execution model)              |
| Status Surface / Dashboard     | GitHub Actions UI + safe-output reports                   |
| HTTP Server Extension          | Not applicable (use GitHub Actions API)                   |
| SSH Worker Extension           | Not applicable (use `runs-on:` runner labels)             |
| `hooks.after_create`           | `steps:` (pre-agent custom steps)                         |
| `hooks.after_run`              | `post-steps:` (post-agent custom steps)                   |
| Retry queue / backoff          | `workflow_dispatch` re-trigger + `cache-memory` state     |
| Agent update streaming         | Not applicable (engine and orchestrator share runner process) |
| Token accounting               | Engine token tracking + OTLP observability                |

## 2. Goals and Non-Goals

### 2.1 Goals

- Dispatch work from GitHub Issues on event triggers or a fixed schedule, with bounded concurrency
  via `concurrency:` groups.
- Maintain orchestrator state via `cache-memory` for dispatch, retries, deduplication, and reconciliation.
- Execute agent sessions inside the GitHub Actions runner sandbox with AWF protection.
- Stop or skip runs when issue state changes make them ineligible (`skip-if-match`).
- Recover from transient failures via workflow re-dispatch (`workflow_dispatch`); implementations
  SHOULD use exponential backoff (per RFC 2119) when using agent-driven retry patterns.
- Load runtime behavior from repository-owned `.github/workflows/*.md` workflow files.
- Expose operator-visible observability through GitHub Actions logs and optional OTLP.
- Support restart recovery through GitHub Issues state (no persistent database required).

### 2.2 Non-Goals

- Rich web UI or multi-tenant control plane (use GitHub Actions UI).
- Prescribing a specific dashboard or terminal UI implementation.
- General-purpose workflow engine or distributed job scheduler.
- Built-in business logic for how to edit tickets, PRs, or comments (that logic lives in the
  workflow prompt and safe-outputs).
- Enforcing sandbox or network isolation beyond what the AWF and host OS provide.
- Mandating a single default approval, sandbox, or operator-confirmation posture.
- Multi-stage orchestration with cross-job state passing (gh-aw single-job constraint).
- Waiting for external events or deployment completions within a single workflow run.
- Cross-run workspace persistence. Runner filesystems are ephemeral; use `cache-memory:` or
  workflow artifacts for cross-run state.

## 3. System Overview

### 3.1 Main Components

1. `Workflow File` (`.github/workflows/<name>.md`)
   - YAML frontmatter: triggers, permissions, tools, safe-outputs, network, engine.
   - Markdown body: agent instructions (runtime-editable without recompilation).
   - Compiled to `.lock.yml` via `gh aw compile`.
   - `gh aw compile` performs structural validation at compile time. Runtime defaults are applied
     by the gh-aw framework. Secrets and environment variables are resolved via GitHub Actions
     expression syntax (`${{ secrets.XXX }}`, `${{ vars.XXX }}`).

2. `Trigger Configuration` (`on:`)
   - Event-driven: `issues`, `issue_comment`, `pull_request`, `discussion`.
   - Time-driven: `schedule` (fuzzy daily/weekly or explicit cron).
   - Manual: `workflow_dispatch`, `slash_command`, `label_command`.

3. `GitHub Issue Tracker`
   - GitHub Issues as the work queue.
   - GitHub Projects for board-level tracking (optional).
   - GitHub Labels for state management and workflow triggering.
   - GitHub MCP server (`tools: github:`) for reading issue data.
   - The GitHub MCP server provides a stable, typed interface for issue data, replacing Symphony's
     explicit normalization layer.

4. `Orchestration Logic`
   - Encoded in the workflow prompt (markdown body).
   - Eligibility filtering via `skip-if-match` / `skip-if-no-match`.
   - Concurrency control via `concurrency:` frontmatter field.
   - State persistence via `cache-memory:` for cross-run deduplication.

5. `Agent Execution`
   - AI engine runs inside the GitHub Actions runner sandbox.
   - Engine selection: `copilot` (default), `claude`, `codex`, `gemini`.
   - Sandboxed by Agent Workflow Firewall (AWF).
   - Tools: `github:`, `bash:`, `edit:`, `web-fetch:`, `web-search:`, custom MCP servers.
   - The runner automatically checks out the repository via `actions/checkout`. Workspace lifecycle
     is managed by `steps:` (pre-agent) and `post-steps:` (post-agent), mapped from Symphony's
     `hooks.after_create` and `hooks.after_run`. Workspace cleanup is implicit (ephemeral runner).

6. `Safe Outputs`
   - All GitHub write operations go through `safe-outputs:`.
   - `create-issue:`, `close-issue:`, `add-comment:`, `create-pull-request:`, `update-issue:`.
   - Rate-limited, auditable, permission-scoped.

7. `Observability`
   - GitHub Actions logs (structured, per-run).
   - Optional OTLP telemetry via `observability:` frontmatter.
   - Status comments via `status-comment: true`.
   - Report workflows via `create-discussion:` safe output.
   - Engine token usage and session-level metrics are tracked via OTLP telemetry or safe-output
     reports. Retry queue state is managed via `cache-memory:`.

### 3.2 Abstraction Levels

1. `Policy Layer` (repo-defined)
   - Workflow markdown body (agent instructions).
   - Team-specific rules for ticket handling, validation, and handoff.

2. `Configuration Layer` (YAML frontmatter)
   - Triggers, permissions, tools, network, engine, safe-outputs.
   - Compiled to GitHub Actions YAML via `gh aw compile`.

3. `Coordination Layer` (triggers + skip guards + reconciliation)
   - Event triggers, schedule, eligibility guards (`skip-if-match`, `skip-if-no-match`,
     `skip-if-check-failing`).
   - Concurrency groups, rate limiting.
   - Reconciliation: skip guards act as the event-driven equivalent of Symphony's per-tick
     reconciliation — each trigger evaluates current issue state before activation.

4. `Execution Layer` (GitHub Actions runner + AWF sandbox)
   - Repository checkout, pre-steps, agent execution, post-steps.
   - Engine lifecycle managed by gh-aw framework.
   - Runner provides ephemeral filesystem; no cross-run workspace persistence
     (use `cache-memory` or artifacts for state continuity).

5. `Integration Layer` (GitHub MCP server + safe-outputs)
   - Read operations via GitHub MCP server toolsets.
   - Write operations via safe-outputs.

6. `Observability Layer` (logs + OTLP + status comments)
   - GitHub Actions UI for run history and logs.
   - Optional OTLP for distributed tracing.

### 3.3 External Dependencies

- GitHub Actions runner environment.
- GitHub API (via GitHub MCP server, `tools: github:`).
- GitHub Actions authentication (`GITHUB_TOKEN`, auto-provisioned per run).
- AI engine API (Copilot, Claude, Codex, or Gemini).
- Agent Workflow Firewall (AWF) for sandbox enforcement.
- Runner ephemeral filesystem (workspace lifetime = run lifetime).
- Optional: external MCP servers for third-party integrations.
- Engine communication protocol is managed by the gh-aw framework and is not user-configurable.

## 4. Core Domain Model

### 4.1 Entities

#### 4.1.1 Issue (GitHub Issue)

Normalized issue record used by orchestration, prompt rendering, and observability.

Fields (accessible via GitHub MCP server or `${{ github.event }}` context):

- `number` (integer)
  - GitHub issue number.
- `title` (string)
- `body` (string or null)
- `state` (string)
  - `open` or `closed`.
- `state_reason` (string or null)
  - `completed`, `not_planned`, or null.
- `labels` (list of label objects)
  - Each with `name`, `color`, `description`.
  - Label names are case-sensitive in GitHub; preserve original casing.
- `assignees` (list of user objects)
- `milestone` (object or null)
- `priority` (string or null)
  - Derived from labels (e.g., `priority:high`, `priority:medium`, `priority:low`).
  - Used for dispatch ordering in batch processing — see §8.2.
- `blocked_by` (list of issue numbers or null)
  - Derived from issue body or task list references.
  - Issues with unresolved blockers are skipped during batch dispatch — see §8.5.
  - Each blocker is resolved by checking the referenced issue's state via the GitHub API
    (`state == closed`). The `skip-if-match:` guard can incorporate blocker resolution checks.
- `branch_name` (string or null)
  - Derived from linked PRs or issue metadata.
- `created_at` (ISO-8601 timestamp)
- `updated_at` (ISO-8601 timestamp)
- `url` (string)
  - HTML URL for the issue.
- `node_id` (string)
  - GraphQL node ID.

Active and terminal state classification:

- **Active states**: Issues matching `is:open` combined with workflow-specific label filters
  (e.g., `label:todo`, `-label:agent:done`). Defined via `skip-if-match` / `skip-if-no-match`
  guards per workflow.
- **Terminal states**: Issues matching `is:closed` or bearing terminal labels
  (e.g., `agent:done`, `agent:blocked`). Terminal issues are skipped by skip guards.

#### 4.1.2 Workflow Definition

Parsed `.github/workflows/<name>.md` payload:

- `frontmatter` (YAML object)
  - All gh-aw configuration fields.
- `markdown_body` (string)
  - Agent instructions, trimmed. Runtime-editable without recompilation.

Compiled output:

- `.github/workflows/<name>.lock.yml`
  - GitHub Actions YAML generated by `gh aw compile`.

#### 4.1.3 Workflow Configuration (Frontmatter Fields)

Core fields:

- `on:` — Workflow triggers (required).
- `permissions:` — GitHub token permissions (read-only for agent job).
- `engine:` — AI engine configuration.
- `tools:` — Tool and MCP server configuration.
- `safe-outputs:` — Write operation definitions.
- `network:` — Network access control.
- `timeout-minutes:` — Agent execution timeout.
- `concurrency:` — Concurrency control.

See Section 5 for the full frontmatter schema.

#### 4.1.4 Run Attempt (GitHub Actions Workflow Run)

One execution attempt for one trigger event.

Fields (from GitHub Actions API):

- `run_id` (integer)
- `run_number` (integer)
  - Sequential run number for the workflow. Note: this is a per-workflow counter, not a
    per-issue retry counter. For per-issue retry tracking, see Cache Memory State below.
- `workflow_id` (integer)
- `status` (`queued`, `in_progress`, `completed`)
- `conclusion` (`success`, `failure`, `cancelled`, `timed_out`)
- `event` (trigger event type)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `actor` (GitHub user who triggered)
- `error` (structured error information)
  - Captured from engine output, tool failures, or timeout events.
  - Includes error category (see §14.1) and message.

#### 4.1.5 Cache Memory State

Persistent state across workflow runs for orchestration logic.

- Stored via `cache-memory:` tool.
- Git-backed persistence within the repository.
- Used for deduplication, incremental processing, and cross-run state.

#### 4.1.6 Agent Session Tracking

Token usage and session metrics tracked per workflow run. This is the gh-aw equivalent of
Symphony's Live Session entity.

Fields (from OTLP spans and engine output):

- `run_id` — Workflow run identifier (serves as session ID).
- `engine_id` — Engine used for this session.
- `turn_count` — Number of chat turns completed.
- `input_tokens` — Total input tokens consumed.
- `output_tokens` — Total output tokens consumed.
- `total_tokens` — `input_tokens + output_tokens`.
- `elapsed_seconds` — Wall-clock time of agent execution.

Token accounting rules:

- Use **absolute totals** from the engine's final usage report, not delta accumulation.
- If the engine reports cumulative totals per turn, use the last turn's cumulative value.
- Do not double-count tokens across continuation turns within the same run.
- OTLP spans SHOULD include `gh-aw.engine.input_tokens`, `gh-aw.engine.output_tokens`,
  and `gh-aw.engine.total_tokens` attributes.

When OTLP is not configured, token usage is available in GitHub Actions run logs
(engine-dependent format). The `gh aw audit <run-id>` command extracts token metrics.

Rate limit information is managed by the engine platform (Copilot, Claude, etc.) and is not
directly observable by the workflow. If rate-limit visibility is needed, engine-specific OTLP
span attributes SHOULD be exported.

#### 4.1.7 Retry State

Per-issue retry tracking stored in `cache-memory`. This is the gh-aw equivalent of Symphony's
Retry Entry entity.

Fields:

- `issue_number` — The issue being retried.
- `attempt` — Current retry attempt number (1-indexed).
- `max_attempts` — Maximum retries before marking blocked (default: 3).
- `last_error` — Error category and message from the last failed attempt.
- `next_retry_after` — ISO-8601 timestamp for the next retry (exponential backoff).
- `backoff_ms` — Current backoff interval in milliseconds.

Backoff formula (recommended):

```
backoff_ms = min(10000 * 2^(attempt - 1), max_retry_backoff_ms)
```

Default `max_retry_backoff_ms`: 300000 (5 minutes).

Agent-driven retry workflows read this state from `cache-memory` at the start of each run and
update it on completion or failure.

#### 4.1.8 Safe Output Record

Structured output from the agent job, processed by a separate output job.

Types:
- `create-issue` — Issue creation with title, body, labels, assignees.
- `close-issue` — Issue closure with comment.
- `add-comment` — Comment on issue/PR/discussion.
- `create-pull-request` — PR creation with branch, title, body.
- `create-discussion` — Discussion creation for reports/audits.
- `update-issue` — Issue metadata updates.
- `dispatch-workflow` — Trigger another workflow.

### 4.2 Stable Identifiers and Normalization Rules

> **Mapping Note:** Symphony's Workspace entity (§4.1.4 in the original specification) — containing `path`, `workspace_key`, and `created_now` fields — is replaced by GitHub Actions `actions/checkout`. Workspace key sanitization rules are not needed as GitHub Actions manages runner directories.

- `Issue Number`
  - Use for GitHub API lookups and cross-reference.
- `Workflow ID`
  - Derived from the `.md` filename (kebab-case).
- `Run ID`
  - Unique GitHub Actions run identifier.

> **Mapping Note:** Symphony's `session_id = "<thread_id>-<turn_id>"` is replaced by GitHub Actions `run_id` (unique per workflow run) combined with `run_attempt` for retry tracking. For multi-turn continuation, the chain of `run_id` values is tracked via `cache-memory:`.

- `Label Names`
  - Case-sensitive in GitHub (preserve original casing).
  - Normalize to lowercase for comparison when used in orchestration logic.
- `Timestamps`
  - All timestamps use ISO-8601 format as returned by GitHub API.
  - Parse and compare as UTC.
- `Tracker ID`
  - Optional `tracker-id:` frontmatter field for asset tracking.
  - Must be ≥ 8 characters, alphanumeric + hyphens + underscores.

## 5. Workflow Specification (Repository Contract)

### 5.1 File Discovery and Path Resolution

Workflow file location:

- `.github/workflows/<workflow-id>.md`
- Subdirectories supported: `.github/workflows/**/*.md`
- Shared components: `.github/workflows/shared/*.md`

Compiled output:

- `.github/workflows/<workflow-id>.lock.yml`
- Generated by `gh aw compile [workflow-id]`.

Discovery behavior:

- `gh aw compile` processes all `.md` files in `.github/workflows/`.
- `gh aw compile <name>` compiles a single workflow by name (without `.md` extension).
- `gh aw compile --purge` removes orphaned `.lock.yml` files.

### 5.2 File Format

Workflow files use **markdown + YAML frontmatter** format:

```markdown
---
on:
  issues:
    types: [opened, labeled]
permissions:
  issues: read
timeout-minutes: 15
tools:
  github:
    toolsets: [default]
safe-outputs:
  add-comment:
    max: 3
---

# Workflow Title

Natural language description of what the AI agent should do.

Use GitHub context expressions like ${{ github.event.issue.number }}.
```

Parsing rules:

- YAML frontmatter between `---` markers: configuration requiring recompilation.
- Markdown body after frontmatter: agent instructions (runtime-editable).
- If no frontmatter delimiters are present, the entire file is treated as the markdown body
  with an empty configuration map (all compiler defaults apply).
- Frontmatter must decode to a YAML map; non-map YAML is an error.
- Body is trimmed before use.
- Unknown frontmatter keys are reported as warnings during compilation but do not block
  compilation (forward compatibility).

Editing without recompilation:

- The markdown body is loaded at runtime.
- Changes to agent instructions take effect on the next workflow run.
- Frontmatter changes require `gh aw compile` and commit of the updated `.lock.yml`.

### 5.3 Frontmatter Schema

#### 5.3.1 `on:` (Triggers — Required)

Event-driven triggers:

- `issues:` — Issue events (`types: [opened, labeled, closed, ...]`).
- `issue_comment:` — Issue/PR comment events.
- `pull_request:` — PR events (`types: [opened, synchronize, ...]`).
- `discussion:` — Discussion events.
- `push:` — Push events.

Time-driven triggers:

- `schedule:` — Cron or fuzzy schedule.
  - Fuzzy: `daily`, `daily on weekdays`, `weekly` (compiler scatters time).
  - Explicit: `- cron: "0 9 * * 1-5"`.
  - Prefer `daily on weekdays` to avoid Monday backlog.

Manual triggers:

- `workflow_dispatch:` — Manual trigger from GitHub UI or API.
  - Automatically added for fuzzy schedules.
- `slash_command:` — `/command-name` in comments.
- `label_command:` — Label application trigger (auto-removed after activation).

Trigger modifiers:

- `roles:` — Repository roles that can trigger (`[admin, maintainer, write]` default, or `all`).
- `skip-roles:` — Skip for specific roles.
- `skip-bots:` — Skip for specific bot actors.
- `skip-if-match:` — Skip when a GitHub search query returns results.
- `skip-if-no-match:` — Skip when a GitHub search query returns no results.
- `skip-if-check-failing:` — Skip when CI checks are failing.
- `stop-after:` — Deadline for workflow execution.
- `reaction:` — Add emoji reaction to triggering item.
- `status-comment:` — Post status comments on start/complete.
- `manual-approval:` — Require environment protection approval.
- `forks:` — Fork allowlist for `pull_request` triggers.

#### 5.3.2 `permissions:` (GitHub Token Permissions)

**Critical security rule**: Agent job permissions must be **read-only**. All write operations go
through `safe-outputs`.

Available permission scopes:

- `contents: read`
- `issues: read`
- `pull-requests: read`
- `discussions: read`
- `actions: read`
- `checks: read`
- `statuses: read`
- `models: read`
- `deployments: read`
- `security-events: read`
- `id-token: write` (exception: allowed for OIDC authentication)

#### 5.3.3 `engine:` (AI Engine Configuration)

String format:

- `"copilot"` (default, recommended)
- `"claude"`
- `"codex"`
- `"gemini"`

Object format:

```yaml
engine:
  id: copilot
  model: gpt-5               # Optional: LLM model override
  max-turns: 10               # Optional: maximum chat iterations
  max-concurrency: 3          # Optional: max concurrent workflow runs
  max-retry-backoff-ms: 300000 # Maximum backoff cap for retry delay calculation (default: 300000 = 5 min)
  agent: custom-agent-name    # Optional: custom agent file (Copilot only)
  env:                         # Optional: custom environment variables
    DEBUG_MODE: "true"
  args: ["--verbose"]          # Optional: custom CLI arguments
  api-target: api.ghes.com    # Optional: GHEC/GHES endpoint
```

Sensible defaults:

- Engine: `copilot` (omit if using default).
- `timeout-minutes`: 20 (omit if using default).
- `max-turns`: engine-specific default (omit if using default).
- `max-concurrency`: 3 (omit if using default).

Timeout granularity:

gh-aw provides a single `timeout-minutes` for the overall agent execution. For finer-grained
timeout control, use these additional settings:

- `timeout-minutes:` — Overall agent execution timeout (default: 20).
- `engine.max-turns:` — Limits the number of chat iterations (prevents infinite loops).
- `tools.timeout:` — Per-tool-call timeout in seconds (default: engine-specific).
- `tools.startup-timeout:` — MCP server initialization timeout in seconds.

Unlike Symphony's three-tier timeout (turn/read/stall), gh-aw consolidates into
`timeout-minutes` + `max-turns`. The engine handles per-turn read timeouts internally.
Stall detection is delegated to `timeout-minutes` (see §8.4).

#### 5.3.4 `tools:` (Agent Tool Configuration)

Built-in tools:

- `github:` — GitHub MCP server (required for GitHub API access).
  - `toolsets:` — Enable toolset groups (`[default]`, `[all]`, or specific sets).
  - `lockdown:` — Limit content to push-access authors (boolean).
  - `min-integrity:` — Minimum content integrity level.
  - `github-app:` — GitHub App token minting.
- `edit:` — File editing (enabled by default in sandbox).
- `bash:` — Shell commands (enabled by default in sandbox, all commands allowed).
- `web-fetch:` — Web content fetching.
- `web-search:` — Web search.
- `playwright:` — Browser automation.
- `agentic-workflows:` — gh-aw introspection tools.

**Important**: `edit` and `bash` are enabled by default due to AWF sandbox. Do not restrict
unnecessarily.

**Important**: GitHub API access requires `tools: github:`. Adding `api.github.com` to
`network: allowed:` does NOT grant API access.

Custom MCP servers:

```yaml
mcp-servers:
  my-server:
    command: "node"
    args: ["path/to/server.js"]
    allowed:
      - function_1
      - function_2
```

#### 5.3.5 `safe-outputs:` (Write Operations)

All GitHub write operations must go through safe-outputs:

```yaml
safe-outputs:
  create-issue:
    title-prefix: "[ai] "
    labels: [automation]
    max: 5
    expires: 7                  # Auto-close after 7 days
    close-older-issues: true
  close-issue:
    target: "triggering"
    max: 1
  add-comment:
    max: 3
    target: "*"
    hide-older-comments: true
  create-discussion:
    category: "General"
    max: 1
    close-older-discussions: true
  create-pull-request:
    max: 1
    base: main
  update-issue:
    max: 5
  dispatch-workflow:
    max: 1
```

Cross-repository operations:

```yaml
safe-outputs:
  github-token: ${{ secrets.CROSS_REPO_PAT }}
  create-issue:
    max: 5
    target-repo: "org/other-repo"
    allowed-repos: [org/repo-a, org/repo-b]
```

Custom safe output jobs (for external services):

```yaml
safe-outputs:
  jobs:
    notify-slack:
      runs-on: ubuntu-latest
      steps:
        - name: Send Slack notification
          run: |
            curl -X POST "${{ secrets.SLACK_WEBHOOK }}" \
              -H 'Content-Type: application/json' \
              -d '{"text": "Workflow completed"}'
```

#### 5.3.6 `network:` (Network Access Control)

```yaml
# String format: curated development domains
network: defaults

# Ecosystem-specific (auto-detected from repo files)
network:
  allowed:
    - node          # npm registry
    - python        # PyPI
    - "api.example.com"
  blocked:
    - "untrusted.com"
```

Ecosystem detection rules:

- `package.json`, `yarn.lock` → `node`
- `requirements.txt`, `pyproject.toml` → `python`
- `go.mod` → `go`
- `Cargo.toml` → `rust`
- `pom.xml`, `build.gradle` → `java`
- `Gemfile` → `ruby`

#### 5.3.7 `concurrency:` (Concurrency Control)

```yaml
# Simple group
concurrency: symphony-dispatch

# With cancellation
concurrency:
  group: symphony-${{ github.event.issue.number }}
  cancel-in-progress: true

# With fan-out discriminator
concurrency:
  job-discriminator: ${{ github.event.issue.number }}
```

> **Symphony Mapping:** Symphony's `max_concurrent_agents_by_state` (per-state concurrency limits) is not directly supported. To approximate per-label concurrency, use multiple `concurrency:` groups keyed by label, or implement label-count checks in `steps:` using the GitHub API before agent execution. If per-state concurrency control is not required, this can be safely omitted.

#### 5.3.8 Additional Configuration Fields

- `timeout-minutes:` — Agent execution timeout (default: 20).
- `runs-on:` — Runner type (default: `ubuntu-latest`).
- `env:` — Environment variables.
- `if:` — Conditional execution expression.
- `run-name:` — Custom workflow run name.
- `name:` — Workflow display name.
- `description:` — Human-readable description.
- `labels:` — Workflow categorization labels.
- `strict:` — Enhanced validation (default: `true`).
- `tracker-id:` — Asset tracking identifier.
- `imports:` — Import shared workflow components.
- `inlined-imports:` — Inline all imports at compile time.
- `checkout:` — Repository checkout configuration.
- `steps:` — Pre-agent custom steps (outside sandbox).
- `post-steps:` — Post-agent custom steps (outside sandbox).

To replicate Symphony's `after_create` (runs only on first workspace creation), use
`cache-memory:` for first-run detection:

```yaml
steps:
  - name: First-run setup
    if: steps.cache_check.outputs.cache-hit != 'true'
    run: |
      # Branch creation, initial comment, etc.
```

Alternatively, use event-type conditions: `if: github.event.action == 'opened'` for
issue-opened-only steps.

Individual steps SHOULD specify `timeout-minutes` to prevent hanging (default
recommendation: `5`). This replaces Symphony's `hooks.timeout_ms` (default: 60000ms).

```yaml
steps:
  - name: Setup dependencies
    timeout-minutes: 5
    run: npm ci
```

> **Mapping Note:** Symphony's `before_remove` hook (runs before workspace deletion) has no gh-aw equivalent. Runner filesystems are ephemeral and automatically cleaned up. Use `post-steps:` for any necessary finalization (e.g., uploading artifacts) before the runner is recycled.

- `runtimes:` — Runtime version overrides (Node.js, Python, etc.).
- `container:` — Container configuration.
- `services:` — Service containers.
- `secrets:` — Secret values.
- `features:` — Feature flags.
- `rate-limit:` — Rate limiting configuration.
- `check-for-updates:` — Version check toggle.

### 5.4 Prompt Template Contract

The markdown body of the workflow file is the agent instruction template.

Runtime behavior:

- Loaded at runtime (not compiled into `.lock.yml`).
- Editable directly on GitHub.com without recompilation.
- Changes take effect on the next workflow run.
- If the markdown body is empty, the engine receives a minimal context prompt with the
  trigger event payload. This is valid but not recommended for production workflows.

Template expressions:

- GitHub Actions context: `${{ github.event.issue.number }}`, `${{ github.repository }}`.
- Steps output: `${{ steps.sanitized.outputs.text }}` (for slash commands).
- Secrets: `${{ secrets.API_KEY }}` (via `secrets:` frontmatter).

Expression resolution rules:

- Expressions use `${{ }}` syntax (not Liquid/Jinja templates).
- Unknown expressions evaluate to empty string (GitHub Actions default behavior).
- This is less strict than Symphony's template engine (which errors on unknown variables).
  Workflow authors SHOULD validate expressions via `gh aw compile --strict` to catch typos.
- `${{ secrets.* }}` expressions that resolve to empty string (undefined secret) SHOULD be
  treated as a configuration error. The workflow SHOULD fail fast if a required secret is
  missing. Use `steps:` to validate critical secrets before agent execution.
- To access the retry attempt number, use `steps:` to read from `cache-memory:` and expose
  via step outputs: `${{ steps.retry_info.outputs.attempt }}`. First attempt is `0`,
  subsequent retries increment.

What you can include in the markdown body:

- Agent instructions and task descriptions.
- Context explanations and background information.
- Output formatting templates.
- Conditional logic and examples.
- Documentation and clarifications.

### 5.5 Workflow Validation and Error Surface

Validation commands:

```bash
# Compile with validation
gh aw compile

# Strict mode with all scanners
gh aw compile --strict

# Security scanners
gh aw compile --actionlint    # Includes shellcheck
gh aw compile --zizmor        # Security vulnerability scanner
gh aw compile --poutine       # Supply chain security analyzer

# Validate without emitting files
gh aw compile --json --no-emit
```

Error classes:

- `E_PARSE` — YAML syntax error (missing or invalid frontmatter).
- `E_SCHEMA` — Frontmatter schema violation (unknown or invalid trigger configuration,
  invalid safe-output configuration, tool configuration errors).
- `E_TEMPLATE` — Unresolved expression in strict mode.
- `E_IMPORT` — Missing or circular import.
- `E_PERMISSION` — Invalid permission combination (write permissions on agent job;
  must use safe-outputs).
- `E_SECURITY` — Security policy violation (network access violations,
  secret usage in `steps:` / `post-steps:` in strict mode).

`gh aw compile` exits with code 1 on any error and outputs JSON diagnostics with `code`,
`message`, `location` fields.

Dispatch gating rules:

- **Compilation errors** (frontmatter/YAML) block ALL dispatches for that workflow — the
  `.lock.yml` is not generated, so no runs can start.
- **Runtime expression errors** (e.g., undefined context in markdown body) affect only the
  individual run — the expression evaluates to empty string but the run proceeds.
- **Skip guard errors** cancel the individual run — visible in GitHub Actions history.
- File read or parse failures during compilation are fatal — `gh aw compile` exits non-zero.

## 6. Configuration Specification

### 6.1 Source Precedence and Resolution Semantics

Configuration sources:

1. YAML frontmatter in the `.md` workflow file.
2. Imported shared workflow components (`imports:`).
3. GitHub Actions context expressions (`${{ ... }}`).
4. GitHub repository secrets and variables.
5. Compiler defaults.

Expression resolution:

- `${{ secrets.API_KEY }}` — Repository secret.
- `${{ vars.CONFIG_VALUE }}` — Repository variable.
- `${{ github.event.* }}` — Trigger event data.
- `${{ github.repository }}` — Repository context.
- Expressions that resolve to empty string are treated as absent/unset.
- Unlike Symphony's `$VAR` shell expansion, gh-aw does NOT perform tilde (`~`) expansion
  or shell command substitution. Path values are used as-is.
- URI strings, arbitrary shell commands, and non-expression values are NOT expanded.

### 6.2 Dynamic Reload Semantics

Frontmatter changes (require recompilation):

- Edit the `.md` file.
- Run `gh aw compile <workflow-id>`.
- Commit both `.md` and `.lock.yml`.

Markdown body changes (no recompilation needed):

- Edit the markdown body directly (GitHub.com, editor, etc.).
- Commit only the `.md` file.
- Changes take effect on the next workflow run.

Invalid workflow behavior:

- Compilation errors prevent `.lock.yml` generation.
- Runtime errors are visible in GitHub Actions logs.
- The last valid `.lock.yml` remains in effect until replaced.
- On invalid reload: the service does not crash; the previous valid configuration continues
  to serve runs. Compilation errors are reported via CLI output and, if OTLP is configured,
  as error events.

### 6.3 Dispatch Preflight Validation

gh-aw provides built-in validation at two levels:

Compile-time validation (via `gh aw compile`):

- Frontmatter schema validation.
- Permission scope validation (no write on agent job).
- Safe-output configuration validation.
- Network/tool configuration validation.
- Security scanner integration (actionlint, zizmor, poutine).

Per-event validation (evaluated at each trigger):

- `skip-if-match:` — Skip when search query matches (deduplication).
- `skip-if-no-match:` — Skip when preconditions are not met.
- `skip-if-check-failing:` — Skip when CI is red.
- `roles:` / `skip-roles:` — Role-based authorization.
- `skip-bots:` — Bot filtering.
- `rate-limit:` — Per-user rate limiting.
- `if:` — Conditional execution expression.

Per-event guards are the gh-aw equivalent of Symphony's per-tick dispatch preflight validation.
They ensure that the system is in a valid state before each run begins.

### 6.4 Config Fields Summary (Cheat Sheet)

Core configuration:

- `on:` — triggers (required)
- `permissions:` — read-only token scopes
- `engine:` — AI engine (default: `copilot`)
- `tools:` — tool and MCP server configuration
- `safe-outputs:` — write operation definitions
- `network:` — network access control
- `timeout-minutes:` — agent timeout (default: 20)

> **Symphony Mapping:** `timeout-minutes` subsumes both Symphony's `codex.stall_timeout_ms` (engine inactivity timeout, default 5min) and `codex.read_timeout_ms` (per-read timeout, default 5s). The granularity of stall detection is reduced: `timeout-minutes` applies to the entire job, not individual engine interactions. For workloads requiring finer-grained stall detection, implement periodic heartbeat checks in `steps:` or rely on engine-level timeouts.
- `concurrency:` — concurrency control
- `runs-on:` — runner type
- `env:` — environment variables
- `secrets:` — secret values

Orchestration:

- `on.skip-if-match:` — deduplication guard
- `on.skip-if-no-match:` — precondition guard
- `on.skip-if-check-failing:` — CI health guard
- `on.stop-after:` — execution deadline
- `on.roles:` — authorized roles (default: `[admin, maintainer, write]`)
- `on.skip-roles:` — excluded roles
- `on.skip-bots:` — excluded bots
- `rate-limit:` — per-user rate limiting

Agent:

- `engine.id:` — engine identifier (copilot, claude, codex, gemini)
- `engine.model:` — LLM model override
- `engine.max-turns:` — max chat iterations
- `engine.max-concurrency:` — max concurrent runs (default: 3)
- `engine.agent:` — custom agent file (Copilot only)
- `engine.max-retry-backoff-ms` — integer, default `300000` (5 min). Maximum backoff cap for agent-driven retry delay calculation. Formula: `min(10000 * 2^(attempt-1), max-retry-backoff-ms)`.
- `engine.max-continuation-runs` — integer, default `5`. Maximum number of continuation runs (multi-turn) allowed for a single issue before the workflow marks the issue as `agent:blocked`. This prevents infinite continuation loops.

Observability:

- `on.status-comment:` — start/complete status comments
- `on.reaction:` — emoji reaction on trigger
- `observability.otlp:` — OpenTelemetry export
- `tracker-id:` — asset tracking identifier

## 7. Orchestration Model

### 7.1 Event-Driven Dispatch (vs. Polling)

Unlike the original Symphony polling model, gh-aw uses **event-driven dispatch**:

| Symphony Polling | gh-aw Event-Driven |
| --- | --- |
| Poll every `interval_ms` | React to `on:` trigger events |
| Fetch candidate issues | GitHub delivers event payload |
| In-memory claimed set | `concurrency:` group + `skip-if-match` |
| Retry timer queue | `workflow_dispatch` re-trigger |
| Running map | GitHub Actions `in_progress` runs |

### 7.2 Issue Orchestration States (via Labels)

Instead of internal orchestrator states, use GitHub labels:

1. `unclaimed` (no agent label)
   - Issue is open, no workflow has claimed it.

2. `agent:claimed` (label applied)
   - Workflow has started processing the issue.
   - Applied via `safe-outputs: update-issue:` or `add-comment:`.

3. `agent:in-progress` (label applied)
   - Agent is actively working on the issue.

4. `agent:review` (label applied)
   - Agent work complete, awaiting human review.

5. `agent:done` (label applied or issue closed)
   - Work complete.

6. `agent:blocked` (label applied)
   - Issue cannot proceed (dependencies, missing info).

7. `agent:retry-queued` (label applied)
   - Agent work failed, awaiting retry dispatch.
   - Retry state tracked in `cache-memory` (see §4.1.7).
   - Transition to `agent:in-progress` when retry run starts.

Skip guard for deduplication:

```yaml
on:
  issues:
    types: [opened, labeled]
  skip-if-match: "is:issue is:open label:agent:in-progress"
```

### 7.3 Run Attempt Lifecycle

A gh-aw workflow run transitions through these phases:

1. `Activation` — Trigger event received, skip guards evaluated.
2. `Checkout` — Repository checked out on runner.
3. `Pre-Steps` — Custom `steps:` executed (outside sandbox).
   - Failure in pre-steps is **fatal** — the run is aborted.
4. `Agent Execution` — AI engine runs with tools and instructions.
   - Includes streaming turns, tool calls, and engine responses.
5. `Safe Output Processing` — Write operations executed by output job.
6. `Post-Steps` — Custom `post-steps:` executed (outside sandbox).
   - Failure in post-steps is **logged but non-fatal** — does not change run conclusion.
7. `Conclusion` — Run completes with `success`, `failure`, `cancelled`, or `timed_out`.

Terminal states:

- `success` — Agent completed normally, safe outputs processed.
- `failure` — Agent execution failed, pre-steps failed, or engine error.
- `cancelled` — Run cancelled by operator or concurrency group.
- `timed_out` — `timeout-minutes` exceeded.
- `stalled` — No agent activity detected within `timeout-minutes`. GitHub Actions reports
  this as `timed_out`. Stall detection relies on `timeout-minutes` as the upper bound
  (see §8.4).

**Terminal State Retry Policies**

Distinct terminal reasons determine retry behavior:

| Terminal State | Retry Eligible | Retry Strategy | Notes |
|---------------|---------------|----------------|-------|
| `completed` | Yes (continuation) | Immediate `dispatch-workflow` | Agent requested more work via continuation |
| `failure` | Yes | Exponential backoff | `min(10s × 2^(attempt-1), max-retry-backoff-ms)` |
| `timed_out` | Yes | Immediate retry | Timeout may be transient; retry with same `timeout-minutes` |
| `cancelled` | No | — | Intentional cancellation; do not retry |
| `stalled` | Yes | Exponential backoff | Treat as infrastructure failure |

### 7.4 Transition Triggers

- `Issue Event`
  - Issue opened, labeled, or commented → workflow dispatch.
  - `skip-if-match` / `skip-if-no-match` evaluated before activation.

- `Schedule`
  - Fuzzy or cron schedule → periodic batch processing.

- `Manual Dispatch`
  - `workflow_dispatch` → operator-triggered run.
  - `slash_command` → user comment `/command`.
  - `label_command` → label application.

- `Completion (success)`
  - Agent execution completes normally → safe outputs processed.
  - Status comment posted if enabled.
  - For multi-turn continuation: agent may use `dispatch-workflow` to trigger a follow-up
    run if more work remains (see §7.6).

- `Completion (failure)`
  - Agent execution failed → error categorized (see §14.1).
  - Retry state updated in `cache-memory` if agent-driven retry is configured.
  - `agent:retry-queued` label applied; `dispatch-workflow` triggers follow-up with backoff.

- `Timeout`
  - `timeout-minutes` exceeded → run concludes as `timed_out`.
  - Acts as stall detection: if the engine produces no output within the timeout window,
    the run is terminated. Unlike Symphony's dedicated `stall_timeout_ms`, gh-aw uses the
    same `timeout-minutes` for both activity timeout and overall deadline.

- `Cancellation`
  - Concurrency group with `cancel-in-progress: true` cancels superseded runs.
  - Operator cancels run via GitHub Actions UI.

- `Issue State Change (reconciliation)`
  - Issue closed or terminal label applied while a run is in progress.
  - Skip guards on subsequent events will prevent new runs.
  - For in-progress runs: `concurrency: cancel-in-progress: true` cancels the current run
    if a new event arrives. Otherwise, the running agent continues to completion.

> **Symphony Mapping:** Symphony's Codex Update Event (live session field updates, token counters, rate limits) has no direct gh-aw equivalent. Token consumption and rate limits are managed by the engine platform. For observability, export engine metrics via OTLP spans (see §13.3) or query them via `gh aw audit`.

**Active Run Cancellation on Issue State Change**

When an issue transitions to a terminal state (closed, deleted) while an agent run is in progress, the running workflow SHOULD be cancelled. Two complementary mechanisms achieve this:

1. **Concurrency-based cancellation**: If the workflow includes `issues: [closed, deleted]` in its triggers and uses `concurrency: { group: issue-${{ github.event.issue.number }}, cancel-in-progress: true }`, closing the issue fires a new workflow run that automatically cancels the in-progress run via the concurrency group.

2. **Explicit cancellation workflow**: A separate lightweight workflow triggered on `issues: [closed, deleted]` can call the GitHub API to cancel running workflow runs for the affected issue:
   ```yaml
   - uses: actions/github-script@v7
     with:
       script: |
         const runs = await github.rest.actions.listWorkflowRuns({...});
         for (const run of runs.data.workflow_runs.filter(r => r.status !== 'completed')) {
           await github.rest.actions.cancelWorkflowRun({...});
         }
   ```

Implementations MUST document which mechanism they use. If neither is implemented, the specification requires that `timeout-minutes` provides a hard upper bound on orphaned runs.

### 7.5 Multi-Turn Continuation

gh-aw executes one agent session per workflow run. For tasks that require multiple sessions
(equivalent to Symphony's multi-turn continuation), use the **dispatch-workflow** pattern:

1. Agent completes a unit of work and saves progress to `cache-memory`.
2. If more work remains, agent triggers `dispatch-workflow` to start a follow-up run.
3. The follow-up run reads `cache-memory` state and resumes from the last checkpoint.
4. Continuation repeats until work is complete or `max_attempts` is reached.

Continuation prompt pattern (in markdown body):

```markdown
## Continuation Protocol

Check cache-memory for work state of issue #${{ github.event.issue.number }}.

If this is a continuation run (state exists):
  - Read the last checkpoint and resume from there.
  - Use the context from the previous run to avoid redundant work.

If this is a fresh run (no state):
  - Start from the beginning.
  - Save checkpoints to cache-memory as you progress.

If work is complete:
  - Clear the work state from cache-memory.
  - Post a completion comment.
  - Apply the `agent:done` label.

If work cannot be completed in this run:
  - Save progress to cache-memory.
  - Trigger a continuation run via dispatch-workflow.
```

Unlike Symphony's same-process multi-turn (where turns share a thread and workspace),
gh-aw continuation runs are independent: each starts with a fresh checkout, new engine
session, and no shared thread context. The `cache-memory` state bridge is the primary
mechanism for continuity.

### 7.6 Idempotency and Recovery Rules

- `concurrency:` groups prevent duplicate dispatch for the same issue.
- `skip-if-match:` prevents re-processing issues already in progress.
- `cache-memory:` persists processed-issue lists across runs.
- On failure, operators can re-trigger via `workflow_dispatch` or `/command`.
- No persistent database required; GitHub Issues state is the source of truth.

**Stale Label Cleanup**

If a workflow run crashes or is force-cancelled, orchestration labels (e.g., `agent:in-progress`) may remain on the issue, causing `skip-if-match:` guards to permanently block re-dispatch. Implementations MUST provide a stale label recovery mechanism. The recommended approach is a scheduled cleanup workflow:

```yaml
on:
  schedule:
    - cron: '0 * * * *'  # hourly
```

The cleanup workflow:
1. Lists all open issues with `agent:in-progress` (or other active-state labels).
2. For each labeled issue, checks whether a corresponding workflow run is still active via the GitHub Actions API.
3. If no active run exists, removes the stale label and optionally adds `agent:queued` for re-dispatch.
4. Emits a warning log entry for operator visibility.

This is the gh-aw equivalent of Symphony's startup terminal workspace cleanup (§8.6 in the original specification).

## 8. Scheduling and Dispatch

### 8.1 Event-Driven Dispatch

For issue-triggered workflows:

```yaml
on:
  issues:
    types: [opened]
  skip-if-match: "is:issue is:open label:agent:in-progress"
permissions:
  issues: read
```

For comment-triggered workflows (slash commands):

```yaml
on:
  slash_command: work-on-issue
  roles: [admin, maintainer, write]
permissions:
  issues: read
  pull-requests: read
```

### 8.2 Scheduled Batch Processing

For periodic issue triage:

```yaml
on:
  schedule: daily on weekdays
  workflow_dispatch:
permissions:
  issues: read
```

Candidate selection and ordering:

When processing multiple issues in a single batch run, the agent SHOULD apply the following
selection and ordering rules (encode these in the markdown body):

1. **Eligibility**: Only process issues that are open, not terminal (no `agent:done`/`agent:blocked`
   labels), not currently in progress (`agent:in-progress`), and not already claimed.
2. **Blocker check**: Skip issues with unresolved blockers (referenced issues that are still open).
   Blockers are identified via task list checkboxes, issue cross-references, or `blocked-by:` labels.
3. **Priority sort**: Process issues in priority order — `priority:critical` → `priority:high` →
   `priority:medium` → `priority:low` → unlabeled. Within the same priority, process oldest first
   (`created_at` ascending). Ties broken by issue number ascending.
4. **Concurrency cap**: Process up to `N` issues per batch run (defined in markdown body, e.g.,
   "up to 10 issues").

Agent instruction pattern for batch processing:

```markdown
# Issue Triage

Search for open issues without the `triaged` label.
For each untriaged issue:
1. Analyze the issue content.
2. Apply appropriate labels.
3. Add a triage comment.

Use the GitHub MCP server to search and read issues.
Post results via safe outputs.
```

### 8.3 Concurrency Control

Global concurrency:

```yaml
engine:
  max-concurrency: 3    # Max 3 concurrent workflow runs
```

Per-issue concurrency:

```yaml
concurrency:
  group: symphony-issue-${{ github.event.issue.number }}
  cancel-in-progress: true
```

Fan-out discriminator:

```yaml
concurrency:
  job-discriminator: ${{ github.event.issue.number }}
```

> **Symphony Mapping:** Symphony's `max_concurrent_agents_by_state` allows per-state concurrency limits (e.g., max 3 agents for "Todo" issues, max 2 for "In Progress"). gh-aw does not natively support per-label concurrency limits. To approximate this, use `steps:` with a GitHub API call to count issues with a specific label before proceeding:
> ```yaml
> steps:
>   - name: Check per-label concurrency
>     uses: actions/github-script@v7
>     with:
>       script: |
>         const issues = await github.rest.issues.listForRepo({
>           owner: context.repo.owner, repo: context.repo.repo,
>           labels: 'agent:in-progress', state: 'open', per_page: 1
>         });
>         if (issues.data.total_count >= 3) {
>           core.setFailed('Per-label concurrency limit reached');
>         }
> ```

### 8.4 Retry and Re-dispatch

gh-aw does not have built-in retry with exponential backoff at the platform level. Instead,
retry logic is implemented via the **agent-driven retry pattern** using `cache-memory` and
`dispatch-workflow`.

Recommended backoff formula:

```
backoff_ms = min(10000 * 2^(attempt - 1), max_retry_backoff_ms)
```

- Default `max_retry_backoff_ms`: 300000 (5 minutes).
- Default `max_attempts`: 3.
- Continuation retry (success with more work): 0ms delay (immediate `dispatch-workflow`).

> **Symphony Difference:** Symphony uses a fixed 1000ms delay before continuation retries. gh-aw uses immediate `dispatch-workflow` triggering. This is intentional: GitHub Actions event queuing provides sufficient natural latency. Be aware of GitHub API rate limits when dispatching rapidly; the `rate-limit:` guard (§5.3) can throttle dispatch frequency if needed.

Manual re-trigger:

- Use `workflow_dispatch` from GitHub Actions UI.
- Use `/command` slash command to re-trigger for a specific issue.

Automated re-trigger:

- Use `dispatch-workflow` safe output to trigger a follow-up run.
- Use `cache-memory` to track retry count and backoff state.

```yaml
safe-outputs:
  dispatch-workflow:
    max: 1
```

Agent-driven retry pattern (in markdown body):

```markdown
Check cache-memory for retry state of this issue.
If previous attempt failed and retry count < 3:
  - Calculate backoff: min(10000 * 2^(attempt-1), 300000) ms.
  - If current time < next_retry_after, skip this run (too early).
  - Increment retry count in cache-memory.
  - Record next_retry_after = now + backoff_ms.
  - Attempt the work again.
  - If successful, clear retry state.
If retry count >= 3:
  - Add a comment explaining the failure history.
  - Apply the `agent:blocked` label.
  - Clear retry state from cache-memory.
```

**Claim Release on Retry Failure**

When the agent-driven retry pattern re-dispatches, the follow-up run MUST verify that the target issue still exists and is in an eligible state. If the issue is closed, deleted, or otherwise ineligible:
1. Remove the `agent:in-progress` label (release the claim).
2. Clear the retry state from `cache-memory:`.
3. Exit the workflow run with a success status (not a failure).

This prevents orphaned `agent:in-progress` labels on issues that became ineligible between retry attempts.

Stall detection:

- gh-aw uses `timeout-minutes` as the stall detection mechanism.
- If the engine produces no output and makes no tool calls within the `timeout-minutes`
  window, GitHub Actions terminates the run with `timed_out`.
- Unlike Symphony's dedicated `stall_timeout_ms` (default 5 minutes) which watches for
  engine activity, gh-aw's `timeout-minutes` covers the entire run duration.
- Set `timeout-minutes` conservatively: long enough for legitimate work but short enough
  to catch stalled sessions (recommended: 15-30 minutes for typical workflows).

> **Granularity Note:** Symphony uses engine-activity-based stall detection (`stall_timeout_ms`, default 5 min) that triggers when the engine produces no events for a period. gh-aw's `timeout-minutes` applies to the entire job duration, not engine activity. This means a long-running but legitimately active agent could be killed by an aggressive timeout. Set `timeout-minutes` generously (e.g., 30–60 min for complex tasks) and consider decomposing large tasks into smaller units via multi-turn continuation (§7.5) rather than relying on a single long-running job.

### 8.5 Eligibility Guards

Skip guards serve as the gh-aw equivalent of Symphony's **pre-dispatch candidate selection** (§8.2 in the original specification). For runtime reconciliation of active runs (Symphony §8.5), see §7.4 Active Run Cancellation on Issue State Change. Each trigger
event evaluates these guards before activation, ensuring the system processes only eligible work.

Processing order guarantee: Guards are evaluated in this order:
1. `if:` — Conditional expression.
2. `roles:` / `skip-roles:` / `skip-bots:` — Actor authorization.
3. `rate-limit:` — Rate limiting.
4. `skip-if-match:` — Deduplication / state check.
5. `skip-if-no-match:` — Precondition check.
6. `skip-if-check-failing:` — CI health check.

If any guard fails, the run is skipped (visible in GitHub Actions history).

Skip-if-match (deduplication):

```yaml
on:
  issues:
    types: [opened]
  skip-if-match: "is:issue is:open label:agent:in-progress"
```

Skip-if-no-match (precondition):

```yaml
on:
  schedule: daily on weekdays
  skip-if-no-match: "is:issue is:open -label:triaged"
```

Skip-if-check-failing (CI health):

```yaml
on:
  pull_request:
    types: [opened, synchronize]
  skip-if-check-failing: true
```

Rate limiting:

```yaml
rate-limit:
  max: 5
  window: 60
  ignored-roles: [admin, maintain]
```

**Runtime Reconciliation**

Skip guards only prevent new dispatches; they do not monitor already-running agents. Runtime reconciliation — detecting that an issue has been closed or deleted while the agent is working — requires one of the following:

1. **Concurrency cancellation**: Include terminal issue events (`issues: [closed, deleted]`) in the workflow triggers with `cancel-in-progress: true` in the concurrency group (see §7.4).
2. **Agent self-check**: Instruct the agent (via prompt) to verify the issue is still open before committing work. This is a best-effort approach.
3. **Timeout expiration**: Rely on `timeout-minutes` as a hard upper bound for orphaned runs.

Implementations SHOULD use mechanism (1) for prompt cancellation. Mechanism (3) alone is acceptable only if the `timeout-minutes` value is short enough to limit wasted compute.

### 8.6 Startup Behavior

Unlike Symphony's startup terminal cleanup, gh-aw workflows are stateless per run:

- Each run starts fresh on the GitHub Actions runner.
- Repository is checked out via `checkout:` configuration.
- Pre-steps (`steps:`) run for environment preparation.
- Agent session starts after checkout and pre-steps complete.
- No workspace persistence across runs (use `cache-memory` or artifacts).

## 9. Execution Environment and Safety

### 9.1 Runner Environment

Default runner: `ubuntu-latest`.

Customizable via:

```yaml
runs-on: ubuntu-latest          # Default
runs-on: macos-latest           # macOS runner
runs-on: [self-hosted, linux]   # Self-hosted runner
```

Repository checkout:

```yaml
# Default: shallow clone
checkout:
  fetch-depth: 1

# Full history
checkout:
  fetch-depth: 0

# Multiple repositories
checkout:
  - path: .
    fetch-depth: 0
  - repository: owner/other-repo
    path: ./libs/other
    ref: main

# Disable checkout
checkout: false
```

### 9.2 Agent Workflow Firewall (AWF) Sandbox

All agent execution runs inside the AWF sandbox:

- Domain-based network egress control.
- `bash` and `edit` tools enabled by default.
- No unnecessary tool restrictions (sandbox provides security).
- Network access controlled by `network:` frontmatter.

### 9.3 Pre-Agent Steps (`steps:`)

Custom steps that run before the agent, outside the sandbox:

```yaml
steps:
  - name: Install dependencies
    run: npm ci
  - name: Build project
    run: npm run build
```

**Security Notice**: Custom steps run OUTSIDE the firewall sandbox. Use only for deterministic
data preparation, not agentic compute. Secrets restriction applies in strict mode.

Failure semantics: Pre-agent step failure is **fatal**. If any step exits non-zero, the workflow
run is aborted and concludes with `failure`. The agent session does not start.

To replicate Symphony's `after_create` hook (executed only on first workspace creation), use event-type conditions or `cache-memory:` for first-run detection:
```yaml
steps:
  - name: First-run setup
    if: github.event.action == 'opened' || github.event.action == 'labeled'
    run: |
      # One-time initialization: branch creation, initial comment, etc.
```
For continuation runs, the `cache-memory:` key presence indicates prior execution.

### 9.4 Post-Agent Steps (`post-steps:`)

Custom steps that run after the agent:

```yaml
post-steps:
  - name: Upload artifacts
    uses: actions/upload-artifact@v4
    with:
      name: results
      path: ./output/
```

Failure semantics: Post-agent step failure is **non-fatal** (logged as warning). The run
conclusion is determined by the agent execution result, not post-step results. Post-steps
always execute regardless of agent success or failure (similar to `hooks.after_run` in Symphony).

### 9.5 Safety Invariants

**Invariant 1**: Agent job permissions must be read-only.

- All write operations go through `safe-outputs:`.
- `safe-outputs` enforce output validation, rate limiting, and audit trails.

**Invariant 2**: Agent runs inside AWF sandbox.

- Network egress controlled by `network:` configuration.
- Tool access controlled by `tools:` configuration.

**Invariant 3**: Secrets are not exposed to the agent.

- Use `secrets:` frontmatter for secret injection.
- Custom `steps:` / `post-steps:` cannot use `${{ secrets.* }}` in strict mode.
- Secrets are masked in logs via `secret-masking:` configuration.

**Invariant 4**: Safe outputs are rate-limited and auditable.

- `max:` limits on all safe output types.
- `expires:` for auto-closing stale outputs.
- Cross-repository operations require explicit `target-repo:` and authentication.

> **Symphony Coverage:** Symphony's workspace safety invariants (cwd == workspace_path verification, path traversal prevention, workspace key sanitization) are implicitly enforced by the AWF sandbox environment. The sandbox restricts filesystem access to the checked-out repository and designated workspace directories. Path traversal beyond the sandbox boundary is blocked at the OS level.

## 10. Agent Integration

### 10.1 Engine Selection

```yaml
# Default (Copilot) — omit engine field
engine: copilot

# Claude
engine: claude

# Codex
engine: codex

# Gemini
engine: gemini
```

### 10.2 Tool Configuration

Minimal recommended configuration:

```yaml
tools:
  github:
    toolsets: [default]
```

Full configuration example:

```yaml
tools:
  github:
    toolsets: [default, discussions, actions]
    lockdown: true
    min-integrity: approved
  web-fetch: true
  web-search: true
  playwright: true
  agentic-workflows: true
  timeout: 120
  startup-timeout: 180
```

> **Symphony Mapping:** Symphony's optional client-side tools (e.g., `linear_graphql`) are replaced by MCP servers in gh-aw. Custom tools can be added via `tools:` with `type: http-sse` or `type: stdio` MCP server configurations. The built-in `github:` MCP server provides GitHub API access equivalent to Symphony's tracker-specific tools.

### 10.3 Agent Instructions (Markdown Body)

The markdown body is the agent's prompt. Write clear, actionable instructions:

```markdown
# Issue Triage Agent

You are an issue triage agent for the repository ${{ github.repository }}.

## Context

Issue #${{ github.event.issue.number }}: "${{ github.event.issue.title }}"

## Instructions

1. Read the issue body and any existing comments.
2. Determine the issue category (bug, feature, question, documentation).
3. Apply appropriate labels via safe output.
4. If the issue is a bug, check for reproducibility information.
5. Post a triage comment summarizing your analysis.

## Output Format

Use safe outputs to:
- Add a comment with your analysis.
- Update the issue labels.
```

### 10.4 Prompt Patterns for Symphony-like Orchestration

Single-issue dispatch (event-driven):

```markdown
# Work on Issue

You are a coding agent working on issue #${{ github.event.issue.number }}.

Read the issue description and implement the requested changes.
Create a pull request with your implementation.
```

Batch processing (scheduled):

```markdown
# Daily Issue Triage

Search for all open issues without the `triaged` label.
For each issue (up to 10):
1. Read the issue content.
2. Classify the issue type.
3. Apply labels.
4. Post a triage comment.

Track processed issues in cache-memory to avoid re-processing.
```

Continuation pattern (multi-run):

```markdown
# Continue Work

Check cache-memory for the current work state.
If previous run was interrupted:
  - Resume from the last checkpoint.
  - Update cache-memory with progress.
If work is complete:
  - Post a completion comment.
  - Apply the `agent:done` label.
```

### 10.5 Timeouts

```yaml
timeout-minutes: 15              # Agent execution timeout
engine:
  max-turns: 10                   # Max chat iterations
tools:
  timeout: 120                    # Per-tool-call timeout (seconds)
  startup-timeout: 180            # MCP server init timeout (seconds)
```

**Stall Detection**

Symphony provides engine-activity-based stall detection (`stall_timeout_ms`) that fires when the engine produces no events for a configurable period (default: 5 min). gh-aw does not have a direct equivalent; `timeout-minutes` applies to the entire job.

If finer-grained stall detection is required:
- Engine platforms may implement their own inactivity timeouts (check engine documentation).
- The GitHub Actions platform enforces a 6-hour maximum job duration as an absolute backstop.
- For most workloads, setting `timeout-minutes` to 30–60 minutes provides sufficient protection against stalled agents.

### 10.6 Agent Behavior Contracts

User input requests:

- If the engine requests interactive user input during an automated workflow run, the run
  MUST fail immediately (hard failure). Automated workflows cannot provide interactive input.
- This is equivalent to Symphony's `requestUserInput` → hard fail policy.
- Engines that support a `--no-interactive` or equivalent flag SHOULD enable it.

Unsupported tool calls:

- If the agent calls a tool that is not configured in `tools:` or `mcp-servers:`, the MCP
  gateway returns an error response to the agent.
- The agent session continues (not terminated) — the agent can adapt and try alternative tools.
- Repeated unsupported tool calls may exhaust `max-turns` and terminate the session normally.

**Session Identification**

gh-aw uses the following identifier hierarchy (replacing Symphony's `session_id = <thread_id>-<turn_id>`):

| Identifier | Scope | Source |
|-----------|-------|--------|
| `run_id` | Single workflow run | `github.run_id` |
| `run_attempt` | Retry within a run | `github.run_attempt` |
| `job_id` | Single job within a run | Job-level context |
| Issue number | Logical work unit (across runs) | `github.event.issue.number` |

For multi-turn continuation, the chain of `run_id` values is tracked via `cache-memory:`, enabling end-to-end traceability across continuation runs. OTLP traces SHOULD use `run_id` as the primary span identifier and issue number as a correlation attribute.

### 10.7 Error Classification

Normalized error categories for agent execution:

| Category | Description | Recovery |
| --- | --- | --- |
| `engine_unavailable` | Engine API unreachable or returned 5xx | Retry with backoff |
| `engine_rate_limited` | Engine API rate limit exceeded | Retry after cooldown |
| `engine_timeout` | No engine response within timeout | Retry or increase timeout |
| `tool_call_failed` | MCP tool call returned error | Agent adapts or run fails |
| `max_turns_exceeded` | `max-turns` limit reached | Increase limit or split work |
| `timeout_exceeded` | `timeout-minutes` limit reached | Increase timeout or split work |
| `checkout_failed` | Repository checkout failed | Check runner/permissions |
| `pre_step_failed` | Pre-agent step exited non-zero | Fix step configuration |
| `safe_output_failed` | Safe output processing error | Check API permissions |
| `user_input_requested` | Engine requested interactive input | Hard failure, reconfigure |

**Completion Condition Classification**

| Condition | Classification | Notes |
|-----------|---------------|-------|
| Agent exits normally, all turns complete | `completed` | Eligible for continuation if requested |
| `max-turns` reached | `completed` | Normal completion; continuation MAY be triggered |
| `timeout-minutes` exceeded | `timed_out` | Eligible for retry |
| Agent engine error | `failure` | Eligible for retry with backoff |
| Workflow cancelled (API or concurrency) | `cancelled` | Not retried |
| Safe-output processing error | `failure` | Agent work may be valid; safe-outputs can be replayed |

### 10.8 Approval and Tool Execution Policy

In gh-aw, the agent operates within the AWF sandbox with the following approval model:

**Automatic Approval (No Human-in-the-Loop)**
- All tool calls executed by the agent within the sandbox are automatically approved. There is no interactive approval prompt.
- MCP server tool calls are executed within the sandbox permissions boundary.
- File system modifications are confined to the sandbox workspace.

**Safe-Outputs as Controlled Mutations**
- Mutations that affect external systems (issue comments, label changes, PR creation) MUST go through `safe-outputs:` declarations.
- Safe-outputs are processed by the post-agent step outside the sandbox, with rate limits and schema validation applied.
- This replaces Symphony's operator-confirmation model with a declarative, auditable write channel.

**Stall Prevention**
- If the agent requests user input (e.g., via a prompt tool), the engine MUST treat this as a hard failure rather than waiting indefinitely.
- `timeout-minutes` provides an absolute upper bound against any form of stall.
- Implementations SHOULD document their tool execution policy, including which MCP servers are available and what permissions they carry.

### 10.9 Runtime Event Contract

Implementations SHOULD emit structured events at key lifecycle points for observability and debugging. These events replace Symphony's §10.4 emitted runtime events.

| Event | Trigger | Required Fields |
|-------|---------|----------------|
| `run_started` | Workflow run begins | `run_id`, `issue_number`, `workflow_file`, `engine`, `timestamp` |
| `agent_started` | Agent engine session begins | `run_id`, `engine`, `model`, `timestamp` |
| `turn_completed` | Agent completes a turn | `run_id`, `turn_number`, `token_usage{input,output,total}`, `timestamp` |
| `turn_failed` | Agent turn fails | `run_id`, `turn_number`, `error_class`, `error_message`, `timestamp` |
| `safe_output_processed` | Safe output applied | `run_id`, `output_type`, `target`, `result{success,skipped,error}`, `timestamp` |
| `run_completed` | Workflow run finishes | `run_id`, `terminal_state`, `total_turns`, `total_tokens`, `duration_seconds`, `timestamp` |

Events are emitted via:
1. **OTLP spans/events** (if configured in `observability:`) — preferred for structured telemetry.
2. **GitHub Actions step outputs** — always available via `::notice::` annotations.
3. **Status comments** (if `safe-outputs:` includes comment outputs) — for human-readable summaries.

> **Important:** Do not make orchestration or retry logic depend on event content. Events are for observability only.

### 10.10 Runner Lifecycle Contract

The gh-aw runner performs the following steps in order, replacing Symphony's Worker Attempt contract (§10.7 in the original specification):

1. **Checkout**: `actions/checkout` clones the repository into the runner workspace.
2. **Pre-agent steps**: Execute `steps:` definitions (dependency installation, secret validation, cache restore). Failure here is fatal — the run is marked as `failure` without invoking the agent.
3. **Agent execution**: The engine runs the agent with the constructed prompt, configured tools, and sandbox restrictions. The agent interacts with tools, writes files, and produces safe-output artifacts.
4. **Safe-output processing**: Post-agent infrastructure processes safe-output artifacts (comments, labels, PRs) with rate limits and validation.
5. **Post-agent steps**: Execute `post-steps:` definitions (cleanup, metrics upload). These run even if the agent failed (equivalent to Symphony's `after_run` with `always` semantics).
6. **Status reporting**: The terminal state is reported via GitHub Actions run status and optional status comments.

> **Key difference from Symphony:** In Symphony, workspaces are preserved after successful runs. In gh-aw, runner filesystems are ephemeral — all persistent state MUST be stored via `cache-memory:`, workflow artifacts, or safe-outputs.

## 11. GitHub Issue Tracker Integration

### 11.1 Reading Issues (via GitHub MCP Server)

The following logical operations are required for gh-aw dispatch and orchestration (mapped from Symphony §11.1):

| Operation | Symphony Equivalent | gh-aw Implementation |
|-----------|-------------------|---------------------|
| Fetch candidate issues | `fetch_candidate_issues()` | GitHub Issues API: `GET /repos/{owner}/{repo}/issues` with label + state filters |
| Fetch issues by state | `fetch_issues_by_states()` | GitHub Issues API: `GET /repos/{owner}/{repo}/issues?labels={label}&state=open` |
| Get issue state by ID | `fetch_issue_states_by_ids()` | GitHub Issues API: `GET /repos/{owner}/{repo}/issues/{number}` |

These operations are performed either via `steps:` (using `actions/github-script`) or by the agent via the `github:` MCP server tool.

```yaml
tools:
  github:
    toolsets: [default]           # Includes issues, repos, pull_requests, context
```

Available toolsets for issue tracking:

- `issues` — Read issues, comments, labels, milestones.
- `pull_requests` — Read PRs, reviews, diffs.
- `repos` — Read repository contents, branches, commits.
- `actions` — Read workflow runs, check statuses.
- `projects` — Read/write GitHub Projects (boards, items, fields).
- `search` — Search issues, PRs, code across repositories.
- `labels` — Manage labels.

### 11.2 Writing to Issues (via Safe Outputs)

> **Design Decision:** In the original Symphony specification (§11.5), the orchestrator has no tracker write API — all writes are performed by the coding agent via runtime tools, and the service acts strictly as a scheduler/runner/reader. In gh-aw, this boundary is redefined: `safe-outputs:` provide a controlled, declarative write channel that is processed *outside* the agent sandbox with rate limits and schema validation. This is not a relaxation of the security boundary but a restructuring: instead of granting the agent direct write permissions, writes are declared as artifacts and processed by trusted post-agent infrastructure. The agent itself remains read-only within the sandbox.

Create issue:

```yaml
safe-outputs:
  create-issue:
    title-prefix: "[symphony] "
    labels: [automation, agent-created]
    assignees: [copilot]
    max: 5
    expires: 7
    group: true
```

Close issue:

```yaml
safe-outputs:
  close-issue:
    target: "triggering"
    max: 1
```

Add comment:

```yaml
safe-outputs:
  add-comment:
    max: 5
    target: "*"
    hide-older-comments: true
```

Update issue (labels, assignees, milestone):

```yaml
safe-outputs:
  update-issue:
    max: 5
```

### 11.3 Normalization Rules

When processing GitHub Issue data, the following normalization rules apply (mapped from Symphony §11.3):

- **Labels**: Compared case-insensitively. `skip-if-match:` and orchestration label checks MUST use case-insensitive matching.
- **Priority**: Derived from labels (e.g., `priority:critical`, `priority:high`). If no priority label exists, the issue is treated as lowest priority.
- **Blocked-by**: Derived from issue body patterns (`blocked by #N`, `depends on #N`) or GitHub sub-issue relationships. Blocker resolution is determined by checking the referenced issue's `state == closed`.
- **Timestamps**: All timestamps use ISO 8601 format as returned by the GitHub API. No additional normalization is needed.
- **Issue identifiers**: The canonical identifier is `owner/repo#number`. For cross-repository references, the full identifier MUST be used.

### 11.4 Cross-Repository Operations

```yaml
safe-outputs:
  github-token: ${{ secrets.CROSS_REPO_PAT }}
  create-issue:
    max: 10
    target-repo: "org/central-tracker"
    allowed-repos: [org/repo-a, org/repo-b]
```

### 11.5 GitHub Projects Integration

For board-level tracking with GitHub Projects:

```yaml
tools:
  github:
    toolsets: [default, projects]
```

Agent instruction for Projects:

```markdown
After creating the issue, add it to the GitHub Project board.
Update the project item status to "In Progress".
Set the priority field based on issue labels.
```

CLI shortcut for project setup:

```bash
gh aw project new "Symphony Board" --owner org --with-project-setup
```

### 11.6 Error Handling

GitHub API errors are handled by the GitHub MCP server:

- Rate limiting: MCP server handles retry with backoff automatically.
- Not found (404): Agent receives error response and can adapt behavior.
- Permission denied (403): Safe-outputs handle write permissions; read permission errors
  indicate misconfigured `permissions:` frontmatter.
- Validation errors (422): Invalid API parameters; agent should fix and retry.
- Server errors (5xx): Transient; MCP server retries automatically.
- Network errors: AWF blocks unauthorized domains; connectivity issues are infrastructure failures.

Error behavior by context:

- **Issue fetch failure during event-driven run**: The event payload contains issue data;
  additional MCP lookups may fail but the run continues with available context.
- **Issue fetch failure during scheduled batch**: Agent should log the error, skip the
  problematic issue, and continue processing remaining candidates.
- **Safe output write failure**: Partial outputs may have been processed. Failed outputs
  are logged in the run. Use `gh aw safe_outputs --run-url <url>` to replay.

Workflow-level error handling:

- Failed runs visible in GitHub Actions UI.
- Status comments report failure when enabled.
- OTLP telemetry captures error spans with error category attributes.

**Orchestrator Behavior on Tracker Failures**

| Failure Context | Behavior | Rationale |
|----------------|----------|-----------|
| Candidate fetch fails (scheduled dispatch) | Skip this run; next schedule trigger retries | Transient failure should not block future dispatches |
| Candidate fetch fails (event-driven dispatch) | Use event payload data to proceed if possible; otherwise mark run as `failure` | Event payload contains enough data for single-issue dispatch |
| Issue state check fails (during agent execution) | Agent continues with last known state | Optimistic execution; state will be reconciled on next event |
| Safe-output write fails | Retry up to 3 times with backoff; log warning if all retries fail | Safe-outputs are important but should not fail the agent's work |
| MCP server tool call fails | Agent receives error and decides next action | Agent autonomy; tool failures are input to agent reasoning |

## 12. Prompt Construction and Context Assembly

### 12.1 Inputs

Inputs to the agent prompt:

- Workflow markdown body (agent instructions).
- GitHub Actions context expressions (`${{ ... }}`).
- Trigger event payload (`${{ github.event.* }}`).
- Repository context (`${{ github.repository }}`, `${{ github.ref }}`).
- Custom environment variables (`env:`).
- Secrets (`secrets:`).
- Steps outputs (`${{ steps.*.outputs.* }}`).

### 12.2 Rendering Rules

- GitHub Actions expressions are resolved at runtime.
- Expressions use `${{ }}` syntax (not Liquid templates).
- Context objects are available: `github`, `env`, `secrets`, `steps`, `inputs`.
- Unknown expressions evaluate to empty string (GitHub Actions default behavior).
- **Strict variable checking policy**: Unlike Symphony's strict template engine (which errors
  on unknown variables), gh-aw expressions silently resolve unknowns to empty string. To
  mitigate typo risk, workflow authors SHOULD:
  - Use `gh aw compile --strict` which validates known expression patterns.
  - Add `steps:` that validate critical expressions are non-empty before agent execution.
  - Prefer well-known context paths (`github.event.*`, `secrets.*`) over dynamic paths.

> **Symphony Mapping:** Symphony requires strict filter checking (unknown filters cause immediate failure). GitHub Actions expressions do not have a filter concept; `gh aw compile --strict` validates expression syntax at compile time. Unknown expressions evaluate to empty string at runtime unless caught by strict compilation.

Nested data structures (labels, assignees, blockers) are preserved natively in GitHub Actions event payloads (e.g., `github.event.issue.labels` is an array of label objects). Templates can iterate over these structures using standard GitHub Actions expression syntax.

### 12.3 Retry and Continuation Semantics

When a workflow run is a retry or continuation (triggered by `dispatch-workflow` safe output),
the prompt SHOULD distinguish between first run and subsequent attempts:

- **First run**: No retry state in `cache-memory`. Full instructions apply.
- **Continuation run**: Work state exists in `cache-memory`. Agent resumes from checkpoint.
  Instructions should include a "continuation protocol" section (see §7.5).
- **Retry run**: Error state exists in `cache-memory` with `attempt > 1`. Agent should
  acknowledge the previous failure and attempt an alternative approach.

The `dispatch-workflow` event payload can carry metadata (via `inputs:`) to communicate
retry context:

```yaml
# In the dispatch-workflow safe output
dispatch-workflow:
  max: 1
  # The agent can include retry metadata when dispatching
```

Prompt pattern for retry awareness:

```markdown
## Retry Awareness

Check cache-memory for retry state of issue #${{ github.event.issue.number }}.
- If attempt == 1: This is the first try. Follow standard instructions.
- If attempt > 1: Previous attempt failed with error: [read from cache-memory].
  Try an alternative approach. Do not repeat the same failing strategy.
- If attempt > max_attempts: Mark as blocked and explain the failure history.
```

### 12.4 Sanitized Input

For slash commands and user-provided text:

- Use `${{ steps.sanitized.outputs.text }}` for sanitized trigger text.
- Never use raw `${{ github.event.comment.body }}` in prompts (injection risk).

### 12.5 Failure Semantics

If the agent fails:

- Workflow run concludes with `failure`.
- Status comment posted if enabled.
- Safe outputs from the failed run may or may not be processed (depends on failure point).
- Operator can re-trigger via `workflow_dispatch` or `/command`.

**Prompt Construction Failures**

If prompt rendering fails (expression resolution error, YAML parsing failure, or missing required context), the workflow MUST fail immediately without invoking the agent engine. This is treated as a `failure` terminal state, and the orchestrator's retry logic (§8.4) determines whether to re-attempt.

Specifically:
- Expression evaluation errors in `strict: true` mode → immediate failure.
- Missing required issue context (e.g., issue not found) → immediate failure.
- Template syntax errors → caught at `gh aw compile` time (should not occur at runtime).

## 13. Logging, Status, and Observability

### 13.1 GitHub Actions Logs

All workflow runs produce structured logs in the GitHub Actions UI:

- Per-step output with timestamps.
- Searchable and downloadable.
- Retained per repository retention policy.

Required context fields in agent logs:

- `issue_number` — The issue being processed (when applicable).
- `run_id` — GitHub Actions run identifier.
- `workflow_id` — Workflow identifier.
- `engine_id` — Engine used for this session.
- `attempt` — Retry attempt number (from `cache-memory` state, if applicable).

Log format conventions:

- Use `key=value` pairs for structured fields where possible.
- Include action results (success/failure) and failure reasons.
- Avoid logging large payloads (issue bodies, full diffs) — reference by URL instead.
- Secrets are automatically masked by GitHub Actions secret masking.

Agent-specific logs:

- Engine output (agent reasoning, tool calls, responses).
- Safe output processing results.
- Error traces and stack traces.

### 13.2 Status Comments

Enable status comments for visibility:

```yaml
on:
  issues:
    types: [opened]
  status-comment: true
```

Posts a comment when:

- Workflow starts (with run link).
- Workflow completes (with result summary).

Default behavior:

- `slash_command` and `label_command`: status comments enabled by default.
- Other triggers: must be explicitly enabled with `status-comment: true`.

### 13.3 OTLP Telemetry

For distributed tracing and monitoring:

```yaml
observability:
  otlp:
    endpoint: ${{ secrets.OTEL_ENDPOINT }}
    headers: ${{ secrets.OTEL_HEADERS }}
```

Emitted spans:

- Setup and conclusion spans with rich attributes.
- Engine-specific attributes (`gh-aw.engine.id`, token usage).
- All jobs in a run share one trace ID.
- Dispatched child workflows inherit parent trace context.

OTLP telemetry is best-effort: if the configured OTLP endpoint is unreachable or returns errors, the workflow run MUST continue without interruption. Telemetry failures SHOULD be logged as warnings in the GitHub Actions log but MUST NOT cause the agent execution to fail.

### 13.4 Token Accounting

Token usage tracking for cost management and capacity planning:

Accounting rules:

- Use **absolute totals** from the engine's final usage report per run.
- If the engine provides per-turn deltas, accumulate them but prefer the final cumulative total
  when available (avoids double-counting).
- Do not double-count tokens across continuation runs — each run's tokens are independent.
- For batch runs processing multiple issues, attribute tokens to the entire run (not per-issue).

Reporting:

- OTLP spans include `gh-aw.engine.input_tokens`, `gh-aw.engine.output_tokens`,
  `gh-aw.engine.total_tokens` attributes when available.
- `gh aw audit <run-id>` extracts token metrics from run logs.
- For aggregate reporting, use OTLP backend queries or GitHub Actions API to sum across runs.

Rate limit tracking:

- Engine rate limits are handled by the engine API client (transparent to the workflow).
- GitHub API rate limits are handled by the GitHub MCP server.
- If rate limits cause persistent failures, the agent-driven retry pattern (§8.4) applies.

**Token Counting Pitfalls**

When aggregating token usage across engine events:
- Prefer absolute totals over delta-style payloads (e.g., ignore `last_token_usage` fields for dashboard totals).
- Extract `input`/`output`/`total` token counts leniently from common field names across engine APIs.
- Do not treat generic `usage` maps as cumulative totals unless the engine's event schema explicitly defines them as such.
- Different engines (Copilot, Claude, Codex, Gemini) report token usage in varying formats; implementations MUST normalize to a consistent `{input_tokens, output_tokens, total_tokens}` schema.

**Runtime Accounting**

In addition to token accounting, implementations SHOULD track runtime duration:
- **Per-run duration**: Computed from `run.started_at` to `run.completed_at` (available via GitHub Actions API).
- **Per-issue cumulative duration**: Sum of all run durations associated with an issue (tracked via `cache-memory:` or aggregated from OTLP spans).
- **Continuation chain duration**: Total time across all multi-turn continuation runs for a single issue.

`gh aw audit --run-url <url>` SHOULD include run duration in its output. Live aggregation during an active run is computed from `run.started_at` + current elapsed time without requiring background polling.

### 13.5 Report Workflows

For periodic status reporting, use `create-discussion:` safe output:

```yaml
safe-outputs:
  create-discussion:
    title-prefix: "[weekly-report] "
    category: "Status Reports"
    max: 1
    close-older-discussions: true
    expires: 30
```

### 13.6 gh-aw CLI Inspection

```bash
# View workflow status
gh aw status

# Inspect configured MCP servers
gh aw mcp inspect

# Download and analyze run logs
gh aw logs <workflow-name>

# Audit a specific run
gh aw audit <run-id>
```

`gh aw status` SHOULD return the following data items (mapped from Symphony §13.3 Runtime Snapshot):
- **Running**: List of active workflow runs with issue number, run_id, engine, elapsed time, and turn count.
- **Queued**: Issues with `agent:queued` label awaiting dispatch.
- **Engine totals**: Aggregate token usage across active and completed runs.
- **Rate limits**: Current API rate limit status (GitHub API, engine API if available).
- **Errors**: Recent error counts by class (last 1 hour).

### 13.7 Workflow Introspection (via agentic-workflows tool)

Enable agent self-introspection:

```yaml
tools:
  agentic-workflows: true
```

Available tools:

- `status` — Show status of workflow files.
- `compile` — Compile workflows.
- `logs` — Download and analyze run logs.
- `audit` — Investigate run failures.
- `checks` — Classify CI check state.

**Important**: Introspection data is for observability purposes only. Orchestration logic
MUST NOT depend on introspection tool output for dispatch or scheduling decisions. This
matches Symphony's principle that humanized event summaries must not influence orchestrator
logic.

Agent engine internal events (tool invocations, reasoning steps, file edits) MAY be summarized in human-readable form for status comments or log annotations. Such summaries are strictly for observability and MUST NOT influence workflow control logic or retry decisions (consistent with Symphony §13.6).

> **Scope Note:** The original Symphony specification (§13.7) defines an optional HTTP Server Extension with dashboard UI, REST API endpoints (`/api/v1/state`, `/api/v1/<issue>`, `POST /api/v1/refresh`), and JSON response schemas. This extension is **not included** in the gh-aw specification because its functionality is covered by:
> - **GitHub Actions UI**: Provides workflow run list, status, and log viewing.
> - **GitHub Actions API**: `GET /repos/{owner}/{repo}/actions/runs` provides programmatic access to run state.
> - **`gh aw status`** (§13.6): CLI-based status inspection.
> - **OTLP telemetry** (§13.3): Structured metrics and traces for external dashboards (Grafana, Datadog, etc.).
>
> Implementations that require a custom dashboard SHOULD build it as a consumer of GitHub Actions API and OTLP data rather than embedding an HTTP server in the workflow.

## 14. Failure Model and Recovery Strategy

### 14.1 Failure Classes

1. `Compilation Failures`
   - Invalid frontmatter.
   - Missing required fields.
   - Security violations (write permissions on agent job).
   - Network/tool configuration errors.

2. `Activation Failures`
   - Skip guard evaluation errors.
   - Role/permission authorization failures.
   - Rate limit exceeded.

3. `Agent Execution Failures`
   - Engine API errors (unavailable, rate-limited, timeout).
   - Tool call failures (MCP server errors, unsupported tools).
   - Timeout exceeded (`timeout-minutes`).
   - Max turns exceeded (`max-turns`).
   - User input requested (hard failure — see §10.6).
   - Stalled session (no engine activity within timeout window).

4. `Safe Output Failures`
   - GitHub API errors during write operations.
   - Rate limit on safe outputs.
   - Cross-repository authentication failures.
   - Output validation failures (title prefix, label requirements).

5. `Infrastructure Failures`
   - Runner unavailable.
   - Checkout failure (repository access, disk space).
   - Network connectivity issues.
   - GitHub Actions platform outage.

6. `Observability Failures`
   - OTLP endpoint unreachable.
   - Status comment posting failure.
   - These are **non-fatal** — observability failures MUST NOT crash or abort the
     agent execution or safe output processing.

### 14.2 Recovery Behavior

Core principle: **Observability and output failures MUST NOT prevent core agent execution
from completing.** If status comments fail to post or OTLP export fails, the agent run
continues normally.

- Compilation failures:
  - Block deployment of new `.lock.yml`.
  - Last valid `.lock.yml` remains in effect.
  - Active runs using the previous `.lock.yml` continue unaffected.

- Activation failures:
  - Workflow run skipped or cancelled.
  - Visible in GitHub Actions run history.

- Agent execution failures:
  - Run concludes with `failure`.
  - Status comment posted if enabled (best-effort).
  - Retry state updated in `cache-memory` (attempt count, error, backoff).
  - Operator can re-trigger via `workflow_dispatch`.
  - Agent-driven retry: `dispatch-workflow` triggers follow-up with exponential backoff
    (see §8.4 for formula).

- Safe output failures:
  - Partial outputs may have been processed.
  - Failed outputs logged in run.
  - Can replay safe outputs: `gh aw safe_outputs --run-url <url>`.

- Infrastructure failures:
  - GitHub Actions retry mechanisms apply.
  - Re-trigger via `workflow_dispatch`.

- Observability failures:
  - OTLP export failure: silently dropped, agent run continues.
  - Status comment failure: logged as warning, agent run continues.

### 14.3 State Recovery

gh-aw workflows are inherently stateless per run. Recovery is driven by:

- GitHub Issues state (source of truth for work items).
- `cache-memory` state (processed items, retry counts, work checkpoints).
- GitHub Actions run history (audit trail).

No persistent orchestrator database is required.

`cache-memory` recovery: If `cache-memory` state becomes corrupted or inconsistent, the
recommended recovery is to clear the affected keys and allow the workflow to re-process
from scratch. Workflows SHOULD be designed to be idempotent — re-processing an already-
completed issue should detect the completed state (via labels/comments) and skip.

### 14.4 Operator Intervention Points

Operators can control behavior by:

- Editing the workflow `.md` file (markdown body changes take effect immediately).
- Editing frontmatter and running `gh aw compile` for configuration changes.
- Changing issue labels/state in GitHub to influence skip guards.
- Re-triggering runs via `workflow_dispatch` from GitHub Actions UI.
- Using `slash_command` or `label_command` for manual dispatch.
- Disabling workflows via `gh aw disable`.

Issue state change impact on running workflows:

- **Issue closed while run is in progress**: The current run continues to completion (gh-aw
  does not cancel mid-run). Skip guards on subsequent triggers will prevent new runs. If
  `concurrency: cancel-in-progress: true` is set and a new event arrives, the current run
  is cancelled.
- **Terminal label applied**: Same behavior as issue closure — current run continues, future
  runs are blocked by skip guards.
- **Issue reopened**: New triggers may start fresh runs. Previous retry state in `cache-memory`
  should be cleared if the issue context has changed.

> **Symphony Difference:** When an issue transitions to a terminal state during an active run, Symphony immediately cancels the running session and cleans up the workspace. In gh-aw, the current run continues to completion unless cancelled by a concurrency group (see §7.4 Active Run Cancellation). This is an intentional architectural difference: ephemeral runners make workspace cleanup unnecessary, and concurrency-based cancellation provides the equivalent functionality when configured.

## 15. Security and Operational Safety

### 15.1 Security Posture

gh-aw enforces a **read-only agent job** security model:

**⚠️ External Content Risk Warning**

Issue bodies, PR comments, commit messages, and repository file contents contain externally-controlled content. A permissive agent configuration can lead to:
- **Data exfiltration**: The agent may be prompted to read secrets or sensitive files and include them in outputs.
- **Destructive mutations**: Without proper safe-output restrictions, the agent could modify or delete critical resources.
- **Prompt injection**: Malicious content in issues or PRs can manipulate agent behavior.

Mitigations are distributed across this chapter: AWF sandbox (§15.2), input sanitization (§15.4), safe-output controls (§15.5), and guard policies (§15.6). Operators MUST review all four controls holistically when configuring a workflow.

- Agent job permissions are read-only for all scopes.
- All write operations go through safe-outputs.
- Safe-outputs enforce rate limiting, output validation, and audit trails.
- AWF sandbox controls network egress.

Trust boundary documentation obligation:

- Each deployment MUST document its trust boundaries explicitly, including:
  - Which roles can trigger which workflows.
  - What safe-outputs are available and their rate limits.
  - What network domains are accessible.
  - What content integrity guards (`min-integrity:`, `lockdown:`) are applied.
- The specification does not prescribe a single security posture. Implementations choose
  the combination of controls appropriate for their risk profile.
- Implementations SHOULD maintain a security review document that evaluates the specific
  risks of their workflow configuration (e.g., "this workflow processes untrusted issue
  input and uses `min-integrity: approved` to mitigate injection").

### 15.2 Agent Workflow Firewall (AWF)

- Domain-based network access control.
- `network:` frontmatter defines allowed/blocked domains.
- Ecosystem identifiers (`node`, `python`, etc.) expand to curated domain lists.
- `firewall: true` enables AWF for Copilot engine.

Filesystem safety (provided by runner sandbox):

- Agent execution is confined to the runner workspace directory.
- Each run gets a fresh filesystem (no cross-run workspace contamination).
- The runner sandbox provides path containment equivalent to Symphony's workspace root
  invariant — the agent cannot access files outside the checkout directory.
- AWF sandbox further restricts tool access to configured tools only.

**Self-Hosted Runner Hardening**

When using self-hosted runners (as opposed to GitHub-hosted runners), the following additional hardening is recommended (mapped from Symphony §15.2):
- Use a dedicated OS user for agent workflow execution.
- Restrict workspace root directory permissions.
- Use ephemeral (auto-scaling) runner instances to avoid state accumulation across runs.
- Use a dedicated volume or tmpfs for the workspace to limit blast radius.
- Monitor runner health (CPU, memory, disk) and implement automatic recycling for degraded runners.

### 15.3 Secret Handling

- Use `secrets:` frontmatter for secret injection.
- `${{ secrets.* }}` expressions resolved at runtime by GitHub Actions.
- Custom steps cannot use secrets in strict mode.
- `secret-masking:` for additional redaction patterns.
- Never commit plaintext secrets in workflow files.

### 15.4 Input Sanitization

- Use `${{ steps.sanitized.outputs.text }}` for user-provided input.
- Never use raw `${{ github.event.comment.body }}` in prompts.
- `min-integrity:` guards control content trust levels.
- `blocked-users:` for unconditional content blocking.
- `trusted-users:` for elevated trust without collaborator status.
- `lockdown:` limits content to push-access authors.

### 15.5 Safe Output Safety

- `max:` limits prevent runaway output creation.
- `expires:` auto-closes stale outputs.
- `close-older-issues:` / `close-older-discussions:` prevent accumulation.
- `required-labels:` / `required-title-prefix:` for targeted operations.
- `target-repo:` requires explicit authentication for cross-repository writes.
- `footer:` preserves XML markers for output tracking.

### 15.6 Guard Policies

MCP Gateway guard policies for fine-grained access control:

```yaml
tools:
  github:
    toolsets: [default]
    min-integrity: approved       # Only trusted content
    blocked-users: [malicious-user]
    trusted-users: [contractor-1]
    approval-labels: [verified]
    lockdown: true
```

### 15.7 Step Execution Safety

`steps:` and `post-steps:` run **outside** the AWF sandbox with full runner permissions. Authors MUST treat step definitions as trusted configuration (equivalent to Symphony's hook scripts):

- **Trust boundary**: Steps have access to secrets, network, and the full runner filesystem. Only repository administrators should be able to modify workflow files containing step definitions.
- **Timeout enforcement**: Individual steps SHOULD specify `timeout-minutes` to prevent hanging processes (recommended default: 5 minutes).
- **Output limits**: Step stdout/stderr is captured in GitHub Actions logs. Excessively verbose steps should pipe output to truncation (`head -c 1M`) to avoid log storage issues.
- **Failure isolation**: A `steps:` failure is fatal (prevents agent execution). A `post-steps:` failure is non-fatal (logged as warning). Neither should leave the runner in an inconsistent state.

## 16. Reference Workflow Examples

> **Note:** The original Symphony specification (Chapter 16) provides six reference algorithms for orchestrator internals (Service Startup, Poll-and-Dispatch Tick, Reconcile Active Runs, Dispatch One Issue, Worker Attempt, Worker Exit and Retry Handling). In gh-aw, these responsibilities are distributed across the platform and workflow configuration:
> - **Service Startup** → GitHub Actions runner provisioning (platform-managed)
> - **Poll-and-Dispatch Tick** → Event triggers (§5.3) and scheduled dispatch (§8.2)
> - **Reconcile Active Runs** → Skip guards (§8.5) and active run cancellation (§7.4)
> - **Dispatch One Issue** → Workflow trigger + eligibility guards (§8.5)
> - **Worker Attempt** → Runner lifecycle contract (§10.10)
> - **Worker Exit and Retry** → Agent-driven retry pattern (§8.4) and terminal state policies (§7.3)
>
> This chapter provides workflow configuration examples for common use cases instead.

### 16.1 Issue Triage (Event-Driven)

```yaml
---
on:
  issues:
    types: [opened]
  skip-if-match: "is:issue is:open label:triaged"
  roles: all
permissions:
  issues: read
tools:
  github:
    toolsets: [default]
safe-outputs:
  add-comment:
    max: 1
  update-issue:
    max: 1
---

# Issue Triage Agent

You are an issue triage agent for ${{ github.repository }}.

## Context

A new issue was opened: #${{ github.event.issue.number }}
Title: "${{ github.event.issue.title }}"

## Instructions

1. Read the issue body and analyze its content.
2. Classify the issue as: bug, feature, question, or documentation.
3. Apply the appropriate label via update-issue safe output.
4. Post a triage comment summarizing your classification and any next steps.
5. If the issue is a bug, check if reproduction steps are provided.
```

### 16.2 Scheduled Batch Processing

```yaml
---
on:
  schedule: daily on weekdays
  workflow_dispatch:
  skip-if-no-match: "is:issue is:open -label:triaged"
permissions:
  issues: read
tools:
  github:
    toolsets: [default]
safe-outputs:
  add-comment:
    max: 10
  update-issue:
    max: 10
  create-discussion:
    title-prefix: "[daily-triage] "
    category: "Status Reports"
    max: 1
    close-older-discussions: true
timeout-minutes: 30
---

# Daily Issue Triage

Process all untriaged open issues in ${{ github.repository }}.

## Instructions

1. Search for open issues without the `triaged` label.
2. For each issue (up to 10):
   - Read the issue content.
   - Classify and apply labels.
   - Post a triage comment.
   - Apply the `triaged` label.
3. After processing all issues, create a summary discussion with:
   - Number of issues processed.
   - Classification breakdown.
   - Issues that need human attention.

Track processed issues in cache-memory to avoid re-processing.
```

### 16.3 Slash Command Dispatch

```yaml
---
on:
  slash_command: work-on-this
  roles: [admin, maintainer, write]
permissions:
  issues: read
  contents: read
  pull-requests: read
tools:
  github:
    toolsets: [default]
network: node
safe-outputs:
  add-comment:
    max: 3
  create-pull-request:
    max: 1
    base: main
timeout-minutes: 30
---

# Work on Issue

A team member has requested work on this issue by typing `/work-on-this`.

## Context

Issue #${{ github.event.issue.number }}: "${{ github.event.issue.title }}"
Additional context: "${{ steps.sanitized.outputs.text }}"

## Instructions

1. Read the issue description carefully.
2. Analyze the codebase to understand the relevant code.
3. Implement the requested changes.
4. Create a pull request with your implementation.
5. Post a comment linking to the PR.
```

### 16.4 Label Command Dispatch

```yaml
---
on:
  label_command: agent-review
  roles: [admin, maintainer, write]
permissions:
  pull-requests: read
  contents: read
tools:
  github:
    toolsets: [default]
safe-outputs:
  add-comment:
    max: 1
  create-pull-request-review-comment:
    max: 20
timeout-minutes: 15
---

# Code Review Agent

The `agent-review` label was applied to this pull request.

## Instructions

1. Read the PR diff.
2. Analyze the code changes for:
   - Correctness and potential bugs.
   - Performance concerns.
   - Security issues.
   - Code style and conventions.
3. Post review comments on specific lines where issues are found.
4. Post a summary comment with your overall assessment.
```

## 17. Test and Validation Matrix

### 17.0 Test Profile System

Tests are organized into three tiers, mirroring Symphony's test profiles:

| Profile | Description | CI Gate | Dependencies |
|---------|-------------|---------|--------------|
| **Core** | Compilation, frontmatter validation, skip guards, safe output schema | Required | None (local CLI only) |
| **Extension** | Agent execution, cache-memory, OTLP, multi-turn flows | Required | Engine API key, GitHub API |
| **Real Integration** | End-to-end workflow run on real GitHub Actions | Manual/Nightly | Full GitHub environment |

- Core profile tests MUST pass before merge.
- Extension profile tests SHOULD pass in CI with appropriate secrets.
- Real Integration profile is smoke-test level — run against a dedicated test repository
  with real credentials and a live engine.

### 17.1 Compilation Validation (Core)

- Workflow file compiles without errors: `gh aw compile`.
- Strict mode passes: `gh aw compile --strict`.
- ActionLint passes: `gh aw compile --actionlint`.
- Zizmor security scan passes: `gh aw compile --zizmor`.
- Poutine supply chain scan passes: `gh aw compile --poutine`.
- JSON validation output: `gh aw compile --json --no-emit`.
- Invalid frontmatter compilation preserves the last valid `.lock.yml` and emits an operator-visible error.

### 17.2 Frontmatter Validation (Core)

- `on:` triggers are valid and supported.
- `permissions:` are read-only (no write except `id-token`).
- `safe-outputs:` are properly configured with `max:` limits.
- `network:` ecosystems are correctly detected from repository files.
- `tools:` configuration is valid.
- `engine:` is a supported engine identifier.
- `secrets:` use proper `${{ secrets.* }}` expressions.

### 17.3 Skip Guard Validation (Core)

- `skip-if-match:` correctly skips when search matches.
- `skip-if-no-match:` correctly skips when search returns empty.
- `skip-if-check-failing:` correctly skips when CI is red.
- `roles:` / `skip-roles:` correctly filter by repository role.
- `skip-bots:` correctly filters bot actors.
- `rate-limit:` correctly limits per-user trigger rate.
- Batch (scheduled) dispatch respects priority sort order: `priority:critical` > `priority:high` > `priority:medium` > `priority:low` > unlabeled, then by `created_at` ascending.
- Issues with unresolved blockers (open `blocked by #N` references) are excluded from dispatch candidates.

### 17.4 Safe Output Validation (Core / Extension)

- `create-issue:` creates issues with correct title, body, labels.
- `close-issue:` closes issues with comment.
- `add-comment:` posts comments on correct targets.
- `create-discussion:` creates discussions in correct category.
- `create-pull-request:` creates PRs with correct base/head.
- `update-issue:` updates labels, assignees, milestone.
- `dispatch-workflow:` triggers target workflow.
- `max:` limits are enforced.
- `expires:` auto-close works correctly.
- `hide-older-comments:` minimizes previous comments.
- `close-older-discussions:` closes outdated discussions.
- Cross-repository operations work with `target-repo:` and authentication.

### 17.5 Agent Execution Validation (Extension)

- Agent receives correct context from GitHub Actions expressions.
- Agent can read issues/PRs via GitHub MCP server.
- Agent can use `bash` and `edit` tools within sandbox.
- Agent respects `timeout-minutes:` limit.
- Agent respects `max-turns:` limit.
- `cache-memory:` persists state across runs.
- Network access is correctly restricted by `network:` configuration.
- `cache-memory:` retry state correctly tracks attempt count, last error class, and next retry timestamp.
- Backoff calculation matches formula: `min(10000 × 2^(attempt-1), max-retry-backoff-ms)` with default cap of 300000ms.
- `dispatch-workflow` safe output triggers a follow-up workflow run on agent failure.
- Maximum retry count (default: 3) is respected; exceeding it applies `agent:blocked` label.
- Retry state is cleared when the agent completes successfully.

### 17.6 Observability Validation (Extension)

- GitHub Actions logs capture agent output.
- Status comments are posted when enabled.
- OTLP spans are exported when configured.
- Failed runs show clear error messages.
- `gh aw logs` and `gh aw audit` produce useful output.

### 17.7 Security Validation (Core / Extension)

- Agent job has no write permissions. (Core)
- Safe-outputs handle all write operations. (Core)
- AWF sandbox restricts network egress. (Extension)
- Secrets are not exposed in agent output. (Extension)
- `min-integrity:` guards filter untrusted content. (Extension)
- `lockdown:` restricts to push-access authors. (Extension)
- Custom steps cannot access secrets in strict mode. (Core)

### 17.8 Runner and Workspace Safety (Extension)

- Runner workspace is isolated per run (no cross-run file leakage).
- Agent file access is confined to checkout directory.
- Concurrent runs on the same runner do not interfere.
- `cache-memory` keys are scoped correctly (no cross-workflow contamination).
- Cleanup: workspace directory is removed after run completion.

### 17.9 Real Integration Profile

Smoke tests run against a dedicated test repository with real credentials:

- Full workflow lifecycle: issue created → agent triggered → work performed → PR opened.
- Multi-turn continuation: run dispatches follow-up, follow-up completes.
- Error recovery: intentionally failing step → retry dispatched → eventual success.
- Safe output end-to-end: comment posted, issue created, PR opened, labels applied.
- Token accounting: audit output shows expected token metrics.

A skipped real-integration test MUST be reported as skipped (not silently treated as passed) when credentials or environment prerequisites are unavailable.

## 18. Implementation Checklist (Definition of Done)

### 18.1 Required for Conformance

- Workflow `.md` file created in `.github/workflows/`.
- Frontmatter includes valid `on:`, `permissions:`, `tools:`, `safe-outputs:`.
- Permissions are read-only (write operations via safe-outputs only).
- `gh aw compile` succeeds without errors.
- `gh aw compile --strict` passes.
- Markdown body contains clear, actionable agent instructions.
- Skip guards configured for deduplication (`skip-if-match`).
- Concurrency control configured.
- Network access minimally scoped.
- Safe outputs include `max:` limits.
- Workflow runs successfully on GitHub Actions.
- GitHub Actions logs capture agent execution output with run context (run_id, issue number, workflow file).
- Agent execution failures produce clear error status in GitHub Actions run history and do not leave orphaned resources (stale labels, unclosed PRs).

### 18.2 Recommended Extensions

- OTLP observability configured for production monitoring.
- Status comments enabled for user-facing workflows.
- `cache-memory` for cross-run state persistence.
- `expires:` on safe outputs for automatic cleanup.
- `close-older-discussions:` / `close-older-issues:` for report workflows.
- `tracker-id:` for asset tracking and search.
- `rate-limit:` for user-facing command workflows.
- `secret-masking:` for additional secret redaction.
- Shared workflow components extracted to `.github/workflows/shared/`.

### 18.3 Operational Validation Before Production

- Run `gh aw compile --strict --actionlint --zizmor --poutine`.
- Trigger workflow manually via `workflow_dispatch` and verify execution.
- Verify skip guards prevent duplicate processing.
- Verify safe outputs create expected artifacts (issues, comments, PRs).
- Verify OTLP telemetry reaches the configured backend.
- Verify `cache-memory` state persists across runs.
- Review GitHub Actions run logs for completeness.
- Test failure scenarios (timeout, API errors, missing permissions).

## Appendix A. Migration Guide from Symphony to gh-aw

### A.1 Workflow File Migration

Symphony `WORKFLOW.md`:

```yaml
---
tracker:
  kind: linear
  api_key: $LINEAR_API_KEY
  project_slug: my-project
  active_states: [Todo, In Progress]
  terminal_states: [Done, Cancelled]
polling:
  interval_ms: 30000
workspace:
  root: ~/workspaces
agent:
  max_concurrent_agents: 5
codex:
  command: codex app-server
  turn_timeout_ms: 3600000
---

You are working on issue {{ issue.identifier }}: {{ issue.title }}.
{{ issue.description }}
```

Equivalent gh-aw workflow (`.github/workflows/symphony-dispatch.md`):

```yaml
---
on:
  issues:
    types: [opened, labeled]
  schedule: daily on weekdays
  workflow_dispatch:
  skip-if-match: "is:issue is:open label:agent:in-progress"
permissions:
  issues: read
  contents: read
  pull-requests: read
tools:
  github:
    toolsets: [default]
network: node
engine:
  max-turns: 20
  max-concurrency: 5
timeout-minutes: 60
safe-outputs:
  add-comment:
    max: 5
  create-pull-request:
    max: 1
    base: main
  update-issue:
    max: 3
  close-issue:
    max: 1
concurrency:
  group: symphony-${{ github.event.issue.number || github.run_id }}
  cancel-in-progress: true
---

# Symphony Issue Agent

You are working on issue #${{ github.event.issue.number }}: "${{ github.event.issue.title }}".

## Issue Description

${{ github.event.issue.body }}

## Instructions

1. Read the issue description and understand the requirements.
2. Analyze the codebase to identify relevant files.
3. Implement the requested changes.
4. Run tests to verify your changes.
5. Create a pull request with your implementation.
6. Post a comment on the issue linking to the PR.
7. Apply the `agent:review` label to the issue.

## On Completion

If the work is complete:
- Create a PR and post a summary comment.
- Apply the `agent:review` label.

If you cannot complete the work:
- Post a comment explaining what's blocking.
- Apply the `agent:blocked` label.
```

### A.2 Concept Mapping Cheat Sheet

| Symphony Concept | gh-aw Equivalent | Notes |
| --- | --- | --- |
| `tracker.kind: linear` | `tools: github: toolsets: [default]` | GitHub Issues as tracker |
| `tracker.api_key` | `${{ secrets.GITHUB_TOKEN }}` (automatic) | Built-in authentication |
| `tracker.project_slug` | Repository + labels/milestones | Or GitHub Projects |
| `tracker.active_states` | `is:open` + label filters | Via skip guards |
| `tracker.terminal_states` | `is:closed` | GitHub issue state |
| `polling.interval_ms` | `schedule: daily on weekdays` | Or event triggers |
| `workspace.root` | GitHub Actions runner workspace | Automatic checkout |
| `hooks.after_create` | `steps:` (pre-agent) | Outside sandbox |
| `hooks.before_run` | `steps:` (pre-agent) | Outside sandbox |
| `hooks.after_run` | `post-steps:` | Outside sandbox |
| `agent.max_concurrent_agents` | `engine.max-concurrency` | Per-workflow limit |
| `agent.max_retry_backoff_ms` | `cache-memory` + `dispatch-workflow` | Manual pattern |
| `codex.command` | `engine.id` / `engine.command` | Engine selection |
| `codex.turn_timeout_ms` | `timeout-minutes` | In minutes |
| `codex.approval_policy` | AWF sandbox (automatic) | Sandbox handles approval |
| State reconciliation | `skip-if-match` / `concurrency` | Guard-based |
| In-memory state | `cache-memory` | Persistent across runs |
| HTTP dashboard | GitHub Actions UI | Built-in |
| Structured logs | GitHub Actions logs + OTLP | Built-in + optional |
| SSH worker extension | `runs-on:` runner labels | Runner selection |

### A.3 Key Differences

1. **Single-job execution**: gh-aw runs one agent session per trigger event. Multi-issue batch
   processing is done within a single run (agent iterates over issues).

2. **No persistent daemon**: No long-running process. Each workflow run is independent.

3. **Event-driven vs. polling**: Use GitHub event triggers instead of polling loops. Scheduled
   workflows provide periodic processing.

4. **Safe outputs vs. direct writes**: All write operations go through safe-outputs with rate
   limiting and audit trails.

5. **Sandbox by default**: AWF sandbox provides security isolation. No need for manual workspace
   containment.

6. **No retry queue**: Use `cache-memory` for retry state and `dispatch-workflow` for re-triggers.

7. **GitHub-native observability**: GitHub Actions UI, run logs, and OTLP replace custom dashboards.

8. **Self-hosted runners**: When using self-hosted runners (the gh-aw equivalent of Symphony's SSH worker extension), operators should consider: environment drift across runner instances, runner health monitoring, cleanup of workspace artifacts, and consistent tool/dependency availability. Use runner labels to match workloads to capable runners. Ephemeral (auto-scaling) runners are strongly recommended to avoid state accumulation. See §15.2 for additional hardening guidance.
