# Cursor Actions migration

The seven `cursor-*.yml` workflows are the Cursor CLI equivalents of the
generated `gh-aw` workflows. The original Markdown sources and generated
`*.lock.yml` files are deliberately retained unchanged so that rollback does
not require regenerating them with a newer `gh-aw` compiler.

## Repository configuration

Before enabling the Cursor workflows, configure:

- Actions repository secret `CURSOR_API_KEY` (required)
- Actions repository variable `CURSOR_AGENT_MODEL` (optional Cursor model ID)
- Existing `GH_AW_GITHUB_TOKEN` (optional but recommended; retained only for
  deterministic GitHub mutations so bot-created PRs and labels can trigger
  downstream workflows)
- **Settings → Actions → General → Workflow permissions → Allow GitHub Actions
  to create and approve pull requests** for the two PR-producing workflows

The shared action in `.github/actions/run-cursor` installs the current official
Cursor CLI, applies a read-only or coding permission profile, and runs it in
non-interactive mode. Cursor never receives `GITHUB_TOKEN`, `GH_TOKEN`, or
`GH_AW_GITHUB_TOKEN`, and every checkout uses `persist-credentials: false`.
GitHub mutations are validated and performed by later deterministic steps with
a step-scoped token. If `GH_AW_GITHUB_TOKEN` is absent, those steps fall back to
the built-in token; GitHub may then suppress workflows that would otherwise be
triggered by bot-created events.

Cursor's official installer tracks the latest CLI build rather than a pinned
release. Review CLI release changes when changing these workflows. The
permission profile also fails closed if a project-level `.cursor/mcp.json`
exists, because MCP servers can add unreviewed external capabilities.

## Cut over

Workflow enabled/disabled state belongs to GitHub and is not stored in Git.
After these files reach the default branch, authenticate `gh` as a maintainer
and run:

```bash
.github/scripts/cursor/toggle-gh-aw-workflows.sh cutover
.github/scripts/cursor/toggle-gh-aw-workflows.sh status
```

`cutover` disables all seven legacy `*.lock.yml` workflows before enabling the
seven Cursor entry-point workflows. The reusable `cursor-issue-worker.yml` is
not an entry point and is therefore not toggled directly.

`agentics-maintenance.yml` is intentionally left unchanged. It is not one of
the seven agents and retaining it preserves expiry handling if the legacy
workflows are restored.

## Roll back to gh-aw

```bash
.github/scripts/cursor/toggle-gh-aw-workflows.sh rollback
.github/scripts/cursor/toggle-gh-aw-workflows.sh status
```

Rollback disables the Cursor workflows first, then re-enables the original
generated workflows. This ordering avoids a window where both implementations
can process the same event.

To stop only the old workflows without enabling Cursor, use:

```bash
.github/scripts/cursor/toggle-gh-aw-workflows.sh disable-old
```

The migration intentionally does not edit or recompile any `gh-aw` source or
lock file. Their compiler metadata remains at the version originally committed.
