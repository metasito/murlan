---
name: GitHub publishing fallback
description: Safe publishing behavior when the workspace Git credential or connector is unavailable.
---

Do not weaken the dev-sync hook's clean-worktree and fast-forward-only rules
just to accommodate an un-published local `main` commit or an unavailable
GitHub connector.

**Why:** A local Git credential can be invalid while an OAuth connection shows
as attached but remains unavailable to the automation runtime. Forcing a reset
or merge in that state risks losing local work and makes a future push harder
to reason about.

**How to apply:** Keep the local `main` history intact, verify it is clean,
and use a securely stored repository write credential (or the Git UI) to
publish. Only then can a GitHub push action trigger the signed Replit dev hook.