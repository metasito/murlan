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

Green: typecheck clean, `expo lint` zero, 607 unit and integration tests, 190
native tests (jest-expo, ios+android projects), and a Playwright E2E suite
(`npm run test:e2e`) that plays complete games through the UI.

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

`npm run db:push` on Replit (the `active_games.match_length` column, or
persistence fails silently) · EAS submit credentials · the 432×432 monochrome
icon · a native Albanian speaker for idiom · real-device VoiceOver and
gameplay. `docs/BACKLOG.md` §2 is the full list with what each one needs.

Anything that would add a database column is worth avoiding for the same
reason: until someone runs `db:push` on Replit, the write fails silently and
takes unrelated writes down with it. Two features already ride existing jsonb
or derive from existing rows instead.

## How to work here

No questions — decide and proceed. Size subagent models explicitly (haiku for
sweeps, sonnet for implementation and review, opus for security and rules).
One backlog item, one commit, verified before moving on. Flag rather than
build: game-rule changes and business decisions. Never claim success without
pasted output.
