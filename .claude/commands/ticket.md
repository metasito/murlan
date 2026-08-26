---
description: Work the murlan queue — one item, or looping until told to stop.
argument-hint: "[loop]"
allowed-tools: Bash(npm run ticket), Bash(node scripts/next-ticket.mjs)
---
Every rule you follow while doing this is in `docs/agents/RULES.md` — read it first.

```
npm run ticket
```

That is the whole pipeline: it picks the ticket, claims it, implements, reviews, opens the pull
request, waits on `ci.yml`, fixes a red run and merges. It prints what it did and releases the
claim on every exit path. Never run two at once — both would push to the same branch.

Mode comes from `$ARGUMENTS`: empty means **one item then stop**; `loop` means run it again as
soon as it returns, until the user says stop or it reports nothing takeable.

It implements code and nothing else. When it says the queue routes to `triage` or `wayfinder`,
run `/triage` or `/wayfinder` instead; when the route hands off to the owner, work that item by
hand.

## Report after each item

Two lines, plain language, no file lists:

- **Opened** — issue number and, in one sentence, what it asked for.
- **Closed** — issue number and the *effective diff*: what behaviour is different now. "The hand
  fans from the left edge instead of the centre", not "edited handLayout.ts".
