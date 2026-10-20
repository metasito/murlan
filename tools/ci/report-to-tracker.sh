#!/usr/bin/env bash
# Files a red scheduled run in the tracker: one open issue per title, commented on by every later red run.
#
#   GH_TOKEN=… GH_REPO=… bash tools/ci/report-to-tracker.sh <title> <body file> <label>…
#
# The first label finds the open issue; every label goes on a new one.
set -euo pipefail

title="$1"
body="$2"
key="$3"
shift 2

open=$(gh issue list --label "$key" --state open --limit 100 --json number,title \
  | jq -r --arg title "$title" 'map(select(.title == $title)) | .[0].number // empty')
if [ -n "$open" ]; then
  gh issue comment "$open" --body-file "$body"
else
  labels=()
  for label in "$@"; do labels+=(--label "$label"); done
  gh issue create --title "$title" "${labels[@]}" --body-file "$body"
fi
