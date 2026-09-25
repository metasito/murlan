#!/usr/bin/env bash
# Shared by the repository scan and its self-test in ci.yml's `secrets` job,
# so weakening this invocation — dropping pipefail, adding --exit-code 0 —
# shows up in both callers at once: the self-test's planted credential stops
# failing the scan, and its own exit-code assertion goes red with it.
set -o pipefail

source_dir="$1"
output_file="$2"

# The scanned tree cannot excuse itself: an inline `gitleaks:allow` or a committed
# .gitleaksignore would hide a leak the same change adds. .gitleaks.toml is the one allowlist.
docker run --rm -v "$source_dir:/repo" -w /repo "$GITLEAKS_IMAGE" \
  detect --source=/repo --redact --no-color -v --ignore-gitleaks-allow --gitleaks-ignore-path=/dev/null 2>&1 | tee "$output_file"
