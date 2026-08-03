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

The shared action in `.github/actions/run-cursor` downloads a pinned Cursor CLI
archive, verifies its SHA-256 digest before extraction, applies a permission
profile, and runs the verified binary by absolute path in non-interactive mode.
It does not execute Cursor's mutable installer or add its install directory to
`PATH`.

Cursor never receives `GITHUB_TOKEN`, `GH_TOKEN`, or `GH_AW_GITHUB_TOKEN`, and
every checkout uses `persist-credentials: false`. GitHub mutations are validated
and performed by later deterministic steps with a step-scoped token. Trusted
publication paths use `GH_AW_GITHUB_TOKEN` when configured and otherwise fall
back to the built-in token. The untrusted Issue implementation path described
below always uses the built-in token so GitHub suppresses recursive PR Actions
runs.

The `analysis` profile is read-only. The `coding` profile used for external
Issue content allows native file reads and writes but explicitly denies every
shell command. The separate `maintenance` profile is reserved for the fixed,
trusted weekly package-upgrade prompt, where local Yarn commands are required.
Its `Shell(yarn)` allowance can run package scripts and is therefore not a
sandbox boundary; never use maintenance mode with Issue, PR, or other untrusted
prompt content.

Native write allowances are materialized as absolute paths under the current
`GITHUB_WORKSPACE`; they do not grant write access to the rest of the runner
home. The action also resolves and revalidates its output directory after the
agent exits, rejects symlink outputs, and atomically installs the result from a
temporary file in that verified directory.

Cursor also receives a fresh temporary `HOME`, isolating any CLI cache or
credential material it creates during the run.

All profiles use Cursor's `static` channel and the action also passes
`--disable-auto-update`, so the verified binary cannot replace itself at run
time. Project Cursor configs are disabled, and the action fails closed if it
finds a project CLI, MCP, or hook configuration (including Claude hooks or
permissions entries), because those files can add unreviewed capabilities or
override the CI permission profile. Native reads of Cursor's credential and
configuration directories are denied as well.

The Issue implementation path never installs dependencies or executes generated
repository code inside its privileged GitHub Actions job. It publishes a Draft
PR with the built-in `GITHUB_TOKEN`, which intentionally suppresses automatic
PR Actions runs. A maintainer must review executable configuration and scripts,
mark the PR ready, then push a reviewed commit or reopen the PR to trigger
Actions. Vercel Preview deployments remain enabled and governed by the
project's normal Git integration. The trusted weekly maintenance path retains
its own Yarn verification flow.

### Updating the pinned Cursor CLI

The version, archive URL, and SHA-256 digest are constants in
`.github/actions/run-cursor/action.yml`. Cursor does not currently publish a
documented stable download API or checksum manifest for this archive, so treat
an update as a supply-chain-sensitive code change:

1. Inspect `https://cursor.com/install` and identify the exact Linux x64 build
   and archive URL it selects.
2. Download that archive independently, calculate its SHA-256 digest, and
   inspect its contents before changing the constants.
3. Verify that the extracted `cursor-agent --version` exactly matches the
   pinned build, then run the workflow validation before merging.

The action performs the digest and version checks again on every run and fails
closed on any mismatch.

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
