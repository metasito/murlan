#!/usr/bin/env bash
# Shared by the repository scan and its self-test in ci.yml's `secrets` job,
# so weakening this invocation — dropping pipefail, adding --exit-code 0 —
# shows up in both callers at once: the self-test's planted credential stops
# failing the scan, and its own exit-code assertion goes red with it.
set -o pipefail

source_dir="$1"
output_file="$2"

docker run --rm -v "$source_dir:/repo" -w /repo "$GITLEAKS_IMAGE" \
  detect --source=/repo --redact --no-color -v 2>&1 | tee "$output_file"
