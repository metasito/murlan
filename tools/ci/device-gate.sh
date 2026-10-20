#!/usr/bin/env bash
# A device run is a schedule, or a dispatch on a ticket's own branch.
#
#   EVENT=… REF=… bash tools/ci/device-gate.sh
# Expressions have no regex, and `startsWith` admits every worktree branch.
set -euo pipefail

[[ "$EVENT" == schedule || "$REF" =~ ^(agent|claude)/[0-9]+- ]] && exit 0
echo "::error::A device run is dispatched only on a ticket's own branch (agent/<n>-… or claude/<n>-…), not $REF."
exit 1
