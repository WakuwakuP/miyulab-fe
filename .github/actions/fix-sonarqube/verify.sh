#!/usr/bin/env bash
set -euo pipefail
for check in check typecheck test:run build; do
  {
    echo "Running yarn $check"
    yarn "$check"
  } 2>&1 | tee "$RUNNER_TEMP/sonarqube-verification.log"
done
