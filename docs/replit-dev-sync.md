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