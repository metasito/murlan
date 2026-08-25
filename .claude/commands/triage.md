---
description: Convert one unspecified issue into a ticket an agent can execute — size, labels, and a body that stands on its own.
argument-hint: "[loop]"
allowed-tools: Read, Grep, Glob, Skill, Bash(node scripts/next-ticket.mjs), Bash(gh issue:*), Bash(gh pr:*), Bash(gh api:*)
---
Every rule you follow while doing this is in `docs/agents/RULES.md` — read it first.


Triage the routed issue. Mode comes from `$ARGUMENTS`: empty means **one issue then stop**;
`loop` means **issue after issue until the user says stop**.

## Pick

`node scripts/next-ticket.mjs`. Take the issue it prints only if the route is `triage` — the
picker reaches this route when nothing in the frontier is *takeable*, which is not the same as
the frontier being empty. If the route is something else, stop and say so.

## Work it

Run **`mattpocock-skills:triage`** and follow it. It owns the state machine, the roles, the
AI-generated disclaimer and the agent-brief format; this file adds only what is true of *this*
repo and is not in that skill:

- **Claim before the first write, release before you stop.** Claim rules are in
  `docs/agents/issue-tracker.md` → *Claiming an item*.
- **Remove `needs-triage` and then `in-progress`.** Triage never closes anything on its own — a
  `rejected` issue stays open (`docs/BRIEF.md`) — and `classify()` in `scripts/next-ticket.mjs`
  skips every `in-progress` issue in every bucket, so a claim left behind hides the issue from
  the queue permanently.
- **Verify the issue's claims against the code before sizing it.** An issue describing a defect
  that is already fixed gets corrected or closed, not sized.
- Multi-line `gh` bodies go through `--body-file`, per that file's *Conventions*.

## What this must not do

- Write code, or open a pull request. Triage produces a ticket, not a change.
- Guess at something only the owner can decide — that is `ready-for-human`, and it should carry
  the options you considered, not just the question.

## Report

Per issue, two lines: the number and what it asked for, then the label and size it got and why.

## Loop mode only

Take the next issue immediately. Stop when the user says so, or when the route stops being
`triage`; say which.
