---
description: Convert one unspecified issue into a ticket an agent can execute — size, labels, and a body that stands on its own.
argument-hint: "[loop]"
allowed-tools: Read, Grep, Glob, Skill, Bash(node tools/loop/next-ticket.mjs), Bash(gh issue:*), Bash(gh pr:*), Bash(gh api:*)
---
Every rule you follow while doing this is in `docs/agents/RULES.md` — read it first.

Triage the routed issue. `$ARGUMENTS` empty: **one issue, then stop**. `loop`: **issue after
issue** until the user says stop or the route stops being `triage`; say which.

1. **Pick.** Run `node tools/loop/next-ticket.mjs` and take the issue it prints only if the route
   is `triage`; otherwise stop and say so. The picker reaches this route when nothing in the
   implement frontier is *takeable*, which is not the same as the frontier being empty.
2. **Claim before the first write** — `docs/agents/issue-tracker.md` → *Picking and claiming*.
3. **Verify the issue's claims against the code before sizing it.** An issue describing a defect
   that is already fixed gets corrected or closed, not sized.
4. **Run `mattpocock-skills:triage`** and follow it. It owns the state machine, the roles, the
   AI-generated disclaimer and the agent-brief format. The body follows `issue-tracker.md` →
   *Writing an issue body an agent can execute*; multi-line `gh` bodies go through `--body-file`
   (*Recipes*).
5. **Release.** Remove `needs-triage`, then `in-progress`: the picker skips an `in-progress` issue
   in every bucket, so a claim left behind hides it from the queue for good. Triage closes nothing
   on its own — a `rejected` issue stays open (`docs/BRIEF.md`).
6. **Report**, per issue, two lines: the number and what it asked for, then the label and size it
   got and why.

Triage produces a ticket, not a change: no code, no pull request. What only the owner can decide
is `ready-for-human`, carrying the options you considered, not just the question.
