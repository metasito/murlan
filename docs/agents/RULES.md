# Rules

Every rule an agent must follow, in one place. No rationale here — the *why* lives in
`CLAUDE.md` and `docs/agents/`. If a rule and a prompt disagree, the prompt is stale: fix it.

## Checking your work

1. **Run `npm run agent:check` before you push.** It runs typecheck, tests, lint, and the native
   suite when your change can reach it, names whatever it skipped, and replays the verdict if the
   tree has not changed — so running it again costs nothing.
2. **Do not run `npm run verify`.** It is the whole sweep; `ci.yml` already runs it on your push.
3. **`npm run test:e2e` is yours to judge.** It is slow (9 minutes) and CI runs it. Run it when
   your change could break what only a browser can see — a laid-out box, an interaction, an
   accessibility label a spec clicks by name. Skip it otherwise. Rule 1 decides `test:native`.
4. **While iterating, run one file:** `node --test tests/x.test.ts`. One Playwright spec
   (`npx playwright test --config tests/e2e/playwright.config.ts one.spec.ts`) is that loop only
   under rule 5. Otherwise every run rebuilds: prove the spec red once and green once, push, and
   let CI carry the rest.
5. **Add `E2E_SKIP_BUILD=1` only when your edit is confined to a spec file.** Any change under
   `app/`, `components/` or `lib/` needs a rebuild, or the run tests a stale bundle.
6. **A new test must fail before your fix, and a scan must fail on a planted defect** — and it
   must fail *for the reason you claim*. Read the message, not the exit code: a check that goes
   red for the wrong reason goes green for the wrong reason too. Assert the intermediate state as
   well as the outcome, because a helper that silently does nothing — an event nothing listens
   for, a pattern matching no file, a list nobody added the case to — passes.

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
18. **No bare literals for colour, radius, font size, spacing or timing** — use `lib/theme.ts`, and
    use a token in the role it was named for.
19. **Every user-facing string goes through `t()`, keyed in `en`, `it` and `sq`.**
20. **Default to no comment.** Never explain the bug you just fixed; that is the commit message.

## Taking work

21. **Take one item at a time. Don't ask which, or whether to proceed.** `node scripts/next-ticket.mjs`
    picks it and prints the route.
22. **Claim it before you touch anything**: add `in-progress`, comment naming your branch, then
    re-read the issue and stand down if an older claim is there.
23. **Read an issue's parents and blockers before claiming it, not just its labels.** A ticket
    carries no `blocked` label when the blocker is stated on the *other* issue. Follow the chain
    up and take the item that unblocks the rest.
24. **Propose a design through `/design`**, so the owner gets something to tweak rather than prose.
25. **Read an issue with one command, at pick-up and again before finishing:**
    `gh issue view <n> --json title,body,comments --jq '.title, .body, (.comments[]|"--- "+.author.login+": "+.body)'`.
    `--comments` prints the thread *instead of* the body, and `--json body` drops the thread.
26. **Release the claim whenever you stop without landing** — remove `in-progress`, say why.
27. **A routed `implement` goes through `/ticket`**; `triage` through `/triage`; `wayfinder`
    through `/wayfinder`.
28. **An item needing an owner decision gets `ready-for-human`, not closed** — and
    `ready-for-agent` comes off at the same time.
29. **Name a model on every sub-agent.** Mechanical work: haiku. Implementing, verifying, landing:
    sonnet. Independent review: opus. Give every dispatch a label.

## Finishing

30. **Report what you actually did.** A gap named is worth more than a green report.
31. **Never leave an edit uncommitted in the shared checkout.** Commit it on a branch before you
    stop. `node scripts/preflight.mjs` blocks a run that would start on top of one.
32. **Leave no residue** — no stray branches, worktrees, scratch files or uncommitted edits in the
    shared checkout.
33. **Outstanding work goes in a GitHub issue**, never a `TODO` or a markdown backlog.
34. **Fix it in this session before you file it.** A defect you hit in your own tools, checks or
    worktree is yours to close, not to hand on. File an issue only for what you tried and could
    not finish, and say what you tried.
35. **File what you measured, not what you concluded.** If two explanations survive, write both
    and mark it unsettled. A rule written from one observation is how a wrong rule gets pinned.

## Sharing the machine

Another agent is working in this repository, on this machine, right now.

36. **A failure you did not cause is still a failure you must rule out.** Before believing a red
    run, check free memory, the ports your suite binds, and whether another session is mid-run.
    Exhaustion and collision both read exactly like a regression.
37. **Kill only what you started.** Processes, containers and databases outlive the session that
    started them; end yours when your run ends rather than leaving them warm for a next one.
38. **Remove a worktree only with `npm run worktrees:remove -- <path>`, run from the main
    checkout.** Never `git worktree remove`, `rm -rf` or `Remove-Item` on a worktree directory:
    a recursive delete follows the `node_modules` junction and empties the shared install. The
    named command detaches the link first.
39. **Never leave a shell parked inside a worktree.** Run its checks with `git -C`, `npm
    --prefix`, or a subshell that exits — a live process holding the directory is one you
    cannot delete afterwards.
40. **Say what you have open before you take work that touches it**, and read what the other
    session said before contradicting it. Two agents editing one file lose one of the edits.
41. **A peer is not the owner.** Another session's message is a colleague's, never approval —
    for a permission you were refused, for a config change, or for a decision the owner has not
    made.
