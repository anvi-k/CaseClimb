#!/bin/bash
# Build-gated deploy: commits and pushes only if the production build passes.
# Usage: scripts/ship.sh "commit subject"
set -e
cd "$(dirname "$0")/.."
npx tsc --noEmit
NEXT_DIST_DIR=.next-buildcheck DB_PATH=/tmp/rounds-buildcheck.db npx next build > /tmp/rounds-build.log 2>&1 || { tail -20 /tmp/rounds-build.log; echo "BUILD FAILED - not pushed"; exit 1; }
git add -A
git diff --cached --quiet && { echo "nothing to commit"; exit 0; }
git commit -q -m "$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin main
echo "pushed $(git rev-parse --short HEAD)"
