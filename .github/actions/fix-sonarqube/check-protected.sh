#!/usr/bin/env bash
set -euo pipefail

protected_changes="$(git status --porcelain --untracked-files=all -- \
  .agents \
  .github \
  .claude \
  .cursor \
  .cursorignore \
  .cursorrules \
  .codex \
  .husky \
  AGENTS.md \
  ':(glob)**/AGENTS.md' \
  CLAUDE.md \
  ':(glob)**/CLAUDE.md' \
  src/zenstack)"
if [[ -n "$protected_changes" ]]; then
  echo "::error::Verification modified protected files"
  printf '%s\n' "$protected_changes"
  exit 1
fi
