# Murlan

Traditional Albanian card game (Big Two family), as an Expo app served as web by an
Express + Socket.io server on Replit. **English (`locales/en.ts`) is the source of truth for
UI copy**; Italian and Albanian are translations of it. A *manche* is one hand; a *partita*
is the match they add up to. **Every key in English must exist in every locale, no
exception** — `it.ts` and `sq.ts` are `Record<keyof typeof en, string>`, so a gap is a
compile error.

**This file is only what you cannot get by reading the code.** Stack, file layout and game
rules are deliberately absent — `package.json`, `ls`, and `docs/RULES.md` are authoritative
and never go stale.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`metasito/murlan`), via the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by
`/domain-modeling`). See `docs/agents/domain.md`.

---

## Replit — breaking any of these takes production down

- Port from `process.env.PORT`, database from `process.env.DATABASE_URL`.
- `DATABASE_URL`, `SESSION_SECRET`, `PORT` must be set in Replit Secrets.
- No build step needing local tooling. Must launch from the Run button with no setup.
- **Production runs Node 22** (`.replit` `modules`). CI's `build` job — the one that boots the
  real artefact — runs 22; the other two check dev tooling and run 24. `server:build`'s
  `--target=node22` lowers *syntax* only and has no API database, so a Node-24-only builtin
  compiles at exit 0 and throws on Replit. The Node 22 job is what catches that.
- **`server/schemaDdl.ts` is the only thing that creates tables**, at boot, from
  `shared/schema.ts`. Every statement is additive and idempotent (`tests/schemaDdl.test.ts`).
  A second creator is how `session` came to exist on one database and nowhere else.
- **`session` table** — `createTableIfMissing: false`, deliberately absent from
  `shared/schema.ts`, excluded from drizzle-kit by `tablesFilter` so push never asks whether
  a new table is a rename of it. Clear its rows; never drop it while the server runs.

## Invariants — each is a bug that shipped

Verify against source before changing any.

- **Server authority.** The server validates every move and broadcasts sanitized state.
  Never trust client state for an outcome.
- **Ticket auth only.** The handshake accepts a live session or a single-use ticket. A bare
  `handshake.auth.userId` branch was a full impersonation vector.
- **Listener registration precedes every `await`** in the socket connection handler.
  Socket.io drops events with no listener attached, and the client emits `game:rejoin`
  synchronously on connect.
- **Socket singleton** — one socket per userId via `lib/socket.ts`; `SocketContext` owns the
  lifecycle.
- **Hooks before the null guard** in both game screens — every hook runs before
  `if (!gameState) return null`.
- **A card appears exactly once** in flight/`pileState` — never twice, never zero times.
- **`CARD_W`/`CARD_H` are declared once**, in `components/cardFaceModel.ts`; `gameTableModel.ts`
  re-exports them, and `handLayout.ts` takes a card width in as a parameter rather than
  importing the constant itself. `tests/gameTableModel.test.ts` source-scans for a second
  declaration — pinning the value cannot find one, because a copy holds the same number.
- **Impact feedback is timed to the card landing**, not the throw. `impactDelayMs()`
  (`components/gameTableModel.ts`) is the one place that delay is derived, so the animation
  and the feedback cannot drift apart.
- **Design tokens are used in the role they were named for.** A fill or border token used as
  a text colour renders as almost nothing, silently. Pinned by `tests/tokenRoles.test.ts`.
- **A labelled control exposes one accessible node.** `Pressable` defaults `accessible` to
  true, which does *not* remove children from the tree — hide decorative ones explicitly.
- **Every `<Modal>` declares `supportedOrientations` including landscape**, or iOS rotates
  the app to portrait behind it. Pinned by `tests/orientation.test.ts`.
- **`NotificationBanner`** never returns null, and animates by callback chain — parallel
  `withTiming` calls overwrite the slide-in.
- **`OfflineBanner`** flags offline only on `state.isConnected === false`; `null` is unknown.
- **Game invites** set `pendingInvite` *before* showing the banner. Banner only, no Alert.
- **Game rules** live in `lib/gameEngine.ts`, specified by `docs/RULES.md`. Change them only
  via a decision recorded in `docs/BRIEF.md` §3.1.

## Comments

**Default is no comment.** Code is the documentation. Before keeping one, ask: would a
competent reader learn something the code wouldn't have told them in ten seconds? If not,
delete it — rename or extract instead.

Four things earn one: an invisible constraint (an ordering that prevents a race, a platform
quirk); a *why* where the obvious approach is wrong and someone will "fix" it back; a
contract the types can't carry; a pointer to the authority.

Never: restating the line below; any history of what it was or when it was fixed;
**explaining the defect you just fixed** — that belongs in the commit message. The code
should read as if the bug never happened. A change adding more comment lines than code
lines is explaining itself instead of being clear.

## Design system

- **No bare literals for colour, radius, font size, spacing or timing** — all from
  `lib/theme.ts`. `eslint.config.js` refuses a bare number for radius, font size and
  spacing only; colour and timing are convention, caught in review or not at all. A
  component-local one-off may be a named module constant. `0` is still a plain `0`.
- Gold is a five-step alpha scale (`goldGhost` … `goldStrong`). Pick by role; don't add a
  sixth to split the difference.
- Menu screens use `MenuLayout` / `MenuCard` / `MenuButton`; `app/lobby.tsx` is the
  reference. The game tables, `app/index.tsx` and `app/result.tsx` are deliberately exempt.
  **A local
  component must not share a name with a shared one** — a duplicate `MenuButton` once hid a
  bug in plain sight.
- **Every user-facing string goes through `t()`**, keyed in all three locales.
- `Shadow.*` is platform-aware. Game screens are landscape-locked; menus do both via
  `useWindowDimensions`. Use `useSafeAreaInsets()` in game and layout components.

## Working agreement

- **Autonomy.** Work the queue one item at a time, one commit per item. The queue is
  `gh issue list --label ready-for-agent --state open --search "-label:in-progress"`,
  smallest `size:*` label first. Don't
  ask which item or whether to proceed. Commit and push yourself — don't wait to be asked —
  then `gh run watch` **the pull request's run** and close the issue only once it is green;
  red CI is the next thing you work on, not something to leave behind. Never watch `main`'s
  run: it is either the same tree skipped, or a duplicate of a result you have already read,
  and watching it blocks for the whole suite to say nothing new. Keep `Closes #NN` out of the
  commit message: it closes the issue at push time, before CI has said anything.
- **Claim the item before working it.** Sessions run in parallel, and every one of them
  authenticates as the same GitHub account — an assignee says who owns the repo, not who
  owns the item, so the claim is `in-progress` plus a comment naming the branch. It is the
  session's *first* write, before the branch and before reading the code: a claim made after
  the work is a claim made after the collision. Then re-read the issue, because two sessions
  can list the same free queue a second apart — if a claim older than yours is there, drop
  yours and take the next item. Release it whenever you stop without landing it, including
  the hand-off to `ready-for-human`; closing the issue releases it for you. A claim whose
  branch exists in neither `git ls-remote --heads origin` nor `git worktree list` is stale,
  and taking it over is fine once you have said so on the issue.
  `docs/agents/issue-tracker.md` has the commands.
- **Work on a branch, land through a pull request.** Never push an item straight to `main`.
  A change that turns out to be wrong goes red on the pull request, where it costs one run
  and nothing else; pushed to `main` it goes red on `main`, and the next person starts from
  a broken tree. **The merge costs a second run only if you let it.** `ci.yml`'s `scope` job
  skips a `main` push whose tree the pull request already passed — it compares the merge
  commit's tree against the pull request head's, so they match only while `main` has not
  moved underneath. Once it has, the merge builds a tree nothing has tested and the whole
  suite runs again, billed. So before merging, bring the branch up to date
  (`gh pr update-branch`) and let the pull request go green on *that* tree: one run either
  way, instead of one on the branch and a second on `main`. An item that turns
  out to need an owner-level call gets relabelled
  `ready-for-human` (not closed) and the next item is taken. When no
  `ready-for-agent` issue remains, run `superpowers:brainstorming` and file what it finds
  with `mattpocock-skills:to-tickets`.
- **A second session works in a worktree, and removes it after.** One checkout cannot hold two
  agents: switching branches under a session that has uncommitted work is how both lose it. Take
  a worktree instead, and delete it once the pull request has merged — a worktree left behind is
  a stale second copy of the tree, and its `npm install` is a second `node_modules`.
- **Don't rehearse CI locally.** `.github/workflows/ci.yml` runs typecheck, `npm test`, lint,
  `test:native`, `test:e2e` and a build-and-boot on every push. Running that same sweep before
  pushing doubles the time per item and tells you nothing the run won't. Push, then
  `gh run watch` the pull request — and take the verdict from `gh run view --json conclusion`,
  never from the watcher's own exit status. Piped into anything, that status belongs to the
  pipe's last command, so `--exit-status` is discarded and a failed run reads as a pass. That
  is how a red branch reached `main`. What *is* worth running locally is the narrow thing CI
  can't give you:
  a single test file while you iterate on it, proving a new test fails before the fix, or any
  check CI does not cover. If CI does not run it, run it yourself. Lint is worth the 25
  seconds: it fails on a single unused variable, and it is the last job to run.
- **Merge the moment the run is green.** `ci.yml`'s `scope` job skips a `main` push whose tree
  a pull request already passed, and that holds only while `main` has not moved. A run takes
  about seven minutes, and every minute a green pull request waits is a minute another session
  can land — after which the merged tree is one no run has tested, so the whole suite runs
  again. Rebasing onto current `main` first does not avoid that: it buys a second
  pull-request run instead, which costs the same. The window is the only lever there is.
- **No workarounds.** If the correct fix is bigger, do the correct fix. Look up current best
  practice rather than guessing.
- **Design first** for anything touching storage, the socket protocol, or many files.
- **The database holds accounts now.** Beta testers have them, so dropping and recreating is
  no longer free: `pg_dump` first, and read `db:push`'s rename-or-drop prompt rather than
  accepting it — answering it wrong deletes the column's data (`docs/DEPLOY-RUNBOOK.md`).
  Order a change by design, not by deploy cost: derive from existing rows → ride an existing
  jsonb column → new table → new column.
- **Outstanding work lives only in GitHub Issues** (`metasito/murlan`) — never a `TODO`
  comment, never a markdown backlog. Elsewhere, point at an issue number (`#45`); never copy
  its content. A second copy goes stale. Labels: `needs-triage` / `needs-info` /
  `ready-for-agent` / `ready-for-human` / `rejected`, plus `size:XS`…`size:XL`. See
  `docs/agents/issue-tracker.md`.
- **Leave no residue.** Implemented design docs, superseded plans and scratch scripts get
  deleted, not archived. A claim that no longer holds is removed the moment it's found.
- **No self-defeating safeguards.** Never ship a guard together with the thing that gets past
  it. **The tell is the justifying comment.** A guard needs a *floor* as well as a trigger:
  prove it fails both on the defect and on the null case where it inspects nothing. It keeps
  recurring, and every instance was verified by its author before it shipped.

## Known pitfalls

- `Cannot read property 'cards' of null` — null-check game state before `.cards`.
- `REPLACE navigation action not handled` — the `index` route must exist before navigating.
- React Compiler can miscompile `useEffect` references. It comes from
  `babel-preset-expo`'s own dependency — do not add a second copy to `package.json`;
  `tests/reactCompiler.test.ts` pins that there is only one.
- **No unit test can see a layout bug.** `@testing-library/react-native` runs on
  `react-test-renderer`, which never runs flexbox, so no native test can assert which side of
  a seat a card fan renders on. Only `tests/e2e/` (Playwright) catches this class — a card fan
  rendered off-screen for months against a green native suite.
