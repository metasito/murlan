# Backlog

The single collection point for outstanding work. Items previously scattered across
`docs/BRIEF.md` §5, `docs/TESTING.md` §5 and code comments have been
folded in here; those documents keep their own topics and no longer carry open items.

Four sections:

- **§1 Work queue** — ready to build, ordered cheapest-first. One item = one commit.
- **§2 Owner-blocked** — cannot be closed from inside the repo.
- **§3 Analysis** — questions already answered, kept so they are not re-asked.
- **§4 Rejected** — with reasons, so they are not re-proposed.

## How this queue is worked

`CLAUDE.md` § *Working agreement* is the standing instruction and is not restated here.
Two things specific to this file:

- **It is never empty and never finished.** When §1 runs dry, run `superpowers:brainstorming`
  and add to it. Closing the last item is a prompt to find the next ones, not to stop.
- **A choice that is genuinely the owner's** — an account, a device, a credential, a business
  call — moves to §2, and the next item is taken.

---

## 1. Work queue

Ordered so the cheap, high-certainty items land first and the queue stays shippable at
every point. `Src` gives the item's original home.

| # | Item | Size | Src |
|---|---|---|---|
| **Quick and certain** |
| Q37 | **A dead `jokers` filter in `getAllValidPlays`** (`lib/gameEngine.ts`). `const jokers = hand.filter((c) => c.isJoker);` is assigned and never read, allocating a discarded array on every AI move search. Verified dead — no other reference in the function — against `docs/RULES.md` §5, *Jokers form no combination*: pairs, triples and bombs are natural-only by rule, so nothing should ever consume it. | XS | code read |
| Q31 | **The top seat's column overflows `TOP_SECTION_H`.** Measured in Chromium: the column is ~89px tall against the hard 70px box even with a *single* badge line, and `components/table/chrome.tsx:211` sets no `overflow`. Pre-existing on `main` — this branch removed a second line it had added, which is why it surfaced. | S | review |
| Q34 | **`headerGatedSpans()`'s exemption is keyed by name, not by call target.** A genuine bypass in the response-code scanner: a helper that happens to share the name is exempted too. Fixing it means resolving call targets rather than matching identifiers. | S | review |
| Q32 | **The spacing lint selector has no test.** It is correct and was watched failing, but one bad edit reopens the same silent hole with CI green — which is exactly how it shipped with `marginHorizontal`/`marginVertical` and negative literals uncovered. Blocked on a call about running ESLint from inside `node --test` without loading the whole Expo config; a weak pin is worse than none. | S | review |
| Q35 | **Nothing holds the line on lint warnings.** Widening `npm run lint` from 45 files to 276 made 107 pre-existing warnings visible, and CI passes no `--max-warnings`, so the count can only grow. `--fix` claims 73 of them, but they are almost all `import/first` in `tests/native/**` where the imports sit *below* a `jest.mock()` call on purpose — reordering 73 sites in test files to satisfy a warning is risk without benefit. The useful shape is to fix them by hand where it is safe, then ratchet `--max-warnings` down so the number can only fall. | S | lint widening |
| Q29 | **`runOnJS` is deprecated.** `react-native-reanimated` marks it `@deprecated` in favour of `react-native-worklets`, which is already a direct dependency at the SDK-54 pin (0.5.1), so no version change is needed. Five call sites, all in `components/NotificationBanner.tsx` and `components/table/pile.tsx`. Deferred deliberately rather than missed: both files are named invariants in `CLAUDE.md` — the banner animates by callback chain because parallel `withTiming` calls overwrite its slide-in, and the pile must hold every card exactly once — and rewiring animation callbacks in them for a deprecation that has not broken anything is the wrong risk the week before a beta. Failure mode if left: a future Reanimated major removes it and those two files stop animating, loudly. | S | surfaces audit |
| **Needs a decision first** |
| Q36 | **Split the browser tests across several CI runners.** `--shard=i/N` would cut the run's critical path by roughly 46%, because the browser job *is* the critical path — 9m34s of a 9m48s run, everything else finishing well before it. The cost is that each shard re-pays its own checkout, `npm ci`, Chromium install and bundle build — about 210s of fixed setup — so three shards means roughly **three times the billed minutes of the most expensive job**, on a private repo. That is a spending decision rather than an engineering one, which is why it is a row and not a commit. Raising Playwright's `workers` above 1 inside one job is the cheaper-looking alternative and was rejected: nine specs share one server and one disposable database, and this branch spent most of its time removing flakes rather than adding a mechanism for new ones. | S | CI split |
| **Needs some design** |
| Q30 | **Timing literals are not on the token scale.** Adding `duration`/`delay` to `eslint.config.js`'s numeric-literal rule reports **32 errors across 8 files**, of which only 2 land on an existing `Motion.duration` step. Closing it means either retiming animations app-wide with no test that can catch a feel regression, or minting ~10 new steps to paper over the existing values — the same trap the `Spacing` sweep hit. Colour and timing are convention for now; radius, font size and spacing are enforced. | M | review |
| Q33 | **Push notifications are one language for everybody.** A push is delivered by the server with no client in the loop, so the recipient's own language is never consulted; every push goes out in English. The real fix is persisting each device's locale at registration — `shared/schema.ts` and `lib/pushRegistration.ts`. | M | review |
| Q28 | **Metro tree shaking on the web bundle.** `dist/_expo/static/js/web/entry-<hash>.js` is 2,969,932 B raw and 758,035 B on the wire once Express' `compression()` has it — re-measured on this branch: `npm run expo:web:build`, then the real server booted and the asset fetched twice, `Accept-Encoding: identity` against `Accept-Encoding: gzip`, on `Cache-Control: public, max-age=31536000, immutable`. The wire figure is the one that matters, and Node's `zlib.gzipSync` at its default level reproduces it byte for byte; the `gzip` CLI is not the same number (756,135 B at its default, 752,918 B at `-9`). Both audited reductions — two dead dependencies, 462 KB of lossless PNG recompression — left that file untouched, because it holds no removable lump: it is React, React Native Web, Reanimated and Gesture Handler, the framework the app is built from. The one lever that reaches it is Metro's `EXPO_UNSTABLE_TREE_SHAKING`, deliberately **not** switched on here — it is experimental, it changes what every module resolves to, and its failure mode is a missing export at runtime rather than a build error. Worth measuring behind a branch once beta is off the critical path, never during one. | M | bundle |
| **Blocked on O11** |
| Q11 | **Maestro flows for the exchange phase and the rematch prompt.** Both need to sit on the animated game table for a whole hand, which is the one thing this machine's emulator cannot hold (§3), so writing them here would mean shipping test code that was never run. Write them against the CI runner once O11's first green run proves it. The portable flows and the CI job already exist. | M | B2 |
| Q12 | **iOS automation via an EAS Workflows `maestro` job.** EAS runs Maestro flows against an iOS simulator on Expo's own infrastructure — no Mac, no macOS CI runner. Reuses Q11's flows. Free tier covers 15 iOS builds/month. | M | B3 |
| **Big, and deliberately last** |
| N6 | **The aesthetics half of the UI audit.** Q27 proved every control is *reachable*; nothing has judged whether the game **reads** well. The measurable defects this turned up — off-screen card fans, a visible grid across the felt, three mis-tuned springs, four screens ignoring reduce-motion — are fixed and pinned by tests. What is left is a matter of taste and needs an eye, not a probe: the spacing rhythm, the large amount of empty felt on a tablet, and how the result screen reads. | L | Q27 |
| Q26 | **Tournaments.** Bracketed multi-table events. Significant work, high ceiling. Last in the queue deliberately. | XL | BRIEF T3 |
---

## 2. Owner-blocked

Cannot be closed from inside the repo — each needs an account, a device, or a person.

| # | Item | What is needed |
|---|---|---|
| O1 | `eas.json` submit credentials are placeholders (`appleId`, `ascAppId`, `serviceAccountKeyPath`) | Apple Developer + Google Play accounts. `eas build` works; `eas submit` cannot run. |
| O2 | `assets/images/android-icon-monochrome.png` is 432×432; the other adaptive layers are 512×512 | The asset regenerated. Re-encoding an icon by guesswork is worse than leaving it. |
| O3 | `locales/sq.ts` needs a native-speaker pass | Grammar and terminology are consistent; what remains is idiom and register, which needs a speaker rather than a rule. The genderless phrasing is grammatically reasonable but, like the rest of the file, not a native read. |
| O4 | VoiceOver / TalkBack flow unverified | A physical device. The pure description logic is unit-tested; the *flow* cannot be. |
| O6 | `icon.png` 1.2 MB, `splash-icon.png` 1.37 MB | A WebP re-encode measures real headroom (icon.png to 105.5 KB, splash-icon.png to 136.6 KB at quality 0.9), but Expo's own prebuild pipeline (`@expo/image-utils` → `jimp-compact`) cannot decode WebP — confirmed by feeding it the encoded output. Shrinking the pixels instead needs a device pass: `icon.png` is pinned at 1024×1024 by the iOS App Store marketing-icon requirement, and `splash-icon.png` is scaled to screen size by `expo-splash-screen`'s CONTAIN mode, so whether 1024px has slack depends on the widest real screens. Measured, deliberately deferred. |
| O7 | Push credentials for Q23 | An FCM service account (Android) and an APNs key (iOS), uploaded to EAS, plus a privacy-policy entry covering push tokens. |
| O8 | Whether the app monetizes at all | A business call. Murlan Pro charges $0.99/month to remove ads. **No ad SDK will be added without an explicit instruction** — it is a data processor, it changes the store privacy answers, and `docs/BRIEF.md` puts ads out of scope. Q25's cosmetics are the non-invasive surface if one is ever wanted. |
| O10 | Account friction, before the ladder is worth defending | Elo makes a *fixed* pair of farming accounts asymptote on its own (`tests/rating.test.ts`), so no rating mechanism is needed for that. What it cannot answer is one player creating many sacrificial accounts. That needs email verification or rate-limited registration — a signup decision, not a rating one. The ladder is honest for the player base that exists; this is what "public and tamper-resistant" would additionally require. |
| O11 | Q11 and Q12 cannot progress: the Maestro job has never actually run | **One manual run, watched to the end:** `gh workflow run maestro.yml`. The workflow is on the remote and registered, but `gh run list --workflow=maestro.yml` comes back empty. It stays `workflow_dispatch` only until a run is seen green; promoting it to `on: push` is what closes this and unblocks Q11 and Q12. |
| O12 | `context/GameContext.tsx` is the one screen-facing provider the React Compiler still skips | An owner ruling on the latest-ref pattern. **Measured:** `node .superpowers/…/compiler-probe.mjs context/GameContext.tsx` → `BAILS — line 151 Cannot access refs during render`. The site is `gameStateRef.current = gameState` at :171, a ref written during render, which the compiler reads as a Rules-of-React violation and which costs `GameProvider` the optimisation the build pays for. **Blast radius is nil today:** that ref is read only inside `answerRematch` (:246) and `chooseExchangeCard` (:254), both `useCallback` handlers a player triggers, so there is no window in which a consumer sees a stale value — this is a correctness tidy-up, not a live bug. The compiler-safe move is to write it in an effect, which changes *when* the value becomes visible; that is a design decision about the pattern, not a dependency-array correction, which is why it is here and not fixed. Everything under `app/` and `components/` compiles clean and `tests/reactCompiler.test.ts` holds that line; `context/` is deliberately outside that assertion. |
| O9 | npm advisories remain, none critical | **Do not run `npm audit fix --force`.** Checked: it would bump `expo` 54 → 57 (three major SDK versions, breaking the React 19.1.0 pin and Expo Go) and *downgrade* `drizzle-kit` 0.31 → 0.18, breaking `db:push`. **One advisory reached production and is now fixed:** `drizzle-orm` — the ORM every route and socket handler queries through — carried GHSA-gpj5-g38j-94v9 up to 0.45.2, and SEC-06 bumped it. It was never exploitable here (the advisory needs an attacker-controlled SQL *identifier*; `sql.identifier`/`sql.raw` appear nowhere in the repo), but O9 had claimed no advisory touched the server at all. Every remaining one does run in build, dev or test tooling only — metro, @expo/cli, @expo/config, @esbuild-kit, drizzle-kit. Plain `npm audit fix` is exhausted. Revisit at the next Expo SDK upgrade. |
| O14 | Real account recovery, and third-party sign-in | There is no password reset — no email is stored — and `scripts/reset-password.mjs` is an owner-run stopgap that does not scale past people you know personally. | The full answer is its own plan: an email (or phone) on the account, a reset-token table and a sender, an in-app change-password screen, and **Sign in with Apple** and **Sign in with Google**. Apple's guideline 4.8 makes Sign in with Apple mandatory once any other third-party sign-in is offered, so the two arrive together. Touches `shared/schema.ts`, `server/routes.ts`, the auth screens and the store listing. |
| O15 | The database has no backup | `pg_dump` before a deploy is written into `replit.md` § Rolling back a deploy, but nothing takes one on a schedule. A `scripts/backup-db.mjs` plus somewhere to keep the output. Wanted before the beta user count is large enough that losing it matters. |
| O16 | There is no way to see what beta users are doing | Client crash reports go to the server log (`POST /api/client-errors`) and nowhere else, and nothing answers "how many people played today" or "did anyone get stuck". An owner-only authenticated view over signups, games played and recent client errors. |
| O17 | Login is rate-limited per IP, 20 attempts per 15 minutes (`server/routes.ts` `authLimiter`) | Beta testers on one home or office network share that budget and can lock each other out — a confusing first impression that looks like a broken app. Either raise it, or key it per-username with a separate per-IP ceiling. |
| O18 | The twelve sound effects have never been played on real iOS or Android hardware | Asserted, not heard. AVFoundation has decoded MP3 for as long as it has existed, so the risk is small — but a simulator is not the check. Ten minutes with a phone; the list is in `docs/BETA-PLAYTEST.md`. |
| O20 | `noUncheckedIndexedAccess` is off | **Measured:** `npx tsc --noEmit --noUncheckedIndexedAccess` finds 649 errors, 75 of them in `lib/` (70 in `lib/gameEngine.ts` alone) and 14 in `server/`. In a game built on indexing hands and seats by position, it is the strict-family flag with the most to say about this codebase specifically. Worth scoping to `lib/gameEngine.ts` and `server/` first rather than the whole repo at once. |
| O22 | Store readiness, beyond O1's submit credentials | `docs/BRIEF.md` §4 W6 named these and nothing has ever tracked them. Outstanding: a **privacy policy** — none exists anywhere in the repo, and both stores refuse a listing without a reachable URL; the **App Privacy / Data Safety answers**, which must match what the app actually collects (accounts, and push tokens once O7 lands); **store copy and screenshots** in all three languages; and **build numbers** — `app.json` carries `version: 1.0.0` but no `ios.buildNumber` and no `android.versionCode`, and both stores reject an upload that does not increment them. Account deletion, the other W6 item, **is** shipped and reachable (`settings.deleteAccount`, covered by `tests/e2e/tapTargets.spec.ts`). | A privacy-policy URL you control, and the store listings themselves. |

---

## 3. Analysis — already answered

### No unit test can see a layout bug

`@testing-library/react-native` runs on `react-test-renderer`, which never runs flexbox, so
no native test can assert which side of a seat a card fan renders on. The only tier that can
catch this class is Playwright (`tests/e2e/`) — which is why the card fan rendered off-screen
for months against a green suite. Worth remembering when something looks wrong and every
test says it is fine.

### Replace the tech stack

> "Modernise and/or replace the whole tech stack to use best-in-class languages and
> frameworks used by mobile games, to reduce game size, improve game logic, improve
> testing and multiplatform building. This could remove Replit and Expo entirely if they
> are bottlenecks. Do not simply trust my word."

**The answer differs for the client and the server.**

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
it costs. Measured from this repository:

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
exactly the behaviour that exists today — and beyond the line count:

- The whole safety net, including the property test proving the straight enumerator is
  complete, has to be re-earned in Dart before the port can be trusted at all
- Every bug fixed here — impersonation, the permanently deadlocking table, the deal that
  removed a Joker from ~7% of games, three exchange-phase freezes, the AI lead deadlock,
  four separate invisible-colour bugs — would need to *not* be reintroduced. Rewrites do
  not carry fixes across; they re-earn them one incident at a time.
- Expo Go testing disappears. Flutter needs a real build for device testing, so the free
  path available today would close.
- `expo-audio`, `expo-haptics`, `expo-screen-orientation`, `expo-localization` and the
  Reanimated animation work all need Flutter equivalents found, wired and re-verified.

**Verdict: no client rewrite.** Revisit only against a measured problem React Native
cannot solve — sustained frame drops during the deal animation on a low-end Android
device would be a real trigger. Bundle size alone is not, and the largest single win
available is 2.5 MB of icon and splash PNGs (O6), which needs no rewrite at all.

#### Expo specifically

Expo is not a bottleneck; it is the reason iOS and Android build at all from a Windows
machine without a Mac. Ejecting would cost the managed build pipeline, OTA updates and
Expo Go testing, and buy nothing this app needs.

The one real Expo constraint already bit and was resolved: `react-native-keyboard-controller`
was the sole thing blocking Expo Go, it was dead code, and removing it restored free
on-device testing.

#### What would actually make the game smaller

Measured, in order:

1. Icons and splash: **2.5 MB** of the assets (O6)
2. Audio: 872 KB of CC0 recordings at 44.1 kHz. Deliberately larger than the
   synthesized set it replaced — quality is the bar there, not size
3. Unused dependencies: 12 removed so far

The client bundle is not where the weight is. `docs/BUNDLE.md` has the numbers, and
`scripts/bundle-report.mjs` regenerates them.

### Server: Replit is a real bottleneck, and the app stays there anyway

**Decision: stay on Replit.** `CLAUDE.md` makes a working Replit environment binding, and
there are no players yet. The analysis below stands for the day that changes.

Replit is fine for developing and demoing, and a poor production host for a real-time
multiplayer game:

- **No horizontal scaling.** All game state lives in in-process `Map`s (`activeGames`,
  `userSocketMap`, `socketRoomMap`). A second instance would not share them, so scaling
  requires either sticky sessions plus a Redis adapter, or staying single-instance forever.
- **Cold starts drop websockets.** A sleeping Repl disconnects every player mid-game.
- **The proxy already caused a real bug** — `trust proxy` being unset meant the production
  session cookie was silently never set, which is *why* the forgeable `userId` fallback
  existed.
- No managed backups, no metrics, no log retention.

The move, when it happens, is small and should stay small: one always-on container on
Fly.io or Railway, managed Postgres from the same provider, the provider's own logs and
metrics. No Kubernetes, no Redis, no queue — none of that is warranted for one Express
process and a Postgres database, and the server uses no Replit-specific APIs, so only the
client's base URL changes. Defer horizontal scaling until player count demands it.

### Android UI automation — built, partially working

Android SDK, an AVD, and Maestro are installed and verified on this machine (`docs/TESTING.md`
§5 has exact versions; Maestro runs natively on Windows via Git Bash, so the documented
WSL2 route is unnecessary here). `.maestro/smoke.yaml` and `.maestro/offline-game.yaml` are
checked in.

`smoke.yaml` passes reliably and repeatedly from a fully cleared app state, and was verified
able to fail (a swapped-in false assertion produced a real exit-1).

`offline-game.yaml`'s logic is verified correct step by step, but a full unattended run does
not yet reliably reach the result screen on this machine: around the landscape rotation into
the live, continuously-animated table, either Android force-kills the activity or the
emulator process dies. This reads as a software-rendering ceiling under sustained animated
load, not a flow defect. Remaining work is Q11 and Q12.

Two app findings came out of actually running it: Expo Go's dev-menu is two stacked layers
whose lower sheet silently swallows taps, and Q4.

---

## 4. Rejected, with reasons

| Item | Why not |
|---|---|
| Free-text in-game chat | All three competitors ship it. Moderation liability with minors in the audience, no gameplay gain. Emoji reactions cover the social signal. |
| Ads | Out of scope per `docs/BRIEF.md`, and an ad SDK is a third-party data processor that changes the store privacy answers. See O8. |
| `React.memo` on the card components | The React Compiler already covers those files, and `deepCloneState` gives every card a new reference per transition, so a shallow comparator can never hit. An incomplete custom one causes stale renders. |
| Replacing `deepCloneState` for performance | Measured at 0.96 ms/move. Not a bottleneck. |
| A generic achievements framework | A flat array with predicates is enough. |
| An `eslint-disable` sweep to clear lint | Cleared honestly instead: every dependency array is real and no `react-hooks` rule is switched off anywhere under `app/`, `components/` or `context/`. A suppression there costs the whole file its React Compiler pass, which `tests/reactCompiler.test.ts` fails on. |
| Real-money play, social feeds, cross-promotion | Out of scope per `docs/BRIEF.md` §5. |
