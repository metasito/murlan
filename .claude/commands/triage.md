---
description: Convert one unspecified issue into a ticket an agent can execute — size, labels, and a body that stands on its own.
argument-hint: "[loop]"
allowed-tools: Read, Grep, Glob, Bash(node scripts/next-ticket.mjs), Bash(gh issue:*), Bash(gh api:*)
---

Triage the routed issue. Mode comes from `$ARGUMENTS`: empty means **one issue then stop**;
`loop` means **issue after issue until the user says stop**.

## Pick

`node scripts/next-ticket.mjs`. Take the issue it prints only if the route is `triage` — the
picker reaches this route when nothing in the frontier is *takeable*, which is not the same as
the frontier being empty. If the route is something else, stop and say so.

## Do

Claim, work, release — the claim rules are in `docs/agents/issue-tracker.md` → *Claiming an item*.

1. Read the issue **and its comments**. The body is often the pre-decision state; the ruling is
   usually in a comment.
2. **Verify its claims against the code before sizing anything.** An issue that describes a
   defect which is already fixed gets corrected or closed, not sized.
3. Rewrite the body to the shape in `docs/agents/issue-tracker.md` → *Writing an issue body an
   agent can execute*. Follow that section; do not restate it here.
4. Label: one `size:*`, and the one label that routes it — `ready-for-agent`, `ready-for-human`,
   `needs-info`, or `rejected`.
5. **Remove `needs-triage`, then remove `in-progress`.** Both matter: `classify()` in
   `scripts/next-ticket.mjs` skips every `in-progress` issue in every bucket, and a `rejected`
   issue stays open (`docs/BRIEF.md`), so triage never closes anything on its own. A claim left
   behind makes the issue invisible to the queue permanently.

Multi-line `gh` bodies go through `--body-file`, per that file's *Conventions*.

## Pull requests

`docs/agents/issue-tracker.md` → *Pull requests as a triage surface* decides whether external
pull requests are triaged here, and how. Read the flag there rather than assuming; this command
has no separate policy.

## What this must not do

- Write code, or open a pull request. Triage produces a ticket, not a change.
- Size an issue whose claims it has not checked against the code.
- Guess at something only the owner can decide — that is `ready-for-human`.

## Report

Per issue, two lines: the number and what it asked for, then the label and size it got and why.

## Loop mode only

Take the next issue immediately. Stop when the user says so, or when the route stops being
`triage`; say which.
