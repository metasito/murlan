#!/bin/bash
set -e

# Idempotent: installs any new/updated dependencies from a merged branch.
# Schema changes apply automatically at server boot (server/schemaDdl.ts),
# so no destructive `db:push` runs here — see replit.md.
npm install
