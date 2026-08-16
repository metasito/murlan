# Handoff — start here in a new session

State as of the last commit on `murlan-hardening`.

## Establish reality first, before doing anything

```bash
cd C:/Users/roton/murlan
git log --oneline -5
git status --porcelain
npm run verify        # typecheck + 504 unit tests + 166 native tests
npx expo lint         # must be ZERO warnings; CI enforces it
```

Do not trust this file over the commands. It ages; they do not.

## Where things stand

Green: typecheck clean, `expo lint` zero, 504 unit tests, 166 native tests
(jest-expo, ios+android projects), Playwright E2E suite (`npm run test:e2e`)
that plays complete games through the UI.

Four test layers, mapped in `docs/TESTING.md`.

## Read these, in order

1. `CLAUDE.md` — binding rules. Comments, Freedom to change things, and
   No self-defeating safeguards especially.
2. `docs/BACKLOG.md` — open items. Section A is what I found, B is the owner's,
   C is rejected-with-reasons so it is not re-proposed.
3. `docs/RULES.md` — canonical game rules, 18 sources.
4. `docs/BRIEF.md` §3.1 — rule decisions already taken.

## Immediately actionable

- **Android automation (BACKLOG B2)** — in progress and unfinished. Maestro 2.8.0
  is installed at `~/.maestro`; there is NO Android SDK, no adb, no emulator, no
  `.maestro/` flows. Order matters: SDK, then a booted AVD proved with
  `adb shell getprop sys.boot_completed`, then the app via Expo Go, then flows.
  Poll with bounded loops — a previous agent stalled silently on a Monitor.
- **`package-lock.json` reconciliation** — `package.json` is ahead of it. Two
  agents added devDeps concurrently and were told not to install. Run one
  `npm install`, verify, commit.

## Needs the owner, not more effort

`npm run db:push` on Replit (the new `active_games.match_length` column, or
persistence fails silently) · EAS submit credentials · the 432×432 monochrome
icon · a native Albanian speaker for idiom · real-device VoiceOver and gameplay ·
the merge decision (45+ commits ahead of main).

## How to work here

No questions — decide and proceed. Size subagent models explicitly (haiku for
sweeps, sonnet for implementation and review, opus for security and rules).
Commit a checkpoint after each verified wave. Flag rather than build: game-rule
changes and business decisions. Never claim success without pasted output.
