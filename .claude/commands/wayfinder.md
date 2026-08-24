---
description: Work one wayfinder child against its map — resolve the question, record the decision, redraw the fog.
argument-hint: "[loop]"
allowed-tools: Read, Grep, Glob, Write, Edit, Skill, WebSearch, WebFetch, Bash(node scripts/next-ticket.mjs), Bash(gh issue:*), Bash(gh api:*)
---

Work the routed wayfinder child. Mode comes from `$ARGUMENTS`: empty means **one child then
stop**; `loop` means **child after child until the user says stop**.

## Pick

`node scripts/next-ticket.mjs`. Take the child it prints only if the route is `wayfinder` — the
picker reaches this route when nothing in the frontier is *takeable* and nothing needs triage.
If the route is something else, stop and say so.

The wayfinder bucket is not gated the way the frontier is: the picker does not check a child's
blockers or assignee before printing it. **Read them yourself** before starting — if the child
is blocked or already assigned, say so, leave it, and take the next.

## Do

Claim and release per `docs/agents/issue-tracker.md` → *Claiming an item*; the map, the child
types and what each produces are in that file's *Wayfinding operations*.

1. Read the child, its comments, and the `wayfinder:map` issue it belongs to.
2. Work it according to its `wayfinder:<type>` label. A `research` child answers from sources; a
   `prototype` child answers by building something throwaway; a `grilling` child answers by
   being argued with; a `task` child answers by doing the thing.
3. Write the answer onto the child, then update the map: move what is now settled into
   Decisions-so-far, and redraw the Fog around what the answer opened up.
4. Close the child, which releases the claim with it.

## Prototype children

A `wayfinder:prototype` child exists to answer a question, so its code is evidence, not a
deliverable: build it in a scratch directory outside the repo, and **delete it once the answer
is on the issue**. It gets no branch and no pull request. If the answer turns out to be worth
shipping, that is a new ticket for the queue, not this one.

## What this must not do

- Land code on `main`, or open a pull request.
- Answer a question the map already settled — check Decisions-so-far first.
- Decide something only the owner can decide. Put the option space on the child, label it
  `ready-for-human`, and take the next.

## Report

Per child, two lines: the number and the question it asked, then the answer and what moved on
the map because of it.

## Loop mode only

Take the next child immediately. Stop when the user says so, or when the route stops being
`wayfinder`; say which.
