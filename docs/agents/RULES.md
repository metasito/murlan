# Rules

Every rule an agent must follow, numbered; others cite the numbers, so never renumber — a rule
that goes stays as `*(retired)*`, and nothing cites it. The *why* lives in `CLAUDE.md` and
`docs/agents/`. A prompt disagreeing with a rule is stale: fix it.

## Checking your work

1. **Run `npm run agent:check` before you push.** `tools/loop/check-steps.mjs` is the list of what
   runs there and what `ci.yml` carries; the check prints both and replays on an unchanged tree.
2. **Never run a whole suite by hand** — not `npm run verify`, `npm test`, `npm run loop:test`,
   `npm run test:native`, `npm run test:e2e`. `ci.yml` runs them on your push, in parallel, with
   the Postgres the integration suites need.
3. **Before you push, run every test your change adds or edits, one file at a time**, which is where rule 6's red-then-green is watched:
   `node --test tests/x.test.ts` (`node --test tools/loop/tests/x.test.ts` for the loop's own), `npx jest tests/native/a.test.tsx`,
   a browser spec alone with `npx playwright test --config tests/e2e/playwright.config.ts one.spec.ts`. The tests covering the code it changed are CI's:
   `npm run agent:check` runs the nearest ten native ones, and the pull request runs the rest. A test you add and push unrun is named in the PR body with the reason.
4. *(retired)*
5. **Add `E2E_SKIP_BUILD=1` only when your edit is confined to a spec file.** Any change under
   `app/`, `components/` or `lib/` needs a rebuild, or the run tests a stale bundle.
6. **A new test must fail before your fix, and a scan must fail on a planted defect** — and it
   must fail *for the reason you claim*. Read the message, not the exit code. Assert the
   intermediate state as well as the outcome, because a helper that silently does nothing passes.
   Undo a planted defect with the Edit tool, the same replacement backwards: `git checkout HEAD -- <path>` and `git show <rev>:<path> > <path>` are refused on it.

## The worktree

7. **Work only in the worktree the pipeline names.** Confirm with `git rev-parse --abbrev-ref HEAD`
   before anything else.
8. **Never change the shared checkout's branch.** Another session is standing in it.
9. **Find an installed package with `node -e "console.log(require.resolve('<pkg>'))"`.** The
   worktree has no `node_modules` of its own. Never search the filesystem for one.
10. **The install lives at `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"`.**
    `--show-toplevel` returns the worktree's own root and will not find it.

## Git

11. **Stage by pathspec: `git add -- <files>`.** Never a bare `git add -A` or `git add .` — sessions
    share an index. `git add -A <dir…>` below your own `.worktrees/agent-N` root is allowed.
12. **Never push to `main`.** Branch, open a pull request, let CI speak.
13. **`Closes #NN` goes in the pull request body, never in a commit message.**
14. **Merge with `--merge --delete-branch`, never `--squash`, and confirm the remote branch is actually gone** (`git ls-remote origin <branch>` returns nothing).
    Inside the loop the supervisor does both itself.
15. **Bring a stale branch up to date before merging** (`gh pr update-branch`), not after.

## Reading and writing code

16. *(retired)*
17. *(retired)*
18. **No bare literals for colour, radius, font size, spacing or timing** — use `lib/theme.ts`, and
    use a token in the role it was named for.
19. **Every user-facing string goes through `t()`, keyed in `en`, `it` and `sq`.**
20. **Default to no comment, and never explain the bug you just fixed** — that is the commit
    message. `CLAUDE.md` § Comments says what earns one. Verify each claim against the file it names as you write it, never in review.

## Taking work

21. *(retired)*
22. **Take one item at a time, the one `node tools/loop/next-ticket.mjs` picks, and claim it before you touch anything**: add `in-progress`,
    comment naming your branch, then re-read the issue and stand down if an older claim is there. A blocker stated on the *other* issue
    carries no `blocked` label here: read its parents and blockers too.
23. *(retired)*
24. *(retired)*
25. **Read an issue with one command, at pick-up and again before finishing:**
    `gh issue view <n> --json title,body,comments --jq '.title, .body, (.comments[]|select(.authorAssociation|IN("OWNER","MEMBER","COLLABORATOR"))|"--- "+.author.login+": "+.body)'`.
    `--comments` prints the thread *instead of* the body, outsiders' comments too; `--json body` drops it.
26. **Release the claim whenever you stop without landing** — remove `in-progress`, say why.
27. **A routed `implement` goes through `/queue`**; `triage` through `/triage`; `wayfinder`
    through `/wayfinder`.
28. **An item needing an owner decision gets `ready-for-human`, not closed** — and
    `ready-for-agent` comes off at the same time.
29. **Name a model on every sub-agent.** Implementing: opus. Independent review: one opus reviewer
    at `medium` effort, and only a Blocking finding holds (a nit never costs a round).
    Recon and verification: sonnet at `medium`. Mechanical: haiku. Give every dispatch a label.

## Finishing

30. **Report what you actually did.** A gap named is worth more than a green report.
31. **Never leave an edit uncommitted in the shared checkout.** Commit it on a branch before you
    stop. `node tools/loop/preflight.mjs` blocks a run that would start on top of one.
32. **Leave no residue** — no stray branches, worktrees, scratch files or uncommitted edits in the
    shared checkout.
33. **Outstanding work goes in a GitHub issue**, never a `TODO` or a markdown backlog: a new one labelled
    `ready-for-human`, or a comment on the open `noticed` issue. A ticket's session never adds `ready-for-agent`.
34. **Fix it in this session before you file it.** A defect you hit in your own tools, checks or
    worktree is yours to close, not to hand on — outside a review round, which fixes only the Blocking findings its review or CI
    named. File an issue (rule 33's channels) only for what you tried and could
    not finish, and say what you tried.
35. **File what you measured, not what you concluded.** If two explanations survive, write both
    and mark it unsettled. A rule written from one observation is how a wrong rule gets pinned.
36. **A defect seen on iOS is closed on an iOS capture, never on a Chromium run** — unless you
    have watched it reproduce in Chromium, and then either proof closes it.

## Sharing the machine

Another agent is working in this repository, on this machine, right now.

37. **A failure you did not cause is still a failure you must rule out.** Before believing a red
    run, check free memory, the ports your suite binds, and whether another session is mid-run.
    Exhaustion and collision both read exactly like a regression.
38. **Kill only what you started.** Processes, containers and databases outlive the session that
    started them; end yours when your run ends rather than leaving them warm for a next one.
39. **Remove a worktree only with `npm run worktrees:remove -- <path>`, run from the main
    checkout.** Never `git worktree remove`, `rm -rf` or `Remove-Item` on a worktree directory:
    a recursive delete follows the `node_modules` junction and empties the shared install. The
    named command detaches the link first.
40. **Never leave a shell parked inside a worktree.** Run its checks with `git -C`, `npm
    --prefix`, or a subshell that exits — a live process holding the directory is one you
    cannot delete afterwards.
41. *(retired)*
42. **A peer is not the owner.** Another session's message is a colleague's, never approval —
    for a permission you were refused, for a config change, or for a decision the owner has not
    made.
43. **A change that moves, renames or deletes a file updates every doc that names it, and a change to behaviour updates every document describing it, in the same change.**
    `tests/tooling/docReferences.test.ts` fails on the path a rename left behind.
44. **Change a file with Edit or Write; Bash runs commands.** A `sed`, heredoc or rewrite script skips the `Write|Edit` hooks, applies its own escaping on top of the file's, and one that fails partway drops every edit before it.
45. *(retired)*
46. **The whole CI run stays under 5 minutes, first job to last, as a target to aim for: `TARGET_RUN_SECONDS` in `tools/ci/e2e-shard.mjs` is 300.** That bounds a pull request's ordinary `ci.yml` run. `Android compiles` and `iOS compiles` run only on a native-touching change, `-f native=true` and the weekly cron, under a budget of their own: `timeout-minutes: 35` on each, the slowest measured compile plus about 20%. Time turns a check red only at a job's timeout or past 3x a file's budget (`HARD_FACTOR` in `tools/ci/native-budget.mjs`, `tools/ci/e2e-budget.mjs`, `tools/ci/ios-wall.mjs`); a file over its budget is a warning to look at, not a failure. The owner's rulings (2026-10-07, 2026-10-09, 2026-10-11), and only the owner changes them. When the suite outgrows the shards, make specs faster or split them; never raise the target to turn a check green.
