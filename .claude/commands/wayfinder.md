---
description: Work one wayfinder child against its map — resolve the question, record the decision, redraw the fog.
argument-hint: "[loop]"
allowed-tools: Read, Grep, Glob, Write, Edit, Skill, WebSearch, WebFetch, Bash(node tools/loop/next-ticket.mjs), Bash(gh issue:*), Bash(gh api:*)
---
Every rule you follow while doing this is in `docs/agents/RULES.md` — read it first.

Work the routed wayfinder child. `$ARGUMENTS` empty: **one child, then stop**. `loop`: **child
after child** until the user says stop or the route stops being `wayfinder`; say which.

1. **Pick.** Run `node tools/loop/next-ticket.mjs` and take the child it prints only if the route
   is `wayfinder`; otherwise stop and say so. The picker reaches this route when nothing in the
   implement frontier is *takeable* and nothing needs triage.
2. **Check the child's native blockers and assignee yourself.** `pickRoute()` returns
   `buckets.wayfinder[0]` with no `takeable()` check, so the route can hand over a child that
   should not be worked. Blocked or assigned: say so, leave it, take the next.
3. **Claim before the first write** — `docs/agents/issue-tracker.md` → *Picking and claiming*.
4. **Run `mattpocock-skills:wayfinder`** and follow it. It owns the map, the child types, the
   Decisions-so-far / Fog structure and the refer-by-name rule. Tracker specifics are in
   `issue-tracker.md` → *Wayfinding operations*.
5. **A `wayfinder:prototype` child's code is evidence, not a deliverable.** Build it in a scratch
   directory outside the repo and delete it once the answer is on the issue. No branch, no pull
   request; an answer worth shipping becomes a new ticket for the queue.
6. **Resolve** with a decision. If it is genuinely the owner's call, put the **option space** on
   the child — what each option costs and what it forecloses — label it `ready-for-human`, release
   the claim, and take the next. A bare question is not a finished ticket. Closing the child
   releases it.
7. **Report**, per child, two lines: the number and the question it asked, then the answer and
   what moved on the map because of it.

Nothing lands on `main` from here, and no pull request is opened.
