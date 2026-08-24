---
description: Work the murlan queue through the ticket pipeline — one item, or looping until told to stop.
argument-hint: "[loop]"
allowed-tools: Workflow, ScheduleWakeup, Bash(node scripts/next-ticket.mjs), Bash(gh issue:*), Bash(gh pr:*), Bash(gh run:*)
---

Work the queue. Mode comes from `$ARGUMENTS`: empty means **one item then stop**; `loop` means
**item after item until the user says stop**.

## The call

```
Workflow({ scriptPath: ".claude/workflows/ticket-pipeline.mjs" })
```

The pipeline picks the ticket itself (`scripts/next-ticket.mjs`), claims it, gates it, implements,
verifies, reviews through three lenses and lands it. Pass nothing — no ticket number, no prompt.

`Workflow({name: "ticket-pipeline"})` does **not** resolve: that registry does not read this
project's `.claude/workflows/`. Always `scriptPath`.

## One at a time

Never have two runs in flight. A second pipeline claims a ticket the first may already be
holding, and both push to the same git index. If a run is still going, wait for its completion
notification and do nothing else meanwhile.

## Report after each item

Two lines, plain language, no file lists:

- **Opened** — issue number and, in one sentence, what it asked for.
- **Closed** — issue number and the *effective diff*: what behaviour is different now. "The hand
  fans from the left edge instead of the centre", not "edited handLayout.ts".

## When the pipeline does not apply

It implements code. Three routes it cannot take — do these by hand, then continue:

- `triage` or `wayfinder` (no code to write)
- a `question` / owner-call ticket
- a route that hands off to the owner (`ready-for-human`)

## Loop mode only

After each landed item, immediately start the next. Use `ScheduleWakeup` with a long delay
(1200s+) purely as a fallback heartbeat in case a run hangs — the workflow's own completion
notification is the real wake signal, so do not poll. Stop only when the user says so, or when
`node scripts/next-ticket.mjs` reports no takeable work; say which.
