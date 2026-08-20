# 0001. Keep the React Native/Expo client and the Replit host

**Status:** Accepted
**Date:** 2026-08-20 (migrated from `docs/BACKLOG.md` §3, original analysis undated)

## Context

> "Modernise and/or replace the whole tech stack to use best-in-class languages and
> frameworks used by mobile games, to reduce game size, improve game logic, improve
> testing and multiplatform building. This could remove Replit and Expo entirely if they
> are bottlenecks. Do not simply trust my word."

The app is a turn-based card game with at most 54 sprites on screen, no physics, no 3D, no
real-time simulation, and a rules engine whose heaviest operation was measured at 0.96 ms
per move. The computational requirement is close to zero — most "game engine" arguments
assume a rendering or simulation problem this app does not have.

### Client options measured

| Option | Bundle (2D, minimal) | Verdict |
|---|---|---|
| **Expo / React Native** (current) | ~15–25 MB | Keep |
| Unity | ~20–30 MB | Would increase size. Built for problems this app does not have. |
| Godot | ~15–25 MB | No size win; loses the entire JS/TS ecosystem and every test written. |
| Flutter + Flame | ~8–15 MB | Genuine size win, but a full rewrite in Dart. |
| Native Swift + Kotlin | ~5–10 MB | Smallest and fastest — and two codebases to maintain forever. |

Flutter and native are genuinely smaller. The cost of ~10 MB, measured from this repository:

| Surface | Lines | Fate under a port |
|---|---|---|
| `app/` | 7,257 | Rewritten in Dart |
| `components/` | 6,552 | Rewritten, including the hand-drawn SVG card art |
| `context/` | 1,584 | Rewritten |
| `lib/` | 2,217 | Rewritten — engine, i18n, sounds, theme |
| `locales/` | 2,046 | Re-keyed (translations survive; plumbing does not) |
| `tests/` | 4,961 | Rewritten in Dart |
| `server/` + `shared/` | 4,025 | Kept — a client port does not touch the backend |

Roughly 19,700 lines of client code plus 5,000 lines of tests to reproduce, to reach exactly
the behaviour that exists today. Beyond the line count: the whole safety net (including the
property test proving the straight enumerator is complete) has to be re-earned in Dart;
every bug already fixed here — impersonation, the permanently deadlocking table, the deal
that removed a Joker from ~7% of games, three exchange-phase freezes, the AI lead deadlock,
four separate invisible-colour bugs — would need to not be reintroduced, since rewrites do
not carry fixes across; Expo Go testing disappears, closing the free device-testing path
available today; and `expo-audio`, `expo-haptics`, `expo-screen-orientation`,
`expo-localization` and the Reanimated animation work all need Flutter equivalents found,
wired and re-verified.

Expo itself is not a bottleneck — it is the reason iOS and Android build at all from a
Windows machine without a Mac. Ejecting would cost the managed build pipeline, OTA updates
and Expo Go testing, and buy nothing this app needs. The one real Expo constraint that ever
bit (`react-native-keyboard-controller` blocking Expo Go) was dead code, and removing it
resolved it.

What would actually make the game smaller, measured in order: icons and splash (2.5 MB,
tracked as issue #31 in this repo), audio (872 KB of CC0 recordings, deliberately larger
than the synthesized set it replaced — quality is the bar there, not size), and unused
dependencies (12 removed so far). The client bundle is not where the weight is —
`docs/BUNDLE.md` has the numbers.

### Server: Replit

Replit is fine for developing and demoing, and a poor production host for a real-time
multiplayer game:

- No horizontal scaling — all game state lives in in-process `Map`s (`activeGames`,
  `userSocketMap`, `socketRoomMap`). A second instance would not share them, so scaling
  requires either sticky sessions plus a Redis adapter, or staying single-instance forever.
- Cold starts drop websockets — a sleeping Repl disconnects every player mid-game.
- The proxy already caused a real bug: `trust proxy` being unset meant the production
  session cookie was silently never set, which is why the forgeable `userId` fallback
  existed.
- No managed backups, no metrics, no log retention.

## Decision

**No client rewrite.** Revisit only against a measured problem React Native cannot solve —
sustained frame drops during the deal animation on a low-end Android device would be a real
trigger. Bundle size alone is not one.

**Stay on Replit for now.** `CLAUDE.md` makes a working Replit environment binding, and
there are no players yet. When it changes, the move should stay small: one always-on
container on Fly.io or Railway, managed Postgres from the same provider, the provider's own
logs and metrics. No Kubernetes, no Redis, no queue — none of that is warranted for one
Express process and a Postgres database, and the server uses no Replit-specific APIs, so
only the client's base URL changes. Defer horizontal scaling until player count demands it.
