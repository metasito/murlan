---
description: Work one wayfinder child against its map — resolve the question, record the decision, redraw the fog.
argument-hint: "[loop]"
allowed-tools: Read, Grep, Glob, Write, Edit, Skill, WebSearch, WebFetch, Bash(node scripts/next-ticket.mjs), Bash(gh issue:*), Bash(gh api:*)
---
Every rule you follow while doing this is in `docs/agents/RULES.md` — read it first.


Work the routed wayfinder child. Mode comes from `$ARGUMENTS`: empty means **one child then
stop**; `loop` means **child after child until the user says stop**.

## Pick

`node scripts/next-ticket.mjs`. Take the child it prints only if the route is `wayfinder` — the
picker reaches this route when nothing in the frontier is *takeable* and nothing needs triage.

**Read the child's blockers and assignee yourself before starting.** The wayfinder bucket is not
gated the way the frontier is: `pickRoute()` returns `buckets.wayfinder[0]` with no `takeable()`
check, so the route can hand over a child that should not be worked. If it is blocked or already
assigned, say so, leave it, and take the next.

## Work it

Run **`mattpocock-skills:wayfinder`** and follow it. It owns the map, the child types, the
Decisions-so-far / Fog structure and the refer-by-name rule. Where it asks for tracker specifics,
they are in `docs/agents/issue-tracker.md` → *Wayfinding operations*.

What this repo adds:

- **Claim before the first write, release before you stop** — `docs/agents/issue-tracker.md` →
  *Claiming an item*. Closing the child releases it.
- **A `wayfinder:prototype` child's code is evidence, not a deliverable.** Build it in a scratch
  directory outside the repo and delete it once the answer is on the issue. No branch, no pull
  request. If the answer turns out to be worth shipping, that is a new ticket for the queue.

## What this must not do

- Land code on `main`, or open a pull request.
- Leave a decision open-ended. If it is genuinely the owner's call, put the **option space** on
  the child — what each option costs and what it forecloses — label it `ready-for-human`, and
  take the next. A bare question is not a finished ticket.

## Report

Per child, two lines: the number and the question it asked, then the answer and what moved on
the map because of it.

## Loop mode only

Take the next child immediately. Stop when the user says so, or when the route stops being
`wayfinder`; say which.
