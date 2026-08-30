# Replit dev sync

The dev preview is kept current by a GitHub push hook rather than by polling.
The `main` push workflow calls `/api/hooks/github` with a signed request. The
dev server fast-forwards the workspace to `origin/main`, then the backend and
frontend Replit workflows restart their child processes from the new checkout.

## GitHub configuration

Configure these two repository values:

- Variable `REPLIT_DEV_HOOK_URL`: the dev server URL ending in
  `/api/hooks/github`, for example
  `https://<replit-dev-domain>:5000/api/hooks/github`
- Secret `REPLIT_DEV_HOOK_SECRET`: the same value as the Replit Secret with
  this name

The action only runs for pushes to `main`. Its concurrency group cancels an
older notification when a newer main push arrives.

## Safety behavior

- The hook requires `X-Hub-Signature-256` and refuses requests without the
  configured Replit secret.
- Only `push` events for `refs/heads/main` are accepted.
- The workspace must be clean. Dirty or untracked files cause the sync to
  return a conflict instead of stashing, overwriting, or deleting anything.
- The sync uses `git merge --ff-only origin/main`; it never creates a merge
  commit from the hook.
- The Replit workflow processes remain running. A successful sync writes a
  short-lived restart signal, and each workflow supervisor restarts only its
  own backend or Expo child process.

## When a sync is refused

A refusal answers `409` with `code: "DEV_SYNC_FAILED"` and a `reason`. The
workflow files that reason into a GitHub issue, because the only party that
sees this failure runs on another machine and cannot read the preview's log.

`reason` carries the sentence for a refusal the hook decided on — a workspace
that is not clean, a local `main` that has diverged. Any other failure is a git
command's own, and its message quotes git's stderr, which carries the remote
URL and so the token in it; those say only that the detail is in the preview's
log. The endpoint is dev-only and 404s under `NODE_ENV=production`, but this
repository is public and the issue is too.

The running commit is on `/health` as `commit`, which is how to tell what the
preview is actually serving without opening a shell on it.