# Backlog

Items worth not losing. Anything small enough to just do gets done rather than listed —
this is for things needing a decision, blocked on something outside the repo, or worth
remembering.

Two lists: what I found, and what the owner asked for.

---

## A. Found while working

### Blocked on the owner — cannot be closed from inside the repo

| # | Item | What's needed |
|---|---|---|
| A1 | `eas.json` submit credentials are placeholders (`appleId`, `ascAppId`, `serviceAccountKeyPath`) | Apple Developer + Google Play accounts. `eas build` works; `eas submit` cannot run. |
| A2 | `assets/images/android-icon-monochrome.png` is 432×432; the other adaptive layers are 512×512 | The asset regenerated. No image tooling here, and re-encoding an icon by guesswork is worse than leaving it. |
| A3 | `locales/sq.ts` needs a native-speaker pass | Grammar and terminology are now consistent (`dorë` properly declined, `manche` removed). What remains is idiom and register, which needs a speaker, not a rule. |
| A4 | VoiceOver / TalkBack flow unverified | A physical device. The pure description logic is unit-tested; the *flow* cannot be. |
| A5 | Replit boot unverified since the `reusePort` fix | One run on Replit. Fix is `process.platform === "linux"` gated, so it should be a no-op there. |

### Decisions the owner should make — deliberately not built

| # | Item | Why it is not mine to decide |
|---|---|---|
| A6 | **Push notifications** ("your turn") | Strongest retention lever for a turn-based game, and the code is routine. But it needs APNs/FCM accounts, stores push tokens (new personal data) and requires a privacy-policy entry. |
| A7 | **Ranked ladder / seasonal leaderboard** | Both major competitors ship it. Seasons need resetting, rewards defining, and a public ladder changes the cheating-pressure posture — a product commitment, not a feature. |
| A8 | **Monetization** | Murlan Pro charges $0.99/month to remove ads. Whether this app monetizes at all is a business call. |
| A9 | **Crash / analytics SDK** | Valuable, but any SDK is a third-party data processor and changes the App Privacy answers. |
| A10 | **Spectator mode** | Nearly free given the existing broadcast architecture. Listed because it is a product choice, not because it is hard. |
| A11 | **Match replay** | Cheap on top of the existing persistence, and disproportionately loved by card players. |

### Technical debt — real, none urgent

| # | Item | Note |
|---|---|---|
| A12 | 28 npm vulnerabilities remain (0 critical, was 50 with 2 critical) | The rest need major-version bumps of Expo-managed packages. Revisit at the next SDK upgrade rather than fighting the resolver now. |
| A13 | `icon.png` 1.2 MB, `splash-icon.png` 1.37 MB | Large for 1024×1024. Re-encoding needs image tooling and risks visible quality loss on the app icon. Measured, deliberately deferred. |
| A14 | `handFlags` (bomb/joker played this hand) live in memory only | A mid-hand server restart loses them, under-counting two achievements. Accepted; the alternative is persisting per-play state on every move. |
| A15 | Match history pruned to the last 50 rows per user | The number is arbitrary but bounded. Revisit if replay (A11) ships. |
| A16 | Exchange-phase integration test retries up to 6× | ~0.02% residual flake by design — reaching a non-both-jokers exchange is probabilistic. Could be made deterministic by stacking the loser's hand. |
| A17 | **A lint rule for the "invisible colour" bug class** | Four instances found this session: a stringified `"Colors.success"`, a singular/plural theme-key mismatch that made every card colourless, and a translucent *fill* token used as a *text* colour. React Native renders an invalid colour as nothing, silently. A custom ESLint rule would catch all four shapes. |

---

## B. Owner's suggestions

### B1 — Replace the tech stack

> "Modernise and/or replace the whole tech stack to use best-in-class languages and
> frameworks used by mobile games, to reduce game size, improve game logic, improve
> testing and multiplatform building. This could remove Replit and Expo entirely if they
> are bottlenecks. Do not simply trust my word."

**Status: analysed. Recommendation is to split the question — the answer differs for the
client and the server.**

#### What the app actually demands

A turn-based card game with at most 54 sprites on screen, no physics, no 3D, no real-time
simulation, and a rules engine whose heaviest operation was **measured at 0.96 ms per
move**. The computational requirement is close to zero. This matters, because most
"game engine" arguments assume a rendering or simulation problem this app does not have.

#### Client: keep React Native / Expo

| Option | Bundle (2D, minimal) | Verdict |
|---|---|---|
| **Expo / React Native** (current) | ~15–25 MB | Keep |
| Unity | ~20–30 MB | **Would increase size.** Built for problems this app does not have. |
| Godot | ~15–25 MB | No size win; loses the entire JS/TS ecosystem and every test written. |
| Flutter + Flame | ~8–15 MB | Genuine size win, but a full rewrite in Dart. |
| Native Swift + Kotlin | ~5–10 MB | Smallest and fastest — and two codebases to maintain forever. |

The premise worth challenging is that a game engine reduces size. **For a 2D card game it
increases it**, because you ship a renderer and physics you never use. Unity and Godot are
the wrong tool here, and would be even if starting from scratch.

Flutter and native *are* genuinely smaller. The question is whether ~10 MB is worth what
it costs.

**What a rewrite would throw away, concretely:**
- 504 passing tests, including a property test proving the straight enumerator is complete
- A hardened trust model: single-use socket tickets, per-user rate limits, runtime payload
  validation, seat-vacancy recovery
- Every bug fixed this session — impersonation, the permanently deadlocking table, the
  broken deal that removed a Joker from ~7% of games, three exchange freezes, the AI lead
  deadlock
- i18n across three locales, the tutorial, achievements, stats
- The Playwright end-to-end suite currently being built

Rewrites do not carry bug fixes across. They re-earn them, one production incident at a
time. The current stack is not what made this app buggy — **absent tests and unguarded
trust boundaries were**, and both are now addressed.

**Verdict: no client rewrite.** Revisit only if a specific, measured problem appears that
React Native cannot solve — sustained frame drops during the deal animation on a low-end
Android device would be a real trigger. Bundle size alone is not.

#### Server: Replit is a legitimate bottleneck

This half of the suggestion is right, and it is a much smaller change.

Replit is fine for developing and demoing. It is a poor production host for a real-time
multiplayer game:

- **No horizontal scaling.** All game state lives in in-process `Map`s (`activeGames`,
  `userSocketMap`, `socketRoomMap`). A second instance would not share them, so scaling
  requires either sticky sessions plus a Redis adapter, or staying single-instance forever.
- **Cold starts drop websockets.** A sleeping Repl disconnects every player mid-game.
- **The proxy already caused a real bug** — `trust proxy` being unset meant the production
  session cookie was silently never set, which is *why* the forgeable `userId` fallback
  existed.
- No managed backups, no metrics, no log retention.

**Verdict: worth moving, and cheap.** The server is plain Express + Socket.io + Postgres
with no Replit-specific APIs. Fly.io or Railway would take an afternoon, keep websockets
alive, and give real logs. Nothing in the client changes but a base URL.

Not urgent while there are no players. It becomes urgent the day there are.

#### Expo specifically

Expo is not a bottleneck; it is the reason iOS and Android build at all from a Windows
machine without a Mac. Ejecting would cost the managed build pipeline, OTA updates and
Expo Go testing, and buy nothing this app needs.

The one real Expo constraint already bit and was resolved: `react-native-keyboard-controller`
was the sole thing blocking Expo Go, it was dead code, and removing it restored free
on-device testing.

#### What would actually make the game smaller

Measured, in order:

1. Icons and splash: **2.5 MB** of the assets (A13)
2. Audio: already cut 53% (558 KB → 257 KB) by regenerating at 22.05 kHz
3. Unused dependencies: 12 removed so far

The client bundle is not where the weight is. `docs/BUNDLE.md` has the numbers, and
`scripts/bundle-report.mjs` regenerates them.

---

## C. Rejected, with reasons — so they are not re-proposed

| Item | Why not |
|---|---|
| Free-text in-game chat | All three competitors ship it. Moderation liability with minors in the audience, no gameplay gain. Emoji reactions cover the social signal. |
| `React.memo` on the card components | The React Compiler already covers those files, and `deepCloneState` gives every card a new reference per transition, so a shallow comparator can never hit. An incomplete custom one causes stale renders. |
| Replacing `deepCloneState` for performance | Measured at 0.96 ms/move. Not a bottleneck. |
| A generic achievements framework | A flat array with predicates is enough. |
| An `eslint-disable` sweep to clear lint | Cleared honestly instead: 13 real dependencies added or restructured, 36 suppressed with a specific per-case reason. |
