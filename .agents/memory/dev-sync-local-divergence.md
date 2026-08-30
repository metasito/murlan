---
name: Dev-sync divergence guard vs local-only commits
description: Why the GitHub->Replit dev-sync webhook can permanently start refusing to sync, and how to unstick it.
---

The dev-sync webhook (`server/devSyncHook.ts`, `.github/workflows/replit-dev-sync.yml`) refuses to
auto-fast-forward the workspace checkout whenever local `main` has a commit `origin/main` doesn't
have (true divergence), returning `DEV_SYNC_FAILED`. This is a deliberate safety guard so it never
silently discards local work — but it means the workspace stops auto-syncing on *every* subsequent
push until someone manually reconciles it, with no self-healing.

**Why:** this environment's checkpoint system can auto-commit local changes (e.g. an attached file
saved into the repo) without pushing them. One such stray local commit is enough to diverge local
`main` from `origin/main` and permanently block the sync hook, even though the commit itself was
trivial/unwanted.

**How to apply:** never leave a commit sitting on local `main` without pushing it in the same breath.
If the dev-sync webhook starts returning `DEV_SYNC_FAILED` (check the `reason` field if present, or
compare `git log main..origin/main` / `git log origin/main..main`), diagnose divergence first. If the
local-only commit(s) are disposable, `git reset --hard origin/main` to reconcile, then restart the
`Start Backend` workflow so it picks up the new code (and check `/health`'s `commit` field to confirm).
Do not assume "the webhook fired successfully" (Action shows `success`) means the sync actually
applied — check `updated` in the response body and the `/health` commit SHA to be sure.
