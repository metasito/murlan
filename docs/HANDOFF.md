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

Green: typecheck clean, `expo lint` zero, 672 unit and integration tests, 220
native tests (jest-expo, ios+android projects), and a Playwright E2E suite
(`npm run test:e2e`) that plays complete games through the UI, drops the
network mid-game to check the reconnect path, and sweeps every screen for
controls a player can see but cannot press.

Those counts age. `npm run verify` is the truth.

Integration tests need a database. `node scripts/dev-stack.mjs up` starts a
local Postgres in Docker and prints the `DATABASE_URL` to export; without it
those suites skip and CI fails on the skip message rather than passing
vacuously.

Five test layers, mapped in `docs/TESTING.md`.

## Read these, in order

1. `CLAUDE.md` — binding rules. Comments, Freedom to change things, and
   No self-defeating safeguards especially.
2. `docs/BACKLOG.md` — the single work queue. §1 is ordered cheapest-first and
   marks what is done; §2 is owner-blocked; §3 is analysis already settled, so
   it is not re-litigated; §4 is rejected-with-reasons.
3. `docs/RULES.md` — canonical game rules, 18 sources.
4. `docs/BRIEF.md` §3.1 — rule decisions already taken.

## Regenerated, not hand-authored

Three artefacts are build outputs. Edit the script, not the result:

- `assets/sounds/` — `node scripts/build-sounds.mjs`
- `assets/images/cards/` — `node scripts/build-court-art.mjs`
- `docs/BUNDLE.md` — `node scripts/bundle-report.mjs > docs/BUNDLE.md`

## Needs the owner, not more effort

`npm run db:push` on Replit — `match_replays` and `user_ratings` do not exist
there yet, so replays and the ladder degrade to empty until it runs · EAS
submit credentials · push credentials and a privacy-policy entry for Q23 · the
432×432 monochrome icon · a native Albanian speaker for idiom · real-device
VoiceOver. `docs/BACKLOG.md` §2 is the full list with what each one needs.

`drizzle.config.ts` excludes the `session` table from push, because otherwise a
push that adds a table asks whether the new one is a *rename* of `session` —
and answering yes logs out every account.

Adding a *column* to a busy table is still worth avoiding: Drizzle's upsert is
one statement, so until `db:push` runs the missing column fails writes that
have nothing to do with the feature. A new *table* fails alone, which is why
replays and ratings each got one and wrap their writes so a game cannot fail
with them.

## How to work here

No questions — decide and proceed. One backlog item, one commit, verified
before moving on. Flag rather than build: game-rule changes and business
decisions. Never claim success without pasted output.

A screenshot raises a suspicion; it does not settle one. Four apparent layout
defects in the UI audit evaporated once each scroll area was actually scrolled,
and two "fixes" written before testing turned out to change nothing and were
reverted. Confirm in the code, or with a DOM probe, before calling something a
defect — and when checking that a new test can fail, revert the fix for real:
`git stash` on an already-committed change stashes nothing and passes
vacuously.
