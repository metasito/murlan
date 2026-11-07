#!/usr/bin/env bash
# Shared by the repository scan and its self-test in ci.yml's `secrets` job,
# so weakening this invocation — dropping pipefail, adding --exit-code 0 —
# shows up in both callers at once: the self-test's planted credential stops
# failing the scan, and its own exit-code assertion goes red with it.
set -o pipefail

source_dir="$1"
output_file="$2"
scan_range="$3"

# Without --log-opts gitleaks reads `git log --all`: every branch, so a finding on any one of them
# reds every run. HEAD's own history, or a pull request's base..head, is all this scan may read.
if ! [[ "$scan_range" =~ ^(HEAD|[0-9a-f]{40}\.\.[0-9a-f]{40})$ ]]; then
  echo "::error::gitleaks-scan.sh takes HEAD or <base-sha>..<head-sha> as its range; got '$scan_range'." | tee "$output_file"
  exit 2
fi

# The scanned tree cannot excuse itself: an inline `gitleaks:allow` or a committed
# .gitleaksignore would hide a leak the same change adds. .gitleaks.toml is the one allowlist.
docker run --rm -v "$source_dir:/repo" -w /repo "$GITLEAKS_IMAGE" \
  detect --source=/repo --redact --no-color -v --ignore-gitleaks-allow --gitleaks-ignore-path=/dev/null --log-opts="$scan_range" 2>&1 | tee "$output_file"
