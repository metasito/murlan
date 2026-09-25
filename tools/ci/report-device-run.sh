#!/usr/bin/env bash
# Files a red scheduled device run in the tracker: one open `device-run` issue per workflow,
# commented on by every later red run, closed by hand once diagnosed.
#
#   GH_TOKEN=… GH_REPO=… RUN_URL=… bash tools/ci/report-device-run.sh <workflow file>
set -euo pipefail

workflow="$1"
title="A scheduled $workflow run went red"
body="$(mktemp)"
{
  echo "The scheduled \`$workflow\` run on \`main\` failed: [run]($RUN_URL), [artifacts]($RUN_URL#artifacts)."
  echo
  echo "Diagnose it from its artifacts; a device run is never rerun (\`docs/agents/checks.md\`). Close this by hand once diagnosed."
} > "$body"
open=$(gh issue list --label device-run --state open --limit 100 --json number,title \
  --jq "map(select(.title == \"$title\")) | .[0].number // empty")
if [ -n "$open" ]; then
  gh issue comment "$open" --body-file "$body"
else
  gh issue create --title "$title" --label device-run --body-file "$body"
fi
