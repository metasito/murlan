---
description: Work the murlan queue through the ticket pipeline — one item, or looping until told to stop.
argument-hint: "[loop]"
allowed-tools: Workflow, ScheduleWakeup, Bash(node scripts/next-ticket.mjs), Bash(gh issue:*), Bash(gh pr:*), Bash(gh run:*)
---
Every rule you follow while doing this is in `docs/agents/RULES.md` — read it first.


Work the queue. Mode comes from `$ARGUMENTS`: empty means **one item then stop**; `loop` means
**item after item until the user says stop**.

## The call

```
Workflow({ scriptPath: ".claude/workflows/ticket-pipeline.mjs" })
```

The pipeline picks the ticket itself (`scripts/next-ticket.mjs`), claims it, gates it, implements,
reads ci.yml's verdict, fixes a red run and lands it. Pass nothing — no ticket number, no prompt.

`Workflow({name: "ticket-pipeline"})` does **not** resolve: that registry does not read this
project's `.claude/workflows/`. Always `scriptPath`.

## One at a time

Never have two runs in flight. A second pipeline claims a ticket the first may already be
holding, and both push to the same git index. If a run is still going, wait for its completion
notification and do nothing else meanwhile.

## The notifications during a run are the run's own

A pipeline stage dispatches sub-agents (`/code-review --fix`, plan and verify helpers), and each
one that stops fires its own task-notification at you — `/code-review --fix …` finishing, an agent
"(resumed)" being killed. **These are not another session's.** They share this session's task
directory; only the workflow's own task-id carries the Opened/Closed result. Do not report them,
do not act on them, and never call them strays — wait for the workflow's completion notification.

The one thing worth reading in them: a review sub-agent reporting **"no diff to review"** means it
stood in the main checkout instead of the ticket's worktree. That is a defect in the run, not a
clean bill — if the run lands on the back of it, say so in the report.

## Report after each item

Two lines, plain language, no file lists:

- **Opened** — issue number and, in one sentence, what it asked for.
- **Closed** — issue number and the *effective diff*: what behaviour is different now. "The hand
  fans from the left edge instead of the centre", not "edited handLayout.ts".

## When the pipeline does not apply

It implements code. Three routes it cannot take:

- `triage` → `/triage`
- `wayfinder` → `/wayfinder`
- a `question` / owner-call ticket, or a route that hands off to the owner — work it by hand,
  then continue.

## Loop mode only

After each landed item, immediately start the next. Use `ScheduleWakeup` with a long delay
(1200s+) purely as a fallback heartbeat in case a run hangs — the workflow's own completion
notification is the real wake signal, so do not poll. Stop only when the user says so, or when
`node scripts/next-ticket.mjs` reports no takeable work; say which.
