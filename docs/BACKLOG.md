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

### B2 — Android UI automation

Not built. The recommendation stands from the native-testing work: **Maestro**, YAML-driven,
free, drives Expo Go or a dev build, no native build required.

**Blocked on tooling, not on decisions.** This machine has JDK 21, virtualisation and WSL2,
but no Android SDK, no `adb`, no emulator.

To do it:
1. Install Android Studio (or just the command-line SDK tools) and create an AVD.
2. `curl -Ls "https://get.maestro.mobile.dev" | bash`
3. Write flows under `.maestro/` — launch, play a full offline hand, exercise the exchange
   phase and the rematch prompt.
4. Wire into CI later; GitHub Actions Linux runners can host an Android emulator at 1×
   minute cost, which is cheap.

Worth doing because it covers a real platform end to end on hardware that behaves like a
phone — gestures, insets, orientation lock, worklet timing — none of which the web suite
or the native-renderer suite can see.

### B3 — iOS testing without a Mac

Researched. There is a genuine answer, and it is not a cloud Mac rental.

| Option | Cost | What it actually gives |
|---|---|---|
| **EAS Workflows `maestro` job** ⭐ | EAS free tier (15 iOS builds/month) | **The recommendation.** EAS has a built-in job type that runs Maestro flows against an iOS simulator on Expo's own infrastructure. The build and the simulator both live on EAS, so no Mac and no macOS CI runner is needed. |
| GitHub Actions macOS runner | $0.062/min, and drains the free allowance at **10×** — 2,000 free minutes = 200 macOS minutes | Works, and can drive an iOS simulator, but the 10× multiplier makes it the expensive way to buy the same thing. |
| Expo Go on the owner's iPhone | Free, works today | Real device, real native runtime — but manual, not automated. Still the best way to *feel* the app. |
| MacStadium / MacinCloud / Scaleway Mac | ~$25–60/month | A full Mac. Only worth it if Xcode itself is needed. |
| BrowserStack / LambdaTest / Sauce Labs | ~$29–199/month | Real iOS *devices*, not simulators. The only option that catches device-specific issues. |

Two limits to be honest about: a simulator is not a device — it will not catch worklet
jank, real audio behaviour, or thermal effects. And Maestro's iOS support is
**simulator-only**, so no automation route drives the owner's physical iPhone.

Sequencing: B2 first (cheaper, and the flows are reusable), then point the same flows at
the EAS `maestro` job for iOS.

### B4 — Move the server off Replit

Split out of B1 because it is the one infrastructure change worth making, and it should
stay small.

**Why:** in-process `Map`s hold all game state, so there is no horizontal scaling without
Redis and sticky sessions. Cold starts drop live websockets. The proxy already caused a
real production bug — an unset `trust proxy` meant the session cookie was silently never
set, which is why the forgeable `userId` fallback existed. No managed backups, metrics or
log retention.

**Keep it lean.** The temptation is to arrive with Kubernetes, Redis, a queue and an
observability stack. None of that is warranted for one Express process and a Postgres
database. The minimum that fixes the actual problems:

- One always-on container on Fly.io or Railway (no cold starts, websockets stay up)
- Managed Postgres from the same provider
- The provider's own logs and metrics

That is the whole change. No new runtime dependencies, no architectural rework — the
server uses no Replit-specific APIs. Only the client's base URL changes.

**Defer horizontal scaling until it is needed.** Sharing state across instances means
Redis plus a Socket.io adapter plus sticky sessions, and it is not worth carrying before
there are enough players to require it. One well-hosted instance handles a great many
concurrent card tables.

**Not urgent while there are no players. Urgent the day there are.**

### B5 — Port the client to Flutter (or Godot, or native)

**What it would buy.** Bundle size, and only bundle size. Measured comparison in B1:
Flutter ~8–15 MB against ~15–25 MB for Expo/RN. Native Swift+Kotlin is smaller still at
~5–10 MB, at the cost of two codebases forever. Unity and Godot would make the app
*larger*, because a 2D card game ships a renderer and physics it never uses.

There is no performance argument. The engine's heaviest operation measures **0.96 ms per
move**, there is no physics, no 3D, and at most 54 sprites on screen.

**What it would cost**, measured from this repository:

| Surface | Lines | Fate under a port |
|---|---|---|
| `app/` | 7,257 | Rewritten in Dart |
| `components/` | 6,552 | Rewritten, including the hand-drawn SVG card art |
| `context/` | 1,584 | Rewritten |
| `lib/` | 2,217 | Rewritten — engine, i18n, sounds, theme |
| `locales/` | 2,046 | Re-keyed (translations survive; plumbing does not) |
| `tests/` | 4,961 | Rewritten in Dart |
| `server/` + `shared/` | 4,025 | **Kept.** A client port does not touch the backend. |

Roughly **19,700 lines of client code plus 5,000 lines of tests** to reproduce, to reach
exactly the behaviour that exists today.

**What is genuinely at risk beyond the line count:**
- The 504-test safety net, including the property test proving the straight enumerator is
  complete, has to be re-earned in Dart before the port can be trusted at all
- Every bug fixed in this codebase — impersonation, the permanently deadlocking table, the
  deal that removed a Joker from ~7% of games, three exchange-phase freezes, the AI lead
  deadlock, four separate invisible-colour bugs — would need to *not* be reintroduced.
  Rewrites do not carry fixes across; they re-earn them one incident at a time.
- Expo Go testing disappears. Flutter needs a real build for device testing, so the free
  path the owner has today would close.
- `expo-audio`, `expo-haptics`, `expo-screen-orientation`, `expo-localization` and the
  Reanimated animation work all need Flutter equivalents found, wired and re-verified.

**Honest verdict:** the case is weak *today* and would be strong in one specific future —
if this app ever needed heavy real-time rendering, which a turn-based card game does not.
Saving ~10 MB does not justify re-earning a year of correctness. Revisit only against a
measured problem React Native cannot solve, such as sustained frame drops during the deal
animation on a low-end Android device. Bundle size alone is not that problem — and the
largest single win available is 2.5 MB of icon and splash PNGs (A13), which needs no
rewrite at all.

---

## C. Rejected, with reasons — so they are not re-proposed

| Item | Why not |
|---|---|
| Free-text in-game chat | All three competitors ship it. Moderation liability with minors in the audience, no gameplay gain. Emoji reactions cover the social signal. |
| `React.memo` on the card components | The React Compiler already covers those files, and `deepCloneState` gives every card a new reference per transition, so a shallow comparator can never hit. An incomplete custom one causes stale renders. |
| Replacing `deepCloneState` for performance | Measured at 0.96 ms/move. Not a bottleneck. |
| A generic achievements framework | A flat array with predicates is enough. |
| An `eslint-disable` sweep to clear lint | Cleared honestly instead: 13 real dependencies added or restructured, 36 suppressed with a specific per-case reason. |
