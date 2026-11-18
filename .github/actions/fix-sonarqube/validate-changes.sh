#!/usr/bin/env bash
set -euo pipefail

if grep \
  --recursive \
  --files-with-matches \
  --fixed-strings \
  --exclude-dir=.git \
  -- "$SONAR_TOKEN" .; then
  rm -rf -- .cursor-output
  echo "::error::Cursor wrote SONAR_TOKEN into the workspace"
  exit 1
fi

automation_changes="$(git status --porcelain --untracked-files=all -- \
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
if [[ -n "$automation_changes" ]]; then
  echo "::error::Cursor modified protected automation files"
  printf '%s\n' "$automation_changes"
  exit 1
fi

rm -rf -- .cursor-output
if [[ -z "$(git status --porcelain --untracked-files=all)" ]]; then
  if [[ "${REPAIR_REQUIRED:-false}" == true ]]; then
    echo "::error::Verification repair removed all SonarQube fixes"
    exit 1
  fi
  echo "has_changes=false" >> "$GITHUB_OUTPUT"
  echo "SonarQube issues require no code changes; no pull request was created." >> "$GITHUB_STEP_SUMMARY"
else
  echo "has_changes=true" >> "$GITHUB_OUTPUT"
fi
