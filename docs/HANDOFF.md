# Handoff — start here in a new session

## Establish reality first, before doing anything

```bash
cd C:/Users/roton/murlan
git log --oneline -5
git status --porcelain
npm run verify        # typecheck + unit/integration + native
npx expo lint         # must be ZERO warnings; CI enforces it
```

Do not trust this file over the commands. It ages; they do not.

## Where things stand

Green: typecheck clean, `expo lint` zero, the unit and integration suites, the
native renderer suites (jest-expo, ios+android projects), and a Playwright E2E
suite (`npm run test:e2e`) that plays complete games through the UI, drops the
network mid-game to check the reconnect path, sweeps every screen for controls
a player can see but cannot press, and measures that no part of the table
renders off the side of the screen.

No counts here on purpose — they age between batches. `npm run verify` is the
truth.

Integration tests need a database. `node scripts/dev-stack.mjs up` starts a
local Postgres in Docker and prints the `DATABASE_URL` to export; without it
those suites skip and CI fails on the skip message rather than passing
vacuously.

Five test layers, mapped in `docs/TESTING.md`.

## Read these, in order

1. `CLAUDE.md` — binding rules. § Comments, § Working agreement and
   § No self-defeating safeguards especially.
2. `docs/BACKLOG.md` — the single work queue. §1 is ordered cheapest-first and
   marks what is done; §2 is owner-blocked; §3 is analysis already settled, so
   it is not re-litigated; §4 is rejected-with-reasons.
3. `docs/RULES.md` — canonical game rules and the sources they came from.
4. `docs/BRIEF.md` §3.1 — rule decisions already taken.

## Regenerated, not hand-authored

Three artefacts are build outputs. Edit the script, not the result:

- `assets/sounds/` — `node scripts/build-sounds.mjs`
- `assets/images/cards/` — `node scripts/build-court-art.mjs`
- `docs/BUNDLE.md` — `node scripts/bundle-report.mjs > docs/BUNDLE.md`

## Needs the owner, not more effort

EAS submit credentials · push credentials and a privacy-policy entry for Q23 ·
the 432×432 monochrome icon · a native Albanian speaker for idiom · real-device
VoiceOver. `docs/BACKLOG.md` §2 is the full list with what each one needs.

`server/schemaDdl.ts` applies `shared/schema.ts` on every server start, so a new
table or column ships with the deploy that introduces it, and a database Replit
has just reprovisioned works on the first boot. `npm run db:push` is left for
destructive reconciliation only.

**One exception is outstanding.** Batch 13 renamed `active_games.room_code` and
`match_replays.room_code` to `room_id`, which is destructive and boot refuses to
carry out: `assertRenamesApplied()` throws, so the server will not start against
a database still holding the old columns. `npm run db:push` has to run against
production before or with that deploy. `audit/2026-08-17/OWNER-TODO.md` carries
the detail.

`drizzle.config.ts` still excludes the `session` table from push, because
otherwise a push that adds a table asks whether the new one is a *rename* of
`session` — and answering yes logs out every account.

## How to work here

No questions — decide and proceed. One backlog item, one commit, verified
before moving on. Flag rather than build: game-rule changes and business
decisions. Never claim success without pasted output.

A failing test is not a regression until you have seen it pass somewhere else.
Three E2E failures here were machine contention and a fourth was a genuine
timeout on an unlucky deal; the way that was settled was building a worktree at
the commit before the suspect change and watching it fail identically. Check
the parent commit before believing your own diff caused something.

A screenshot raises a suspicion; it does not settle one. Four apparent layout
defects in the UI audit evaporated once each scroll area was actually scrolled,
and two "fixes" written before testing turned out to change nothing and were
reverted. Confirm in the code, or with a DOM probe, before calling something a
defect — and when checking that a new test can fail, revert the fix for real:
`git stash` on an already-committed change stashes nothing and passes
vacuously.
