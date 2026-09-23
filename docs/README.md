# Docs index

Every document under `docs/` is reachable from here or from `docs/adr/README.md`. A plan, a
research note or a design spec is a working artefact and is deleted once the work it describes
lands — see `docs/adr/README.md`'s note on that policy. What remains below is meant to stay: each
row is the condition that should send you to that file, not just its subject.

## Product

| Document | Read it when… |
|---|---|
| [`BRIEF.md`](BRIEF.md) | You need what Murlan is, what's decided, and what's still open before proposing a change to scope. |
| [`GAME-RULES.md`](GAME-RULES.md) | You're changing or questioning a rule of play — the canonical spec, sourced and cross-checked against the tradition. |
| [`DISCONNECT-POLICY.md`](DISCONNECT-POLICY.md) | You're touching reconnect, seat vacancy or timeout behaviour — the owner-decided policy, clause by clause. |
| [`FEEL-BAR.md`](FEEL-BAR.md) | You're judging whether a moment (a play, a win, a reconnect) feels good enough to ship — the bar it's judged against. |

## Operating the repo

| Document | Read it when… |
|---|---|
| [`agents/checks.md`](agents/checks.md) | You need to know which check catches a given class of bug, what it costs, or which React Native Web trap passes every check and renders nothing. |
| [`agents/issue-tracker.md`](agents/issue-tracker.md) | You're taking, claiming, or releasing a ticket — the queue, labels and `gh` invocations. |
| [`agents/RULES.md`](agents/RULES.md) | You need the numbered rule a citation elsewhere points at, or you're about to break an invariant and want to check first. |
| [`agents/smell-baseline.md`](agents/smell-baseline.md) | You're running a code-review pass and need the vendored smell checklist it's judged against. |
| [`DEPLOY-RUNBOOK.md`](DEPLOY-RUNBOOK.md) | You're deploying, or a schema change means reading the `db:push` rename-or-drop prompt before accepting it. |

## Reference

| Document | Read it when… |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | You need the layers, data flow, socket lifecycle or persistence model before changing how a system fits together. |
| [`WEB-PERF.md`](WEB-PERF.md) | You're chasing a frame-rate or jank complaint on the web build, where no first-party profiler exists. |
| [`BUNDLE.md`](BUNDLE.md) | You're adding a dependency or asset and want to know what it costs the bundle. |
| [`BETA-PLAYTEST.md`](BETA-PLAYTEST.md) | You're running the beta playtest script with real devices and real people. |
| [`PRIVACY.md`](PRIVACY.md) | You're changing what data the app collects or how it's disclosed to a player. |
| [`tests/e2e/57-polish-audit/README.md`](../tests/e2e/57-polish-audit/README.md) | You're changing a menu screen's or the table's layout — the measurements and captures `tests/e2e/onlineTableSurvey.spec.ts` and `tests/ui-rules/tableProportions.test.ts` hold it to. |

## Decisions

| Document | Read it when… |
|---|---|
| [`adr/README.md`](adr/README.md) | You're about to touch an area a past decision already settled, or a decision you're making now will outlive this ticket. |
