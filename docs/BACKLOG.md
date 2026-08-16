# Backlog

The single collection point for outstanding work. Items previously scattered across
`docs/BRIEF.md` §5, `docs/TESTING.md` §5, `docs/PLAN.md` and code comments have been
folded in here; those documents keep their own topics and no longer carry open items.

Four sections:

- **§1 Work queue** — ready to build, ordered cheapest-first. One item = one commit.
- **§2 Owner-blocked** — cannot be closed from inside the repo.
- **§3 Analysis** — questions already answered, kept so they are not re-asked.
- **§4 Rejected** — with reasons, so they are not re-proposed.

---

## 1. Work queue

Ordered so the cheap, high-certainty items land first and the queue stays shippable at
every point. `Src` gives the item's original home.

| # | Item | Size | Src |
|---|---|---|---|
| **Correctness and accessibility** |
| Q1 ✅ | **Modals force portrait on iOS** — RN's `<Modal>` defaults `supportedOrientations={['portrait']}`, so opening one in landscape snaps the app to portrait and leaves the parent's layout stale; taps then land nowhere. Both `components/SettingsModal.tsx:76` and `components/ErrorFallback.tsx:105` are affected. **Rule to enforce everywhere: a user in landscape is never forced to portrait. Portrait is forced to landscape only for the game table, which needs the width.** Audit every screen and overlay for the same shape, not just these two. | S | owner |
| Q2 ✅ | **`ExchangeModal`'s `SelectableCard` has no `accessibilityLabel`** (`components/ExchangeModal.tsx:63`). It sets `accessibilityRole="button"` but the only nearby label belongs to the *disabled* inner `CardView` it wraps, so a screen-reader user gets an unnamed button. Fixing this also closes Q3. | S | A18 |
| Q3 ✅ | **E2E exchange giveback click is ~1-in-5 flaky** (`tests/e2e/helpers/bot.ts`, `giveExchangeCard`). Because of Q2 the harness must find the inner label and dispatch `pointerdown`/`pointerup`/`click` on its `<button>` ancestor, and RNW's gesture responder for that shape does not always react. Each attempt is verified against the offered-card count dropping, so a miss surfaces as a real stall, never a false pass. Q2 is the proper fix. | S | A19 |
| Q4 ✅ | **`tutorial.tsx` header buttons do not collapse into one accessible node** (`~505-507`, same shape on the back chevron). Two matchable nodes carry the text "Salta": the correctly-labelled `Pressable` and an inner `Text`. Screen readers see the same ambiguity Maestro does, and a tap on either never fires the RN `onPress`. | S | TESTING §5 |
| Q5 ✅ | **`app/result.tsx:273` labels exchange cards as raw `` `${card.rank} ${card.suit}` ``** instead of the localized card name every other surface uses. Wrong for screen readers in all three locales, and it blocks E2E coverage of the result screen's own exchange overlay. | S | A21 |
| Q6 ✅ | **A lint rule for the "invisible colour" bug class.** Four instances found: a stringified `"Colors.success"`, a singular/plural theme-key mismatch that made every card colourless, and a translucent *fill* token used as a *text* colour. React Native renders an invalid colour as nothing, silently. A custom ESLint rule catches all four shapes. | M | A17 |
| **Test durability** |
| Q7 ✅ | **Exchange-phase integration test retries up to 6×** (~0.02% residual flake by design — reaching a non-both-jokers exchange is probabilistic). Made deterministic by stacking the loser's hand. | S | A16 |
| Q8 ✅ | **`handFlags` (bomb/joker played this hand) live in memory only.** A mid-hand server restart loses them, under-counting two achievements. | S | A14 |
| Q9 | **E2E coverage gaps** — three areas the Playwright suite does not drive: the result screen's own rematch exchange (`app/result.tsx`'s `CardExchangeOverlay`, distinct from `GameTable`'s `ExchangeModal`, unblocked by Q5); teams-mode partner coordination; and the AFK auto-pass / disconnect-reconnect paths. | M | A21 |
| Q10 | **One unreproduced online E2E stall.** A single run of the two-real-browsers test threw `Took action "played single 7 di Quadri" but the table state did not advance` late in a hand (viewer 3 cards, opponent 7), 10s after a click confirmed as delivered. Unknown whether it is a genuine server-authoritative race or an artefact of running with `MURLAN_AFK_TIMEOUT_MS=5000` (down from 30s). Needs repeated runs to classify. | M | A20 |
| Q11 | **Maestro flows for the exchange phase and the rematch prompt**, plus wiring `.maestro/` into CI. GitHub Actions Linux runners host an Android emulator at 1× minute cost and may sidestep this machine's stability ceiling entirely (see `docs/TESTING.md` §5). | M | B2 |
| Q12 | **iOS automation via an EAS Workflows `maestro` job.** EAS runs Maestro flows against an iOS simulator on Expo's own infrastructure — no Mac, no macOS CI runner. Reuses Q11's flows. Free tier covers 15 iOS builds/month. | M | B3 |
| **Feel and presentation** |
| Q12b ✅ | **The card faces are wrong.** `components/CardView.tsx` draws all 54 faces procedurally. Two separate defects: (a) the court figures and jokers are built from ~20 hand-written `<Path d="…">` strings (`CourtPanel`, `:222-298`) and read as abstract shapes rather than a J/Q/K; (b) the pip field is a hand-written `PIP_LAYOUTS` table over a 3-column grid (`:53-78`) whose counts do not all match the rank, and whose top row (`PIP_TOP = 0.16`) collides with the corner index suit at `INDEX_SUIT_Y = 0.25`. **Planned split — the two halves want opposite treatments.** Pips stay procedural: a correct grid is cheap, scales crisply to any card size, and inherits the suit colour token for free; the fix is deriving the layout from the canonical pip grid and moving the field clear of the index, then pinning every rank's pip count with a test. Court cards and jokers get real vector art from a public-domain deck, licence recorded, subsetted to the 14 faces actually needed so the bundle cost stays measured against `docs/BUNDLE.md`. Verify by rendering all 54 faces to one sheet and looking at it. | L | owner |
| Q13 ✅ | **The sound effects sound bad.** They are synthesized by `scripts/gen-sounds.js` and it shows. Source genuinely good audio — real recorded card handling, a proper win sting — rather than tuning the synthesizer. **There is no size budget here: quality is the only bar.** Keep the same file names so `lib/sounds.ts` is untouched, and record each asset's licence. Note this deliberately overrides the "audio already cut 53%" line in §3; the bundle number is expected to go up and that is accepted. | M | owner |
| Q13b ✅ | **The settings menu is thin for a game.** It carries sounds on/off, haptics on/off, language, logout and delete-account. What players expect and it lacks: a **volume level** rather than a binary mute (and separate music vs. effects levels once there is music), animation-speed or a reduce-motion toggle that does not depend on reading the OS setting, card-sort preference, left-/right-handed hand layout, and a table/card-back picker once Q25 exists. Depends on Q13 for anything volume-shaped to be worth hearing. Settle the full list against what shipped card games offer during Q27's research rather than guessing it here. | M | owner |
| Q14 ✅ | **Haptic and sound choreography.** The assets exist; the choreography does not. Which event fires what, layered against the animation rather than alongside it. | M | BRIEF T3 |
| Q15 ✅ | **Colourblind-safe suit differentiation.** Measured, and the premise was wrong: the traditional two-ink deck already separates by ΔE 27.4 under protanopia (its worst case) and 59–87 elsewhere, and the pip glyph differs per suit regardless. The obvious "fix" — a four-colour deck with a green club — is a **regression**: red against green is ΔE 13.2 under deuteranopia. `tests/suitColours.test.ts` pins both facts so it is not changed on intuition later. Nothing to build. | S | BRIEF T3 |
| Q16 | **Rejoin-in-progress UX.** A disconnect is currently a cliff; it should be a speed bump. The server-side grace timer and rehydration already exist — this is the client's presentation of them. | M | BRIEF T1 |
| **Features** |
| Q17 | **Match replay.** Cheap on top of the existing persistence and disproportionately loved by card players: store the move log per match, step through it after the fact. Note the interaction with Q19 — history is pruned to 50 rows per user. | L | A11 |
| Q18 | **Spectator mode.** Watch a friend's table. Nearly free given the existing broadcast architecture: join without a seat, receive the same sanitized state every non-acting player already receives. | M | A10 |
| Q19 | **Match history pruned to the last 50 rows per user.** The number is arbitrary but bounded. Revisit when Q17 ships, since a replay is worth keeping longer than a scoreline. | S | A15 |
| Q20 | **Bot personalities.** Named opponents with distinct play styles rather than easy/medium/hard. Makes offline play feel like a game rather than a practice mode. | M | BRIEF T2 |
| Q21 | **Daily streaks.** Standard, effective, low risk. Achievements already ship; this is the returning-player half. | S | BRIEF T2 |
| Q22 | **Ranked ladder with a visible rating.** Gives skilled players a reason to return. Seasons need resetting and rewards defining, and a public ladder changes the cheating-pressure posture — decide the season policy before building. | L | A7 |
| Q23 | **"Your turn" push notifications.** The strongest retention lever for a turn-based game, and the code is routine. Ships inert until the owner supplies FCM (Android) and APNs (iOS) credentials via EAS, and it stores push tokens — new personal data, so it needs a privacy-policy entry before release. | L | A6, BRIEF T1 |
| Q24 | **Error reporting.** Wanted, but every third-party crash SDK is a data processor and changes the App Store privacy answers. Build the in-house version first: a single authenticated endpoint the existing `ErrorFallback` posts to. No new dependency, no new processor. | M | A9 |
| Q25 | **Cosmetics: card backs and table felts.** Non-invasive, and the natural monetization surface if one is ever wanted. Useful without IAP. | L | BRIEF T3 |
| Q26 | **Tournaments.** Bracketed multi-table events. Significant work, high ceiling. Last in the queue deliberately. | XL | BRIEF T3 |
| **The polish pass** |
| Q27 | **UI/UX audit and rebuild against how good card games actually feel.** Its own workstream, not a single commit: research how shipped card games handle table layout, readability and motion; then drive the real app and record every defect — text clipped or escaping its button, animation that jitters or overshoots, unclear affordances, layout that breaks at a given size, anything that reads as unfinished. Each confirmed defect becomes its own queue entry and its own commit. | XL | owner |

---

## 2. Owner-blocked

Cannot be closed from inside the repo — each needs an account, a device, or a person.

| # | Item | What is needed |
|---|---|---|
| O1 | `eas.json` submit credentials are placeholders (`appleId`, `ascAppId`, `serviceAccountKeyPath`) | Apple Developer + Google Play accounts. `eas build` works; `eas submit` cannot run. |
| O2 | `assets/images/android-icon-monochrome.png` is 432×432; the other adaptive layers are 512×512 | The asset regenerated. Re-encoding an icon by guesswork is worse than leaving it. |
| O3 | `locales/sq.ts` needs a native-speaker pass | Grammar and terminology are consistent (`dorë` properly declined, `manche` removed). What remains is idiom and register, which needs a speaker, not a rule. |
| O4 | VoiceOver / TalkBack flow unverified | A physical device. The pure description logic is unit-tested; the *flow* cannot be. |
| O5 | Replit boot unverified since the `reusePort` fix | One run on Replit. The fix is `process.platform === "linux"` gated, so it should be a no-op there. |
| O6 | `icon.png` 1.2 MB, `splash-icon.png` 1.37 MB | Large for 1024×1024, and the single biggest bundle win available (2.5 MB). Re-encoding needs image tooling and risks visible quality loss on the app icon. Measured, deliberately deferred. |
| O7 | Push credentials for Q23 | An FCM service account (Android) and an APNs key (iOS), uploaded to EAS, plus a privacy-policy entry covering push tokens. |
| O8 | Whether the app monetizes at all | A business call. Murlan Pro charges $0.99/month to remove ads. **No ad SDK will be added without an explicit instruction** — it is a data processor, it changes the store privacy answers, and `docs/BRIEF.md` puts ads out of scope. Q25's cosmetics are the non-invasive surface if one is ever wanted. |
| O9 | 30 npm vulnerabilities remain (0 critical; was 50 with 2 critical) | **Do not run `npm audit fix --force`.** Checked: it would bump `expo` 54 → 57 (three major SDK versions, breaking the React 19.1.0 pin and Expo Go) and *downgrade* `drizzle-kit` 0.31 → 0.18, breaking `db:push`. Every remaining advisory is in build tooling — metro, @expo/cli, @expo/config, @esbuild-kit, drizzle-kit — which runs on a dev machine and in CI, not in the shipped bundle or the running server. Plain `npm audit fix` is exhausted (30 before, 30 after). Revisit at the next Expo SDK upgrade. |

---

## 3. Analysis — already answered

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

- The 504-test safety net, including the property test proving the straight enumerator is
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
2. Audio: already cut 53% (558 KB → 257 KB) by regenerating at 22.05 kHz — and Q13 must
   not undo this
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
| An `eslint-disable` sweep to clear lint | Cleared honestly instead: 13 real dependencies added or restructured, 36 suppressed with a specific per-case reason. |
| Real-money play, social feeds, cross-promotion | Out of scope per `docs/BRIEF.md` §5. |
