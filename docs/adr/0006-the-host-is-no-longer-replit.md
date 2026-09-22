# ADR-0006 — The host is no longer Replit, and the next one is still to be chosen

**Status:** Accepted
**Date:** 2026-09-21

## Context

ADR-0001 decided to **"Stay on Replit for now."** The Replit subscription has since ended. The
dev-sync machinery built for it — a GitHub workflow posting every push to the Repl's preview, a
webhook in the server that fast-forwarded the Repl's checkout, a boot-time sync and a Run-button
supervisor — was still wired into the server, CI and the dev bundler with nothing on the other
end. Its CI job mapped the dead Repl's HTTP 404 to "stopped" and passed, so it would have been
green forever while syncing nothing: "a guard satisfied without the thing it guards" (#1103).

## Decision

ADR-0001's "Stay on Replit for now" clause is superseded; the rest of ADR-0001 (keep the React
Native/Expo client, no game engine) still holds.

Replit is no longer the host. The dev-sync machinery is deleted rather than patched, since
nothing it talked to exists. Which host replaces Replit is not decided here: that is
[#1105 "Move off Replit"](https://github.com/metasito/murlan/issues/1105). ADR-0001's sketch
of a small move — one always-on container, managed Postgres from the same provider — is input
to that choice, not a decision.

## Consequences

- Nothing in the server, CI or Metro config depends on a live Repl any more.
- Code that still assumes a Replit environment at runtime — the `ssl:` sniffs, the
  `REPLIT_*` fallbacks in CORS and `safeHost`, `.replit` itself and the Replit section of
  `CLAUDE.md` — stays until #1104 and #1105 replace it. `.replit`'s Run-button workflow calls
  npm scripts this change removes; it has no Repl left to run on.
- `docs/research/2026-08-27-replit-dev-sync.md` and `docs/DEPLOY-RUNBOOK.md` describe a deleted
  workflow and a dead host until the docs refresh rewrites them.
