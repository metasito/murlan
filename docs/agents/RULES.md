# Rules

Every rule an agent must follow, in one place. No rationale here — the *why* lives in
`CLAUDE.md` and `docs/agents/`. If a rule and a prompt disagree, the prompt is stale: fix it.

## Checking your work

1. **Run `npm run agent:check` before you push.** It runs typecheck, tests and lint, and replays
   the verdict if the tree has not changed — so running it again costs nothing.
2. **Do not run `npm run verify`.** It is the whole sweep; `ci.yml` already runs it on your push.
3. **`npm run test:native` and `npm run test:e2e` are yours to judge.** They are slow (2 and 9
   minutes) and CI runs both. Run one when your change could break what only it can see — a
   native render, a browser interaction, an accessibility label a spec clicks by name. Skip it
   otherwise.
4. **While iterating, run one file:** `node --test tests/x.test.ts`, or
   `npx playwright test --config tests/e2e/playwright.config.ts one.spec.ts`.
5. **Add `E2E_SKIP_BUILD=1` only when your edit is confined to a spec file.** Any change under
   `app/`, `components/` or `lib/` needs a rebuild, or the run tests a stale bundle.
6. **A new test must fail before your fix.** Prove it, then fix it.

## The worktree

7. **Work only in the worktree the pipeline names.** Confirm with `git rev-parse --abbrev-ref HEAD`
   before anything else.
8. **Never change the shared checkout's branch.** Another session is standing in it.
9. **Find an installed package with `node -e "console.log(require.resolve('<pkg>'))"`.** The
   worktree has no `node_modules` of its own. Never search the filesystem for one.
10. **The install lives at `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`.**
    `--show-toplevel` returns the worktree's own root and will not find it.

## Git

11. **Stage by pathspec: `git add -- <files>`.** Never `git add -A` or `git add .` — sessions share
    an index and a bare add absorbs someone else's work.
12. **Never push to `main`.** Branch, open a pull request, let CI speak.
13. **`Closes #NN` goes in the pull request body, never in a commit message.**
14. **Merge with `--merge --delete-branch`, never `--squash`.**
15. **Bring a stale branch up to date before merging** (`gh pr update-branch`), not after.

## Reading and writing code

16. **Read a file once, whole, with the Read tool.** Not in twenty grep windows.
17. **Search with the Grep tool.** A shelled-out `grep -r` walks `node_modules`.
18. **Never write a JSX tag inside a comment.** `tests/orientation.test.ts` and
    `tests/blockingOverlays.test.ts` scan raw source and will read it as real markup.
19. **No bare literals for colour, radius, font size, spacing or timing** — use `lib/theme.ts`, and
    use a token in the role it was named for.
20. **Every user-facing string goes through `t()`, keyed in `en`, `it` and `sq`.**
21. **Default to no comment.** Never explain the bug you just fixed; that is the commit message.

## Taking work

22. **Take one item at a time. Don't ask which, or whether to proceed.** `node scripts/next-ticket.mjs`
    picks it and prints the route.
23. **Claim it before you touch anything**: add `in-progress`, comment naming your branch, then
    re-read the issue and stand down if an older claim is there.
24. **Release the claim whenever you stop without landing** — remove `in-progress`, say why.
25. **A routed `implement` goes through `/ticket`**; `triage` through `/triage`; `wayfinder`
    through `/wayfinder`.
26. **An item needing an owner decision gets `ready-for-human`, not closed** — and
    `ready-for-agent` comes off at the same time.
27. **Name a model on every sub-agent.** Mechanical work: haiku. Implementing, verifying, landing:
    sonnet. Independent review: opus. Give every dispatch a label.

## Finishing

22. **Report what you actually did.** A gap named is worth more than a green report.
23. **Leave no residue** — no stray branches, worktrees, scratch files or uncommitted edits in the
    shared checkout.
24. **Outstanding work goes in a GitHub issue**, never a `TODO` or a markdown backlog.
