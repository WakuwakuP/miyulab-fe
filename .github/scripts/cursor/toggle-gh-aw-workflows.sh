#!/usr/bin/env bash

set -euo pipefail

repository="${GH_REPO:-WakuwakuP/miyulab-fe}"

legacy_workflows=(
  agent-review.lock.yml
  daily-triage.lock.yml
  daily-work.lock.yml
  issue-triage.lock.yml
  stale-label-cleanup.lock.yml
  weekly-package-upgrade.lock.yml
  work-on-issue.lock.yml
)

cursor_workflows=(
  cursor-agent-review.yml
  cursor-daily-triage.yml
  cursor-daily-work.yml
  cursor-issue-triage.yml
  cursor-stale-label-cleanup.yml
  cursor-weekly-package-upgrade.yml
  cursor-work-on-issue.yml
)

set_workflow_state() {
  local operation="$1"
  shift

  local workflow
  for workflow in "$@"; do
    echo "$operation $workflow in $repository"
    gh workflow "$operation" "$workflow" --repo "$repository"
  done
}

case "${1:-}" in
  cutover)
    # Stop the legacy side first so the two agents never handle the same event.
    set_workflow_state disable "${legacy_workflows[@]}"
    set_workflow_state enable "${cursor_workflows[@]}"
    ;;
  disable-old)
    set_workflow_state disable "${legacy_workflows[@]}"
    ;;
  rollback)
    # Stop Cursor first so rollback never creates a double-execution window.
    set_workflow_state disable "${cursor_workflows[@]}"
    set_workflow_state enable "${legacy_workflows[@]}"
    ;;
  status)
    gh workflow list \
      --all \
      --repo "$repository" \
      --json name,path,state \
      --jq '.[] | select(.path | test("/(?:cursor-|(?:agent-review|daily-triage|daily-work|issue-triage|stale-label-cleanup|weekly-package-upgrade|work-on-issue)\\.lock\\.yml$)"))'
    ;;
  *)
    echo "Usage: $0 {cutover|disable-old|rollback|status}" >&2
    echo "Set GH_REPO=owner/repository to target a fork." >&2
    exit 2
    ;;
esac
