# 0003. Cloud Run already runs the app on multiple instances

**Status:** Accepted
**Date:** 2026-09-10

## Context

ADR-0001 (2026-08-20) described horizontal scaling as deferred: "No horizontal scaling —
all game state lives in in-process `Map`s... A second instance would not share them... Defer
horizontal scaling until player count demands it." `.replit` sets `deploymentTarget =
"cloudrun"` with no `maxInstances` — Cloud Run's default is uncapped autoscaling, and it also
runs two revisions concurrently during every deploy.

`docs/research/2026-08-29-multiplayer-infrastructure.md` reproduced this directly
(`scripts/repro-544.mjs`): two instances against one database silently split broadcasts, and
states "it is the running configuration," not a risk to check. Scaling was never deferred — it
was already the deployed shape before anyone decided it.

## Decision

Treat multi-instance as the current reality, not a future one. The fix already shipped:
`server/gameOwnership.ts` (Postgres advisory lock, one owner per room) plus
`@socket.io/postgres-adapter` (`server/socketAdapter.ts`) carrying broadcasts and forwarded
actions (`server/tableRouter.ts`) across instances (commit `13b09ac`). This is load-bearing
production infrastructure, not speculative scaffolding — do not remove or simplify it on the
assumption the app is single-instance.

## Consequences

A future architecture review that reads ADR-0001's "no horizontal scaling" line in isolation
will misread `gameOwnership.ts`/`tableRouter.ts`/`socketAdapter.ts` as a hypothetical seam
with only one adapter. It has two, both real. Any change to how rooms are owned or how state
broadcasts must account for concurrent instances as a given, not a contingency.
