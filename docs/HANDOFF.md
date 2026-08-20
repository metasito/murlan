# Handoff — start here in a new session

## Establish reality first, before doing anything

```bash
cd C:/Users/roton/murlan
git log --oneline -5
git status --porcelain
npm run verify        # typecheck + unit/integration + native
npm run lint          # whole repo; must be ZERO errors; CI enforces it
```

Do not trust this file over the commands. It ages; they do not.

## Where things stand

Green: typecheck clean, `npm run lint` free of errors, the unit and integration
suites, the native renderer suites (jest-expo, ios+android projects), and a
Playwright E2E suite (`npm run test:e2e`) that plays complete games through the
UI, drops the network mid-game to check the reconnect path, sweeps every screen
for controls a player can see but cannot press, and measures that no part of
the table renders off the side of the screen.

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
2. GitHub Issues (`metasito/murlan`) — the single work queue. `ready-for-agent`,
   smallest `size:*` first; `ready-for-human` is owner-blocked; `rejected` is
   rejected-with-reasons, kept open so it is not re-litigated. See
   `docs/agents/issue-tracker.md`. Settled analysis lives in `docs/adr/`.
3. `docs/RULES.md` — canonical game rules and the sources they came from.
4. `docs/BRIEF.md` §3.1 — rule decisions already taken.

## Regenerated, not hand-authored

These artefacts are build outputs. Edit the script, not the result:

- `assets/sounds/` — `node scripts/build-sounds.mjs`
- `assets/images/cards/` — `node scripts/build-court-art.mjs`
- `assets/images/**/*.png` — `node scripts/optimize-images.mjs`, a lossless
  recompression run in place over whatever the other scripts wrote. Court art
  is optimised by `build-court-art.mjs` itself; the icon, splash and adaptive
  layers are hand-drawn sources that have already been through it.
- `assets/fonts/*.subset.ttf` — `node scripts/build-icon-fonts.mjs`
- `public/fonts/*.woff2` — `node scripts/build-fonts.mjs`
- `docs/BUNDLE.md` — `node scripts/bundle-report.mjs > docs/BUNDLE.md`

## Needs the owner, not more effort

GitHub Issues labelled `ready-for-human` is the list, with what each one needs. Never copy it here.

`server/schemaDdl.ts` applies `shared/schema.ts` on every server start, so a new
table or column ships with the deploy that introduces it, and a database Replit
has just reprovisioned works on the first boot. `npm run db:push` is left for
destructive reconciliation only.

Batch 13 renamed `active_games.room_code` and `match_replays.room_code` to
`room_id`. That is destructive, so boot refuses to carry it out —
`assertRenamesApplied()` throws rather than start against a database still
holding the old columns, and `npm run db:push` has to answer *rename* for each.
Both were applied to production on 2026-08-19; `docs/DEPLOY-RUNBOOK.md` is the
sequence that did it.

`drizzle.config.ts` still excludes the `session` table from push, because
otherwise a push that adds a table asks whether the new one is a *rename* of
`session` — and answering yes logs out every account.

## How to work here

No questions — decide and proceed. One backlog item, one commit, verified
before moving on. Flag rather than build: game-rule changes and business
decisions. Never claim success without pasted output.

A failing test is not a regression until you have seen it pass somewhere else.
Machine contention and unlucky deals both look exactly like a regression. Build
a worktree at the commit before the suspect change and watch it fail there too;
check the parent commit before believing your own diff caused something.

A screenshot raises a suspicion; it does not settle one. Apparent layout defects
evaporate once a scroll area is actually scrolled, and a fix written before the
defect is confirmed usually changes nothing. Confirm in the code, or with a DOM
probe, before calling something a defect — and when checking that a new test can fail, revert the fix for real:
`git stash` on an already-committed change stashes nothing and passes
vacuously.
