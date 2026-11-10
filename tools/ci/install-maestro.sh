#!/usr/bin/env bash
# Maestro decides what "the app rendered" means, and unpinned it was the only thing in either job
# that could change between two runs of the same commit. Raise it deliberately, and read the
# changelog when you do (#701). The installer reads the variable from its own environment, so it
# is exported above the pipe.
set -euo pipefail

export MAESTRO_VERSION=2.10.0
curl -Ls "https://get.maestro.mobile.dev" | bash
# Checked rather than echoed. A tag that does not resolve leaves the installer's own `exit`
# returning the status of the echo before it, which is 0 with nothing installed - so the pin has to
# be read back off the binary that arrived.
"$HOME/.maestro/bin/maestro" --version 2>&1 | tee /dev/stderr | grep -q "$MAESTRO_VERSION"
