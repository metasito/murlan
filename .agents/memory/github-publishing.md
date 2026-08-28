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

**Observed failure mode:** `git push`/`gh api ... update-branch` can fail with
a real 403 ("Permission ... denied" / "Resource not accessible by personal
access token") because the workspace's `GITHUB_TOKEN` secret is scoped without
Contents:write, even though it authenticates fine for reads. Reproposing the
GitHub connector/connection to fix this can loop forever: `searchIntegrations`
reports the connection `not_added`, but attaching it fails with "This Repl
already has a github connection assigned" — the connection is stuck attached
at the platform level while unusable to the agent. Retrying the same
propose/attach cycle repeatedly does not resolve it. Escalate to the user
after one confirmed loop instead of retrying further: they can push from the
Replit Git pane / their own machine, or supply a scoped PAT as a secret.

**Resolution that worked:** ask the user to run the interactive device-code
flow themselves rather than looping on connector reattachment. The workspace
`GITHUB_TOKEN`/`GH_TOKEN` env vars pre-empt `gh`'s own credential, including
during `gh auth login --web`, so start it as
`env -u GITHUB_TOKEN -u GH_TOKEN gh auth login --hostname github.com --git-protocol https --web`,
hand the printed one-time code and URL to the user, wait for their
confirmation, then run `env -u GITHUB_TOKEN -u GH_TOKEN gh auth setup-git` and
push/merge with those two vars unset. A repo collaborator role alone did not
fix the 403; the account-level OAuth token from this flow did. Also: a `git
worktree` can silently go stale (`git worktree list` shows it `prunable`, its
`.git` file points at a missing dir) — commands run from inside it then
silently operate on the *outer* repo's checked-out branch instead of erroring,
which can create a stray commit on the wrong branch (e.g. `main`) without any
warning. Always confirm `git branch --show-current` matches expectations after
`cd`ing into a worktree, especially after any prior worktree trouble in the
session; `git worktree remove --force` + re-`add` repairs it (the commit
object and branch ref survive in the shared store regardless).