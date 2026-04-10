---
description: Automatically pick and work on one triaged issue per day
on:
  schedule:
    - cron: "0 1 * * 1-5"
  workflow_dispatch:
permissions:
  issues: read
  contents: read
  pull-requests: read
tools:
  github:
    toolsets: [default]
  cache-memory: true
network:
  allowed:
    - defaults
    - node
steps:
  - uses: actions/setup-node@v4
    with:
      node-version: "24"
  - run: corepack enable
  - run: yarn install --immutable
safe-outputs:
  add-comment:
    max: 3
  create-pull-request:
    max: 1
    labels: [agent-created]
  update-issue:
    max: 3
timeout-minutes: 45
concurrency: daily-work
---

# 🤖 Daily Auto-Work Agent

You are an autonomous coding agent for **miyulab-fe** — a Fediverse (Mastodon/Pleroma compatible) web client.

This workflow runs once per weekday. Your job is to **pick one issue and implement it**.

## Step 1: Select an Issue

Search for open issues in **${{ github.repository }}** that meet ALL of:
- Has `triaged` label
- Does NOT have `agent:in-progress`, `agent:claimed`, `agent:blocked`, or `agent:done` labels
- Does NOT have the `agentic-workflows` label
- Does NOT already have a linked pull request

From the results, pick **exactly one** issue using this priority order:
1. `priority:critical` → `priority:high` → `priority:medium` → `priority:low`
2. Within the same priority, pick the **oldest** issue (lowest issue number)

If no eligible issue is found, use `noop` and stop.

## Step 2: Claim the Issue

Apply the `agent:in-progress` label to the chosen issue and post a comment:
> 🤖 Daily auto-work agent has selected this issue for implementation.

## Step 3: Implement

Read the issue description and comments to understand the requirements.

### Project Overview

This is a **Next.js 16** application with:
- **React 19** + React Compiler
- **TypeScript** (strict mode, `src` baseUrl for imports)
- **Tailwind CSS v4** + **shadcn/ui** (Lucide icons)
- **Fediverse API** via **megalodon** library
- **Client-side SQLite Wasm** + Dexie (IndexedDB) for local caching
- **Biome 2.x** for lint/format (NOT ESLint/Prettier)
- **Yarn 4** with corepack
- **react-virtuoso** for virtual scrolling

### Code Structure

```
src/
├── app/                    # Next.js App Router
│   ├── layout.tsx          # Provider chain (13 layers of Context)
│   ├── page.tsx            # Home — timeline group display
│   ├── _components/        # Page-level components (feature units)
│   ├── _parts/             # Reusable low-level UI parts
│   └── api/attachment/     # Media proxy API Route
├── components/ui/          # shadcn/ui generated components (DO NOT EDIT)
├── types/types.ts          # App-wide type definitions
└── util/
    ├── db/                 # SQLite/Dexie data layer
    ├── hooks/              # Timeline data fetching hooks
    ├── streaming/          # WebSocket stream management
    ├── provider/           # React Context providers
    └── queryBuilder.ts     # SQL query building
```

### Key Conventions

- **Import paths**: Use `src` baseUrl absolute paths (e.g., `util/hooks/xxx`, `types/types`)
- **Components**: Page features in `_components/`, reusable UI in `_parts/`, shadcn in `components/ui/`
- **State management**: React Context only (no external state libraries)
- **Biome rules**: `src/components/ui/**` is excluded from Biome (generated code)
- **Backend types**: `Backend = 'mastodon' | 'pleroma' | 'friendica' | 'firefish' | 'gotosocial' | 'pixelfed'`

### Implementation Guidelines

- Follow existing code conventions and patterns
- Use TypeScript strict mode compatible code
- Use single quotes, no semicolons (Biome style)
- Use `useSortedKeys` / `useSortedProperties` (Biome rule)
- Prefer Server Components; use Client Components only when needed

## Step 4: Verify

Run verification in this exact order:
```bash
yarn check:fix     # Auto-fix lint/format issues
yarn check         # Verify lint/format
yarn build         # Production build
```

## Step 5: Create PR

Create a pull request with:
- Clear title describing the change
- Body referencing the issue (`Closes #<issue_number>`)
- Commit messages following conventional format

## Step 6: Update the Issue

- Post a comment linking to the created PR
- Apply the `agent:review` label (replace `agent:in-progress`)

## On Failure

If you cannot complete the work:
- Post a comment explaining what's blocking
- Apply the `agent:blocked` label (replace `agent:in-progress`)
- Include relevant error messages or analysis

## Continuation Protocol

Check cache-memory for previous daily-work state.

If a previous run left incomplete work:
- Resume from the saved checkpoint instead of picking a new issue.
- Only pick a new issue if no incomplete work exists.
