# One clock per motion: implementation plan (#1259, plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Seam errata (final cross-plan check; these win over the text below).** Plan 1 has landed before this plan runs. Code against the tree it leaves, not today's.
> - **Task 6 (cues):** the table already calls `event()`, not `playCue`. Keep plan 1's `roundWon` on the pass/close line and its `partitaOver` branch (`matchOver`/`matchWinners`), or plan 1's `everyMomentHasACaller` goes red. `stingTimerRef` and `duckMusicFor` no longer exist.
> - **No `jest.mock('@/lib/device/feedback')`** (the three sites in Tasks 5–7). Plan 1's `oneAudioMock` forbids it. Observe feedback through plan 1's `bootFeedback`, `sounds()` and `hapticCalls()`.
> - `preloadSounds` and `holdSounds` are gone. Plan 1 left `setTimeout(() => event([deal]), entryMs)`. The helpers this plan cites as "plan 1 Task 8's" are in plan 1 Task 11.
> - Name the landing-signal option you pass into `useLampRig` (plan 3 keeps it). Add an `onClock(key, clock)` callback to `usePileFlight`/`FlyingCards`, fed from the same clock as `bombClock`, because plan 4 binds to it.

**Goal:** Every consequence of a card landing (dust, shake, burst, flinch, scrim, sound, haptic, turn chip, lamp target, seat count) starts on the frame the thrown card touches the pile. The throw and the exchange move the way the lantern mockup moves them, with no card jumping between two places.

**Architecture:**
- The throw becomes one pure pose function, `flightPose`, evaluated on the UI thread by a per-flight frame clock (`useFlightClock`).
- Contact is *sampled* from that pose (`contactMs`), never guessed from constants.
- At the flight's first UI frame the clock computes `landsAt = frame.timestamp + contactMs` and hands it to JS (`scheduleOnRN`). A small JS module, `TableTimeline`, then sends that commit's sounds as one `feedback.event(moments, at)` call per anchor (the landing's at `landsAt`, the turn's at `handsOffAt`), plus React-state timers keyed on those two times.
- Pixel consequences, and the landing and bomb haptics, react to a `LandingSignal` shared value, which the clock writes on the contact frame itself.
- The exchange becomes one pure timeline (`lib/game/exchangeTimeline.ts`), shared by the client, which draws its legs on UI clocks, and the server, which arms the next seat from it.

**Tech Stack:**
- Reanimated 4.5.5: `useFrameCallback`, `FrameInfo.timestamp`, `useAnimatedReaction`, `getAnimatedStyle` in jest.
- react-native-worklets 0.10.4: `scheduleOnRN`.
- RN 0.86.3.
- TypeScript compiler API (the `typescript` already installed).
- Node 24 `node --test` with type stripping.
- Playwright with the virtual clock (`tests/e2e/helpers/virtualClock.ts`).

**Spec:** `docs/plans/2026-09-28-1259-design.md` §2 (with §1 for `feedback.event` and §8 for the bench). `docs/adr/0008-the-throw-is-the-lantern-mockups.md` supersedes `docs/adr/0002-a-play-leaves-the-seat-it-was-thrown-from.md` §1 and §4, and, by the lead's ruling on Q5 (the lead amends the ADRs), §2 and §3 as well: the count drops at the throw, and there are no departing backs. The measured causes are in `docs/research/2026-09-28-lantern-review.md` § "Timing: effects on guessed delays and separate clocks". The owner's findings are in `gh issue view 1259 --repo metasito/murlan --comments` (#3, #4, #9).

**Depends on plan 1 (lands first), whose interfaces this plan uses and never re-implements:**
- `lib/device/feedback.ts`: `event(moments: Moment[], at?: number)`, where `at` is `performance.now()` ms.
- `lib/device/feedback.ts`: `landingPulsesFor({ cards, bomb, mine })` and the worklet `runLandingPulses(steps)` (react-native-turbo-haptics behind them, ADR-0009 `docs/adr/0009-audio-and-haptics-libraries.md`). Task 5's contact reaction runs `runLandingPulses` on the UI thread with the steps `landingPulsesFor` gave on JS. This plan never imports `hapticsEngine`, and a landing's cue in `event` carries no haptic.
- `event(moments, at)` drops a play whose `at` is more than about one IO buffer in the past; it never plays late.
- `lib/device/moments.ts`: `type Moment` (with `mancheOver: { outcome: "won" | "lost" | "neutral" }`).
- `lib/diagnostics/index.ts`: `diag(row: DiagRow)`, where `DiagRow` is built from `interface DiagRows` (`lib/diagnostics/types.ts`) and every row carries `t` in `performance.now()` ms; the rows used here are `trigger: { name }`, `play: { lead; dropped; … }` and `onset: { db; source: "app" | "mic" }`.
- `lib/diagnostics/bench.ts`: `registerBenchScenario(name, run: (ctx: BenchContext) => Promise<void>)`; a scenario drives and records, and judges nothing. `lib/diagnostics/benchTable.ts`: `botTable()`, `driveBots(ctx, state, stepMs, onStep?)`.
- `scripts/diagnostics-verdict.mjs`: `GATES`, each `(rows) => { pass: boolean; metrics }`, and its helpers `times`, `onsetsOf`, `matchOnsets`, `p90`.

**Produces for plan 4 (exact names):**
- `components/flightPose.ts`, exporting:
  - `flightPose(elapsedMs, i, n, from: CardFrom, to: CardSlot, catchUp: boolean): Pose`;
  - `contactMs(n, from: CardFrom[], to: CardSlot[], catchUp: boolean): number`;
  - the types `CardFrom`, `CardSlot`, `Pose`.
- `landsAt`, delivered to JS by `components/table/useFlightClock.ts` (`onStart(key, landsAt, endsAt)`) and held by `components/table/tableTimeline.ts` (`useTableTimeline().landsAt`).

## Coverage

| Finding / defect (design §2, research) | Task | Red today on |
| --- | --- | --- |
| #3 dust and landing sound fire at 56–78 % of travel (`impactDelayMs` = 253 ms on a separate clock from the flight, `pile.tsx:851`, `:873` vs `:106`) | 4, 5, 6 | `tests/e2e/landingContact.spec.ts` (Task 3); `tests/native/landingOnContact.test.tsx` (Task 5) |
| #4 the throw is not the mockup's (no stagger, ease, lift, scale; 63 ms fade; `FLY_ROTS`; lifted shadow; hand-zone-centre origin; extra dip after the wobble) | 1, 4, 7 | `tests/ui-rules/flightPose.test.ts` (Task 1: module missing); `tests/e2e/flightOrigin.spec.ts` (Task 4); mockup parity `trick-landings` with the `flight` field (Task 7) |
| Pile-ups: landing, turn and pass cues fired from three timers in one beat (`useTableFeedback.ts:384-423`) | 6 | `tests/native/oneEventPerCommit.test.tsx` (Task 6) |
| `landsAtRef = Date.now() + handOffDelayMs` drives the turn chip, turn cue and lamp target (`useTableFeedback.ts:369-372`) | 6 | `tests/ui-rules/oneClock.test.ts` (Task 2) flags `useTableFeedback.ts:389`, `:399` |
| Departing backs on `withTiming(impactDelayMs)` (`seats.tsx:197`), and the mockup-vs-app double: a back leaves the fan while the face card is already in the air. Lead's ruling on Q5: follow the mockup (`S.counts[by]-=n` at the throw, `index.html:515`); the flying card *is* the departing card | 6 | `tests/e2e/throwLeavesTheFan.spec.ts` (Task 6): red today, because `seat-back-departing` is drawn during the flight and the badge holds the pre-throw count until landing |
| The hand-off gap: the app hands off 50 ms after its guessed landing, while the mockup hands off 175 ms after its flight ends (`index.html:612`, `:614`). Lead's ruling on Q6: follow the mockup | 6, 7 | `trick` parity's `moment:handoff` onset comparison (Task 7) |
| Bomb scrim ramp on `impactDelayMs` (`pile.tsx:847`) | 5 | `tests/native/feltScrim.test.tsx`, rewritten in Task 5 |
| The next play clears the pending impact, so the landing sound is dropped (`pile.tsx:824`) | 4, 6 | `tests/native/landingNotDropped.test.tsx` (Task 6) |
| Manche sting on `handOffDelayMs + shift` (`useTableFeedback.ts:457-461`) | 6 | `oneClock` flags `useTableFeedback.ts:457`; `tests/native/gameOverSting.test.tsx`, rewritten |
| The mockup-parity landing check subtracts `impactDelayMs` from its own action times (`mockupParity.ts:150`, `:179-182`), so it is green by construction | 7 | Task 7 deletes the subtraction; the `flight` field compares poses |
| #9 the exchange: prompt under the deal, bot gives at +600 ms, sound over the deal, 260 ms face-up hold, the fliers vanish at 1780 ms, the tags vanish without a fade | 8, 9 | `tests/ui-rules/exchangeTimeline.test.ts` (Task 8); `tests/e2e/exchangeTeleport.spec.ts` (Task 9) |
| Owner, round 3: the exchange is too quick, and its two centre messages do not make clear who gave what to whom | 8, 9 | `exchangeTimeline.test.ts` (the still rest ≥ `Hold.reveal`); `tests/e2e/exchangeAttribution.spec.ts` (Task 9: each tag names giver then receiver and rides within 8 pt of its card; no exchange text at the centre; each end is marked, giver then receiver: a ring flash at an opponent, the lift or the highlight at the viewer), after the Task 9 `/design` gate |
| Online a bot or AFK winner re-arms after `botMoveDelayMs()` = 1200 ms, not `exchangeAnnounceMs` (`gameTurn.ts:191`, `:218` call `armTurn(io, roomId)`, and `armTurn`'s default argument is `botMoveDelayMs()`, `gameTurn.ts:87`) | 8 | `tests/server/exchangeRearm.test.ts` (Task 8) |
| Teleport 1: the winner's confirmed card vanishes from the hand and a flier appears at the seat | 9 | `exchangeTeleport.spec.ts` |
| Teleport 2: the received card is drawn at the table centre (`GameTable.tsx:1201-1202`, `ExchangePrompt receivedCard`), then flies again from the loser's seat | 9 | `exchangeTeleport.spec.ts` |
| Teleport 3: given and thrown cards leave from the hand zone's centre (`flightOrigin`, `flightPhysics.ts:483-512`), not their own slot | 4, 9 | `flightOrigin.spec.ts`; `exchangeTeleport.spec.ts` |
| `ExchangeFlight.tsx:84`, `:102` and `sharedGameFlow.ts:191` time the exchange on separate timers | 9 | `oneClock` flags `ExchangeFlight.tsx:84`. `:102` and `sharedGameFlow.ts:191` use `EXCHANGE_FLIGHT_MS`, which is not a source, so Task 9 deletes them outright. |
| Other instances of the class, found by the scan: `GameTable.tsx:759` (deal cue after `setTimeout(entryMs)`), `deal.tsx:76`, `hand.tsx:861`, `pile.tsx:113`, `:130`, `:138`, `:145`, `:156`, `:810` | 4, 5, 10 | `oneClock.test.ts` |
| Stale docs: `FEEL-BAR.md:16` and `pile.tsx:836` say 213 ms; `FEEL-BAR.md:427` checks against `impactDelayMs`; the `components/CLAUDE.md` invariant names `impactDelayMs()` | 12 | `tests/tooling/claudeMdScope.test.ts` (`OWNED` lists `impactDelayMs`; updated in Task 12) |
| Device: sound onset against the contact frame | 11 | bench scenario `landingSync`, judged by `GATES.landingSync` in `scripts/diagnostics-verdict.mjs`; `tests/tooling/landingSyncGate.test.ts` |

## What the source says (verified 2026-09-28 in this worktree)

**The mockup's throw.** `play()` is at `tests/e2e/fixtures/lantern-table/index.html:513-517`, and `easeOut` = `1-(1-k)^3` at `:253`.
- Timing: `dur` = 380 per card and `step` = 45 when `dur > 300`, else 20. The reconnect catch-up calls `play(…, 200)` (`:642`), so **catch-up is 200 ms per card and a 20 ms stagger**. The design and ADR-0008 give only the stagger.
- Pose: lift `-24·sin(πe)`; scale `f.sc+(1-f.sc)e+.1·sin(πe)`; rotation `f.rot+(p.rot-f.rot)e`.
- Origin: for "you", `HE` (the card's own hand entry, `sc = w/CW`, CW = 65.97). For an opponent, `FANAT[by]` with `sc = .4`.
- Slots: `slots(n)` (`:509`) are 34/28/24 apart for n ≤ 2 / ≤ 4 / more, with rotation `(i-(n-1)/2)·1.2`, around `PILE = [457,222]` (`:248`).
- The landing: after `dur+(n-1)·step` it runs `landWobble`, `renderHud`, `sfx`, `onLand`.

**The mockup's exchange.** `receive` is at `:543-547`, `giveBack` at `:548-551`, and the chapter script at `:605-606`.
- `dealRun(0,…)` ends at 40+13·42+320 = 906 (`:532-542`). `receive` runs at 1250, 344 ms later; `giveBack` at 2800; the turn at 4000.
- Receive: the back flies 380 ms from `FANAT` to (457,236) with a `-30·sin` lift, scaling .37→1. It flips over 240 ms starting at +450, with the face shown from the flip's midpoint. At +1050 it slides 320 ms into its sorted slot with `hi`, and the highlight is removed 1000 ms after the slide.
- Giveback: `selectCard`, then 420 ms later `sfx('exchange')`. It flies 460 ms with a `-40·sin` lift, scaling 1→.34, flipping to its back over `p = (e-.25)/.45`. The loser's count rises at the end.

**The app today.**
- `components/flightPhysics.ts`:
  - `FLIGHT_MS` `:72`, `LANDING_FRACTION` `:74`, `impactDelayMs` `:77-81`;
  - `ANTICIPATE_PX`, `anticipationOffset` `:84-91`, `handOffDelayMs` `:94-96`, `landingHoldMs` `:105-107`;
  - `LAND_WOBBLE_MS`, `landWobble` `:110-123`;
  - `flightOrigin` `:483-512`, `readThrownPlay` `:932-944`, `seatPoint` `:947`;
  - `exchangeFlight` `:580`, `readExchangeTrips` `:998-1026`.
- `components/table/pile.tsx`:
  - `FlyingCards` `:64-216`, with its reduced `setTimeout(Motion.duration.tap)` `:113` and `withDelay(Motion.anticipate…)` `:130`;
  - `withDelay(impactDelayMs)` at `:138` and `:145`, the floor `setTimeout` `:156`;
  - `PlayedPile` `:430-570`, with the bounce `:474-480` and the flinch `:486-494`;
  - `usePileFlight` `:660-954`:
    - the sweep timer at `:810`;
    - the pending impact cleared at `:799` (round close) and `:824` (next play);
    - the scrim at `:846-849`, the impact timer at `:851-866`, the land timer at `:871-876`.
- `components/useTableFeedback.ts`:
  - `landsAtRef` `:369-372`, the turn reveal `:384-391`, the turn cue `:393-402`;
  - the exchange cue `:404-407`, the pass cue `:416-423`, the sting `:457-461`;
  - the shake `:213-235`, the burst `:188-198`.
- Wiring:
  - `components/GameTable.tsx`: `land` `:706-710`, the `boomTrigger` effect `:711-715`, the entry beat `:751-771`, departing `:883-885`, the pile/announcement/flight render `:1200-1271`;
  - `components/table/seats.tsx`: departing progress `:190-198`, `useArrivedCount` `:259-266`;
  - `components/table/deal.tsx:76`, `components/table/hand.tsx:861`.
- Exchange:
  - `lib/exchangeCeremony.ts` (`EXCHANGE_LEG_MS` 460, `MEET_HOLD_MS` 260, `exchangeAnnounceMs`; relative imports only, because `server:build` bundles it);
  - `lib/game/sharedGameFlow.ts`: `useExchangeCeremonyExpiry` `:65`, `useTradedCardsLanded` `:191`;
  - `app/game.tsx`: `AI_EXCHANGE_DELAY` `:34`, the bot give `:145-149`;
  - `context/GameContext.tsx`: `chooseExchangeCard` `:251-268`, `E2E_EXCHANGE_HOLD_MS` `:61`.
- Server:
  - `server/game/gameTurn.ts`: `armTurn(io, roomId, botDelayMs = botMoveDelayMs())` `:87`, `runBotTurn` ends in `armTurn(io, roomId)` `:191`, `handleAutoPass` in `armTurn(io, roomId)` `:218`;
  - `server/game/tableHandlers.ts:370`: `armTurn(io, roomId, exchangeAnnounceMs(bothJokersException))`.
- Tokens: `Motion` lives in **`lib/tokens.ts:361-438`** (the design says `lib/theme.ts`, which only re-exports it). `Hold.land = 50` is at `:481-484`. Its only reader is `landingHoldMs` (`flightPhysics.ts:106`), which Task 6 deletes.
- **The mockup's hand-off gap:**
  - The trick chapter (`index.html:610-614`) throws at 1150, 2600 and 5350, and hands off at 1750 (`:612`), 3250 (`:613`) and 5950 (`:614`).
  - Its "landing" is the `later(dur+(n-1)*step)` callback (`:517`): the flight's end, 380 + 45 = 425 ms after a pair's throw, at 1575, 3025 and 5775.
  - The gaps are therefore **175** (`:612`), **225** (`:613`) and **175** (`:614`).
  - Measured from contact instead (the fixture's geometry run through the Task 1 pose: an opponent pair from `FANAT` `:476` touches at +371/+372), the gaps are about 270, 279 and 228, with no constant among them. That is because the mockup scripts its hand-offs from the throw (600, 650, 600 ms), and the flight's end is what those times sit a fixed distance after.
- **The count at the throw:**
  - `displayedHandCount(handCount, cardsInFlight)` (`seatLayout.ts:218`) and `fanCounts` (`:238`) hold the thrown cards in the fan until landing.
  - Their readers are `seats.tsx:186`, `:717`, `:884` and `flightPhysics.ts:961`, `:965`.
  - The departing back's testID is `seat-back-departing` (`seats.tsx:146`).
- Tests that re-derive their expectation from the constants this plan deletes:
  - `tests/native/`: `landingDust`, `flightShadow`, `yourTurnCue`, `seatFanDeparting`, `gameOverSting`, `feltScrim`, `lampFlareEndToEnd`, `lampFlareReducedMotion`, `lampFlareWiring`, `onlinePartitaShake`;
  - `tests/ui-rules/flightPhysics.test.ts:615-736`, and `:1894-1911` (the `useTradedCardsLanded` caller pin);
  - `tests/ui-rules/motionScale.test.ts:72-82`.
- Tooling: `tests/ui-rules/*.test.ts` run under **`node --test`** (`package.json` `"test"`), not jest; jest runs only `tests/native/**/*.test.tsx` (`jest.config.js:22`).

## Global Constraints

- The throw is the mockup's `play()` (ADR-0008):
  - 380 ms per card, 45 ms stagger; in reconnect catch-up, 200 ms per card and 20 ms stagger;
  - ease `1−(1−k)³` on every channel;
  - lift `−24·sin(πe)`;
  - scale `sc+(1−sc)e+0.1·sin(πe)`, from 0.4 at a fan or the hand card's own width ratio;
  - rotation from the origin's angle to `(i−(n−1)/2)·1.2°`;
  - slots 34/28/24 pt apart (mockup units, scaled by `fieldCardW / 65.97`) around the pile centre.
- **Contact:** the first sample at which every card is within **1 pt** of its slot and within **0.01** of scale 1, stepped at **1 ms**.
- **`landsAt`:** in the `performance.now()` clock; `landsAt = first UI frame's timestamp + contactMs`.
- **The hand-off** (turn chip, turn cue, lamp target) happens at `endsAt + Hold.land`, where `endsAt` is the flight's end as its clock reports it, and **`Hold.land = 175`**. This is the mockup's gap from a flight's end to its hand-off (`index.html:612`, `:614`). Its one outlier, 225 at `:613`, is Design question 6.
- **The count drops at the throw** (the mockup, `index.html:515`; ADR-0008 as the lead amends it). A seat's fan and badge show `handCountOf(seat)` from the throw's first frame. The flying cards are the departing cards, and there are no departing backs.
- **The deal and exchange timings come from one shared module the client and server both import:** `lib/game/dealTimeline.ts` (the deal's schedule) and `lib/game/exchangeTimeline.ts` (the exchange's poses). The server computes nothing of its own.
- **One sound per event:** the moments one commit produces at one anchor go into one `feedback.event(moments, at)` call (design §1). The landing and the hand-off are two anchors, so two calls.
- **No `setTimeout`/`setInterval` delay and no `withDelay` delay may be derived from a motion token** (`tests/ui-rules/oneClock.test.ts`, Task 2). `withDelay(Motion.duration.*)` is allowed only when nothing in its subtree reaches JS (no `scheduleOnRN`/`runOnJS`, no completion callback).
- `lib/exchangeCeremony.ts`, `lib/game/dealTimeline.ts` and `lib/game/exchangeTimeline.ts` keep to relative imports and no `react-native` runtime import: `server:build` bundles them with no alias resolution.
- Locally: only `npx tsc --noEmit -p .`, `npx eslint <files>` and `node --test <one file>` (rules 1–4). Jest (`tests/native/`) and Playwright (`tests/e2e/`) run on CI. Push once, in Task 12. Intermediate commits may carry the red `oneClock` scan and red specs.
- Comment budget (`CLAUDE.md` § Comments, `npm run check:comments`): counted over the whole branch against `origin/main`. This branch deletes far more code than it adds, and deleted comments do not count as credit. The code blocks below carry **5 comment lines** in total, and the executor adds none.
- Stage by pathspec (rule 11). Edit files with Edit/Write (rule 44). Timing values live in `lib/tokens.ts` (rule 18). A deleted or renamed symbol updates every doc that names it (rule 43).

## Review Focus

1. **A fast next play** arrives while the previous flight is still in the air (online, two quick human plays; offline, a bot answering at `botMoveDelayMs` = 0 in e2e).
   - Expected: both flights keep their own contact, and both landing sounds and dusts happen.
   - Pinned by `tests/native/landingNotDropped.test.tsx` (Task 6).
2. **Reduced motion.** Nothing flies. Contact is the first frame, so every consequence happens at once, and nothing waits on a timer derived from a token.
   - Pinned by the reduced-motion case in `landingOnContact.test.tsx` (Task 5).
3. **A reconnect catch-up play** (`catchUp` true): a shorter flight whose contact must still be sampled, not guessed.
   - Pinned by the catch-up rows of `flightPose.test.ts` (Task 1) and by a catch-up case in `landingOnContact.test.tsx` (Task 5).
4. **The manche-ending play:** the landing and the sting come from one commit (offline) or two (online, where `handOutcomeFor` is `"pending"` first). The sting must follow the hand-off beat (`endsAt + Hold.land + shift`), never precede it.
   - Pinned by `gameOverSting.test.tsx`'s rewritten online case (Task 6).
5. **The exchange with the viewer as the loser, and as a bystander.** The loser's hand keeps the taken card until the receive leg departs. Both cards stay face up to every seat from the lift to the tuck (D5 revised), and each tag names its giver and receiver while riding its card (`exchangeAttribution.spec.ts`).
   - Pinned by `exchangeTeleport.spec.ts`'s loser and bystander tests (Task 9).

---

### Task 1: The throw as one pose function, and its tokens

**Files:**
- Create: `components/flightPose.ts`
- Create: `tests/ui-rules/flightPose.test.ts`
- Modify: `lib/tokens.ts:361-438` (add `Motion.throw`; `Motion.anticipate` is removed in Task 4 with its last reader)
- Modify: `tests/ui-rules/motionScale.test.ts:72-82`

**Interfaces:**
- Consumes: `Motion` from `lib/tokens.ts`.
- Produces:
  - `interface CardFrom { x: number; y: number; rot: number; scale: number }`
  - `interface CardSlot { x: number; y: number; rot: number }`
  - `interface Pose { x: number; y: number; rot: number; scale: number }`
  - `flightPose(elapsedMs: number, i: number, n: number, from: CardFrom, to: CardSlot, catchUp: boolean): Pose`
  - `contactMs(n: number, from: CardFrom[], to: CardSlot[], catchUp: boolean): number`
  - `flightEndMs(n: number, catchUp: boolean): number`
  - `pileSlots(n: number, cardW: number, roomW: number): CardSlot[]`

  All coordinates are in points, relative to the pile centre, with y growing downward. All functions are worklets and pure.

- [ ] **Step 1: Write the failing test**

`tests/ui-rules/flightPose.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as real from "../../components/flightPose.ts";
import type { CardFrom, CardSlot } from "../../components/flightPose.ts";

type Mod = typeof real;
const root = path.resolve(import.meta.dirname, "..", "..");

function sampledContact(m: Mod, n: number, from: CardFrom[], to: CardSlot[], catchUp: boolean): number {
  for (let t = 0; ; t++) {
    const all = from.every((f, i) => {
      const p = m.flightPose(t, i, n, f, to[i], catchUp);
      return Math.hypot(p.x - to[i].x, p.y - to[i].y) <= 1 && Math.abs(p.scale - 1) <= 0.01;
    });
    if (all) return t;
    assert.ok(t < 5000, "the pose never reaches its slots");
  }
}

const FANS: CardFrom[] = [
  { x: 0, y: -97.5, rot: 0, scale: 0.4 },
  { x: -328, y: -42, rot: 90, scale: 0.4 },
  { x: 328, y: -42, rot: -90, scale: 0.4 },
];
const handFrom = (i: number, n: number): CardFrom => ({ x: (i - (n - 1) / 2) * 40, y: 150, rot: (i - (n - 1) / 2) * 3, scale: 1.2 });

function cases() {
  const out: { name: string; n: number; from: CardFrom[]; catchUp: boolean }[] = [];
  for (let n = 1; n <= 6; n++) {
    for (const catchUp of [false, true]) {
      FANS.forEach((f, s) => out.push({ name: `fan ${s}, n=${n}, catchUp=${catchUp}`, n, from: Array(n).fill(f), catchUp }));
      out.push({ name: `hand, n=${n}, catchUp=${catchUp}`, n, from: Array.from({ length: n }, (_, i) => handFrom(i, n)), catchUp });
    }
  }
  return out;
}

describe("the throw's contact is sampled from its own pose", () => {
  for (const c of cases()) {
    test(c.name, () => {
      const to = real.pileSlots(c.n, 66, 600);
      const sampled = sampledContact(real, c.n, c.from, to, c.catchUp);
      assert.equal(real.contactMs(c.n, c.from, to, c.catchUp), sampled);
      c.from.forEach((f, i) => assert.deepEqual(real.flightPose(0, i, c.n, f, to[i], c.catchUp), f));
      c.from.forEach((f, i) => {
        const p = real.flightPose(sampled + 60, i, c.n, f, to[i], c.catchUp);
        assert.ok(Math.hypot(p.x - to[i].x, p.y - to[i].y) < 0.01 && Math.abs(p.scale - 1) < 0.001, `card ${i} is not at rest 60 ms after contact`);
      });
    });
  }

  test("a single card from the top fan touches well before the mockup's 380 ms tween ends", () => {
    const to = real.pileSlots(1, 66, 600);
    const t = real.contactMs(1, [FANS[0]], to, false);
    assert.ok(t >= 290 && t <= 340, `contact at ${t} ms`);
  });

  test("the slots are the mockup's: 34, 28 and 24 apart at the mockup's card width, 1.2° per step", () => {
    const gap = (n: number) => { const s = real.pileSlots(n, 65.97, 1000); return s[1].x - s[0].x; };
    assert.deepEqual([gap(2), gap(4), gap(5)].map((g) => Math.round(g * 100) / 100), [34, 28, 24]);
    assert.deepEqual(real.pileSlots(3, 65.97, 1000).map((s) => s.rot), [-1.2, 0, 1.2]);
    const tight = real.pileSlots(6, 66, 150);
    assert.ok(tight[5].x - tight[0].x + 66 <= 150 + 1e-9, "the pile overflows its room");
  });
});

test("a planted ease moves contact, and contactMs follows it", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "flight-pose-"));
  mkdirSync(path.join(dir, "components"));
  mkdirSync(path.join(dir, "lib"));
  writeFileSync(path.join(dir, "lib", "tokens.ts"), readFileSync(path.join(root, "lib", "tokens.ts")));
  const source = readFileSync(path.join(root, "components", "flightPose.ts"), "utf8");
  assert.equal(source.split("const EASE_POWER = 3;").length, 2, "flightPose.ts must declare `const EASE_POWER = 3;` once");
  writeFileSync(path.join(dir, "components", "flightPose.ts"), source.replace("const EASE_POWER = 3;", "const EASE_POWER = 2;"));
  const planted: Mod = await import(pathToFileURL(path.join(dir, "components", "flightPose.ts")).href);
  const to = real.pileSlots(2, 66, 600);
  const from = [FANS[0], FANS[0]];
  const before = sampledContact(real, 2, from, to, false);
  const after = sampledContact(planted, 2, from, to, false);
  assert.notEqual(after, before, "the planted ease did not move contact, so this test cannot see a guessed contact");
  assert.equal(planted.contactMs(2, from, to, false), after);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/ui-rules/flightPose.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` … `components/flightPose.ts`.

- [ ] **Step 3: Add the tokens**

In `lib/tokens.ts`, inside `Motion`, after `stagger: { deal: 42 },`:

```ts
  /** The lantern mockup's `play()` (ADR-0008): per card, and between cards; catch-up is its reconnect replay. */
  throw: { card: 380, stagger: 45, catchUpCard: 200, catchUpStagger: 20 },
```

In `tests/ui-rules/motionScale.test.ts`, replace the `Motion.anticipate` assertion (`:78-82`) with:

```ts
  assert.deepEqual(
    Motion.throw,
    { card: 380, stagger: 45, catchUpCard: 200, catchUpStagger: 20 },
    "the throw is the lantern mockup's play(), ADR-0008"
  );
```

The test's name and the `travel` assertion stay: `travel` still times the deal and the sweep.

- [ ] **Step 4: Write `components/flightPose.ts`**

```ts
import { Motion } from "../lib/tokens.ts";

export interface CardFrom { x: number; y: number; rot: number; scale: number }
export interface CardSlot { x: number; y: number; rot: number }
export interface Pose { x: number; y: number; rot: number; scale: number }

const EASE_POWER = 3;
const LIFT = 24;
const POP = 0.1;
const MOCKUP_CARD_W = 65.97;
const SLOT_ROT = 1.2;

function timing(catchUp: boolean): { card: number; stagger: number } {
  "worklet";
  return catchUp
    ? { card: Motion.throw.catchUpCard, stagger: Motion.throw.catchUpStagger }
    : { card: Motion.throw.card, stagger: Motion.throw.stagger };
}

export function flightEndMs(n: number, catchUp: boolean): number {
  "worklet";
  const { card, stagger } = timing(catchUp);
  return card + (n - 1) * stagger;
}

export function flightPose(elapsedMs: number, i: number, n: number, from: CardFrom, to: CardSlot, catchUp: boolean): Pose {
  "worklet";
  const { card, stagger } = timing(catchUp);
  const k = Math.min(1, Math.max(0, (elapsedMs - i * stagger) / card));
  const e = 1 - Math.pow(1 - k, EASE_POWER);
  const arc = Math.sin(Math.PI * e);
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e - LIFT * arc,
    rot: from.rot + (to.rot - from.rot) * e,
    scale: from.scale + (1 - from.scale) * e + POP * arc,
  };
}

export function contactMs(n: number, from: CardFrom[], to: CardSlot[], catchUp: boolean): number {
  "worklet";
  const end = flightEndMs(n, catchUp);
  for (let t = 0; t < end; t++) {
    let touching = true;
    for (let i = 0; i < n && touching; i++) {
      const p = flightPose(t, i, n, from[i], to[i], catchUp);
      touching = Math.hypot(p.x - to[i].x, p.y - to[i].y) <= 1 && Math.abs(p.scale - 1) <= 0.01;
    }
    if (touching) return t;
  }
  return end;
}

export function pileSlots(n: number, cardW: number, roomW: number): CardSlot[] {
  "worklet";
  const wanted = (n <= 2 ? 34 : n <= 4 ? 28 : 24) * (cardW / MOCKUP_CARD_W);
  const gap = n > 1 ? Math.min(wanted, (roomW - cardW) / (n - 1)) : 0;
  const out: CardSlot[] = [];
  for (let i = 0; i < n; i++) {
    const c = i - (n - 1) / 2;
    out.push({ x: c * gap, y: 0, rot: c * SLOT_ROT });
  }
  return out;
}
```

`n` in `flightPose` is part of the fixed signature for plan 4. The pose does not read it.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test tests/ui-rules/flightPose.test.ts tests/ui-rules/motionScale.test.ts && npx tsc --noEmit -p . && npx eslint components/flightPose.ts lib/tokens.ts tests/ui-rules/flightPose.test.ts tests/ui-rules/motionScale.test.ts`
Expected: PASS. Also confirm the plant bites: temporarily make `contactMs` return `Math.round(0.84 * flightEndMs(n, catchUp))`, and the rows and the planted test fail. Then revert.

- [ ] **Step 6: Commit**

```bash
git add -- components/flightPose.ts tests/ui-rules/flightPose.test.ts lib/tokens.ts tests/ui-rules/motionScale.test.ts
git commit -m "feat(table): the throw as one sampled pose, the lantern mockup's play()

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The class guard: no timer delay derived from a motion token

**Class:** an effect's onset keyed to a guessed time on a clock separate from the motion it describes.

**Files:**
- Create: `tests/ui-rules/oneClock.test.ts`

**Interfaces:**
- Consumes: `components/flightPose.ts` (Task 1) as a source file; `typescript`.
- Produces: nothing at runtime. It is the guard every later task turns green.

**The rule:**
- It applies in `app/`, `components/`, `context/` and `lib/`.
- **A timer delay is flagged** if it derives from a source. The timer delays are:
  - the second argument of `setTimeout`/`setInterval`;
  - the first argument of `withDelay`.
- **Sources:**
  - any `Motion.*` member;
  - a `motionMs(...)` call;
  - any symbol declared in `components/flightPose.ts`, `lib/game/dealTimeline.ts` or `lib/game/exchangeTimeline.ts`;
  - any `components/flightPhysics.ts` export whose name ends in `Ms` or `_MS`.
- **The timer calls** are matched by name whether bare or reached through `global`, `globalThis` or `window` (`global.setTimeout(...)`).
- **Allowed for `withDelay` only: a UI-thread chain.** A `withDelay` whose delay is `Motion.duration.*` or `motionMs(...)` is allowed only when nothing in its subtree reaches JS: no `scheduleOnRN`/`runOnJS` call, and no completion callback (a third argument to `withTiming`/`withSpring`, or a second to `withDecay`). A chain that calls back is a JS consequence on a guessed delay, and is flagged like a `setTimeout`.
- **Derivation follows:**
  - `const`/`let` initializers, including destructuring: a binding element (`const { card } = Motion.throw`) derives from its declaration's initializer;
  - imports (through `getAliasedSymbol`);
  - every assignment to a binding or to its `.current`;
  - sub-expressions, including call arguments and arrow bodies bound to a `const`;
  - **the return expressions of a named function** that is called (`function impactDelayMs(...) { return … }` shape): a call derives from what the function returns;
  - **callback parameters, where resolvable:** a parameter of an arrow or function expression passed to a method call (`xs.forEach((ms) => …)`, `.map`, `.reduce`) derives from that call's receiver `xs`.
- **Derivation stops at:** parameters and props of a component or named function, and anything destructured from them. A time handed in, such as `landsAt`, is a reported time.
- The planted probe is served by the compiler host. Every case above is planted, and it must be flagged on exactly the nine lines listed.

- [ ] **Step 1: Write the scan**

`tests/ui-rules/oneClock.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..", "..");
const SCOPE = ["app", "components", "context", "lib"].map((d) => path.join(root, d) + path.sep);
const PROBE = path.join(root, "components", "__oneClockProbe.ts");
const MOTION_FILES = ["components/flightPose.ts", "lib/game/dealTimeline.ts", "lib/game/exchangeTimeline.ts"].map((p) => path.join(root, p));
const PHYSICS = path.join(root, "components", "flightPhysics.ts");
const TOKENS = path.join(root, "lib", "tokens.ts");

const PROBE_LINES = [
  `import { Motion, motionMs } from "../lib/tokens";`,
  `import { contactMs as touch } from "./flightPose";`,
  `import { withDelay, withTiming } from "react-native-reanimated";`,
  `import { scheduleOnRN } from "react-native-worklets";`,
  `import { useRef } from "react";`,
  `declare const done: () => void;`,
  `function hold() { return Motion.throw.card + 10; }`,
  `export function probe(landsAt: number) {`,
  `  setTimeout(done, Motion.throw.card);`,
  `  const wait = Motion.throw.stagger * 2;`,
  `  setTimeout(done, wait);`,
  `  const ref = useRef(0);`,
  `  ref.current = Date.now() + touch(1, [], [], false);`,
  `  setTimeout(done, ref.current - Date.now());`,
  `  withDelay(touch(1, [], [], false), withTiming(1));`,
  `  const { card } = Motion.throw;`,
  `  setTimeout(done, card);`,
  `  setTimeout(done, hold());`,
  `  [Motion.throw.card].forEach((ms) => setTimeout(done, ms));`,
  `  global.setTimeout(done, Motion.throw.card);`,
  `  withDelay(Motion.duration.shift, withTiming(1, {}, () => scheduleOnRN(done)));`,
  `  setTimeout(done, landsAt - performance.now());`,
  `  withDelay(Motion.duration.shift, withTiming(1));`,
  `  withDelay(motionMs("shift", false), withTiming(1));`,
  `}`,
];
const PROBE_FLAGGED = [
  "setTimeout(done, Motion.throw.card);",
  "setTimeout(done, wait);",
  "setTimeout(done, ref.current - Date.now());",
  "withDelay(touch(1, [], [], false), withTiming(1));",
  "setTimeout(done, card);",
  "setTimeout(done, hold());",
  "setTimeout(done, ms);",
  "global.setTimeout(done, Motion.throw.card);",
  "withDelay(Motion.duration.shift, withTiming(1, {}, () => scheduleOnRN(done)));",
];

const options = ts.getParsedCommandLineOfConfigFile(path.join(root, "tsconfig.json"), {}, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (d) => assert.fail(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
})!;

function scan(): { file: string; line: number; text: string }[] {
  const host = ts.createCompilerHost(options.options);
  const read = host.getSourceFile;
  host.getSourceFile = (file, ...rest) =>
    path.resolve(file) === PROBE ? ts.createSourceFile(file, PROBE_LINES.join("\n"), ts.ScriptTarget.Latest, true) : read(file, ...rest);
  const inScope = (f: string) => SCOPE.some((d) => path.resolve(f).startsWith(d)) && !f.endsWith(".d.ts");
  const program = ts.createProgram([...options.fileNames.filter(inScope), PROBE], options.options, host);
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles().filter((f) => inScope(f.fileName));

  const resolve = (s: ts.Symbol | undefined) => (s && s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
  const writes = new Map<ts.Symbol, ts.Expression[]>();
  for (const f of files) {
    const visit = (n: ts.Node): void => {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const target = ts.isPropertyAccessExpression(n.left) && n.left.name.text === "current" ? n.left.expression : n.left;
        const s = resolve(checker.getSymbolAtLocation(target));
        if (s) writes.set(s, [...(writes.get(s) ?? []), n.right]);
      }
      ts.forEachChild(n, visit);
    };
    visit(f);
  }

  const labelOf = (id: ts.Identifier, s: ts.Symbol): string | null => {
    const decl = s.declarations?.[0];
    if (!decl) return null;
    const file = path.resolve(decl.getSourceFile().fileName);
    if (MOTION_FILES.includes(file)) return "flight";
    if (file === PHYSICS && /(Ms|_MS)$/.test(s.name) && ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Export) return "flight";
    if (file === TOKENS && s.name === "motionMs") return "duration";
    if (file === TOKENS && s.name === "Motion") {
      const p = id.parent;
      return ts.isPropertyAccessExpression(p) && p.expression === id && p.name.text === "duration" ? "duration" : "motion";
    }
    return null;
  };

  const labels = (node: ts.Node): Set<string> => {
    const out = new Set<string>();
    const seen = new Set<ts.Symbol>();
    const visit = (n: ts.Node): void => {
      if (ts.isIdentifier(n)) {
        const s = resolve(checker.getSymbolAtLocation(n));
        if (!s || seen.has(s)) return;
        seen.add(s);
        const label = labelOf(n, s);
        if (label) return void out.add(label);
        for (const d of s.declarations ?? []) {
          let root: ts.Node = d;
          while (ts.isBindingElement(root) || ts.isObjectBindingPattern(root) || ts.isArrayBindingPattern(root)) root = root.parent;
          if (ts.isVariableDeclaration(root) && root.initializer) visit(root.initializer);
          if (ts.isFunctionDeclaration(d) && d.body) {
            const returns = (b: ts.Node): void => {
              if (ts.isReturnStatement(b) && b.expression) visit(b.expression);
              if (!ts.isFunctionLike(b)) ts.forEachChild(b, returns);
            };
            ts.forEachChild(d.body, returns);
          }
          if (ts.isParameter(d) && (ts.isArrowFunction(d.parent) || ts.isFunctionExpression(d.parent))) {
            const call = d.parent.parent;
            if (ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)) visit(call.expression.expression);
          }
        }
        for (const w of writes.get(s) ?? []) visit(w);
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return out;
  };

  const TIMER_HOSTS = new Set(["global", "globalThis", "window"]);
  const timerName = (e: ts.Expression): string | null =>
    ts.isIdentifier(e) ? e.text
    : ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && TIMER_HOSTS.has(e.expression.text) ? e.name.text
    : null;
  const CALLBACK_ARG: Record<string, number> = { withTiming: 2, withSpring: 2, withDecay: 1 };
  const reachesJs = (n: ts.Node): boolean => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.text;
      if (name === "scheduleOnRN" || name === "runOnJS") return true;
      if (name in CALLBACK_ARG && n.arguments.length > CALLBACK_ARG[name]) return true;
    }
    return ts.forEachChild(n, reachesJs) ?? false;
  };

  const found: { file: string; line: number; text: string }[] = [];
  for (const f of files) {
    const visit = (n: ts.Node): void => {
      const name = ts.isCallExpression(n) ? timerName(n.expression) : null;
      if (name && ts.isCallExpression(n)) {
        const delay = name === "withDelay" ? n.arguments[0] : name === "setTimeout" || name === "setInterval" ? n.arguments[1] : undefined;
        if (delay) {
          const l = labels(delay);
          if (name === "withDelay" && !reachesJs(n)) l.delete("duration");
          if (l.size > 0) {
            const { line } = f.getLineAndCharacterOfPosition(n.getStart());
            found.push({ file: path.relative(root, f.fileName).replaceAll("\\", "/"), line: line + 1, text: n.getText(f) });
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(f);
  }
  return found;
}

const found = scan();

test("the planted probe is flagged on exactly the nine guessed delays", () => {
  const probe = found.filter((f) => f.file === "components/__oneClockProbe.ts").map((f) => `${f.text};`);
  assert.deepEqual(probe, PROBE_FLAGGED);
});

test("no timer in the app waits out a motion token: every landing consequence comes from the flight's contact", () => {
  const real = found.filter((f) => f.file !== "components/__oneClockProbe.ts").map((f) => `${f.file}:${f.line}  ${f.text}`);
  assert.deepEqual(real, [], "derive the time from the flight's reported landsAt (components/table/tableTimeline.ts), or react to it on the UI thread");
});
```

- [ ] **Step 2: Run it to verify it fails for the right reason**

Run: `node --test tests/ui-rules/oneClock.test.ts`
Expected:
- The probe test passes.
- The app test **fails**, listing at least:
  - `components/GameTable.tsx:759`;
  - `components/table/ExchangeFlight.tsx:84`;
  - `components/table/deal.tsx:76`;
  - `components/table/hand.tsx:861`;
  - `components/table/pile.tsx:113`, `:130`, `:138`, `:145`, `:156`, `:810`, `:851`, `:873`;
  - `components/useTableFeedback.ts:389`, `:399`, `:457`.

  Record the actual list in the commit message.
- Following named-function returns adds one hit from Task 8 on: `exchangeAnnounceMs` then returns from `GIVE_MS`, an `exchangeTimeline.ts` source, so `lib/game/sharedGameFlow.ts:65` (`useExchangeCeremonyExpiry`) and the dismiss timer `ExchangeAnnouncement.tsx:73` are flagged. Task 9 re-anchors both. Today they read `EXCHANGE_FLIGHT_MS`, which is not a source.
- If the list holds a line not named here, read it. It is either a new instance of the class, in which case add it to the task that owns its file (Tasks 4–10), or proof the rule over-reaches; in that case stop and report to the lead. Never add an exemption.
- If the probe test fails, fix the scan, not the probe.

- [ ] **Step 3: Local checks**

Run: `npx tsc --noEmit -p . && npx eslint tests/ui-rules/oneClock.test.ts`
Expected: clean.

- [ ] **Step 4: Commit (red on purpose; it turns green in Task 10)**

```bash
git add -- tests/ui-rules/oneClock.test.ts
git commit -m "test(table): flag every timer that waits out a motion token

Red today on: <the list from Step 2>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The web can see contact: a flight trace source and the landing-contact spec

**Files:**
- Modify: `lib/e2eTrace.ts` (add the `flight` field and source)
- Modify: `tests/e2e/helpers/traceDiff.ts` (add the `"flight"` field, the `contactPt` tolerance, `flightSegments`, `diffFlight`)
- Modify: `tests/ui-rules/traceDiff.test.ts` (planted cases for `diffFlight`)
- Modify: `components/table/pile.tsx` (today's `FlyingCards` registers the source and renders a slot marker per card)
- Modify: `tests/e2e/helpers/mockupParity.ts` (export `pairsTable`, `pass`, `botMove`, `playLowest`; add `flight` to `MOCKUP_SAMPLE`)
- Create: `tests/e2e/landingContact.spec.ts`

**Interfaces:**
- Produces:
  - `TraceFrame.flight: number` — the largest distance, in pt, of any flying card's drawn centre from its slot's centre, measured from the DOM on web, and `0` with nothing flying.
  - `useTraceSource("flight", read: () => number)`.
  - In `traceDiff.ts`:
    - `export function flightSegments(trace: Trace): { start: number; half: number; contact: number }[]`
    - `export function diffFlight(mockup: Trace, app: Trace, tol?: typeof TOLERANCES): Failure[]`
- DOM contract (web): each flying card is `testID="flying-card"`. A sibling `testID="flight-slot"` has the same size, no transform, and sits at the card's slot. The trace reads their `getBoundingClientRect()` centres. Rotation and scale about the centre do not move a centre, so this measures only what the pose moves.

- [ ] **Step 1: Write the failing unit tests for the diff**

Append to `tests/ui-rules/traceDiff.test.ts`, reusing its `reference()` helper (frames every 16 ms from 0 to 480):

```ts
describe("the flight field", () => {
  const withFlight = (start: number, contact: number, from = 120): Trace => {
    const t = reference();
    for (const f of t.frames) {
      f.flight = f.t < start ? 0 : f.t >= contact ? 0.5 : from * (1 - (f.t - start) / (contact - start)) + 0.6;
    }
    return t;
  };

  test("the same flight on both sides passes", () => {
    assert.deepEqual(diffFlight(withFlight(32, 336), withFlight(32, 336)), []);
  });

  test("an app flight that touches down 32 ms late fails", () => {
    const failures = diffFlight(withFlight(32, 336), withFlight(32, 368));
    assert.ok(failures.some((f) => f.field === "flight" && /contact/.test(f.message)), JSON.stringify(failures));
  });

  test("a flight on one side only fails", () => {
    const none = reference();
    for (const f of none.frames) f.flight = 0;
    assert.ok(diffFlight(withFlight(32, 336), none).some((f) => /one side/.test(f.message)));
  });
});
```

Add `diffFlight` to the file's import list. Also add `flight: 0` to the frames `reference()` builds.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test tests/ui-rules/traceDiff.test.ts`
Expected: FAIL with `diffFlight` not exported (a `SyntaxError` naming it).

- [ ] **Step 3: Implement the field and the diff**

`lib/e2eTrace.ts`:
- Add `flight: number;` to `TraceFrame`, and `flight: () => number;` to `Sources`.
- Add `flight: new Set(),` to `sources`.
- In `tick`, add:

```ts
      flight: Math.max(0, ...[...sources.flight].map((read) => read())),
```

`tests/e2e/helpers/traceDiff.ts`:
- Add `| "flight"` to `Field`, and `contactPt: 1,` to `TOLERANCES`.
- Add:

```ts
export function flightSegments(trace: Trace, tol: typeof TOLERANCES = TOLERANCES): { start: number; half: number; contact: number }[] {
  const out: { start: number; half: number; contact: number }[] = [];
  let open: { start: number; from: number; half?: number } | null = null;
  for (const f of trace.frames) {
    if (!open && f.flight > tol.contactPt) open = { start: f.t, from: f.flight };
    else if (open) {
      if (open.half === undefined && f.flight <= open.from / 2) open.half = f.t;
      if (f.flight <= tol.contactPt) {
        out.push({ start: open.start, half: open.half ?? f.t, contact: f.t });
        open = null;
      }
    }
  }
  return out;
}

export function diffFlight(mockup: Trace, app: Trace, tol: typeof TOLERANCES = TOLERANCES): Failure[] {
  const m = flightSegments(mockup, tol);
  const a = flightSegments(app, tol);
  const out: Failure[] = [];
  if (m.length !== a.length) {
    out.push({ field: "flight", t: 0, mockup: m.length, app: a.length, message: `${a.length} flights against ${m.length}: a flight on one side only` });
  }
  for (let i = 0; i < Math.min(m.length, a.length); i++) {
    for (const k of ["start", "half", "contact"] as const) {
      if (Math.abs(a[i][k] - m[i][k]) > tol.onsetMs) {
        out.push({ field: "flight", t: a[i][k], mockup: m[i][k], app: a[i][k], message: `flight ${i} ${k} at ${a[i][k]} ms, the mockup's at ${m[i][k]} ms` });
      }
    }
  }
  return out;
}
```

- In `movingFields`, add `if (differs((f) => f.flight)) moved.add("flight");`.

- [ ] **Step 4: Make today's flight measurable, and export the table drivers**

In `components/table/pile.tsx`, today's `FlyingCards` draws the group at the arc from `fieldArc`. Wrap each card's render in a `View` that carries `testID="flying-card"` and the card's current transform. Render beside it an absolutely positioned `View` with `testID="flight-slot"` and `pointerEvents="none"`, the same `left`/`top`/`width`/`height`, and no transform. Register the source in `usePileFlight`, the hook `GameTable` calls for the table's whole life (`PlayedPile` is swapped out for `StartCardBanner`, `GameTable.tsx:1213-1232`):

```tsx
  useTraceSource(
    "flight",
    useCallback(() => {
      if (typeof document === "undefined") return 0;
      const cards = document.querySelectorAll('[data-testid="flying-card"]');
      const slots = document.querySelectorAll('[data-testid="flight-slot"]');
      let far = 0;
      cards.forEach((c, i) => {
        const a = c.getBoundingClientRect();
        const b = slots[i]?.getBoundingClientRect();
        if (b) far = Math.max(far, Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2));
      });
      return far;
    }, [])
  );
```

This read is the one Task 4 keeps. Put it in `components/table/flightTrace.ts` as `export function readFlightFromDom(): number`, and register it **once, in `usePileFlight`**, never per `FlyingCards`. `useTraceSource` adds the function to a `Set` and deletes it on unmount (`lib/e2eTrace.ts:92-99`). Two mounted flights would share one entry, and the first to unmount would remove the source from under the second. The read already covers every `flying-card` in the DOM.

In `tests/e2e/helpers/mockupParity.ts`:
- Export `pairsTable`, `pass`, `botMove` and `playLowest` (`:87-117`), and add `belowCapsTable` (Task 4's seed, every opponent below its fan cap) beside `pairsTable`, built on the same `seatTable` (`:90`).
- Add to `MOCKUP_SAMPLE`'s returned object:

```js
    flight: Math.max(0, ...[...document.querySelectorAll("#pile .grp.cur .card")].map((c) => {
      const t = getComputedStyle(c).transform;
      if (!t || t === "none") return 0;
      const v = t.slice(t.indexOf("(") + 1, -1).split(",").map(Number);
      return Math.hypot(v[4], v[5]);
    })),
```

`play()` writes `translate(...) rotate(...) scale(...)`, so the matrix's `e`/`f` are the translation.

- [ ] **Step 5: Write the landing-contact spec**

`tests/e2e/landingContact.spec.ts`:

```ts
import { test, expect } from "./fixtures";
import { installVirtualClock, step, takeOver } from "./helpers/virtualClock";
import { botMove, pairsTable, playLowest, recorded } from "./helpers/mockupParity";

test.use({ launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] } });

const SOUND_SPY = `(() => {
  window.__scheduled = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when = 0, ...rest) {
    const ctx = this.context;
    const lead = Math.max(when, ctx.currentTime) - ctx.currentTime;
    window.__scheduled.push({ at: performance.now() + lead * 1000, state: ctx.state });
    return start.call(this, when, ...rest);
  };
})()`;

// The scheduled `when` only. Output latency is the device's, and Task 11's gate measures it on the phone; adding it here would move the spec with the headless browser's audio sink.
test("each landing sound is scheduled for the frame the cards touch the pile", async ({ page, baseURL }) => {
  await page.addInitScript(SOUND_SPY);
  await installVirtualClock(page, 1259);
  await pairsTable(page, baseURL!);
  await takeOver(page);
  await page.evaluate(() => (globalThis as unknown as { murlanTrace: { start(): void } }).murlanTrace.start());
  for (const move of [playLowest(2), botMove, botMove]) {
    await move(page);
    for (let i = 0; i < 60; i++) await step(page);
  }
  const frames = await recorded(page);
  const contacts: number[] = [];
  let flying = false;
  for (const f of frames) {
    if (!flying && f.flight > 1) flying = true;
    else if (flying && f.flight <= 1) {
      contacts.push(f.t);
      flying = false;
    }
  }
  expect(contacts.length, "three flights traced").toBe(3);
  const sounds = (await page.evaluate(() => (window as unknown as { __scheduled: { at: number; state: string }[] }).__scheduled));
  expect(sounds.every((s) => s.state === "running"), "the audio context is running").toBe(true);
  for (const c of contacts) {
    const nearest = Math.min(...sounds.map((s) => Math.abs(s.at - c)));
    expect(nearest, `a landing sound within 16 ms of the contact frame at ${c} ms`).toBeLessThanOrEqual(16);
  }
  const onsets = frames.filter((f) => f.onsets.includes("moment:landing")).map((f) => f.t);
  expect(onsets.length).toBe(3);
  onsets.forEach((t, i) => expect(Math.abs(t - contacts[i]), `moment:landing ${i}`).toBeLessThanOrEqual(16));
});
```

`fixtures`, `pairsTable`'s signature `(page, baseURL)`, and `recorded(page, from?)` are the existing helpers (`tests/e2e/fixtures.ts`, `mockupParity.ts:87`, `:330`). If `installVirtualClock` must run before `goto` in `pairsTable`, reorder to match `mockupParity.ts`'s own `openAppSide` (`:391`); read it first.

- [ ] **Step 6: Verify locally what can be verified**

Run: `node --test tests/ui-rules/traceDiff.test.ts && npx tsc --noEmit -p . && npx eslint lib/e2eTrace.ts tests/e2e/helpers/traceDiff.ts tests/e2e/helpers/mockupParity.ts tests/e2e/landingContact.spec.ts components/table/pile.tsx components/table/flightTrace.ts tests/ui-rules/traceDiff.test.ts`
Expected: PASS and clean.

`landingContact.spec.ts` runs on CI (rule 3 allows one spec locally if memory permits). Expected **red today**, because:
- `moment:landing` fires about 40–60 ms before the first frame within 1 pt (research: 11.5–14.8 pt from rest at 253 ms);
- no `AudioBufferSourceNode` sound is scheduled until plan 1's engine.

Record which assertion fails.

- [ ] **Step 7: Commit**

```bash
git add -- lib/e2eTrace.ts tests/e2e/helpers/traceDiff.ts tests/ui-rules/traceDiff.test.ts components/table/pile.tsx components/table/flightTrace.ts tests/e2e/helpers/mockupParity.ts tests/e2e/landingContact.spec.ts
git commit -m "test(e2e): trace the flight from the DOM and hold the landing sound to contact

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The flight runs on its own frame clock, from where each card really is

**Files:**
- Create: `components/table/useFlightClock.ts`
- Modify: `components/table/pile.tsx`:
  - `FlyingCards` `:64-216` is rewritten;
  - `PlayedPile` and `SweepCards` switch `fieldArc` → `pileSlots`;
  - the bounce `:474-480` is deleted;
  - `usePileFlight` holds a list of flights, not one.
- Create: `components/fanGeometry.ts` (the fan's shape: `seatFanArc`, moved from `seatLayout.ts:275-287`, and the new `fanPoint`)
- Modify: `components/flightPhysics.ts`:
  - `readThrownPlay` returns per-card `CardFrom[]`;
  - delete `FLIGHT_MS`, `ANTICIPATE_PX` and `anticipationOffset`;
  - keep `landWobble` and `LAND_WOBBLE_MS` (which it reads), now driven by the flight clock past the tween's end.
- Modify: `components/seatLayout.ts` (`seatFanArc` moves out; `sideSlotHeight`/`topFanHeight` import it from `./fanGeometry.ts`), and every other importer of `seatFanArc` (Grep; `components/table/seats.tsx` `CardFan`)
- Create: `tests/native/flightStartsOnce.test.tsx`
- Modify: `components/table/hand.tsx` (publish each drawn card's origin)
- Modify: `components/GameTable.tsx`:
  - pass `handOrigins` and `catchUp`;
  - render one `FlyingCards` per flight inside the pile's group.
- Modify: `lib/tokens.ts` (delete `Motion.anticipate`)
- Modify: `tests/ui-rules/flightPhysics.test.ts:615-736` (delete the anticipation/impact-delay blocks, repoint the wobble block)
- Modify: `tests/native/flightShadow.test.tsx` (the lifted shadow is gone; see Step 5)
- Create: `tests/e2e/flightOrigin.spec.ts`

**Interfaces:**
- Consumes:
  - `flightPose`, `contactMs`, `flightEndMs`, `pileSlots`, `CardFrom`, `CardSlot` (Task 1);
  - `readFlightFromDom` (Task 3).
- Produces:
  - `useFlightClock(signal: SharedValue<LandingSignal>, onStart: (key: string, landsAt: number, endsAt: number) => void, onContact: (key: string, at: number) => void, onEnd: (key: string) => void): FlightClock`, where
    - `interface FlightClock { elapsed: SharedValue<number>; arm(landing: LandingPayload): void; begin(spec: FlightSpec): void }`, one object for the component's life;
    - `interface FlightSpec { key: string; n: number; from: CardFrom[]; to: CardSlot[]; catchUp: boolean; reduced: boolean; contact: number; end: number }`;
    - `flightSpec(key, from, to, catchUp, reduced): FlightSpec`, which computes `contact` and `end` on JS.
  - `FlyingCards` props: `{ cards: Card[]; flight: FlightSpec; landing: LandingPayload; signal: SharedValue<LandingSignal>; onStart: (key: string, landsAt: number, endsAt: number) => void; onEnd: (key: string) => void; scale?: number }`. `LandingPayload` and `LandingSignal` are defined here, so Task 5 only reads them:
    - `interface LandingPayload { tier: ImpactTier; cards: number; x: number; y: number; flush: boolean; heavy: boolean; mine: boolean; pulses: readonly PulseStep[] }`, where `pulses` is plan 1's `landingPulsesFor` of the landing, run at contact (Task 5)
    - `interface LandingSignal extends LandingPayload { seq: number; at: number }`, where `at` is the contact frame's `frame.timestamp`
    - `const NO_LANDING: LandingSignal`
  - In `components/fanGeometry.ts`: `fanPoint(ring: { dx: number; dy: number }, dir: OpponentSide, scale: number, count: number): { x: number; y: number; rot: number }`, the fan's centre relative to the pile (the frame `seatPoint` returns its ring in) and the fan's drawn angle; and `seatFanArc(count, backScale)`, moved there unchanged. Both keep their count: the fan's centre moves with the drawn count.
  - `readThrownPlay(...)` returns `{ dir, cards, from: CardFrom[], pile: {x,y}, heavy, emptiedHand }`. `origin` is gone.
  - In `hand.tsx`: prop `onOrigins?: (origins: ReadonlyMap<string, CardFrom>) => void`, with coordinates relative to the hand zone's centre.

- [ ] **Step 1: Write the failing origin spec**

`tests/e2e/flightOrigin.spec.ts`:

```ts
import { test, expect } from "./fixtures";
import { installVirtualClock, step, takeOver } from "./helpers/virtualClock";
import { belowCapsTable, botMove, pairsTable } from "./helpers/mockupParity";
import { GIOCA_VALID_LABEL } from "./helpers/labels";

const centre = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test("a thrown card's first frame is where the viewer last saw it", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1259);
  await pairsTable(page, baseURL!);
  await takeOver(page);
  const hand = page.locator('[data-hand-state] [data-testid="card-box"]');
  await hand.nth(0).click({ force: true, position: { x: 8, y: 30 } });
  await hand.nth(1).click({ force: true, position: { x: 8, y: 30 } });
  await step(page);
  const before = [centre((await hand.nth(0).boundingBox())!), centre((await hand.nth(1).boundingBox())!)];
  await page.getByRole("button", { name: GIOCA_VALID_LABEL }).click({ force: true });
  await step(page);
  const flying = page.locator('[data-testid="flying-card"]');
  await expect(flying).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    const at = centre((await flying.nth(i).boundingBox())!);
    expect(Math.hypot(at.x - before[i].x, at.y - before[i].y), `card ${i} starts in its own hand slot`).toBeLessThanOrEqual(2);
  }
});

const fanBoxes = async (page: import("@playwright/test").Page) => {
  const backs = await page.locator('[data-testid="seat-back"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  const width = page.viewportSize()!.width;
  const side = (x: number) => (x < width / 3 ? "left" : x > (2 * width) / 3 ? "right" : "top");
  const fans = new Map<string, { x0: number; y0: number; x1: number; y1: number; n: number }>();
  for (const b of backs) {
    const k = side(b.x + b.width / 2);
    const f = fans.get(k) ?? { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, n: 0 };
    fans.set(k, { x0: Math.min(f.x0, b.x), y0: Math.min(f.y0, b.y), x1: Math.max(f.x1, b.x + b.width), y1: Math.max(f.y1, b.y + b.height), n: f.n + 1 });
  }
  return fans;
};

test("an opponent's thrown card's first frame is its fan's centre, not its ring's, below the cap", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1259);
  await belowCapsTable(page, baseURL!);
  await takeOver(page);
  const badges = (await page.locator('[data-testid="seat-card-count"]').allTextContents()).map(Number).sort();
  const drawn = [...(await fanBoxes(page)).values()].map((f) => f.n).sort();
  expect(drawn, "every fan draws its whole count: the seed is below the caps").toEqual(badges);
  await botMove(page);
  await step(page);
  const first = centre((await page.locator('[data-testid="flying-card"]').first().boundingBox())!);
  const fans = await fanBoxes(page);
  const nearest = Math.min(...[...fans.values()].map((f) => Math.hypot(first.x - (f.x0 + f.x1) / 2, first.y - (f.y0 + f.y1) / 2)));
  expect(nearest, "the throw starts at its fan's centre, as drawn on the throw's frame").toBeLessThanOrEqual(2);
});

test("on its first frame the flier paints above the hand slot and the fan it leaves", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1259);
  await belowCapsTable(page, baseURL!);
  await takeOver(page);
  await botMove(page);
  await step(page);
  const flier = page.locator('[data-testid="flying-card"]').first();
  const clip = (await flier.boundingBox())!;
  const shown = await page.screenshot({ clip });
  await flier.evaluate((e) => ((e as HTMLElement).style.visibility = "hidden"));
  const hidden = await page.screenshot({ clip });
  await flier.evaluate((e) => ((e as HTMLElement).style.visibility = ""));
  expect(shown.equals(hidden), "hiding the flier changed nothing: something paints over it").toBe(false);
});
```

- **The fan is measured on the throw's own frame**, excluding `seat-back-departing` by the exact-match locator. That is the fan the card leaves: the post-throw fan once Task 6 drops the count at the throw, and the remaining backs before it.
- **The paint test** is a pixel check, because the flier is `pointerEvents="none"` and `elementFromPoint` skips it. If a hand card or fan back painted over the flier, hiding the flier would leave the clip unchanged. A viewer's-throw variant (the first test's setup) runs the same check over the hand slot.

**Seed below the caps.** The opponent tests must not seed `pairsTable`, whose 13-card hands sit at the fan caps (`FAN_DRAWN_CARDS` top 7, sides 5, `seatLayout.ts:155`). At the cap, a fan's centre does not move with its count, so a `fanPoint` that ignored `count` would pass. Seed `belowCapsTable(page, baseURL)` instead, a new export of `mockupParity.ts`: `seatTable(page, baseURL, offlineGameSave(4, 13, 1, MOCKUP_SCORES, BELOW_CAPS))`. In `BELOW_CAPS` (`TRICK_HANDS` sliced), the viewer keeps 13 cards, the two side seats hold 4 and 2 cards, and the top seat holds 5. Turn 1 is a bot's lead on an empty pile, so `botMove` throws. The test also asserts, before the throw, that each opponent's drawn `seat-back` count equals its `seat-card-count` badge: the seed really is below the cap.

Before writing, confirm against source and use the real names:
- The GIOCA button's accessible name: `GIOCA_VALID_LABEL`, exported from `tests/e2e/helpers/labels.ts:12`. `mockupParity.ts:10` imports it but does not export it. Import it from `./helpers/labels`, rather than the regex.
- The seat backs: `seat-back` is `seats.tsx:146`. The exact-match locator excludes `seat-back-departing`, which Task 6 deletes.

A throw from the ring centre (today's `flightOrigin`) sits `seatGap + fan/2` away from every fan centre, so it fails.

`tests/native/flightStartsOnce.test.tsx` (jest runs without the React Compiler, so a restart-on-render bug shows here even when the compiled app hides it):

```tsx
it('one throw starts its clock once, whatever its parent re-renders', async () => {
  const onStart = jest.fn();
  const spec = flightSpec('k1', FROM, TO, false, false);
  const tree = (n: number) => (
    <FlyingCards key="k1" cards={CARDS} flight={{ ...spec }} landing={{ ...LANDING }} signal={signal}
      onStart={(...a) => onStart(n, ...a)} onEnd={() => {}} scale={1} />
  );
  const view = await render(tree(0));
  for (let r = 1; r <= 3; r++) {
    await act(async () => { jest.advanceTimersByTime(16); });
    await view.rerender(tree(r));
  }
  await act(async () => { jest.advanceTimersByTime(16 * 40); });
  expect(onStart).toHaveBeenCalledTimes(1);
  await view.unmount();
});
```

Each re-render hands `FlyingCards` a fresh `flight`, `landing` and `onStart`. `CARDS`, `FROM`, `TO`, `LANDING` and `signal` (a `makeMutable(NO_LANDING)`) are the test's own fixtures. Copy the Reanimated/worklets mocks and fake timers from `landingDust.test.tsx`.

- [ ] **Step 2: Run it (CI, or one local run per rule 3) to verify it fails**

Expected: FAIL. `flying-card` does not exist yet with a per-card start at the slot: today's flight starts at the hand zone's centre (`flightOrigin`, `flightPhysics.ts:483-512`), more than 2 pt from any card but the middle one. The opponent case also fails, because today's origin is the ring centre.

- [ ] **Step 3: Write the clock**

`components/table/useFlightClock.ts`:

```ts
import { useMemo, useState } from "react";
import { useFrameCallback, useSharedValue, type FrameInfo, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { contactMs, flightEndMs, type CardFrom, type CardSlot } from "@/components/flightPose";
import { LAND_WOBBLE_MS, type ImpactTier } from "@/components/flightPhysics";
import type { PulseStep } from "@/lib/device/feedback";

export interface FlightSpec {
  key: string; n: number; from: CardFrom[]; to: CardSlot[]; catchUp: boolean; reduced: boolean;
  /** Computed on JS when the spec is built (`flightSpec`), never on the UI thread's first frame. */
  contact: number;
  end: number;
}
export interface LandingPayload { tier: ImpactTier; cards: number; x: number; y: number; flush: boolean; heavy: boolean; mine: boolean; pulses: readonly PulseStep[] }
export interface LandingSignal extends LandingPayload { seq: number; at: number }
export const NO_LANDING: LandingSignal = { seq: 0, at: 0, tier: "ordinary", cards: 0, x: 0, y: 0, flush: false, heavy: false, mine: false, pulses: [] };

export function flightSpec(key: string, from: CardFrom[], to: CardSlot[], catchUp: boolean, reduced: boolean): FlightSpec {
  const n = to.length;
  return {
    key, n, from, to, catchUp, reduced,
    contact: reduced ? 0 : contactMs(n, from, to, catchUp),
    end: reduced ? 0 : flightEndMs(n, catchUp),
  };
}

interface Run { spec: FlightSpec | null; startedAt: number; touched: boolean }

export interface FlightClock {
  elapsed: SharedValue<number>;
  arm(landing: LandingPayload): void;
  begin(spec: FlightSpec): void;
}

function stepper(
  run: SharedValue<Run>,
  elapsed: SharedValue<number>,
  landing: SharedValue<LandingPayload | null>,
  signal: SharedValue<LandingSignal>,
  report: { start: (k: string, at: number, end: number) => void; touch: (k: string, at: number) => void; end: (k: string) => void }
) {
  return (frame: FrameInfo) => {
    "worklet";
    const r = run.value;
    if (!r.spec) return;
    if (r.startedAt < 0) {
      r.startedAt = frame.timestamp;
      scheduleOnRN(report.start, r.spec.key, frame.timestamp + r.spec.contact, frame.timestamp + r.spec.end);
    }
    const t = frame.timestamp - r.startedAt;
    elapsed.value = t;
    if (!r.touched && t >= r.spec.contact) {
      r.touched = true;
      const l = landing.value;
      if (l) signal.value = { ...l, seq: signal.value.seq + 1, at: frame.timestamp };
      scheduleOnRN(report.touch, r.spec.key, frame.timestamp);
    }
    if (t >= r.spec.end + (r.spec.reduced ? 0 : LAND_WOBBLE_MS)) {
      const key = r.spec.key;
      r.spec = null;
      scheduleOnRN(report.end, key);
    }
  };
}

export function useFlightClock(
  signal: SharedValue<LandingSignal>,
  onStart: (key: string, landsAt: number, endsAt: number) => void,
  onContact: (key: string, at: number) => void,
  onEnd: (key: string) => void
): FlightClock {
  const run = useSharedValue<Run>({ spec: null, startedAt: -1, touched: false });
  const elapsed = useSharedValue(0);
  const landing = useSharedValue<LandingPayload | null>(null);
  const [ended] = useState(() => (key: string) => {
    frames.setActive(false);
    onEnd(key);
  });
  const [step] = useState(() => stepper(run, elapsed, landing, signal, { start: onStart, touch: onContact, end: ended }));
  const frames = useFrameCallback(step, false);
  return useMemo(
    () => ({
      elapsed,
      arm: (l: LandingPayload) => { landing.value = l; },
      begin: (spec: FlightSpec) => {
        run.value = { spec, startedAt: -1, touched: false };
        frames.setActive(true);
      },
    }),
    [elapsed, landing, run, frames]
  );
}
```

- The callbacks are captured once in `useState` initializers (`tests/ui-rules/frameCallbackIdentity.test.ts`). Callers must therefore pass stable functions: `FlyingCards` passes `useCallback`s that read refs, the same pattern as today's `onDoneRef` at `pile.tsx:88-93`.
- **The returned clock is one object for the component's life.** `useMemo` over values that never change identity: shared values, and `useFrameCallback`'s return, which is its own `useRef`'s `current` (`react-native-reanimated/src/hook/useFrameCallback.ts:33-61`). So an effect that lists `clock` runs once. Without that, every render handed back a new `begin`, and an effect depending on it restarted the flight on each re-render. In jest, which runs without the React Compiler, that is a restart on every parent render.
- **The frame callback runs only while a flight is up.** It is created inactive (`autostart` false). `begin` activates it, and the end report deactivates it (`setActive(false)`). An always-active callback makes Reanimated request frames for as long as the group is mounted (`FrameCallbackRegistryUI.ts:75-77`), and plan 4 keeps trick groups mounted. `ended` reads `frames` when it is called, after the first render has assigned it.
- **The clock runs past the flight's end, through `LAND_WOBBLE_MS`**, so the wobble is drawn. `endsAt`, reported to JS, is still the tween's end (`spec.end`): the hand-off anchor (Task 6) does not wait out the wobble.
- **`contact` and `end` are computed on JS**, in `flightSpec`, when `usePileFlight` builds the flight. The UI thread's first frame only adds its own timestamp. `contactMs` samples the pose at 1 ms (Task 1), and that work stays off the frame that starts the flight.
- `touch` carries the contact frame's timestamp to JS, for Task 11's diagnostics row.

- [ ] **Step 4: Rewrite `FlyingCards` on the clock**

```tsx
export function FlyingCards({ cards, flight, landing, signal, onStart, onEnd, scale = 1 }: {
  cards: Card[];
  flight: FlightSpec;
  landing: LandingPayload;
  signal: SharedValue<LandingSignal>;
  onStart: (key: string, landsAt: number, endsAt: number) => void;
  onEnd: (key: string) => void;
  scale?: number;
}) {
  const cardScale = scale * FIELD_SCALE;
  const w = CARD_W(cardScale);
  const h = CARD_H(cardScale);
  const onStartRef = useRef(onStart);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onStartRef.current = onStart;
    onEndRef.current = onEnd;
  });
  const started = useCallback((k: string, at: number, end: number) => onStartRef.current(k, at, end), []);
  const ended = useCallback((k: string) => onEndRef.current(k), []);
  const touched = useCallback(() => traceOnset("moment", "landing"), []);
  const clock = useFlightClock(signal, started, touched, ended);
  const [armed] = useState(() => ({ spec: flight, landing }));
  const { spec } = armed;
  useEffect(() => {
    clock.arm(armed.landing);
    clock.begin(armed.spec);
  }, [clock, armed]);
  const group = useAnimatedStyle(() => {
    const k = spec.reduced ? 0 : Math.min(1, Math.max(0, (clock.elapsed.value - spec.end) / LAND_WOBBLE_MS));
    const { scale: s, rotate } = landWobble(k);
    return { transform: [{ scale: s }, { rotate: `${rotate}deg` }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, group]} {...a11yHidden()}>
      {cards.map((card, i) => (
        <FlyingCard key={card.id} card={card} i={i} spec={spec} elapsed={clock.elapsed} w={w} h={h} cardScale={cardScale} />
      ))}
    </Animated.View>
  );
}

function FlyingCard({ card, i, spec, elapsed, w, h, cardScale }: {
  card: Card; i: number; spec: FlightSpec; elapsed: SharedValue<number>; w: number; h: number; cardScale: number;
}) {
  const to = spec.to[i];
  const style = useAnimatedStyle(() => {
    const p = flightPose(spec.reduced ? Infinity : elapsed.value, i, spec.n, spec.from[i], to, spec.catchUp);
    return {
      transform: [{ translateX: p.x - to.x }, { translateY: p.y - to.y }, { rotate: `${p.rot}deg` }, { scale: p.scale }],
    };
  });
  const box = { position: "absolute" as const, left: "50%" as const, top: "50%" as const, width: w, height: h, marginLeft: to.x - w / 2, marginTop: to.y - h / 2 };
  return (
    <>
      <View testID="flight-slot" pointerEvents="none" style={box} />
      <Animated.View testID="flying-card" style={[box, style]}>
        <CardView card={card} scale={cardScale} />
      </Animated.View>
    </>
  );
}
```

- **The wobble.** The group style replaces the `wobble` shared value. `landWobble(k)` (`flightPhysics.ts:116-123`) takes progress `k` from 0 to 1, unclamped, and is at rest at both ends. So the style clamps `(elapsed − spec.end) / LAND_WOBBLE_MS` into [0, 1]: rest during the flight, the wobble for 400 ms after the tween's end, rest after it. `LAND_WOBBLE_MS` stays, because `landWobble` itself reads it (`:118`). Reduced motion holds `k` at 0, which is rest, as `settleForMotion` does today.
- **Mount-only start.** `armed` is captured once in a `useState` initializer, and `clock` is one object (Step 3), so the effect runs once per mount. A parent re-render that hands `FlyingCards` a new `flight`, `landing` or callback cannot restart the throw.
- **The flight trace source is registered once, by the pile**, not per `FlyingCards`. `useTraceSource` adds one function to a `Set` and deletes it on unmount (`lib/e2eTrace.ts:92-99`). Two flights that register the same `readFlightFromDom` share one entry, so the first to unmount deletes it while the second is still flying. `usePileFlight` calls `useTraceSource("flight", readFlightFromDom)` once (Task 3), and `readFlightFromDom` reads every `flying-card` in the DOM.
- **Paint order at the origin.** At its first frame the flier sits on its own hand slot or on the fan, and must paint above both. Read `GameTable`'s layout for the nearest common ancestor of the pile's group, the hand zone and the seats. The pile's child of that ancestor takes `zIndex: Layer.moment` while the flight list is non-empty: a `Layer` role, per `components/CLAUDE.md`, never tree order. Step 1's third test pins it.
- `CardView` stands in for whatever element today's `FlyingCards` draws a face with (`pile.tsx:186-214`). Use the same component and props it uses.
- The cards carry no shadow of their own: the lamp shadow is the felt's (ADR-0008, design §2).
- Reduced motion evaluates the pose at `Infinity`, which is the slot. Contact is 0, so every consequence fires on the first frame.

- [ ] **Step 5: Origins, the pile, the list of flights**

Create `components/fanGeometry.ts`, the fan's shape as against a seat's position (the lead's ruling). Move `seatFanArc` there from `seatLayout.ts:275-287` unchanged, with its imports (`CARD_BACK_W`/`CARD_BACK_H`/`BACK_SCALE` from `./cardFaceModel.ts`, `arcBounds`/`solveArc`/`SEAT_ARC` from `./tableArc.ts`). Add `fanPoint` beside it, and make `flightPhysics.ts`'s `readThrownPlay` build `from`:

```ts
export function fanPoint(
  ring: { dx: number; dy: number },
  dir: OpponentSide,
  scale: number,
  count: number
): { x: number; y: number; rot: number } {
  const drawn = Math.min(count, FAN_DRAWN_CARDS[dir]);
  const across = drawn > 0 ? seatFanArc(drawn, scale * BACK_SCALE).bounds.h : 0;
  const along = (SEAT_DISC * scale) / 2 + seatGap(scale) + across / 2;
  if (dir === "top") return { x: ring.dx, y: ring.dy + along, rot: 0 };
  return { x: ring.dx + (dir === "left" ? along : -along), y: ring.dy, rot: dir === "left" ? 90 : -90 };
}
```

The caller, in `readThrownPlay` for an opponent:

```ts
const dir = seatDirection(playedBy, input.viewerSeat, players.length);
if (dir !== "bottom") {
  const fan = fanPoint(seatPoint(input, playedBy), dir, input.scale, handCountOf(thrower));
  // every card's `from` is { ...fan, scale: 0.4 }
}
```

Read `FlyDirection` (`seatLayout.ts`) first: the narrowing above assumes it is `OpponentSide | "bottom"`. If it is not, narrow on its real members, never with a cast.

- The signatures are read from source:
  - `seatDirection(seat, viewerSeat, playerCount)` (`seatLayout.ts:174`) takes three arguments;
  - `seatFanArc(count, backScale)` (`seatLayout.ts:275`, moving to `fanGeometry.ts`) returns `{ cards, box, bounds }`;
  - `seatPoint(input: SeatGeometry, seat)` (`flightPhysics.ts:947`) returns `{ dx, dy }`, not `{ x, y }`;
  - `FAN_DRAWN_CARDS` (`seatLayout.ts:155`), `OpponentSide`, `SEAT_DISC` (`:245`) and `seatGap` (`:251`) are in `seatLayout.ts`, and `fanGeometry.ts` imports them from there;
  - `BACK_SCALE` is in `cardFaceModel.ts:52`.
- **The import direction.** `fanGeometry.ts` imports from `seatLayout.ts`: a fan sits beside its ring. Until plan 3 lands, `seatLayout.ts`'s `sideSlotHeight` and `topFanHeight` (`:294-311`) import `seatFanArc` back from `fanGeometry.ts`. That is a call-time-only cycle, since neither module uses the other at evaluation. Plan 3's guard forbids that edge, and plan 3 owns how its bands get the fan's size.
- **Which extent `across` uses.** The fan's extent along the ring-to-fan axis is `bounds.h` on every side:
  - the top fan is unrotated, so its vertical extent is the arc's height, as in `topFanHeight` (`:307-311`);
  - a side fan is turned a quarter, so its vertical extent is the arc's width (`sideSlotHeight`, `:294-299`), and its horizontal extent is the height.
- `drawn` is `min(count, FAN_DRAWN_CARDS[dir])`, the same cap `sideSlotHeight` and `topFanHeight` apply. The count is the seat's count *after* the throw: the count drops at the throw (Task 6), so the fan the card leaves is the post-play fan.
- **`fanPoint` keeps `count`** (the lead's ruling). The fan's centre moves with the drawn count, because `across` is `seatFanArc(drawn, …).bounds.h`. It lives in `fanGeometry.ts`, fan shape, which plan 3's guard allows a count, and not among the seat, ring, band and pile position functions, which the guard allows only `scale`.
- The fan sits beside the ring. `SideOppSlot` lays out as row / row-reverse with `seatGap` between (`seats.tsx`); the top fan sits below its ring.
- `flightOrigin.spec.ts` is the proof that this arithmetic matches the drawn fan within 2 pt. If it does not, correct the arithmetic, never the tolerance.

`readThrownPlay` changes from returning `origin` to returning `from: CardFrom[]`, relative to the pile centre:
- **An opponent's play:** every card starts at `fanPoint(...)`, which is already relative to the pile (`seatPoint`'s ring is `flightOrigin`'s ring centre, `flightPhysics.ts:497-511`), with `scale: 0.4` and the fan's `rot`. `flightPhysics.ts` imports `fanPoint` from `./fanGeometry.ts`.
- **The viewer's play:** each card starts at `handOrigins.get(card.id)` plus (the hand zone's centre − the pile point). The hand zone's centre is today's `flightOrigin(... "bottom")` value, which is the hand zone's centre. If a card has no published origin, it starts at the hand zone's centre, as today.

In `components/table/hand.tsx`, publish the origins in a no-deps `useEffect` from the values each `CardItem` draws with (`:970-1000`):
- `left = rowMid + home.x`;
- `bottom = -crop - home.y`;
- `shiftX = at.x - home.x + gapShift(i)`;
- `arcRot = home.rot`;
- the selection lift;
- the pan `-(panLimit + clamp(pan))` (`:614-618`), read through a JS mirror kept by the pan's `onEnd`.

```ts
  useEffect(() => {
    if (!onOrigins) return;
    const zoneW = rowBoxW;
    const origins = new Map<string, CardFrom>();
    rest.forEach((card, i) => {
      const at = arc[slotOf(i)] ?? arc[arc.length - 1];
      const home = place.get(card.id) ?? at;
      origins.set(card.id, {
        x: rowMid + home.x + (at.x - home.x + gapShift(i)) + cardW / 2 - zoneW / 2 - panShownRef.current,
        y: visibleH / 2 - (-crop - home.y) - cardH / 2 - (selectedSet.has(card.id) ? SELECT_LIFT * scale : 0),
        rot: home.rot,
        scale: cardW / (CARD_W * fieldScale),
      });
    });
    onOrigins(origins);
  });
```

- `rowBoxW`, `panShownRef`, `SELECT_LIFT` and `fieldScale` are stand-ins. Before writing, bind each to its real name in `hand.tsx`:
  - the row box's width is `scrollable ? totalW : rowW` (`:966`);
  - the selection lift is whatever `liftY` animates to for a selected card;
  - the field card scale is `scale * FIELD_SCALE`.
- `flightOrigin.spec.ts` is the only arbiter of this arithmetic: iterate until both cards start within 2 pt.
- GameTable keeps the map in a ref, `handOriginsRef.current = origins`, and passes it to `usePileFlight`. A ref written in a callback is not read during render.

In `usePileFlight`:
- `flyInfo` becomes `flights: FlyInfo[]`, where `FlyInfo = { key, cards, spec: FlightSpec, landing: LandingPayload }`. `spec` is built with `flightSpec(...)` on JS when the play commits, so `contact` and `end` are computed once, off the UI thread.
- `setFlyInfo(x)` becomes `setFlights((f) => [...f, x])`.
- `onFlightDone(key)` becomes `setFlights((f) => f.filter((x) => x.key !== key))`.
- `openNewRound` keeps its `setFlights([])` only when no flight is still short of its end. Guard it with `flightsRef.current.length === 0`, otherwise leave the flights to finish.
- `spec.to` is `pileSlots(n, CARD_W * scale * FIELD_SCALE, roomW)`.
- `spec.catchUp` is the new `catchUp` input.
- `spec.reduced` is `reduceMotion`.

In `PlayedPile` and `SweepCards`, replace `fieldArc(...)` with `pileSlots(...)`. Place each card at `left: 50% + slot.x − w/2`, `top: 50% + slot.y − h/2`, `rotate: slot.rot`, exactly as `FlyingCard`'s `box` does. That is how the flight hands over to the pile with no jump. Delete:
- the `cardTilt` jitter (`flightPhysics.ts:871-881`);
- the bounce effect (`pile.tsx:474-480`), with its `bounceTrigger` prop and state.

`PlayedPile`'s `current` shows when no flight in `flights` carries the current combination's key.

In `GameTable.tsx`:
- Render `flights.map((f) => <FlyingCards key={f.key} … />)` inside the pile's own container, beside `PlayedPile` in the `centerSection` branch (`:1216-1229`), not as a later sibling: ADR-0008, "inside the pile layer group".
- Pass `catchUp`: a new `GameTable` prop `catchUp?: boolean`.
  - Online: `app/(online)/game.tsx` passes `reconnectNotice !== null` (it already destructures `reconnectNotice`, `:71`; the type is `context/OnlineGameContext.tsx:88`).
  - Offline: it passes nothing.

In `lib/tokens.ts`, delete `anticipate: 40,` with its doc comment. In `tests/ui-rules/flightPhysics.test.ts`:
- delete the `describe` blocks at `:615-663`;
- delete the anticipation assertions;
- keep the `landWobble` block `:713-736`, changing only its "pile.tsx draws the flying cards at the wobble's scale" source check to name the group style.

`tests/native/flightShadow.test.tsx` asserts the lifted shadow's `withDelay(impactDelayMs)`. The shadow is removed, so the test becomes one assertion: a flying card's style carries no `shadowOpacity`/`elevation`. Keep its render harness.

- [ ] **Step 6: Local checks**

Run: `npx tsc --noEmit -p . && npx eslint components/table/useFlightClock.ts components/table/pile.tsx components/flightPhysics.ts components/fanGeometry.ts components/seatLayout.ts components/table/seats.tsx components/table/hand.tsx components/GameTable.tsx lib/tokens.ts tests/e2e/flightOrigin.spec.ts tests/native/flightStartsOnce.test.tsx && node --test tests/ui-rules/flightPhysics.test.ts tests/ui-rules/frameCallbackIdentity.test.ts tests/ui-rules/motionScale.test.ts tests/ui-rules/motionEscapes.test.ts tests/ui-rules/seatLayout.test.ts`
Expected: PASS. `motionEscapes`' pinned count of `_MS` declarations in `components/` drops by exactly one: `FLIGHT_MS` is deleted, and `LAND_WOBBLE_MS` stays. Update the pinned number in the same commit, and name the deletion in the message.

`node --test tests/ui-rules/oneClock.test.ts` now omits `pile.tsx:113`, `:130`, `:138`, `:145` and `:156`.

- [ ] **Step 7: Commit**

```bash
git add -- components/table/useFlightClock.ts components/table/pile.tsx components/flightPhysics.ts components/fanGeometry.ts components/seatLayout.ts components/table/seats.tsx components/table/hand.tsx components/GameTable.tsx "app/(online)/game.tsx" lib/tokens.ts tests/ui-rules/flightPhysics.test.ts tests/ui-rules/motionEscapes.test.ts tests/native/flightShadow.test.tsx tests/native/flightStartsOnce.test.tsx tests/e2e/flightOrigin.spec.ts tests/e2e/helpers/mockupParity.ts
git commit -m "feat(table): the throw flies the mockup's pose on its own frame clock, from each card's own place

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Pixels react on the contact frame

**Files:**
- Create: `components/table/useLandingReaction.ts`
- Modify:
  - `components/table/particleLayer.tsx` (dust);
  - `components/table/particles.ts` (`"worklet"` on `landDust` `:123` and on `landingDustCount`);
  - `components/useTableFeedback.ts` (the shake `:213-235` and the burst `:188-198` become reactions);
  - `components/flightPhysics.ts` (`"worklet"` on `traumaFor`, `shakeAmplitudeFor`, `flinchFor`, `flareKindFor`, `lampLiftFor`);
  - `components/table/useLampRig.ts` (flare/kick as a reaction);
  - `components/table/moments.tsx` (`BombBurst` `:398` reacts; `LampLift` reacts);
  - `components/table/pile.tsx` (`PlayedPile` flinch and flush catch react; the scrim is derived from the flight clock);
  - `components/GameTable.tsx` (one `useSharedValue<LandingSignal>(NO_LANDING)` threaded through; the `land` callback `:706-710` and the `boomTrigger` effect `:711-715` are deleted).
- Test:
  - Create `tests/native/landingOnContact.test.tsx`.
  - Rewrite `tests/native/landingDust.test.tsx`, `feltScrim.test.tsx`, `lampFlareEndToEnd.test.tsx`, `lampFlareReducedMotion.test.tsx`, `lampFlareWiring.test.tsx`, `onlinePartitaShake.test.tsx`, `tableShake.test.tsx`, `bombBurstAnimatesVisibly.test.tsx` and `landingHaptic.test.tsx` onto the reaction.

**Interfaces:**
- Consumes:
  - `LandingSignal`, `NO_LANDING`, `LandingPayload` (Task 4);
  - plan 1's `landingPulsesFor({ cards, bomb, mine }): readonly PulseStep[]` and worklet `runLandingPulses(steps)`, both from `@/lib/device/feedback` (plan 1 Task 7; ADR-0009 §2). Plan 1 owns the steps, their timing, cancellation and the haptics setting.
- Produces:
  - `useLandingReaction(signal: SharedValue<LandingSignal>, react: (l: LandingSignal) => void): void`, where `react` is a worklet;
  - `LandingPayload.pulses: readonly PulseStep[]`, computed on JS when the flight is built.

**The rule this task makes true:** every landing consequence that moves pixels, and the landing and bomb haptics, start inside `useLandingReaction`, on the frame the clock writes the signal. Everything that sets React state or makes a sound is Task 6's.

- [ ] **Step 1: Write the failing native test**

`tests/native/landingOnContact.test.tsx`. Copy `landingDust.test.tsx`'s mocks, `METRICS`, `state` and `throwPair()` verbatim, then add:

```tsx
import { getAnimatedStyle } from 'react-native-reanimated';

const farthest = (view: ReturnType<typeof render>) =>
  Math.max(0, ...view.queryAllByTestId('flying-card').map((el) => {
    const t = (getAnimatedStyle(el).transform ?? []) as Record<string, number>[];
    const x = t.find((s) => 'translateX' in s)?.translateX ?? 0;
    const y = t.find((s) => 'translateY' in s)?.translateY ?? 0;
    return Math.hypot(x, y);
  }));

async function frameOfFirst(view: ReturnType<typeof render>, happened: () => boolean) {
  const drawn: number[] = [];
  for (let f = 0; f < 60; f++) {
    await act(async () => { jest.advanceTimersByTime(16); });
    drawn.push(farthest(view));
    if (happened()) return { frame: f, drawn };
  }
  throw new Error('never happened');
}

it('throws the dust on the first frame every card is within 1 pt of its slot, not before', async () => {
  const view = await throwPair();
  const { frame, drawn } = await frameOfFirst(view, () => mockEmit.mock.calls.length > 0);
  expect(drawn[frame]).toBeLessThanOrEqual(1);
  expect(drawn[frame - 1]).toBeGreaterThan(1);
  await view.unmount();
});

it('under reduced motion the dust is withheld and the landing is traced on the first frame', async () => {
  mockMotion.reduced = true;
  const view = await throwPair();
  await act(async () => { jest.advanceTimersByTime(16); });
  expect(landings()).toHaveLength(1);
  expect(mockEmit).not.toHaveBeenCalled();
  await view.unmount();
});
```

Add to its mocks `jest.mock('@/lib/device/feedback', () => ({ ...jest.requireActual('@/lib/device/feedback'), runLandingPulses: jest.fn() }))`, keeping the real `landingPulsesFor`, with `runLandingPulses` marked as a worklet the way the file's other UI-thread mocks are. Then add:

```tsx
it('starts the landing pulses on the contact frame, not before', async () => {
  const view = await throwPair();
  const { frame, drawn } = await frameOfFirst(view, () => mockRunLandingPulses.mock.calls.length > 0);
  expect(drawn[frame]).toBeLessThanOrEqual(1);
  expect(drawn[frame - 1]).toBeGreaterThan(1);
  expect(mockRunLandingPulses).toHaveBeenCalledTimes(1);
  expect(mockRunLandingPulses).toHaveBeenCalledWith(landingPulsesFor({ cards: 2, bomb: false, mine: true }));
  await view.unmount();
});
```

`throwPair()` throws a pair; if it is not the viewer's own, throw it from the viewer's seat for this case, since another seat's ordinary landing has no steps. The expectation is read off the drawn transforms, never off a constant.

`landingHaptic.test.tsx` moves from `playImpact` (deleted) to the contact reaction. It mocks `runLandingPulses` as above and drives frames with `frameOfFirst`. Its cases:
- **The viewer's own single card, and combo:** one call on the contact frame, with `landingPulsesFor` of that landing.
- **Another seat's ordinary landing:** one call on the contact frame with `[]` (`landingPulsesFor` gives none), so nothing pulses (`:83-95`).
- **A bomb from another seat** (the existing `"right"` case, `:104`): one call on the contact frame with the bomb's steps.

The steps' offsets, their order and a bomb cancelling a bomb's tail are plan 1's (`runLandingPulses`), tested there; this file holds only the frame and the argument. Its sound assertions leave for Task 6's `event` tests.

Rewrite `landingDust.test.tsx` the same way: its first test drives frames until the emit, then checks the dust's count and spread, which it already asserts. Drop the `impactDelayMs` import.

For the other rewritten tests, the change is the same in each: replace `advanceTimersByTime(impactDelayMs(...))` with `frameOfFirst(view, <that test's own effect>)`, and add the pair `drawn[frame] <= 1` / `drawn[frame - 1] > 1`. Their own assertions (shake peak, flare kind, scrim level, burst visibility) stay.

- [ ] **Step 2: Run on CI (jest is CI's) and read the red**

Expected: `landingOnContact` FAILS with `drawn[frame - 1] > 1` false or `drawn[frame] <= 1` false. Today's dust fires from `setTimeout(impactDelayMs)` on JS, while Task 4's clock is already drawing the mockup's pose, so the emit lands on a frame where the cards are several points out.

Locally, `npx tsc --noEmit -p .` must be clean.

- [ ] **Step 3: The reaction hook and the consumers**

`components/table/useLandingReaction.ts`:

```ts
import { useAnimatedReaction, type SharedValue } from "react-native-reanimated";
import type { LandingSignal } from "./useFlightClock";

export function useLandingReaction(signal: SharedValue<LandingSignal>, react: (l: LandingSignal) => void): void {
  useAnimatedReaction(
    () => signal.value.seq,
    (seq, prev) => {
      if (prev !== null && seq !== prev) react(signal.value);
    }
  );
}
```

`particleLayer.tsx` takes `landing: SharedValue<LandingSignal>` and `sx`, `sy`, `reduced` (it already takes `sx`, `sy`):

```ts
  useLandingReaction(landing, (l) => {
    "worklet";
    if (reduced.value) return;
    field.modify((v) => {
      "worklet";
      for (const p of landDust(l.cards, landingDustCount(l.cards), l.x / sx, l.y / sy, Math.random)) spawn(v.s, p);
      return v;
    }, true);
  });
```

`useImpactFeedback` in `useTableFeedback.ts`:
- `shake` keeps its body but becomes the worklet `startShake(tier)` called from `useLandingReaction(signal, (l) => { "worklet"; startShake(l.tier); })`.
- It reads `reduceMotion` and `screenShake` from two shared values mirrored from the refs it reads today.
- `traceOnset("moment", tier)` moves behind `scheduleOnRN(traceOnset, "moment", l.tier)`.
- `burst` is replaced the same way: `BombBurst` takes `landing` and derives `flareKindFor(l.tier)` inside the reaction. `LampLift` fires on `lampLiftFor(l.tier)`. `useLampRig` fires `lampControls.flare` and `lampControls.kick` in the reaction, which are worklets already (`useLampRig.ts:84-106`).
- `boomTrigger`, `flareKind`, `lampLiftTrigger` and their state are deleted.

`PlayedPile` takes `landing`:
- The flinch effect (`pile.tsx:486-494`) becomes a reaction on `flinchFor(l.tier, reduced.value) * scale`.
- The flush catch fires when `l.flush`.
- `flinchTrigger`, `flinchTier` and `catchTrigger`, with their state in `usePileFlight` and `useTableFeedback`, are deleted.

The scrim (`pile.tsx:846-849`) is no longer a `withTiming` on a guessed duration. `feltDim` becomes a `useDerivedValue` over the in-flight bomb's clock:
- during a bomb's flight, `FELT_SCRIM_PEAK * Easing.in(Easing.quad)(min(1, elapsed / contact))`;
- `0` from contact on, and `0` otherwise.

The bomb's clock reaches the scrim's worklet through a shared value, never through a ref or a JS callback. `usePileFlight` owns `const bombClock = useSharedValue({ elapsed: -1, contact: 0 })`, declared with the table's other hooks, and passes it to every `FlyingCards`. A `FlyingCards` whose `landing.heavy` is true writes it from a `useAnimatedReaction` on `clock.elapsed.value`, on the UI thread: `{ elapsed: t, contact: spec.contact }` while `t < spec.contact`, then `{ elapsed: -1, contact: 0 }`. `useFlightClock`'s signature is unchanged. The scrim's `useDerivedValue` reads `bombClock.value` alone, is 0 while `elapsed < 0`, so it moves on the UI frame the bomb does. A JS ref would be invisible to the worklet, and a callback would put the ramp on the JS clock.

`GameTable.tsx` owns `const landingSignal = useSharedValue<LandingSignal>(NO_LANDING);`, declared with every other hook before `if (!gameState)` (CLAUDE.md invariant). It passes the value to `usePileFlight` (to `FlyingCards`), `ParticleLayer`, `useTableFeedback`, `useLampRig`, `BombBurst`, `LampLift` and `PlayedPile`.

`usePileFlight` builds each flight's `landing` payload:

```ts
    const landing: LandingPayload = {
      tier: landingTier({ comboType: combo.type, handOver: gameOver, matchOver: matchOverRef.current }),
      cards: combo.cards.length,
      x: thrown.pile.x,
      y: thrown.pile.y,
      flush: thrown.emptiedHand,
      heavy: thrown.heavy,
      mine: thrown.dir === "bottom",
      pulses: landingPulsesFor({ cards: combo.cards.length, bomb: thrown.heavy, mine: thrown.dir === "bottom" }),
    };
```

`pulses` is computed here, on JS, because `landingPulsesFor` is plain JS and the reaction runs on the UI thread; the steps ride the signal as data.

The old impact timer (`:851-866`) and its `playImpact`/`land`/`shake`/`burst`/`celebrateFlush` inputs go. The sound is Task 6's.

**The landing and bomb haptics** start in the same contact reaction as the shake, in `useImpactFeedback`, on the UI thread:

```ts
  useLandingReaction(signal, (l) => {
    "worklet";
    runLandingPulses(l.pulses);
    startShake(l.tier);
  });
```

- `runLandingPulses` and `landingPulsesFor` come from `@/lib/device/feedback` only (plan 1 Task 7), never from `hapticsEngine`. This plan keeps no step list, no timer and no frame callback of its own: plan 1 owns the offsets, the order, a bomb cancelling a bomb's tail, who feels it (a bomb for every seat, anything else only for `mine`) and the haptics setting.
- **`LandingSignal` gains `at`**, the contact frame's `frame.timestamp`, written by the clock with the signal (Task 4's `NO_LANDING` gets `at: 0`, `pulses: []`). Task 11 logs it.
- Reduced motion does not withhold the pulse: the dust and the shake are motion, the pulse is not.

- [ ] **Step 4: Local checks**

Run: `npx tsc --noEmit -p . && npx eslint <every file above> && node --test tests/ui-rules/frameCallbackIdentity.test.ts tests/ui-rules/flightPhysics.test.ts`
Expected: clean and PASS. `oneClock` now omits `pile.tsx:851`.

- [ ] **Step 5: Commit**

```bash
git add -- components/table/useLandingReaction.ts components/table/particleLayer.tsx components/table/particles.ts components/useTableFeedback.ts components/flightPhysics.ts components/table/useLampRig.ts components/table/moments.tsx components/table/pile.tsx components/GameTable.tsx tests/native/landingOnContact.test.tsx tests/native/landingDust.test.tsx tests/native/feltScrim.test.tsx tests/native/lampFlareEndToEnd.test.tsx tests/native/lampFlareReducedMotion.test.tsx tests/native/lampFlareWiring.test.tsx tests/native/onlinePartitaShake.test.tsx tests/native/tableShake.test.tsx tests/native/bombBurstAnimatesVisibly.test.tsx tests/native/landingHaptic.test.tsx
git commit -m "feat(table): dust, shake, burst, flinch, scrim and the landing haptic start on the contact frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sounds and state consequences on the flight's clock, one event per anchor

**Files:**
- Create: `components/table/tableTimeline.ts`
- Modify:
  - `components/useTableFeedback.ts`:
    - delete `landsAtRef` `:369-372`;
    - the turn reveal `:384-391` and turn cue `:393-402` read the timeline;
    - the pass cue `:416-423` and sting `:457-461` go through `timeline.moment`;
    - the exchange cue `:404-407` is deleted (Task 9 owns it);
    - `playImpact` `:529-539` is deleted;
  - `components/table/pile.tsx`: `usePileFlight` calls `timeline.awaitFlight`, `timeline.moment` and `timeline.flightStarted`; it deletes `flightLanded`'s timer `:871-876`, its guarded clears `:743`, `:799` and `:824`, and its `impactTimerRef`/`landTimerRef`;
  - `components/table/seats.tsx`: delete the departing backs (the `departing` prop, `:186-198`, the `seat-back-departing` branch at `:146`); `displayed` at `:717` and `:884` becomes `Math.min(cardCount ?? player.hand.length, arrived)`;
  - `components/seatLayout.ts`: delete `displayedHandCount` (`:218`), and delete `fanCounts`' `departing` term (`:238`); the fan draws `Math.min(count, cap)`;
  - `components/flightPhysics.ts`: `:961` and `:965` read `handCountOf(...)` directly; delete `LANDING_FRACTION`, `impactDelayMs`, `handOffDelayMs` and `landingHoldMs`;
  - `components/GameTable.tsx`: `useTableTimeline()` with every other hook; the flush effect is the component's last hook; delete `departingSide`/`departingCount` (`:879-885`) and the three `departing=` props (`:1161`, `:1187`, `:1290`);
  - `lib/tokens.ts`: `Hold.land` becomes 175; add `export const LATE_SOUND_MS = 45;` beside `Hold`, with the doc line `/** How late a sound may still start and be heard as on time; later, it is dropped. */`. It is not a `Motion` member, so `oneClock` does not treat it as a source;
  - `lib/diagnostics/types.ts`: add `dropped: { name: string };` to `interface DiagRows` (plan 1).
- Test:
  - Create `tests/native/oneEventPerCommit.test.tsx`, `tests/native/landingNotDropped.test.tsx`, `tests/ui-rules/landingCueHasNoHaptic.test.ts` (Step 5) and `tests/e2e/throwLeavesTheFan.spec.ts`.
  - Rewrite `tests/native/yourTurnCue.test.tsx`, `gameOverSting.test.tsx` and `tableFeedbackIdentity.test.tsx` to mock `@/lib/device/feedback` and assert on `event` calls. (`landingHaptic.test.tsx` is Task 5's.)
  - Delete `tests/native/seatFanDeparting.test.tsx`: the backs it pinned are gone, and the Playwright spec replaces it.
  - In `tests/ui-rules/seatLayout.test.ts`, delete the `displayedHandCount` block (`:142-158`) and the `fanCounts` `departing` cases (`:160-182`), keeping the cap case as `fanCounts(10, 5)`.

**Interfaces:**
- Consumes:
  - `event(moments: Moment[], at?: number)` from `lib/device/feedback.ts` (plan 1);
  - `Moment` from `lib/device/moments.ts` (plan 1, Task 7);
  - `FlyingCards`' `onStart(key, landsAt, endsAt)` (Task 4).
- Produces: `useTableTimeline(): TableTimeline`, where

```ts
export type Anchor = "landing" | "handoff";
export interface TableTimeline {
  /** performance.now() ms of the latest reported contact; null before the first flight. */
  landsAt: number | null;
  /** The latest flight's end + Hold.land: when the turn passes (the mockup's gap). */
  handsOffAt: number | null;
  /** True from a throw's commit until landsAt has passed. */
  inFlight: boolean;
  moment(m: Moment, anchor?: Anchor, afterMs?: number): void;
  awaitFlight(key: string): void;
  flightStarted(key: string, landsAt: number, endsAt: number): void;
  flush(): void;
}
```

**Owner rulings:**
- **Q5, from the lead:** the count drops at the throw, as in the mockup. ADR-0008 will state it also supersedes ADR-0002 §2/§3; the lead edits the ADRs.
- **Q6, from the lead:** the hand-off follows the mockup's gap from the flight's end.

- [ ] **Step 1: Write the failing tests**

`tests/native/oneEventPerCommit.test.tsx`:
- Mock `@/lib/device/feedback` as `{ event: mockEvent }` and use `landingDust.test.tsx`'s harness.
- **The throw test:** render a table where seat 3 has just played a pair, `currentTurnIndex` is 0 (the viewer's turn), and the viewer is not finished. Drive frames with `frameOfFirst` (Task 5) until the first `mockEvent` call, then 60 more frames. Assert exactly two calls, each with its own time:
  - the landing call is `event([{kind:"landing", cards: 2, bomb: false, mine: false}], at)`, with `at` ≥ the frame's `performance.now()` and within one frame (16 ms) of the frame on which the drawn cards first sit within 1 pt (`farthest(view) <= 1`);
  - the turn call is `event([{kind:"turn"}], at)`, with `at` within 16 ms of the first frame whose drawn cards sit exactly at rest (`farthest(view) === 0`) plus `Hold.land`.
  - No call carries both. The one-sound priority rule (plan 1) applies within each call, never across the two.
- **The pass test:** re-render with `passCount` + 1. Assert one `event([{kind:"pass"}])` call with `at` undefined or ≤ now.
- **The stall tests:** throw as above, but make the JS side reach `flightStarted` late by advancing `performance.now()` (the jest fake clock) past `landsAt` before the report runs:
  - 20 ms past `landsAt`: the landing's `event` is called once, with `at` equal to that `now`;
  - 100 ms past `landsAt`: no landing `event` is called, and `mockDiag` got one `{ k: "dropped", name: "landing" }` row. Mock `@/lib/diagnostics` with `DIAGNOSTICS: true` for this case.

`tests/native/landingNotDropped.test.tsx`:
- Render with play A (seat 3, a single).
- Advance 5 frames, then re-render with play B (seat 0, a pair).
- Advance 60 frames.
- Assert two landing moments reached `event` (`cards: 1` and `cards: 2`), and `mockEmit` (dust) was called twice.

Today the second play clears the first's impact timer (`pile.tsx:824`), so only one arrives.

`tests/e2e/throwLeavesTheFan.spec.ts` is Playwright, because it is about what is drawn:

```ts
import { test, expect } from "./fixtures";
import { installVirtualClock, step, takeOver } from "./helpers/virtualClock";
import { belowCapsTable, botMove } from "./helpers/mockupParity";

const badgeOf = async (page: import("@playwright/test").Page) =>
  Object.fromEntries(
    await page.locator('[data-testid="seat-card-count"]').evaluateAll((els) =>
      els.map((e) => [Math.round(e.getBoundingClientRect().x), Number(e.textContent)])
    )
  ) as Record<string, number>;

test("an opponent's throw leaves its fan on the throw's first frame, and nothing of it is drawn twice", async ({ page, baseURL }) => {
  await installVirtualClock(page, 1259);
  await belowCapsTable(page, baseURL!);
  await takeOver(page);
  const before = await badgeOf(page);
  const backsBefore = await page.locator('[data-testid="seat-back"]').count();
  expect(backsBefore, "the seed is below the caps: every card is a drawn back").toBe(Object.values(before).reduce((a, b) => a + b, 0));
  await botMove(page);
  let n = 0;
  for (let f = 0; f < 40; f++) {
    await step(page);
    if (n === 0) n = await page.locator('[data-testid="flying-card"]').count();
    if (n === 0) continue;
    const after = await badgeOf(page);
    const dropped = Object.keys(before).filter((k) => after[k] !== before[k]);
    expect(dropped.length, `frame ${f}: exactly one seat's count changed`).toBe(1);
    expect(before[dropped[0]] - after[dropped[0]], `frame ${f}: the count dropped by the play at the throw`).toBe(n);
    expect(await page.locator('[data-testid="seat-back-departing"]').count(), `frame ${f}: a departing back beside the face card`).toBe(0);
    expect(await page.locator('[data-testid="seat-back"]').count(), `frame ${f}: the fans draw exactly the post-throw counts`).toBe(backsBefore - n);
  }
  expect(n, "the throw was traced").toBeGreaterThan(0);
});
```

- The fan's drawn backs are capped (`FAN_DRAWN_CARDS`), so "no back beside the face" is asserted as "the seat's backs fell on the throw's first frame". The cap rule lives in `seatFans.spec.ts`.
- Before writing, confirm three things and use the real names:
  - `seat-card-count` (`seats.tsx:544`) renders the number as its text;
  - the badges' x positions are distinct per seat in `pairsTable`'s seed;
  - the spec seeds `belowCapsTable` (Task 4), not `pairsTable`. `pairsTable`'s 13-card hands sit at the caps, where a back that stayed is indistinguishable from the cap. Under `belowCapsTable` every opponent's badge equals its drawn backs before the throw, and the spec asserts that first.

- [ ] **Step 2: Run on CI, read the red**

Expected:
- `oneEventPerCommit` FAILS: `playCue` is still called, not `event`, and neither time is the flight's.
- `landingNotDropped` FAILS with one landing.
- `throwLeavesTheFan` FAILS "a departing back beside the face card" on the throw's first frame, and on the badge, which holds the pre-throw count until landing (`displayedHandCount`, `seatLayout.ts:218`).

- [ ] **Step 3: Write the timeline**

`components/table/tableTimeline.ts`:

```ts
import { useCallback, useMemo, useRef, useState } from "react";
import { event } from "@/lib/device/feedback";
import type { Moment } from "@/lib/device/moments";
import { DIAGNOSTICS, diag } from "@/lib/diagnostics";
import { Hold, LATE_SOUND_MS } from "@/lib/tokens";

export type Anchor = "landing" | "handoff";
export interface TableTimeline {
  landsAt: number | null;
  handsOffAt: number | null;
  inFlight: boolean;
  moment(m: Moment, anchor?: Anchor, afterMs?: number): void;
  awaitFlight(key: string): void;
  flightStarted(key: string, landsAt: number, endsAt: number): void;
  flush(): void;
}

type Batch = Map<string, { anchor: Anchor; after: number; moments: Moment[] }>;
interface Times { landsAt: number; handsOffAt: number }

export function useTableTimeline(): TableTimeline {
  const [clock, setClock] = useState<{ times: Times | null; awaiting: string | null }>({ times: null, awaiting: null });
  const queued = useRef<Batch>(new Map());
  const held = useRef(new Map<string, Batch>());
  const awaiting = useRef<string | null>(null);
  const timesRef = useRef<Times | null>(null);

  const send = useCallback((batch: Batch, times: Times | null) => {
    const now = performance.now();
    for (const { anchor, after, moments } of batch.values()) {
      const base = times === null ? now : anchor === "landing" ? times.landsAt : times.handsOffAt;
      const at = base + after;
      if (at < now - LATE_SOUND_MS) {
        if (DIAGNOSTICS) diag({ k: "dropped", t: now, name: moments.map((m) => m.kind).join("+") });
        continue;
      }
      event(moments, Math.max(now, at));
    }
  }, []);

  const moment = useCallback((m: Moment, anchor: Anchor = "landing", afterMs = 0) => {
    const key = `${anchor}+${afterMs}`;
    const slot = queued.current.get(key) ?? { anchor, after: afterMs, moments: [] };
    slot.moments.push(m);
    queued.current.set(key, slot);
  }, []);
  const awaitFlight = useCallback((key: string) => {
    awaiting.current = key;
    setClock({ times: null, awaiting: key });
  }, []);
  const flightStarted = useCallback((key: string, landsAt: number, endsAt: number) => {
    const times = { landsAt, handsOffAt: endsAt + Hold.land };
    timesRef.current = times;
    const batch = held.current.get(key);
    held.current.delete(key);
    if (batch) send(batch, times);
    if (awaiting.current === key) awaiting.current = null;
    setClock((c) => ({ times, awaiting: c.awaiting === key ? null : c.awaiting }));
  }, [send]);
  const flush = useCallback(() => {
    if (queued.current.size === 0) return;
    const batch = queued.current;
    queued.current = new Map();
    if (awaiting.current !== null) held.current.set(awaiting.current, batch);
    else send(batch, timesRef.current);
  }, [send]);

  const { times } = clock;
  const inFlight = clock.awaiting !== null || (times !== null && times.landsAt > performance.now());
  return useMemo(
    () => ({ landsAt: times?.landsAt ?? null, handsOffAt: times?.handsOffAt ?? null, inFlight, moment, awaitFlight, flightStarted, flush }),
    [times, inFlight, moment, awaitFlight, flightStarted, flush]
  );
}
```

- A commit's moments go out as one `event` per anchor: the landing's at `landsAt`, the turn's at `handsOffAt`. Two anchors are two calls, so the one-sound rule picks within each, never across them.
- A batch waits for its flight's first frame. `event` is called with the reported `landsAt` (or `handsOffAt`), and the engine schedules the sound in time (design §1), so a JS stall after the throw cannot delay it.
- `Hold.land` is added to a *reported* `endsAt`, never to a timer's start, so it stays on the flight's clock.
- `awaitFlight` clears the published times, so the turn reveal below cannot act on the previous flight's `handsOffAt` while the new throw has not yet drawn its first frame.
- A pass in a later commit whose `landsAt` has passed sounds now.
- `send` never passes an `at` in the past: plan 1 drops a play more than about one IO buffer late. A sound due within `LATE_SOUND_MS` (45) of now is sent at `Math.max(now, at)`, so a reduced-motion landing (contact 0, `landsAt` the first frame, one JS hop in the past) still sounds. A sound due earlier than that, after a longer JS stall, is not played late at all (finding #3's class): it is skipped and recorded as a `dropped` diag row.
- `performance.now()` is read in render only for `inFlight`. A render after the landing needs a state change to flip it, so Step 4's `landed` timer sets that state.

- [ ] **Step 4: Wire it**

In `usePileFlight`'s play branch, in place of the impact and land timers:

```ts
    timeline.awaitFlight(key);
    timeline.moment({ kind: "landing", cards: combo.cards.length, bomb: thrown.heavy, mine: thrown.dir === "bottom" });
```

`FlyingCards`' `onStart` is `timeline.flightStarted`. `flightLanded` is replaced by `landed`, a state that a timer flips at `landsAt`:

```ts
  useEffect(() => {
    if (timeline.landsAt === null) return;
    setLanded(false);
    const id = setTimeout(() => setLanded(true), Math.max(0, timeline.landsAt - performance.now()));
    return () => clearTimeout(id);
  }, [timeline.landsAt]);
```

The delay derives only from `landsAt`, a reported time, so `oneClock` does not flag it. The same pattern gives `useTableFeedback`'s turn reveal (the turn chip and the lamp target) at `handsOffAt`, the flight's reported end plus the mockup's gap:

```ts
  useEffect(() => {
    if (turn.shown === turn.seat) return;
    const reveal = () => {
      traceOnset("moment", "handoff");
      setTurn((t) => ({ ...t, shown: t.seat }));
    };
    if (timeline.inFlight && timeline.handsOffAt === null) return;
    const wait = (timeline.handsOffAt ?? 0) - performance.now();
    if (wait <= 0) return reveal();
    const id = setTimeout(reveal, wait);
    return () => clearTimeout(id);
  }, [turn, timeline.handsOffAt, timeline.inFlight]);
```

The existing turn/pass effects keep their edge detection. Each replaces its `playCue(...)` with `timeline.moment(...)`:

```ts
      timeline.moment({ kind: "turn" }, "handoff");
```

```ts
    if (passCount > prevCount || (closed && !wasClosed)) timeline.moment({ kind: "pass" });
```

The sting becomes:

```ts
    timeline.moment({ kind: "mancheOver", outcome }, "handoff", motionMs("shift", reduceMotion));
```

It fires for all three outcomes, `neutral` included (design D6, finding #5), where today's guard sounds only a win or a loss. The effect's existing `"pending"` early return stays.

Its `stingTimerRef`, `handOffTimerRef` and `duckMusicFor(2200)` go: plan 1's `event` ducks for a sting.

`GameTable.tsx` declares `const timeline = useTableTimeline();` among its hooks and ends with:

```ts
  useEffect(() => timeline.flush());
```

This is the last hook before `if (!gameState)`. Effects in one component run in declaration order, so every producer above has queued before it flushes.

**The count at the throw** (Q5, lead's ruling):
- `seats.tsx` `CardFan` loses `departing`: the fan draws `Math.min(count, FAN_DRAWN_CARDS[side])` backs, all `seat-back`, and `seat-back-departing` goes.
- The opponent seats' `displayed` (`:717`, `:884`) becomes `Math.min(cardCount ?? player.hand.length, arrived)`.
- `displayedHandCount` goes from `seatLayout.ts`, and `fanCounts(count, cap)` keeps only the cap.
- `flightPhysics.ts:961`/`:965` pass `handCountOf(...)` where they passed `displayedHandCount(…, leaving)`. That is the pre-throw geometry the origin must not depend on, so it is also one less count parameter for plan 3's scan to find.
- `GameTable` drops `departingSide`, `departingCount` and the three `departing=` props.
- The thrown cards are drawn only by `FlyingCards`, from the fan centre (Task 4). The flying card *is* the departing card.

In `lib/tokens.ts`, `Hold.land` becomes 175, with its doc line replaced by `/** From a flight's end to the hand-off — the lantern mockup's gap (index.html:612, :614). */`.

In `components/flightPhysics.ts`, delete `LANDING_FRACTION`, `impactDelayMs`, `handOffDelayMs` and `landingHoldMs` (`:72-107`, minus `landWobble`). Grep `impactDelayMs|handOffDelayMs|landingHoldMs|LANDING_FRACTION` across `app components context lib tests`. Every hit is fixed in this task, except `tests/e2e/helpers/mockupParity.ts` (Task 7) and docs (Task 12).

- [ ] **Step 5: Rewrite the tests that re-derived the delay**

Every one of the following mocks `@/lib/device/feedback` (`event`) in place of `@/lib/device/sounds`. Each drives frames with `frameOfFirst` and states its expectation in drawn terms:

| Test | New assertion |
| --- | --- |
| `yourTurnCue.test.tsx` | the `turn` moment's `at` is within 16 ms of the first frame whose drawn cards sit exactly at rest (`farthest(view) === 0`, the flight's end) plus `Hold.land`; nothing is sent before the flight's first frame |
| `gameOverSting.test.tsx` | the `mancheOver` moment's `at` is the turn anchor's `at + motionMs("shift")`. **Online case:** `handScores` arrive one render late; the sting's `at` is unchanged |
| `oneEventPerCommit.test.tsx` (added case) | a bomb's landing moment reaches `event` with `bomb` true, choosing the sound |
| `tests/ui-rules/landingCueHasNoHaptic.test.ts` (new, `node --test`) | for every `cards` 1–5 × `bomb` × `mine`, `cueFor({ kind: "landing", … }).haptics` is empty (`cueFor` from `lib/device/moments.ts`): the landing pulses are `runLandingPulses`' (Task 5), and a second pulse through `event` would double them |
| `tableFeedbackIdentity.test.tsx` | unchanged intent; replace its `playCue` spy with `event` |

`Hold.land` and `motionMs("shift")` appear in these expectations because they are the *specified* gaps between two events. The anchors, the rest frame and the recorded `at`s, are read from what was drawn and called, never computed.

- [ ] **Step 6: Local checks**

Run: `npx tsc --noEmit -p . && npx eslint components/table/tableTimeline.ts components/useTableFeedback.ts components/table/pile.tsx components/table/seats.tsx components/seatLayout.ts components/GameTable.tsx components/flightPhysics.ts lib/tokens.ts lib/diagnostics/types.ts tests/e2e/throwLeavesTheFan.spec.ts && node --test tests/ui-rules/oneClock.test.ts tests/ui-rules/flightPhysics.test.ts tests/ui-rules/seatLayout.test.ts tests/ui-rules/landingCueHasNoHaptic.test.ts`
Expected: `landingCueHasNoHaptic` passes (plan 1 gives a landing cue no haptics). `oneClock` now omits every `pile.tsx` and `useTableFeedback.ts` line. What remains is `GameTable.tsx:759`, `ExchangeFlight.tsx:84`, `deal.tsx:76` and `hand.tsx:861`, for Tasks 9 and 10.

- [ ] **Step 7: Commit**

```bash
git add -- components/table/tableTimeline.ts components/useTableFeedback.ts components/table/pile.tsx components/table/seats.tsx components/seatLayout.ts components/GameTable.tsx components/flightPhysics.ts lib/tokens.ts lib/diagnostics/types.ts tests/native/oneEventPerCommit.test.tsx tests/native/landingNotDropped.test.tsx tests/native/yourTurnCue.test.tsx tests/native/gameOverSting.test.tsx tests/native/tableFeedbackIdentity.test.tsx tests/ui-rules/seatLayout.test.ts tests/ui-rules/landingCueHasNoHaptic.test.ts tests/e2e/throwLeavesTheFan.spec.ts
git rm -- tests/native/seatFanDeparting.test.tsx
git commit -m "feat(table): the count leaves the fan at the throw; every landing consequence reads the flight's clock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Mockup parity compares the throw's pose, with nothing subtracted

**Files:**
- Modify: `tests/e2e/helpers/mockupParity.ts`:
  - the `import` at `:27`;
  - `TRICK_LANDINGS` `:121`;
  - the `trick` moment `:136-155`;
  - the `trick-landings` moment `:156-186`;
  - the mockup script injection `:311-317`;
  - the comparison call inside `parityTests`.

**Interfaces:**
- Consumes: `diffFlight` and `TraceFrame.flight` (Task 3); `traceOnset("moment","handoff")` and `Hold.land = 175` (Task 6).
- Produces: nothing new. Both moments stay on absolute times, aligned on the landings: the app throws at the mockup's own throw times, so its flights end where the mockup's do, and any difference in the hand-off gap shows up as a hand-off onset and a lamp position that are off.

- [ ] **Step 1: Delete the subtraction and the sound comparison**

`trick-landings`:
- `actions`:

```ts
    actions: [
      { atMs: 1150, app: playLowest(2) },
      { atMs: 2600, app: botMove },
      { atMs: 4150, app: pass },
      { atMs: 5350, app: botMove },
    ],
```

  These are the mockup's own throw times (`index.html` trick chapter).
- `fields: ["flight", "live", "dropped", "brightness"]`.
- Delete `onsets` and the `landWobble` wrapper in `mockupScript`. The sound's time is held against contact by `landingContact.spec.ts` on purpose: design §2 departs from the mockup's tween timer.
- Keep `checkpoints` and `regionsAt` as literal times derived from `[1584, 3040, 5792]`, the mockup's sampled landings, now named `MOCKUP_LANDINGS`. They sample the mockup at rest and are not a claim about the app's timing.

`trick`:
- Wrap the mockup's `handoff` in `mockupScript`:

```js
      const hand = handoff;
      handoff = (a, b) => { window.__parityOnsets.push("moment:handoff"); hand(a, b); };
```

- `actions[0]` becomes `{ atMs: 1150, app: playLowest(2) }`: the mockup throws the pair 5c/5d at 1150 (`index.html:611`), with nothing subtracted. Today's `playLowest(1)` throws a single, whose flight ends 45 ms earlier. The seed (`heldTurnTable`) must hold a pair: confirm it, or switch this moment to `pairsTable`, which `trick-landings` already uses.
- The passes at 3250, 4550 and 5950 stay. In the app each hands off at once, at the mockup's own hand-off times (`:613`, `:614`).
- `fields: ["onset", "lamp", "level"]` and `onsets: ["moment:handoff"]`.
- `checkpoints` stay `[1040, 2496, 4000, 5296, 6704]`: absolute, and therefore aligned on the landing. The mockup's pair ends at 1575 and hands off at 1750. The app's ends at 1575 + first-frame lag and hands off at 1750 + lag, within the 16 ms onset tolerance for a one-frame lag.

A gap regression now fails twice: the `moment:handoff#0` onset moves by the regression, and so does the lamp at 2496, 750 ms after it.

In `parityTests`, when `m.fields` includes `"flight"`, append `diffFlight(mockup.trace, app.trace)` to the failures.

Remove the `handOffDelayMs, impactDelayMs` import (`:27`).

- [ ] **Step 2: Run the unit tests and the type check**

Run: `node --test tests/ui-rules/traceDiff.test.ts && npx tsc --noEmit -p . && npx eslint tests/e2e/helpers/mockupParity.ts`
Expected: PASS. `mockupParityTrickLandingsSkia.spec.ts` and `mockupParityTrickSkia.spec.ts` run on CI.

Expected on CI, at this commit: **green** on `flight` and on `moment:handoff`. Before Task 4, the same spec would fail `flight 0 contact` and `start`, because there was no stagger and a 40 ms anticipation. Before Task 6, `trick` would fail `moment:handoff#0` by about 170 ms, because the app hands off at 253 + 50 after the throw. Confirm this once by running the spec against the commit before Task 4 (`git stash` is forbidden across worktrees; use `git worktree add` of `HEAD~4` outside `.worktrees/`, per memory, and remove it with `npm run worktrees:remove`). If the old commit is green on `flight`, the field cannot see the throw: stop and report.

- [ ] **Step 3: Commit**

```bash
git add -- tests/e2e/helpers/mockupParity.ts
git commit -m "test(e2e): mockup parity holds the throw's pose, at the mockup's own throw times

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The exchange as one timeline, and the server re-arms from it

**Owner decision D5 (revised):** both traded cards are shown face up to every seat, the giveback included. This departs from the mockup's `giveBack`, which turns the card to its back mid-flight (`index.html:548-551`).

**Owner direction on the exchange's pace and attribution** (verbatim in substance): give the exchange more time, and make it clear who gave what to whom, in place of the two centre messages, aligned to the design system. So:
- both legs run seat to seat, face up, and slower;
- each card rests, still and face up, beside its receiver's seat for `Hold.reveal` before it tucks in;
- a name tag rides each card (Task 9).

The legs no longer pass through the table centre, which the mockup's `receive` did (`:543-547`, flying to (457,236) and sliding from there). The departure is the owner's; ADR-0008 must record it, which is the lead's edit (design question 9).

**Lead's ruling on Q10:** the server's give delay is computed from the same pure functions the client animates with. The shared modules both sides import are:
- **`lib/game/dealTimeline.ts`** (new): the deal's schedule, moved out of `components/flightPhysics.ts:384-415`;
- **`lib/game/exchangeTimeline.ts`**: the exchange's poses.

The server holds no estimate of its own.

**Files:**
- Create: `lib/game/dealTimeline.ts`. Move `DEAL_FLIGHT_MS`, `dealFlightsMs`, `dealLeaveMs` and `dealArrivalsMs` there from `components/flightPhysics.ts:384-415`, unchanged, and add `dealEndMs`.
- Modify: `components/table/deal.tsx:14-20` (import the four from `@/lib/game/dealTimeline`), `components/flightPhysics.ts` (delete the moved block), and every test importing them from `flightPhysics` (Grep `dealArrivalsMs|dealFlightsMs|dealLeaveMs|DEAL_FLIGHT_MS` in `tests/`: `tests/ui-rules/dealSchedule.test.ts`, `tests/ui-rules/flightHooks.test.ts` and `tests/native/seatDealArrival.test.tsx`).
- Modify: `tests/ui-rules/motionEscapes.test.ts`, whose pinned `_MS` count in `components/` drops by one (`DEAL_FLIGHT_MS` leaves). Name it in the commit message.
- Create: `lib/game/exchangeTimeline.ts`
- Modify: `lib/tokens.ts` (add `Motion.exchange` and `Hold.reveal`)
- Modify: `lib/exchangeCeremony.ts` (derive from the timeline; delete `EXCHANGE_LEG_MS`, `MEET_HOLD_MS`, `EXCHANGE_FLIGHT_MS`)
- Modify: `server/game/gameTurn.ts` (one funnel: `armAfterMove`; the exchange winner's bot delay)
- Modify: `server/game/tableHandlers.ts:370`
- Create: `tests/ui-rules/exchangeTimeline.test.ts`
- Create: `tests/server/exchangeRearm.test.ts`

**Interfaces:**
- Produces (all worklets, pure, relative imports only):
  - `interface LegPoints { from: From; fromFace: boolean; rest: From; to: From; toFace: boolean }`. `fromFace` is false when the card leaves a fan of backs; `toFace` is false when it tucks into one.
  - `restPoint(to: { x: number; y: number }): From`, the still point beside the receiver: `REST_REACH` (0.7) of the way from the pile centre to `to`, upright, at `REST_SCALE` (0.8).
  - `receivePose(elapsedMs: number, leg: LegPoints): ExchangePose` and `givePose(elapsedMs: number, leg: LegPoints): ExchangePose`, one shared `legPose` each, started at `Motion.exchange.beat` and `Motion.exchange.giveWait`
  - `interface ExchangePose extends Pose { visible: boolean; face: boolean; flip: number }` (the received card's highlight is the hand's, Task 9), where `flip` is the horizontal scale of the flip, from 0.02 to 1
  - `RECEIVE_MS: number` — the end of the receive, from the deal's end
  - `GIVE_MS: number` — the end of the give, from the choice
  - `RECEIVE_LEAD = beat` and `GIVE_LEAD = giveWait`: where each leg starts on its clock.
  - `REST_AT_MS`, `REST_END_MS: number` — offsets from a leg's lead: the card comes to rest (`lift + fly`) and starts to tuck (`REST_AT_MS + Hold.reveal`). The card leaves at offset 0. The giver's ring flashes at the lead, the receiver's at `lead + REST_AT_MS` (Task 9).
  - `receiveSoundMs: number`, `giveSoundMs: number` — each measured from its leg's clock start
  - `exchangeGiveDelayMs(counts: readonly number[]): number`: the latest the client's receive leg can end, computed from `dealEndMs` and `receivePose`; the server's floor for a bot winner's give
  - from `lib/game/dealTimeline.ts`: `dealEndMs(counts: readonly number[], offsetMs: number, flightsMs: readonly number[]): number`, the last card's landing (`max` over seats of `dealArrivalsMs(...)`'s last entry), which `deal.tsx`'s own end report must agree with
- `exchangeAnnounceMs(bothJokersException: boolean): number` keeps its signature. It now returns `(bothJokers ? 0 : GIVE_MS) + Reading.notice`.

- [ ] **Step 1: Write the failing tests**

`tests/ui-rules/exchangeTimeline.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { GIVE_MS, RECEIVE_MS, givePose, receivePose, receiveSoundMs, restPoint, type LegPoints } from "../../lib/game/exchangeTimeline.ts";
import { exchangeAnnounceMs } from "../../lib/exchangeCeremony.ts";
import { Hold, Reading } from "../../lib/tokens.ts";

const FAN = { x: -328, y: -42, rot: 90, scale: 0.37 };
const SLOT = { x: 40, y: 150, rot: 2, scale: 1.2 };
const TOP_FAN = { x: 0, y: -170, rot: 0, scale: 0.34 };
const RECEIVE: LegPoints = { from: FAN, fromFace: false, rest: restPoint(SLOT), to: SLOT, toFace: true };
const GIVE_TO_FAN: LegPoints = { from: SLOT, fromFace: true, rest: restPoint(FAN), to: FAN, toFace: false };
const BYSTANDER_GIVE: LegPoints = { from: TOP_FAN, fromFace: false, rest: restPoint(FAN), to: FAN, toFace: false };
const LEGS = [
  { name: "receive", pose: (t: number) => receivePose(t, RECEIVE), end: RECEIVE_MS, leg: RECEIVE },
  { name: "give into a fan", pose: (t: number) => givePose(t, GIVE_TO_FAN), end: GIVE_MS, leg: GIVE_TO_FAN },
  { name: "give, fan to fan", pose: (t: number) => givePose(t, BYSTANDER_GIVE), end: GIVE_MS, leg: BYSTANDER_GIVE },
];

function sample(pose: (t: number) => { x: number; y: number; scale: number; visible: boolean; face: boolean; flip: number }, end: number) {
  const out = [];
  for (let t = 0; t <= end + 50; t++) out.push({ t, ...pose(t) });
  return out;
}

for (const { name, pose, end, leg } of LEGS) {
  test(`${name}: the card never jumps, no two adjacent 1 ms samples more than 4 pt apart while it is visible`, () => {
    const s = sample(pose, end);
    for (let i = 1; i < s.length; i++) {
      if (s[i].visible && s[i - 1].visible) assert.ok(Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y) <= 4, `jump at ${s[i].t} ms`);
    }
    assert.ok(s[0].visible === false && s[s.length - 1].visible === false, "hidden before the lead and after it has tucked in");
  });

  test(`${name}: the face rests still, face up, beside the receiver for at least Hold.reveal`, () => {
    const s = sample(pose, end);
    const still = s.filter((p) => p.visible && p.face && p.flip > 0.5 && Math.hypot(p.x - leg.rest.x, p.y - leg.rest.y) < 0.5 && Math.abs(p.scale - leg.rest.scale) < 0.01);
    assert.ok(still.length >= Hold.reveal, `the face rests for ${still.length} ms`);
    assert.ok(Hold.reveal >= 600, "the #1259 reading floor");
  });

  test(`${name}: face up to every seat from the lift to the tuck (D5, revised)`, () => {
    const s = sample(pose, end).filter((p) => p.visible);
    const firstFace = s.findIndex((p) => p.face);
    const lastFace = s.findLastIndex((p) => p.face);
    assert.ok(firstFace >= 0 && s.slice(firstFace, lastFace + 1).every((p) => p.face), "the face never turns away mid-leg");
    const last = s.at(-1)!;
    assert.ok(Math.hypot(last.x - leg.to.x, last.y - leg.to.y) <= 1, "it tucks in where it is going");
    assert.equal(last.face, leg.toFace, "a card tucked into a fan joins it as a back");
  });
}

test("the receive sound is on the frame the back leaves the fan", () => {
  const s = sample((t) => receivePose(t, RECEIVE), RECEIVE_MS);
  const leaves = s.find((p) => p.visible)!.t;
  assert.equal(receiveSoundMs, leaves);
});

test("the ceremony holds the table for the give and then a notice's reading", () => {
  const s = sample((t) => givePose(t, GIVE_TO_FAN), GIVE_MS);
  const lastVisible = s.filter((p) => p.visible).at(-1)!.t;
  assert.equal(exchangeAnnounceMs(false), lastVisible + 1 + Reading.notice);
  assert.equal(exchangeAnnounceMs(true), Reading.notice);
});

test("the server's give floor is the client's own deal and receive, whatever the seats' distances", () => {
  const counts = [13, 13, 13, 13];
  const s = sample((t) => receivePose(t, RECEIVE), RECEIVE_MS);
  const received = s.filter((p) => p.visible).at(-1)!.t + 1;
  const farthest = dealEndMs(counts, Motion.duration.reveal, counts.map(() => DEAL_FLIGHT_MS));
  assert.equal(exchangeGiveDelayMs(counts), farthest + received);
  for (const seats of [[{ dx: 0, dy: 100 }, { dx: -300, dy: 0 }, { dx: 300, dy: 0 }, { dx: 0, dy: -120 }], [{ dx: 0, dy: 10 }, { dx: 5, dy: 0 }, { dx: 0, dy: -400 }, { dx: 20, dy: 0 }]]) {
    const client = dealEndMs(counts, Motion.duration.reveal, dealFlightsMs(seats)) + received;
    assert.ok(client <= exchangeGiveDelayMs(counts), `the client's receive ends at ${client}, after the server's floor`);
  }
});
```

Add to the file's imports:

```ts
import { DEAL_FLIGHT_MS, dealEndMs, dealFlightsMs } from "../../lib/game/dealTimeline.ts";
import { Motion } from "../../lib/tokens.ts";
import { exchangeGiveDelayMs } from "../../lib/game/exchangeTimeline.ts";
```

- The expected receive end is sampled from `receivePose` (the last visible 1 ms sample + 1), not read from `RECEIVE_MS`. A floor computed from a separate estimate fails the equality.
- `Motion.duration.reveal` is the deal's own offset when the table mounts: `GameTable.tsx:574` passes `entryMs = motionMs("reveal")` to `useDeal`, and a rematch on a mounted table deals at 0. The mount offset is the later of the two, so it is the floor.

`tests/server/exchangeRearm.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Server as SocketServer } from "socket.io";
import { armTurn } from "../../server/game/gameTurn.ts";
import { persistence } from "../../server/game/gamePersistence.ts";
import { activeGames, type OnlineGameState } from "../../server/game/gameRoom.ts";
import { botMoveDelayMs, clearRoomTimers } from "../../server/game/gameTimers.ts";
import { initializeRematch, type GameState } from "../../lib/game/gameEngine.ts";
import { exchangeAnnounceMs } from "../../lib/exchangeCeremony.ts";
import { exchangeGiveDelayMs } from "../../lib/game/exchangeTimeline.ts";

const ROOM = "exchange-rearm-room";
const io = { to: () => ({ emit: () => {} }) } as unknown as SocketServer;

function exchangeTable(): OnlineGameState {
  const seats = [0, 1, 2, 3].map((i) => ({ name: `B${i}`, type: "ai" as const, id: `player_${i}` }));
  const gameState: GameState = initializeRematch(seats, "free_for_all", ["player_0", "player_1", "player_2", "player_3"]);
  assert.ok(gameState.exchangePhase?.active, "the rematch opens an exchange");
  const game = { roomId: ROOM, gameState, playerMap: {}, weakSeats: new Set<number>() } as unknown as OnlineGameState;
  activeGames.set(ROOM, game);
  return game;
}

test("a bot winner gives no earlier than the receive has been shown, and the next seat waits out the ceremony", (t) => {
  t.mock.method(persistence, "writeActiveGame", async () => {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const game = exchangeTable();
  try {
    const phase = game.gameState.exchangePhase!;
    armTurn(io, ROOM);
    const floor = exchangeGiveDelayMs(game.gameState.players.map((p) => p.hand.length));
    t.mock.timers.tick(floor - 1);
    assert.equal(game.gameState.exchangePhase?.active, true, "gave before the receive was shown");
    t.mock.timers.tick(1);
    assert.equal(game.gameState.exchangePhase?.active ?? false, false, "the bot winner gave");
    const after = structuredClone(game.gameState);
    t.mock.timers.tick(Math.max(botMoveDelayMs(), exchangeAnnounceMs(phase.bothJokersException)) - 1);
    assert.deepEqual(game.gameState, after, "the next seat moved during the ceremony");
    t.mock.timers.tick(1);
    assert.notDeepEqual(game.gameState, after, "the next seat never moved");
  } finally {
    clearRoomTimers(ROOM);
    activeGames.delete(ROOM);
  }
});
```

Before running, confirm:
- `initializeRematch`'s `prevRankings` puts the last-ranked seat as the loser and seats an exchange (`gameEngine.ts:833-898`);
- `ai` is the `PlayerType` value for a bot. Read `PlayerType` and use its real member.

If `initializeRematch` needs `dealtHands` for a deterministic exchange, pass the hands from `tests/server/exchangeVisibility.test.ts`'s fixture.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/ui-rules/exchangeTimeline.test.ts tests/server/exchangeRearm.test.ts`
Expected: FAIL.
- The first file fails with `ERR_MODULE_NOT_FOUND` `lib/game/exchangeTimeline.ts`.
- Once the module exists, the server test still fails "the next seat moved during the ceremony": `runBotTurn` re-arms with `botMoveDelayMs()` (`gameTurn.ts:191`).

- [ ] **Step 3: Tokens and the timeline**

`lib/tokens.ts`, in `Motion` after `throw`:

```ts
  /** The exchange's two legs, seat to seat, face up (#1259, D5 revised); `beat`, `giveWait`, `tuck` and `highlight` are the mockup's (index.html:543-551). */
  exchange: { beat: 344, lift: 240, fly: 900, tuck: 320, highlight: 1000, giveWait: 420 },
```

In `Hold`: `reveal: 600,` with the doc line `/** A face shown to be read before it moves on — the floor the #1259 research asks for. */`.

**The proposed pace, against today's.** Each leg is `lift + fly + Hold.reveal + tuck` = 240 + 900 + 600 + 320 = **2060 ms**:

| | today (the mockup's) | proposed |
| --- | --- | --- |
| receive, from the deal's end | 344 + 1050 + 320 = 1714 | 344 + 2060 = **2404** |
| give, from the choice | 420 + 460 = 880 | 420 + 2060 = **2480** |
| the face still, before it moves on | 360 at the centre (receive), none (give) | **600** beside the receiver, both legs |
| the ceremony, `exchangeAnnounceMs(false)` | 880 + 4000 | 2480 + 4000 = **6480** |

- `lift` (240): the card rises off the giver's seat to `REST_SCALE` and, if it left a fan of backs, turns face up across it, the mockup's `flip` length.
- `fly` (900): seat to rest, with the mockup's cubic ease-out and its 30 pt arc. It is 2.4× the mockup's 380, the owner's "a bit more time", so the eye can follow the card from one seat to the other.
- These are the values the Task 9 mockup proposes. The owner's approved values replace them in this one line before Task 9 builds.

`lib/game/exchangeTimeline.ts`:

```ts
import { Hold, Motion, Reading } from "../tokens.ts";

interface Point { x: number; y: number; rot: number }
interface From extends Point { scale: number }
export interface ExchangePose extends From { visible: boolean; face: boolean; flip: number }
export interface LegPoints { from: From; fromFace: boolean; rest: From; to: From; toFace: boolean }

const X = Motion.exchange;
const REST_REACH = 0.7;
const REST_SCALE = 0.8;
const ARC = 30;
const clamp01 = (k: number) => {
  "worklet";
  return Math.min(1, Math.max(0, k));
};
const ease = (k: number) => {
  "worklet";
  return 1 - Math.pow(1 - clamp01(k), 3);
};
const lerp = (a: number, b: number, e: number) => {
  "worklet";
  return a + (b - a) * e;
};
const turn = (k: number) => {
  "worklet";
  return Math.max(0.02, Math.abs(Math.cos(Math.PI * clamp01(k))));
};

export const REST_AT_MS = X.lift + X.fly;
export const REST_END_MS = REST_AT_MS + Hold.reveal;
const LEG_MS = REST_END_MS + X.tuck;
export const RECEIVE_LEAD = X.beat;
export const GIVE_LEAD = X.giveWait;
export const RECEIVE_MS = RECEIVE_LEAD + LEG_MS;
export const GIVE_MS = GIVE_LEAD + LEG_MS;
export const receiveSoundMs = RECEIVE_LEAD;
export const giveSoundMs = GIVE_LEAD;

export function restPoint(to: { x: number; y: number }): From {
  "worklet";
  return { x: to.x * REST_REACH, y: to.y * REST_REACH, rot: 0, scale: REST_SCALE };
}

function legPose(t: number, p: LegPoints): ExchangePose {
  "worklet";
  const { from, rest, to } = p;
  if (t < 0 || t >= LEG_MS) return { ...to, visible: false, face: p.toFace, flip: 1 };
  if (t < X.lift) {
    const k = t / X.lift;
    return {
      ...from,
      scale: lerp(from.scale, rest.scale, ease(k)),
      visible: true,
      face: p.fromFace || k >= 0.5,
      flip: p.fromFace ? 1 : turn(k),
    };
  }
  if (t < REST_AT_MS) {
    const e = ease((t - X.lift) / X.fly);
    return {
      x: lerp(from.x, rest.x, e),
      y: lerp(from.y, rest.y, e) - ARC * Math.sin(Math.PI * e),
      rot: lerp(from.rot, rest.rot, e),
      scale: rest.scale,
      visible: true,
      face: true,
      flip: 1,
    };
  }
  if (t < REST_END_MS) return { ...rest, visible: true, face: true, flip: 1 };
  const k = (t - REST_END_MS) / X.tuck;
  const e = ease(k);
  return {
    x: lerp(rest.x, to.x, e),
    y: lerp(rest.y, to.y, e),
    rot: lerp(rest.rot, to.rot, e),
    scale: lerp(rest.scale, to.scale, e),
    visible: true,
    face: p.toFace || k < 0.5,
    flip: p.toFace ? 1 : turn(k),
  };
}

export function receivePose(t: number, leg: LegPoints): ExchangePose {
  "worklet";
  return legPose(t - RECEIVE_LEAD, leg);
}

export function givePose(t: number, leg: LegPoints): ExchangePose {
  "worklet";
  return legPose(t - GIVE_LEAD, leg);
}

export function exchangeGiveDelayMs(counts: readonly number[]): number {
  return dealEndMs(counts, Motion.duration.reveal, counts.map(() => DEAL_FLIGHT_MS)) + RECEIVE_MS;
}

export function exchangeAnnounceFrom(bothJokersException: boolean): number {
  return (bothJokersException ? 0 : GIVE_MS) + Reading.notice;
}
```

The file also imports `import { DEAL_FLIGHT_MS, dealEndMs } from "./dealTimeline.ts";`.

`lib/game/dealTimeline.ts` moves the four deal functions verbatim from `components/flightPhysics.ts:384-415`, changing only their import to `import { Motion } from "../tokens.ts";`, and adds:

```ts
export function dealEndMs(counts: readonly number[], offsetMs: number, flightsMs: readonly number[]): number {
  return Math.max(0, ...counts.map((count, seat) => dealArrivalsMs(count, seat, counts.length, offsetMs, flightsMs[seat]).at(-1) ?? 0));
}
```

`deal.tsx`'s end (`:74-76` today; Task 10 moves it onto the deal's own clock) is `dealEndMs(deal.counts, deal.offsetMs, deal.flightsMs)`, the same function. So the server's floor and the client's animation are one computation, differing only in the flights. The server takes every seat at the farthest seat's `DEAL_FLIGHT_MS`, because it has no geometry; `dealFlightsMs` never exceeds that (`flightPhysics.ts:390-394`), so the floor is never early.

`lib/exchangeCeremony.ts` keeps `exchangeAnnounceMs` as a one-line delegate to `exchangeAnnounceFrom`, which is imported with `./game/exchangeTimeline.ts`. Its callers (`tableHandlers.ts`, `sharedGameFlow.ts`, `tests/server/exchangeVisibility.test.ts`) are unchanged. Delete `EXCHANGE_LEG_MS`, `MEET_HOLD_MS` and `EXCHANGE_FLIGHT_MS`. Their client readers go in Task 9, in the same push.

The client keeps its own wait: it holds the give leg until its own receive leg has ended, whatever the server does (Task 9).

- [ ] **Step 4: One funnel for the server's re-arm**

In `server/game/gameTurn.ts`, add beside `armTurn`:

```ts
function armAfterMove(io: SocketServer, roomId: string, prev: GameState) {
  const phase = prev.exchangePhase;
  armTurn(io, roomId, phase?.active ? exchangeAnnounceMs(phase.bothJokersException === true) : botMoveDelayMs());
}
```

- `runBotTurn`'s `armTurn(io, roomId)` (`:191`) and `handleAutoPass`'s (`:218`) become `armAfterMove(io, roomId, prevState)`, with `prevState` captured before `game.gameState = next`.
- `tableHandlers.ts:370` becomes `armAfterMove(io, roomId, prevState)`, which needs `armAfterMove` exported. `bothJokersException` there is then read from the funnel.
- In `armTurn`'s vacant-seat branch, a seat that is the active exchange's winner is armed with `Math.max(botDelayMs, exchangeGiveDelayMs(game.gameState.players.map(handCountOf)))`. These are the counts `deal.tsx:57` deals from; `handCountOf` is `shared/protocol.ts`'s.

Import `exchangeGiveDelayMs` with a relative `.ts` path, as `server/` does for `lib/`.

- [ ] **Step 5: Run to verify they pass**

Run: `node --test tests/ui-rules/exchangeTimeline.test.ts tests/server/exchangeRearm.test.ts tests/server/exchangeVisibility.test.ts tests/server/openingGrace.test.ts tests/server/weakSeatTakeover.test.ts tests/ui-rules/dealSchedule.test.ts tests/ui-rules/flightHooks.test.ts tests/ui-rules/motionEscapes.test.ts && npx tsc --noEmit -p . && npx eslint lib/game/dealTimeline.ts lib/game/exchangeTimeline.ts lib/exchangeCeremony.ts lib/tokens.ts components/flightPhysics.ts components/table/deal.tsx server/game/gameTurn.ts server/game/tableHandlers.ts tests/ui-rules/exchangeTimeline.test.ts tests/server/exchangeRearm.test.ts`
Expected: PASS. `tsc` reports the client files that still import the deleted `EXCHANGE_*` names. Leave them to Task 9, which is the same push. `tsc` must be clean at the end of Task 9.

- [ ] **Step 6: Commit**

```bash
git add -- lib/game/dealTimeline.ts lib/game/exchangeTimeline.ts lib/exchangeCeremony.ts lib/tokens.ts components/flightPhysics.ts components/table/deal.tsx server/game/gameTurn.ts server/game/tableHandlers.ts tests/ui-rules/exchangeTimeline.test.ts tests/server/exchangeRearm.test.ts tests/ui-rules/dealSchedule.test.ts tests/ui-rules/flightHooks.test.ts tests/native/seatDealArrival.test.tsx tests/ui-rules/motionEscapes.test.ts
git commit -m "feat(exchange): one timeline for the trade, and the server re-arms from it on every path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9 (owner-gated at Step 1): The exchange legs on UI clocks, seat to seat, with the names riding the cards

**Owner decisions:** D5 revised, and the direction on pace and attribution, both as in Task 8.

**The design this task builds.** These are the defaults the Step 1 mockup proposes; the approved mockup overrides any of them.
- **The card.** Each traded card leaves the giver's seat (a fan of backs, or the viewer's own hand). It lifts and turns face up, flies to `restPoint(receiver)` beside the receiver's seat, rests there still and face up for `Hold.reveal`, and tucks in. A card tucked into a fan turns to its back as it goes, because a fan holds backs. The poses are all Task 8's.
- **The name tag.** A tag rides each card: `ExchangeTag`, which this task creates in `components/table/ExchangeTag.tsx` from the existing chip components in `components/table/chrome.tsx` (`<TableChip scale lit>` around `<ChipText scale lit>`), so it adds no token, no style and no contrast row.
  - Its text is `t("exchange.tag", { from, to })`, "{{from}} → {{to}}", with the viewer named `t("gameShared.you")`.
  - It is centred under the card's rotated box, `Spacing.xxs` below it, from the leg's first frame until the rest ends.
  - It then stays parked where the card rested while the card tucks in, and stays there until the ceremony dismisses. So when the give has landed, the two tags name the whole trade at the two receiving seats.
- **Each end is marked, giver first.**
  - An opponent's end: its ring pings, the giver's on the leg's first visible frame and the receiver's on the rest frame. It is the ring's existing one-shot ping (`seats.tsx:434-449`), now also started from a shared value that `ExchangeLegs` writes on those frames.
  - The viewer's end has no ring (the viewer's seat draws no `SeatRing`; only `TopOppSlot`/`SideOppSlot` render `SeatWho`, `seats.tsx:756`, `:833`). As giver, the mark is the card lifting out of the viewer's own hand: the leg starts at the card's hand slot and the hand stops drawing it on that frame. As receiver, the mark is a gold halo on the received card once it is in the hand, for `Motion.exchange.highlight` (the mockup's `hi`, `index.html:546-547`). Today's hand has no such halo, so this task adds it (Step 4).
- **No centre text.** The two centre messages go:
  - `ExchangePrompt` (the received card and its sentence, `GameTable.tsx:1200-1212`);
  - `ExchangeAnnouncement`'s centre layer (its fliers, its "got X" tags, its no-swap line).
  - Both files are deleted, as plan 5's Task 4 expects (it leaves them to this plan, with their `contrast.test.ts` rows `:229,263,264`).
- **The choice's instruction moves to the HUD's `TurnChip`** (`GameTable.tsx:1027-1042`), where the mockup writes its own "Scambio" note (`index.html:605`). During the choice the chip reads:
  - `t("exchange.chipGive", { name: loser })` for the viewer who gives;
  - `t("exchange.chipGiveLowest", { name: loser })` when no card is in 3–10 (`givebackIsFallback`);
  - `t("exchange.chipChoosing", { winner })` for everyone else.

  Its `spokenSeat` carries the sentence `ExchangePrompt` spoke (`exchange.receivedCardA11yLabel*` followed by the line). The `exchange-prompt` testID moves to a `View` wrapping the `TurnChip` for the same window. It is plan 5's kept selector, read by `tests/e2e/helpers/bot.ts:405`, `.maestro/exchange-phase.yaml` and seven specs.
- **Both Jokers (no swap).** An `ExchangeTag` reading `t("exchangeAnnouncement.noSwapText")` sits at `restPoint` of the loser's seat for the ceremony.

**Files:**
- Create:
  - `components/table/ExchangeLegs.tsx`, which owns the `exchange-announce` root and its live region, the two cards, the two tags, the no-swap tag, the ring-flash writes and the ceremony's dismissal;
  - `components/table/ExchangeTag.tsx`;
  - `tests/e2e/exchangeTeleport.spec.ts` and `tests/e2e/exchangeAttribution.spec.ts`;
  - `tests/e2e/fixtures/exchange-legs/index.html`, the approved mockup (Step 1).
- Modify:
  - `components/GameTable.tsx`:
    - `ExchangePrompt` and `ExchangeAnnouncement` go, and `ExchangeLegs` renders in the pile's group;
    - `useExchangeTrips` and `useTradedCardsLanded` go;
    - the `TurnChip` gets the exchange texts;
    - one `useSharedValue<RingFlash>` is threaded to the seats;
  - `components/table/seats.tsx`: `SeatRing` takes `flash?: SharedValue<RingFlash>` and its seat index, and starts `ringPing` in a `useAnimatedReaction` when `flash.value.seq` changes with `flash.value.seat` its own. `ringPing` gets `testID="seat-ring-ping"`;
  - `lib/game/sharedGameFlow.ts`: delete `useTradedCardsLanded` (`:176`), and delete `useExchangeCeremonyExpiry` (`:57-68`) with its call (`:158`) and the `holdMsOverride` parameter of `useExchangeAnnouncement`; the phase-leaving close (`:144-148`) stays. `context/GameContext.tsx:169` drops the second argument; `exchangeHoldMsOverride` still reaches `ExchangeLegs` through `app/game.tsx:221` and `GameTable`'s `holdMsOverride` (`:223`), as it reaches the overlay today;
  - `app/game.tsx`: delete `AI_EXCHANGE_DELAY` `:34`; the bot's give fires from `GameTable`'s new `onExchangeReady`;
  - `components/flightPhysics.ts`: delete `exchangeFlight`, `ExchangeFlight`, `readExchangeTrips` `:514-627`, `:998-1026`;
  - `components/table/hand.tsx`: the loser keeps the taken card until the receive leg shows, the winner's chosen card leaves on the give leg's first visible frame, and `CardItem` gains the received-card halo (`testID="hand-received-highlight"`);
  - `components/useTableFeedback.ts`: the exchange cue `:404-407` is already deleted in Task 6;
  - `locales/en.ts`, `it.ts`, `sq.ts` (rule 19): add `exchange.tag`, `exchange.chipGive`, `exchange.chipGiveLowest` and `exchange.chipChoosing`; delete `exchange.prompt`, `exchange.watching`, `exchange.waitingForYou`, `exchange.seatGot` and `exchange.noValidCards` if no reader is left (Grep first);
  - `tests/ui-rules/contrast.test.ts`: delete the rows `:229` (`ExchangeAnnouncement.tsx:styles.noSwap`), `:263` and `:264` (`ExchangePrompt.tsx`), and `:262` (`ExchangeFlight.tsx:styles.tag`), since all three files go here.
- Delete: `components/table/ExchangeFlight.tsx`, `components/ExchangeAnnouncement.tsx` and `components/table/ExchangePrompt.tsx`.
- Modify tests:
  - `tests/ui-rules/flightPhysics.test.ts` (delete `readExchangeTrips` `:2023-2100` and the `useTradedCardsLanded` caller pin `:1894-1911`);
  - `tests/ui-rules/flightHooks.test.ts` (its `useTradedCardsLanded`/`ExchangeFlight` references);
  - the native exchange tests listed in Step 6.

**Interfaces:**
- Consumes:
  - `receivePose`, `givePose`, `restPoint`, `LegPoints`, `RECEIVE_MS`, `GIVE_MS`, `RECEIVE_LEAD`, `GIVE_LEAD`, `REST_AT_MS`, `REST_END_MS`, `receiveSoundMs` and `giveSoundMs` (Task 8);
  - `fanPoint`, the hand origins, and `useTableTimeline` (Tasks 4, 6);
  - `TableChip`, `ChipText` and `CHIP_NAME_MAX_W` from `components/table/chrome.tsx:189`, `:222`, `:311`.
- Produces:
  - `ExchangeTag({ name, scale, testID? }: { name: string; scale: number; testID?: string })`, the same signature plan 5's Task 4 gives it, so plan 5's migration changes its body only;
  - `<ExchangeLegs … onShown(leg) onLanded(leg) onDismiss holdMsOverride? flash={SharedValue<RingFlash>} />`, where `interface RingFlash { seq: number; seat: number }`;
  - testIDs: `exchange-flier-to-winner` / `exchange-flier-to-loser` (the cards, kept from today), `exchange-tag-to-winner` / `exchange-tag-to-loser` (the tags, kept from today), `exchange-no-swap`, and `exchange-announce` (the root);
  - the `GameTable` prop `onExchangeReady?: () => void`, called when the receive leg ends. The offline bot winner gives on it.

**Order against plan 5.** Plan 5's `TableNotice` does not exist when this plan lands. This task always creates `ExchangeTag` itself, from the existing design-system chip components and tokens, with no dependency on plan 5. Plan 5 later migrates `ExchangeTag` onto `TableNotice`.

```tsx
import { ChipText, CHIP_NAME_MAX_W, TableChip } from "./chrome";

export function ExchangeTag({ name, scale, testID }: { name: string; scale: number; testID?: string }) {
  return (
    <TableChip scale={scale} lit>
      <ChipText scale={scale} lit maxWidth={CHIP_NAME_MAX_W * 2} testID={testID}>
        {name}
      </ChipText>
    </TableChip>
  );
}
```

- [ ] **Step 1 (gate): get the exchange's mockup approved**

Before any code in this task, the lead runs `/design` (rule 24) for the exchange at the lantern table, both legs, in three frames each: mid-flight, at rest, and after the tuck with the tag parked. The prompt is:

> "The card exchange at the lantern table (`tests/e2e/fixtures/lantern-table/index.html`, seats `FANAT` L476, `receive`/`giveBack` L543-551). Luan (left) gives You his best card; You give Luan one back. Both cards fly seat to seat face up, lift 240 ms, fly 900 ms, rest still 600 ms beside the receiver, tuck 320 ms. A name-tag chip (`.cchip`, L110, gold `lit` tone) rides under each card reading 'Luan → Tu' / 'Tu → Luan', and stays parked beside the receiver after the card tucks. Luan's seat ring flashes as his card leaves; You have no ring, so your card is marked by lifting out of your hand, and the card you receive glows gold (`.card.hi`, L72) in your hand for 1 s after it tucks in. Luan's ring flashes again when your card comes to rest beside him. Nothing is written at the table centre. The HUD chip reads 'Dai una carta a Luan' during the choice. Show a bystander's view of the same trade too (Besnik at top), and the both-Jokers case."

The owner approves it, or changes it. Then:
- **Check the arrow before the build:** confirm that the bundled Rajdhani font file has a glyph for U+2192 ("→"), by reading its `cmap` (e.g. `fontTools`' `TTFont(path).getBestCmap()` has `0x2192`). If it does not, the tag uses the design system's existing arrow or separator instead, and `exchange.tag` is written with it.
- Record the approved values in Task 8's `Motion.exchange` line, `REST_REACH`, `REST_SCALE` and the tag's gap. Task 8's tests read them, so they follow.
- Add the approved mockup's HTML to `tests/e2e/fixtures/exchange-legs/index.html`, with `#tag-give`/`#tag-receive` on the two tags and `#card-give`/`#card-receive` on the two cards. Write the ids into the `/design` prompt.
- Measure the fixture's tag-to-card gap at rest. If it exceeds 6 pt, raise Step 2's `TAG_REACH` to that gap plus 2 pt. The spec's bound must hold for the approved design, never be tuned to the build.

If the owner's mockup keeps text at the centre, or drops the travelling tag, stop and return to the lead: `exchangeAttribution.spec.ts` encodes this design.

- [ ] **Step 2: Write the failing specs**

**The teleport spec.**

`tests/e2e/exchangeTeleport.spec.ts` seeds an offline rematch with an exchange. Use the save builder the existing `exchangeFit.spec.ts` uses: read it and reuse its seeding helper. It runs three tests: viewer as winner, viewer as loser, viewer as bystander (a four-seat table where the viewer is neither).

Each test steps the virtual clock 16 ms at a time from the phase opening to the ceremony's end. On every frame it records each visible exchange card's centre:
- `[data-testid="exchange-flier-to-winner"]` for the receive leg;
- `[data-testid="exchange-flier-to-loser"]` for the give leg.

It then asserts:

```ts
for (const leg of ["exchange-flier-to-winner", "exchange-flier-to-loser"]) {
  const path = track.filter((p) => p.leg === leg);
  expect(path.length, `${leg} was drawn`).toBeGreaterThan(10);
  for (let i = 1; i < path.length; i++) {
    const d = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
    expect(d, `${leg} jumped ${d.toFixed(1)} pt at ${path[i].t} ms`).toBeLessThanOrEqual(40);
  }
}
```

40 pt per 16 ms is above the legs' peak speed; a teleport is hundreds of points. It also asserts the three findings directly:
- **Receive start** (teleport 2): the receive leg's first frame is within 2 pt of the loser's fan centre (bystander, winner) or of the taken card's hand slot (loser), measured from the DOM before the leg starts.
- **Give start** (teleports 1 and 3): the give leg's first frame is within 2 pt of the chosen card's hand slot (winner), measured after the tap and before the leg.
- **No double draw:** no frame shows `exchange-received-card`, which is deleted with `ExchangePrompt`. The traded card is drawn once, as its flier.
- **Never missing:** where the viewer holds a traded card (the taken card as loser, the chosen card as winner, each received card), it is drawn on every frame from the phase opening to the ceremony's end, in exactly one place: in the viewer's hand (a `card-<id>` in `hand-row`; read `CardView` for the real testID) or as its flier. A frame that shows neither fails, as does one that shows both. For an opponent's card, the seat's badge plus the visible fliers is constant across the leg.
- **D5 revised:** for every viewer, the bystander included, each leg's flier shows its face from the lift's end to the rest's end. A face-down flier carries the back's `testID` (read `CardView` for it); the spec asserts that testID is absent inside the flier on every frame of that window.
- **Ordering:** `exchange-prompt` (now the `TurnChip`'s wrapper) is not visible before the receive leg's last frame.

**The attribution spec.** `tests/e2e/exchangeAttribution.spec.ts` uses the same seeding and the same three viewers, the same 16 ms stepping, and the table's names from the seed. It holds `TAG_REACH = 8` pt. On every frame of each leg, from the flier's first visible frame to the rest's end:

```ts
const tag = await box(page, tagId);
const card = await box(page, flierId);
expect(await page.getByTestId(tagId).textContent(), "the tag names the giver, then the receiver").toMatch(
  new RegExp(`${esc(giverName)}.*${esc(receiverName)}`)
);
const gap = Math.max(0, card.x - (tag.x + tag.w), tag.x - (card.x + card.w), card.y - (tag.y + tag.h), tag.y - (card.y + card.h));
expect(gap, `${tagId} is ${gap.toFixed(1)} pt from its card at ${t} ms`).toBeLessThanOrEqual(TAG_REACH);
```

- The pairs are `exchange-tag-to-winner` with `exchange-flier-to-winner` (the receive), and `exchange-tag-to-loser` with `exchange-flier-to-loser` (the give).
- `giverName` and `receiverName` are the seat names the seed gave. The viewer's own is `t("gameShared.you")`'s English value, since the spec runs in `en`.
- `box` is the element's `boundingBox()`. Reject a `null` box inside the window: a tag that is not drawn fails, not passes.
- **The centre stays clear.** On every frame from the receive's first frame to the ceremony's dismissal:
  - the centre box is the pile's centre ± `CARD_W · FIELD_SCALE · scale` across and ± `CARD_H · FIELD_SCALE · scale / 2` down, read from `components/cardFaceModel.ts`;
  - no element under `exchange-announce` with non-empty text, and no `exchange-prompt`, has its box centre inside it — except a tag whose card is itself within `TAG_REACH` on that frame (a card crossing the table carries its tag through the middle);
  - once the rest begins, no exceptions remain.
- **Each end is marked, giver then receiver.** For each leg, record the first frame of each end's mark:
  - an opponent's end: its `seat-ring-ping` has opacity > 0;
  - the viewer as giver: the flier's first visible frame, within 2 pt of the card's hand slot, with the card gone from `hand-row` on that frame;
  - the viewer as receiver: `hand-received-highlight` on the received card has opacity > 0, and stays so for `Motion.exchange.highlight` ± 32 ms.

  The giver's frame comes first, and the receiver's comes no earlier than the rest frame. No `seat-ring-ping` is expected at the viewer's seat.
- **Both Jokers:** `exchange-no-swap` has its box centre outside the centre box, within the loser's half of the table.

- [ ] **Step 3: Run on CI, read the red**

Expected:
- the teleport spec fails on "receive start" (the card is drawn at the centre first) and on the jump bound (it reappears at the loser's seat);
- the attribution spec fails on the tag text (today's tags read "got X" and appear only after the landing, `ExchangeAnnouncement.tsx:130-145`), and on the centre box (`exchange-prompt` is at the centre, `GameTable.tsx:1200-1212`).

- [ ] **Step 4: Write `ExchangeLegs`**

`components/table/ExchangeLegs.tsx` runs one frame clock per leg, with the same `useState` + `useFrameCallback` pattern as `useFlightClock`:

```tsx
function legStepper(
  started: SharedValue<number>,
  shown: SharedValue<boolean>,
  elapsed: SharedValue<number>,
  lead: number,
  length: number,
  report: { begun: (start: number) => void; shown: () => void; landed: () => void }
) {
  return (frame: FrameInfo) => {
    "worklet";
    if (started.value === -2) return;
    if (started.value === -1) {
      started.value = frame.timestamp;
      scheduleOnRN(report.begun, frame.timestamp);
    }
    elapsed.value = frame.timestamp - started.value;
    if (!shown.value && elapsed.value >= lead) {
      shown.value = true;
      scheduleOnRN(report.shown);
    }
    if (elapsed.value >= length) {
      started.value = -2;
      scheduleOnRN(report.landed);
    }
  };
}
```

- `lead` is `RECEIVE_LEAD` or `GIVE_LEAD`, `length` is `RECEIVE_MS` or `GIVE_MS`. `shown` is reported on the first frame the flier is visible (`elapsed >= lead`), never on the clock's first frame: the hand withholds a card on `shown`, and withholding it before the flier is drawn would leave a frame with the card nowhere.
- `begun` carries the clock's start frame, so the sounds below stay anchored on the leg's own clock.
- The clock deactivates on `landed` (`setActive(false)`), as the flight's does (Task 4).

- The card's animated style evaluates `receivePose(elapsed.value, leg)` or `givePose(elapsed.value, leg)`. It maps `x`/`y`/`rot`/`scale` exactly as `FlyingCard` does, `flip` to `scaleX`, and `visible` to opacity 0/1.
- `face` switches face and back with `useDerivedValue(() => pose.face)` feeding a `useAnimatedProps` on two stacked views' opacity. `face` must not be a React prop, because a React re-render would put the flip on the JS clock.
- **The tag** is a sibling `Animated.View` holding `ExchangeTag`, with its own animated style from the same `elapsed`:
  - it evaluates the pose at `Math.min(elapsed.value, lead + REST_END_MS)`, so it rides the card until the rest ends and then stays where the card rested;
  - its top is the card's `y` plus half the rotated card's height, `(|cos rot| · CARD_H + |sin rot| · CARD_W) · scale / 2`, plus `Spacing.xxs`. Its `left` centres it on the card's `x` from its own `onLayout` width (size only, per the `onLayout` pitfall in `CLAUDE.md`);
  - it is hidden before the lead, and fades out (`Motion.duration.flash`) on the ceremony's dismissal.
- **Ring flashes** are written from the stepper, on the UI thread, only for an opponent's seat (the viewer's seat has no ring):
  - `flash.value = { seq: flash.value.seq + 1, seat: giver }` on the frame `elapsed` first reaches the lead;
  - the same for the receiver on the frame it first reaches `lead + REST_AT_MS`.

  `SeatRing`'s `useAnimatedReaction` starts the same `withTiming` pair the `isActive` effect starts today (`seats.tsx:437-449`), unless reduced motion is on.
- **The viewer's marks.** As giver, `hand.tsx` stops drawing the card on the leg's `shown` (the flier is its lift). As receiver, `GameTable` passes `receivedHighlight?: string` (the card id) to the hand from the leg's `landed`, and `CardItem` draws an `Animated.View` with `handStyles.giveableHalo`'s style and `testID="hand-received-highlight"`, whose opacity runs `withSequence(withTiming(1, { duration: Motion.duration.tap }), withTiming(1, { duration: Motion.exchange.highlight }), withTiming(0, { duration: Motion.duration.tap }))`. The hold is a tween on the animation's own clock, not a delay, so `oneClock` has nothing to flag (a `withDelay(Motion.exchange.highlight, …)` would be flagged: only `Motion.duration.*` is allowed there).
- **Sounds:** the stepper also reports `begun(start)` on the clock's first frame (`started.value === -1`), and `begun` calls `event([{ kind: "exchange" }], start + receiveSoundMs)` for the receive, or `start + giveSoundMs` for the give. The sound is sent a lead (344 or 420 ms) before it is due, never from `shown`, whose `start + lead` is already past when it reaches JS and which plan 1 would drop as late.
- **The live region** (`A11yStatus`, `role="alert"`, `live="assertive"`) speaks `exchangeAnnouncement.giveLine` for a leg when it comes to rest. Both Jokers speaks `exchangeAnnouncement.a11yNoSwap`, as today (`ExchangeAnnouncement.tsx:83-102`).
- **Receive leg geometry:**
  - `from` is the loser's `fanPoint` at scale 0.37 with `fromFace: false`, or the loser's own hand origin for the taken card with `fromFace: true` when the viewer is the loser;
  - `to` is the winner's hand origin for the received card with `toFace: true` when the viewer is the winner, else the winner's `fanPoint` at scale 0.4 with `toFace: false`;
  - `rest` is `restPoint(to)`.
- **Give leg geometry:**
  - `from` is the chosen card's hand origin with `fromFace: true` (viewer the winner), or the winner's `fanPoint` with `fromFace: false`;
  - `to` is the loser's `fanPoint` at 0.34 with `toFace: false`, or the loser's hand origin for the new card with `toFace: true` when the viewer is the loser;
  - `rest` is `restPoint(to)`. The card is face up to every viewer from the lift to the tuck (D5 revised).
- **Start:**
  - The receive leg's clock starts on the deal's reported end (Task 10's `onDealLanded`), so it starts only after the deal lands. With no deal (a resumed save) it starts on mount.
  - The give leg's clock starts when both hold: the choice has arrived (`exchangePhase.cardToLoser` set, or the announcement's data), and the receive leg has reported `landed`. That is how a server that gives early still never makes a card jump.
- **`onExchangeReady`** fires on the receive leg's `landed`. The `TurnChip`'s exchange text and its `exchange-prompt` wrapper start from then on.

In `GameTable.tsx`:
- Delete the `ExchangePrompt` branch (`:1200-1212`); the centre shows `PlayedPile` or `StartCardBanner` as its other branches do.
- Render `ExchangeLegs` in the pile's group where `ExchangeAnnouncement` rendered (`:1242-1257`), passing `onDismiss` and `holdMsOverride`. It mounts whenever the announcement has `data`, with no `exchangeTrips` condition: a leg whose geometry is not measured yet runs with `from = to = rest` and still reports `shown` and `landed`. The dismissal is then always reached while the table is mounted, which is what `useExchangeCeremonyExpiry`'s timer guarded.
- **The dismissal** is anchored on reported times, never on `exchangeAnnounceMs` (which `oneClock` flags from Task 8 on, `sharedGameFlow.ts:65` and `ExchangeAnnouncement.tsx:73`):
  - an ordinary trade dismisses `Reading.notice` after the give leg's `landed`;
  - both Jokers dismisses `Reading.notice` after mount;
  - with `holdMsOverride` (offline e2e only, `GameContext.tsx:61`, not a motion token), it dismisses that long after mount instead, as today.
- Online, the server arms the next seat from the same timeline (Task 8), so the client's flag only draws the ceremony. Offline, `app/game.tsx:115`'s bot loop waits on the flag, and the dismissal above is what releases it.
- `useHandArrival`'s `landed` input becomes the give leg's (or, for the winner's received card, the receive leg's) `landed` report. It is state, set from `onLanded`.
- The `TurnChip`'s `chipText`, `spokenSeat` and `lit` take the exchange's values during the choice, as listed in the design above. `lit` is `exchange.viewerIsWinner`.

In `hand.tsx`, the loser's hand keeps drawing the taken card until the receive leg reports `shown`. Pass `withheldUntilShown?: Card` from `GameTable`, which holds `exchangePhase.cardFromLoser` while the viewer is the loser and the receive has not shown. For an opponent loser, the seat's `displayed` count (`seats.tsx:717`/`:884`, as Task 6 leaves it) is `handCountOf(seat) + 1` over the same window. The engine has already moved the card, and the mockup's `receive` drops the loser's count only as the back leaves (`index.html:543`, `S.counts[k]--`), which is the same "the count drops when the card leaves" rule as the throw. The give leg's giver gets the same `+1` until the give leg reports `shown`. Each leg's receiver, when an opponent, shows `handCountOf(seat) - 1` until that leg reports `landed`, the mockup's `S.counts[k]++` in the tuck's `done` (`index.html:551`).

`app/game.tsx`: delete `AI_EXCHANGE_DELAY`. The `setTimeout` at `:145-149` becomes the `onExchangeReady` handler passed to `GameTable`. It calls the same give function the timer called today. `tests/tooling/exchangeE2EHold.test.ts` pins `E2E_EXCHANGE_HOLD_MS`'s regex in `GameContext.tsx`, which is untouched.

- [ ] **Step 5: Delete the old trip and the centre messages**

- Delete `components/table/ExchangeFlight.tsx`, `components/ExchangeAnnouncement.tsx` and `components/table/ExchangePrompt.tsx`.
- Delete `exchangeFlight`/`ExchangeFlight`/`readExchangeTrips`/`TAG_MAX_W` from `flightPhysics.ts`.
- Delete `useTradedCardsLanded` from `sharedGameFlow.ts`.
- Delete their tests in `flightPhysics.test.ts` (`:1894-1911`, `:2023-2100`) and `flightHooks.test.ts`, and the `contrast.test.ts` rows listed under Files.
- Grep `locales/en.ts` readers for each exchange key listed under Files, and delete a key from all three locales only when nothing reads it.

The caller pin at `:1894-1911` guarded "one clock for the exchange landing". Its replacement is `oneClock.test.ts`, whose sources include `lib/game/exchangeTimeline.ts`.

- [ ] **Step 6: Native and e2e exchange tests**

For each of `exchangeAnnounceBothWays`, `exchangeAnnounceFrame`, `exchangeHoldsTheTurn`, `exchangeOnTable`, `ceremonyHoldsTheCard`, `exchangeE2EHold` and `gameContextExchange` in `tests/native/`:
- Read the test.
- If it asserts a timing through `EXCHANGE_FLIGHT_MS` or `useTradedCardsLanded`, drive frames until the leg's `landed` (a `frameOfFirst` on the tag's appearance) instead.
- If it asserts the old fliers' testIDs, keep the IDs: `ExchangeLegs` reuses `exchange-flier-to-winner` for the receive and `exchange-flier-to-loser` for the give.
- `exchange-received-card` (`ceremonyHoldsTheCard.test.tsx:206`, `exchangeOnTable.test.tsx:214,275`) is gone with `ExchangePrompt`. Assert the received card on its flier during the receive's rest instead.
- A test importing `ExchangeAnnouncement` renders `ExchangeLegs` instead, keeping the `exchange-announce` root and its no-button assertion (`exchangeAnnounceBothWays.test.tsx:126`).
- A test that times the ceremony's end on `exchangeAnnounceMs` drives frames to the give leg's `landed`, then advances `Reading.notice`.
- Add one case to `exchangeHoldsTheTurn.test.tsx`: `ExchangeLegs` with no measured seat geometry, driven by frames, still calls `onDismiss`. It pins the floor `useExchangeCeremonyExpiry` used to be.

These e2e specs read `exchange-prompt` or the tags, and run on CI: `exchangeAnnounceNodes`, `exchangeFit`, `exchangeNoOverlap`, `exchangePickChange`, `a11yOverlays`, `handClearance` and `playedHand`. `tests/e2e/helpers/bot.ts:405` and `.maestro/exchange-phase.yaml` read the same two IDs.
- Read each before pushing.
- `exchange-prompt` still exists during the choice, now on the HUD, so a wait on it keeps working.
- A geometry assertion on the prompt's box at the centre (e.g. `exchangeFit`, `handClearance`) is re-aimed at the rest points, or deleted when the attribution spec now holds what it held. Name each in the commit message.

- [ ] **Step 7: Local checks**

Run: `npx tsc --noEmit -p . && npx eslint components/table/ExchangeLegs.tsx components/table/ExchangeTag.tsx context/GameContext.tsx components/GameTable.tsx components/table/seats.tsx components/table/hand.tsx components/flightPhysics.ts lib/game/sharedGameFlow.ts app/game.tsx locales/en.ts locales/it.ts locales/sq.ts tests/e2e/exchangeTeleport.spec.ts tests/e2e/exchangeAttribution.spec.ts && node --test tests/ui-rules/flightPhysics.test.ts tests/ui-rules/flightHooks.test.ts tests/ui-rules/frameCallbackIdentity.test.ts tests/tooling/exchangeE2EHold.test.ts tests/ui-rules/oneClock.test.ts tests/ui-rules/contrast.test.ts tests/ui-rules/exchangeTimeline.test.ts`
Expected: `tsc` clean. `oneClock` no longer lists `ExchangeFlight.tsx:84`, `ExchangeAnnouncement.tsx:73` or `sharedGameFlow.ts:65`.

- [ ] **Step 8: Commit**

```bash
git add -- components/table/ExchangeLegs.tsx components/table/ExchangeTag.tsx context/GameContext.tsx components/GameTable.tsx components/table/seats.tsx components/table/hand.tsx components/flightPhysics.ts lib/game/sharedGameFlow.ts app/game.tsx locales/en.ts locales/it.ts locales/sq.ts tests/ui-rules/flightPhysics.test.ts tests/ui-rules/flightHooks.test.ts tests/ui-rules/contrast.test.ts tests/e2e/exchangeTeleport.spec.ts tests/e2e/exchangeAttribution.spec.ts tests/e2e/fixtures/exchange-legs/index.html <each native and e2e test changed>
git rm -- components/table/ExchangeFlight.tsx components/ExchangeAnnouncement.tsx components/table/ExchangePrompt.tsx
git commit -m "feat(exchange): the traded cards fly seat to seat face up, each carrying who gave it to whom

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The last instances: the deal's end, the entry cue, the hand's reorder commit, the deal arrivals

**Files:**
- Modify:
  - `components/table/deal.tsx:60-80` (the deal reports its own end);
  - `components/table/seats.tsx:259-266` (`useArrivedCount` is anchored on the deal's reported start);
  - `components/GameTable.tsx:751-771` (the deal cue at the deal's first frame, through the timeline);
  - `components/table/hand.tsx:850-862` (the reorder commits on the settle animation's own completion).
- Test: `tests/ui-rules/oneClock.test.ts` turns green; `tests/native/seatDealArrival.test.tsx` is rewritten.

**Interfaces:**
- Produces:
  - `useDeal(...)` gains `onLanded: () => void` and `onStarted: (at: number) => void`;
  - `DealFlights` runs one frame clock (the `legStepper` shape from Task 9, with `length` = the deal's last arrival) and reports both.

- [ ] **Step 1: Confirm the red**

Run: `node --test tests/ui-rules/oneClock.test.ts`
Expected: FAIL listing exactly `components/GameTable.tsx:759`, `components/table/deal.tsx:76` and `components/table/hand.tsx:861`.

- [ ] **Step 2: Fix each**

- **`deal.tsx`:**
  - `setDeal(null)` moves from `setTimeout(lastLanding)` to `DealFlights`' `landed` report.
  - The report also calls `onLanded`, which starts the exchange's receive leg (Task 9).
  - `DealtBack`'s `withDelay(card.leaveMs, …)` (`:116`) is fixed unconditionally. Its `leaveMs` comes from `dealLeaveMs` but through the `card` prop, where the scan stops, so the scan cannot be relied on to list it. The fix is the same clock: the back's style reads the deal clock's `elapsed` and evaluates the leave and the flight from it, in place of `withDelay`. `seatDealArrival.test.tsx` (Step 3) proves each back is drawn from that clock.
- **`seats.tsx` `useArrivedCount`:** its arrivals are times from the deal's start. It becomes a `useDerivedValue` over the deal clock's `elapsed`, counting `arrivals.filter((a) => a <= elapsed)`, and the fan reads it on the UI thread. Where the count must be React state (the badge), `setLanded` fires from a `useAnimatedReaction` on that count through `scheduleOnRN`.
- **`GameTable.tsx:751-771`:** the entry beat's `setTimeout(resolve, entryMs)` goes. `preloadSounds`/`holdSounds` remain as plan 1 left them. The deal cue becomes `DealFlights`' `onStarted` → `event([{ kind: "deal" }])`, with no `at`: the report reaches JS a hop after the first frame, so that frame's timestamp is already past, and plan 1 drops a play more than about one IO buffer late.
- **`hand.tsx:861`:** `settle.value = withTiming(1, { duration: ms }, (finished) => { if (finished) scheduleOnRN(commit); });`, and delete `setTimeout(commit, ms)`. `commit` must be a stable JS function, which it is (`:850`).

- [ ] **Step 3: Rewrite `seatDealArrival.test.tsx`**

It advanced `setTimeout`s by `dealArrivalsMs`. It now drives frames and asserts that the fan's drawn card count at each frame equals the number of `DealtBack`s whose drawn position has reached the seat, read with `getAnimatedStyle` from their transforms. It derives no deal constant.

- [ ] **Step 4: Verify**

Run: `node --test tests/ui-rules/oneClock.test.ts && npx tsc --noEmit -p . && npx eslint components/table/deal.tsx components/table/seats.tsx components/GameTable.tsx components/table/hand.tsx`
Expected: `oneClock` **PASS**, both tests.

- [ ] **Step 5: Commit**

```bash
git add -- components/table/deal.tsx components/table/seats.tsx components/GameTable.tsx components/table/hand.tsx tests/native/seatDealArrival.test.tsx
git commit -m "feat(table): the deal, its cue and the hand's reorder end on their own animations' clocks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Device gate: the landing sound against the contact frame, on the bench

**Owner decision D8:** the owner runs the bench once. On the other answer, the gate stays unrun and the PR says so.

**Files:**
- Create: `lib/diagnostics/scenarios/landingSync.ts`, `tests/tooling/landingSyncGate.test.ts`
- Modify:
  - `lib/diagnostics/scenarios/index.ts` (`import "./landingSync";`);
  - `scripts/diagnostics-verdict.mjs` (the `landingSync` entry in `GATES`);
  - `components/table/pile.tsx` (`FlyingCards`' `touched` records the contact frame).

**Interfaces:**
- Consumes (plan 1, Task 1 unless noted):
  - `DIAGNOSTICS` and `diag(row: DiagRow)` from `@/lib/diagnostics`. The row is the existing `trigger` key of `interface DiagRows` (`{ name }`, plus the `t` every row carries), so `DiagRows` needs no new key;
  - `registerBenchScenario(name, run: (ctx: BenchContext) => Promise<void>)`, and `botTable()`/`driveBots(ctx, state, stepMs, onStep?)` from `lib/diagnostics/benchTable.ts`;
  - in `scripts/diagnostics-verdict.mjs` (plan 1 Task 8's helpers): `times`, `onsetsOf`, `matchOnsets`, `median`, `p90`;
  - `setSoundVolume` from `@/lib/device/feedback` (plan 1 Task 7).
- Produces:
  - the row `{ k: "trigger", t, name: "flightContact" }`, where `t` is `LandingSignal.at`: the timestamp of the frame on which `touched` flips (Task 4's stepper), in `performance.now()` ms, the timebase of every plan 1 row;
  - `GATES.landingSync(rows) => { pass, metrics: { contacts, misses, absP90, medianErr, leadMs } }`.

**Metric:** for each contact, the signed offset from contact to its landing sound's `app` onset, shifted by the engine's scheduling lead exactly as plan 1's `scheduledOnset` does (`onset + lead − contact`), matched one onset per contact within ±150 ms.
**Threshold:** at least 40 contacts, every one heard (`misses` = 0), and the p90 of the absolute offset ≤ 20 ms. A play `event` dropped as late (plan 1) is a miss: the gate never accepts a late sound as a landing's.
**Scenario:** `landingSync`, bot hands through the real table until 40 plays. It records; the laptop judges (`node scripts/diagnostics-verdict.mjs <run.ndjson> landingSync`).
**Ships off:** `DIAGNOSTICS` is a build-time constant (plan 1).

- [ ] **Step 1: Write the failing test**

`tests/tooling/landingSyncGate.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { GATES } from "../../scripts/diagnostics-verdict.mjs";

const LEAD = 12;
const contacts = Array.from({ length: 40 }, (_, i) => 1000 + i * 900);
const rows = (offsets: (number | null)[]) => [
  { k: "play", t: 0, id: "combo", at: 0, bus: "sfx", dropped: false, lead: LEAD },
  ...contacts.map((c) => ({ k: "trigger", t: c, name: "flightContact" })),
  ...contacts.flatMap((c, i) => (offsets[i] === null ? [] : [{ k: "onset", t: c - LEAD + offsets[i]!, db: -20, source: "app" }])),
];

test("onsets within a frame of contact pass", () => {
  const r = GATES.landingSync(rows(contacts.map((_, i) => ((i * 7) % 17) - 8)));
  assert.equal(r.pass, true);
  assert.equal(r.metrics.misses, 0);
});

test("onsets 30 ms late on a fifth of the landings fail", () => {
  assert.equal(GATES.landingSync(rows(contacts.map((_, i) => (i % 10 < 2 ? 30 : 2)))).pass, false);
});

test("a landing with no sound fails even when the rest are exact", () => {
  const r = GATES.landingSync(rows(contacts.map((_, i) => (i === 0 ? null : 0))));
  assert.equal(r.pass, false);
  assert.equal(r.metrics.misses, 1);
});

test("a sound that plays early by 25 ms fails: the gate is signed, not only late", () => {
  assert.equal(GATES.landingSync(rows(contacts.map(() => -25))).pass, false);
});

test("fewer than 40 landings is not a pass", () => {
  assert.equal(GATES.landingSync(rows(contacts.map(() => 0)).filter((r) => !(r.k === "trigger" && r.t > 30000))).pass, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tooling/landingSyncGate.test.ts`
Expected: FAIL, `GATES.landingSync is not a function`.

- [ ] **Step 3: Implement**

In `scripts/diagnostics-verdict.mjs`, above `export const GATES`, beside plan 1's gates:

```js
function landingSync(rows) {
  const lead = median(rows.filter((r) => r.k === "play" && !r.dropped).map((r) => r.lead));
  const contacts = times(rows, "trigger", "flightContact");
  const heard = matchOnsets(contacts.map((c) => c - lead - 150), onsetsOf(rows, "app"), 300);
  const offsets = contacts.flatMap((c, i) => (heard[i] === null ? [] : [heard[i] + lead - c]));
  const misses = contacts.length - offsets.length;
  const absP90 = p90(offsets.map(Math.abs));
  return {
    pass: contacts.length >= 40 && misses === 0 && absP90 <= 20,
    metrics: { contacts: contacts.length, misses, absP90, medianErr: median(offsets), leadMs: lead },
  };
}
```

Add `landingSync` to `GATES`.

In `components/table/pile.tsx`, `FlyingCards`' `touched` (Task 4) takes the `at` its `touch` report already carries, `frame.timestamp` on the contact frame, which is the value it writes to `LandingSignal.at`:

```ts
  const touched = useCallback((_k: string, at: number) => {
    traceOnset("moment", "landing");
    if (DIAGNOSTICS) diag({ k: "trigger", t: at, name: "flightContact" });
  }, []);
```

`lib/diagnostics/scenarios/landingSync.ts`:

```ts
import { setSoundVolume } from "@/lib/device/feedback";
import { registerBenchScenario } from "../bench";
import { botTable, driveBots } from "../benchTable";

registerBenchScenario("landingSync", async (ctx) => {
  setSoundVolume(1);
  let plays = 0;
  for (let hand = 0; hand < 5 && plays < 40; hand++) {
    await driveBots(ctx, botTable(), 900, (s) => {
      if (s.lastPlayedCombination && s.passCount === 0) plays++;
    });
  }
  await ctx.sleep(500);
});
```

- `driveBots` moves every seat through `offlineBotMove` only, the one chooser (CLAUDE.md invariant). This scenario keeps no loop of its own over moves.
- Five hands bound a run; the gate, not the scenario, decides whether 40 contacts were recorded.
- 900 ms per move outlasts a flight plus `Hold.land`, so each landing's onset stands apart from the next.

- [ ] **Step 4: Verify and commit**

Run: `node --test tests/tooling/landingSyncGate.test.ts tests/tooling/diagnosticsVerdict.test.ts && npx tsc --noEmit -p . && npx eslint lib/diagnostics/scenarios/landingSync.ts lib/diagnostics/scenarios/index.ts scripts/diagnostics-verdict.mjs components/table/pile.tsx tests/tooling/landingSyncGate.test.ts`
Expected: PASS.

```bash
git add -- lib/diagnostics/scenarios/landingSync.ts lib/diagnostics/scenarios/index.ts scripts/diagnostics-verdict.mjs tests/tooling/landingSyncGate.test.ts components/table/pile.tsx
git commit -m "feat(bench): gate the landing sound on the contact frame, p90 within 20 ms

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**What the owner does:**
1. Install the Release bench build: `npm run ios:device -- --bench` (plan 1). A verdict from any other build is `pass: null`, unrun.
2. Open the bench and choose `landingSync`. Accept the one ReplayKit prompt.
3. Leave the phone face up for about 40 s.

The result posts to the collector and shows as JSON. The PR reports `p90`, `misses` and the verdict.

---

### Task 12: Docs, the components invariant, the budget, push

**Files:**
- Modify:
  - `components/CLAUDE.md:19-20`;
  - `tests/tooling/claudeMdScope.test.ts:22`;
  - `docs/FEEL-BAR.md:16`, `:427`;
  - `docs/ARCHITECTURE.md`, `docs/BRIEF.md`, `.claude/workflows/audit.mjs:162`, `docs/adr/README.md` (every line naming a deleted symbol);
  - `lib/tokens.ts` (the `Motion.reduced` doc that names `impactDelayMs()`, `:386-392`).

- [ ] **Step 1: Rewrite the invariant**

`components/CLAUDE.md:19-20` becomes:

```markdown
- **Derive every landing consequence from the flight's contact**: pixels react to the
  `LandingSignal` on the contact frame, sounds and state read `landsAt` (`tableTimeline.ts`).
  `tests/ui-rules/oneClock.test.ts` refuses a timer that waits out a motion token.
```

In `claudeMdScope.test.ts:22`, replace `"impactDelayMs"` with `"landsAt"`. Run `node --test tests/tooling/claudeMdScope.test.ts`: the word budget (700) must hold.

- [ ] **Step 2: Every other doc**

Grep `impactDelayMs|handOffDelayMs|LANDING_FRACTION|landingHoldMs|anticipat|EXCHANGE_FLIGHT_MS|useTradedCardsLanded|ExchangeFlight|displayedHandCount|departing back|213 ?ms` across `docs components lib .claude CLAUDE.md`. For each hit outside `docs/research/`, `docs/plans/` (dated records) and `docs/adr/` (the lead amends ADR-0002/0008):
- a statement of current behaviour is rewritten to the new one, in one sentence, naming `flightPose`/`contactMs`/`landsAt`;
- a check (`FEEL-BAR.md:427`) names `landingContact.spec.ts`.

- [ ] **Step 3: The budget and the whole-branch checks that run locally**

Run: `npm run check:comments`
Expected: PASS.

Run: `npx tsc --noEmit -p . && npx eslint $(git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx') && node --test tests/ui-rules/oneClock.test.ts tests/ui-rules/flightPose.test.ts tests/ui-rules/traceDiff.test.ts tests/ui-rules/exchangeTimeline.test.ts tests/tooling/landingSyncGate.test.ts tests/server/exchangeRearm.test.ts tests/tooling/claudeMdScope.test.ts tests/tooling/rulesAreSingleSourced.test.ts tests/ui-rules/motionScale.test.ts tests/ui-rules/motionEscapes.test.ts tests/ui-rules/frameCallbackIdentity.test.ts`
Expected: all PASS.

- [ ] **Step 4: Commit, rebase, push, read CI**

```bash
git add -- components/CLAUDE.md tests/tooling/claudeMdScope.test.ts docs/FEEL-BAR.md docs/ARCHITECTURE.md docs/BRIEF.md .claude/workflows/audit.mjs docs/adr/README.md lib/tokens.ts
git commit -m "docs: every landing consequence derives from the flight's contact

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git fetch origin && git rebase origin/main
git push -u origin HEAD
```

Then read the run. These must be green:
- **Jest:** `landingOnContact`, `landingNotDropped`, `oneEventPerCommit`, and every rewritten native test.
- **Playwright:** `landingContact.spec.ts`, `flightOrigin.spec.ts`, `exchangeTeleport.spec.ts`, `exchangeAttribution.spec.ts`, `mockupParityTrickLandingsSkia.spec.ts`, `mockupParityTrickSkia.spec.ts`, `pileHandoff.spec.ts`, `reducedMotionWobbleReset.spec.ts`, `tableMoments.spec.ts`, and the seven exchange-reading specs of Task 9 Step 6.

A red spec is read from its artifact before any second push (rule 37).

---

## CLAUDE.md invariants this plan touches

- **Every hook runs before `if (!gameState)`:** `useTableTimeline`, `landingSignal`, the `handOriginsRef` and the flush effect are all declared in `GameTable`'s hook block. The flush effect is the last hook, still above the guard. The reviewer checks `GameTable.tsx` for any new hook below `if (!gameState)`.
- **`lib/game/autoMove.ts` is the one chooser:** the offline bot winner's give moves from a timer to `onExchangeReady`, but still calls the function `app/game.tsx` calls today. The server funnel changes only the delay, not the chooser. The bench's `landingSync` scenario moves the table only through plan 1's `driveBots`, which calls `offlineBotMove` (`lib/game/autoMove.ts:142`).
- **Game rules only via `docs/GAME-RULES.md` § Decisions:** no rule changes. The engine still moves the exchanged card first (`GameContext.tsx:204-215`), and only the drawing changes.
- **No self-defeating safeguards:**
  - The parity offset is deleted.
  - `oneClock` carries a planted floor and no exemption list; its one carve-out, `withDelay(Motion.duration.*)` with nothing reaching JS, is a stated rule, and the probe proves a chain that calls back is still flagged.
  - `flightPose.test` plants the ease and proves `contactMs` follows it.
  - `landingSyncGate.test.ts` plants late, early and missing onsets, and too few landings, against `GATES.landingSync`.
- **No unit test can see a layout bug:** origins and teleports are proved in Playwright (`flightOrigin`, `exchangeTeleport`), never in jest.
- **Take only the size from `onLayout`:** the hand origins are computed from the same numbers the hand draws with. Nothing reads a position from `onLayout`.
- **components/CLAUDE.md** "impact feedback is timed to the card landing": rewritten in Task 12.

## Versions and native code

No dependency changes and no native code. Reanimated 4.5.5 and react-native-worklets 0.10.4 are used as installed (`useFrameCallback`, `useAnimatedReaction`, `scheduleOnRN`). No CI build assertion is needed.

## Self-review

- **Coverage:** every row of the design's §2 has a task:
  - the pose and contact (1);
  - UI-thread reactions (5);
  - JS consequences at `landsAt` (6);
  - sounds scheduled (6, through plan 1);
  - the deletions (4, 6);
  - the pending impact (4, 6);
  - the exchange timeline (8, 9);
  - the online re-arm (8);
  - the four guards (1, 2, 3, 7);
  - the device gate (11).

  The "other defects" rows (the parity offset, stale docs, the sting) are Tasks 7, 12 and 6. The three teleports are Tasks 4 and 9.
- **Placeholders:** one spot binds to facts the executor must read: the hand-origin variables (`rowBoxW`, `panShownRef`, `SELECT_LIFT`, `fieldScale`), arbitrated by `flightOrigin.spec`.

  Plan 1's final names are bound as its plan gives them: `BenchContext` (no `mark`/`rowsSince`), `driveBots`, `DiagRows` (every row `t` in `performance.now()` ms), `GATES`, `landingPulsesFor`/`runLandingPulses`, `Moment`, and `event`'s late-play drop. Task 9 depends on nothing from plan 5.

  `fanPoint`'s calls were checked against source in round 3 (`seatDirection` takes three arguments, `seatFanArc(count, backScale).bounds`, `seatPoint` returns `{ dx, dy }`).

  No step says "handle edge cases" or "similar to".
- **Names:** these are used identically across Tasks 1, 4, 5, 6, 9 and 11:
  - `CardFrom`, `CardSlot`, `Pose`, `flightPose`, `contactMs`, `flightEndMs`, `pileSlots`;
  - `FlightSpec`, `LandingPayload`, `LandingSignal`, `NO_LANDING`, `useFlightClock`, `useLandingReaction`;
  - `useTableTimeline`, `landsAt`, `inFlight`, `awaitFlight`, `flightStarted`, `flush`;
  - `receivePose`, `givePose`, `restPoint`, `LegPoints`, `RECEIVE_MS`, `GIVE_MS`, `RECEIVE_LEAD`, `GIVE_LEAD`, `REST_AT_MS`, `REST_END_MS`, `RingFlash`, `exchangeGiveDelayMs(counts)`, `exchangeAnnounceFrom`;
  - `dealEndMs`, `DEAL_FLIGHT_MS`, `dealFlightsMs`, `dealLeaveMs`, `dealArrivalsMs` (all in `lib/game/dealTimeline.ts` from Task 8 on);
  - `handsOffAt`, `Anchor`, and `flightStarted(key, landsAt, endsAt)`.

  `exchangeAnnounceMs` keeps its name and signature.
- **Review Focus:** each of the five lines has its test in the owning task:
  1. `landingNotDropped` (6);
  2. `landingOnContact` reduced case (5);
  3. catch-up rows (1) and a catch-up case in `landingOnContact` (5);
  4. `gameOverSting` online case (6);
  5. `exchangeTeleport` loser and bystander, and `exchangeAttribution` (9).

## Design questions for the lead

1. **Catch-up is 200 ms per card, not only a 20 ms stagger.** The mockup's reconnect calls `play(…, 200)` (`index.html:642`), and `step = dur > 300 ? 45 : 20` follows from that. The design and ADR-0008 §5 name only `Motion.throw.catchUpStagger`. I assumed the mockup: `Motion.throw.catchUpCard: 200` is added and pinned. On the other reading, delete `catchUpCard` and use `card` in `timing()`.
2. **The design cites `lib/theme.ts` for `Motion`; it lives in `lib/tokens.ts`** (theme re-exports it). All edits are in `lib/tokens.ts`. The research's "1200 at `gameTurn.ts:191`/`:218`" is not a literal there: it is `armTurn`'s default argument, `botMoveDelayMs()` (`:87`, `gameTimers.ts:60`). I fixed it through one funnel, `armAfterMove`, rather than at two call sites.
3. **What `oneClock` counts as a source.** The design says "`Motion.*`, `FLIGHT_MS`, `*DelayMs`". I made it:
   - `Motion.*`, `motionMs`, everything declared in `flightPose.ts`, `dealTimeline.ts` and `exchangeTimeline.ts`, and `flightPhysics` exports ending `Ms`/`_MS`;
   - derivation followed through destructuring, named-function returns and callback parameters, and timers matched bare or through `global`/`globalThis`/`window`;
   - with `withDelay(Motion.duration.*)` allowed only when nothing in its subtree reaches JS (no `scheduleOnRN`/`runOnJS`, no completion callback);
   - with `Hold` and `Reading` outside it. `exchangeCeremony.ts` is no longer outside it in effect: `exchangeAnnounceMs` returns from `GIVE_MS` from Task 8 on, so its two timers are flagged and Task 9 re-anchors both on the give leg's reported landing;
   - scoped to `app/`, `components/`, `context/` and `lib/`, not only the two the design names.

   The scan does not follow a time passed through props (e.g. `useArrivedCount(arrivals)`). Task 10 fixes that instance by hand. A prop-crossing rule would need JSX attribute resolution; I judged it not worth it.
4. **Pixels on the UI thread, sound and state at `landsAt`, as one rule.** The design lists "dust, shake, burst, pile flinch, bomb scrim" as reactions. I also moved the lamp flare/kick/lift and the flush catch onto the reaction, because they are pixel consequences of the same landing and were on the same guessed timer. (The departing backs are gone; see 5.)
5. **Resolved by the lead: the count drops at the throw**, as in the mockup (`S.counts[by] -= n`, `:515`). The flying cards are the departing cards, and `displayedHandCount`, `fanCounts`' departing term and `seat-back-departing` are deleted (Task 6). `throwLeavesTheFan.spec.ts` holds that the badge equals the post-throw count from the throw's first frame, and that no departing back is drawn. The lead amends ADR-0008 to supersede ADR-0002 §2/§3.
6. **Resolved by the lead: the hand-off takes the mockup's gap.**
   - It is measured from the mockup's landing callback, the flight's end (`later(dur+(n-1)*step)`, `index.html:517`), to its scripted hand-offs: 1750 − 1575 = **175** (`:612`) and 5950 − 5775 = **175** (`:614`).
   - `Hold.land` = 175, applied to the flight's reported `endsAt`.
   - Measured from contact instead, the gaps are about 270/279/228, because the mockup scripts hand-offs from the throw. The flight's end is therefore the anchor with a constant gap.
   - **Left to the lead: the fixture's one outlier**, `:613`, hands off 225 after luan's pair ends at 3025. One token cannot give both. Parity never compares that hand-off after an app landing: in `trick` the app reaches it through a scripted pass at 3250, and `trick-landings` holds no hand-offs. If the owner wants 225, it is a one-token change.
   - Parity stays aligned on landings (absolute times, the mockup's own throw times), and `trick` compares the `moment:handoff` onsets, so a gap regression fails.
7. **No sound onset is held against the mockup.** The design departs from the mockup's tween-timer sound on purpose (about 57 ms earlier). `trick-landings` drops `sound:combo`/`moment:landing` and compares the pose, while `landingContact.spec` holds the sound to contact.
8. **The pile's slot jitter (`cardTilt`) is dropped** for the mockup's exact `slots(n)`, and the extra dip after the wobble (`pile.tsx:474-480`) is deleted: ADR-0008 makes the throw the mockup's.
9. **Resolved by the owner: D5 revised, and the attribution rides the cards** (Tasks 8 and 9).
   - Both cards are face up to every seat, and both legs run seat to seat through a still rest beside the receiver. The #602 "got X" tags become `ExchangeTag`s reading "giver → receiver".
   - `ExchangePrompt` and `ExchangeAnnouncement` are deleted. The choice's instruction moves to the HUD's `TurnChip`, which keeps the `exchange-prompt` testID.
   - **Left to the lead:**
     - ADR-0008's exchange paragraph must record that the legs no longer pass through the centre, and that the giveback no longer turns to its back mid-flight.
     - Plan 5's `TableNotice` does not exist when this plan lands. Task 9 always creates `ExchangeTag` itself from the existing chip components (`TableChip`, `ChipText`), with plan 5's signature; plan 5 later migrates it onto `TableNotice`.
     - The viewer's seat has no ring. Its end is marked by the card lifting out of the hand (giver) and a gold halo on the received card for `Motion.exchange.highlight` (receiver), the mockup's `hi`. The `/design` gate shows both.
     - `useExchangeCeremonyExpiry`'s timer is deleted. `ExchangeLegs` mounts whenever the ceremony has data, geometry or not, and dismisses `Reading.notice` after the give leg's reported landing, which releases the offline bot loop (`app/game.tsx:115`).
     - Rajdhani's "→" (U+2192) is checked in Task 9 Step 1. If the glyph is missing, the tag uses the design system's existing arrow or separator. `exchangeAttribution.spec` reads the two names in order, so it holds either way.
     - Moving the choice's text into the `TurnChip` is my reading of "no exchange text at the centre" for the one phase the owner did not name. If the owner wants the choice's sentence kept at the centre, only the legs, rests and hold are held clear, and the spec's centre window starts at the give's lead.
10. **Resolved by the lead: the online bot winner's give comes from the shared timeline.**
    - `exchangeGiveDelayMs(counts)` = `dealEndMs(counts, Motion.duration.reveal, every seat at DEAL_FLIGHT_MS)` + `RECEIVE_MS`.
    - `dealEndMs` lives in the new shared `lib/game/dealTimeline.ts`, beside the deal functions moved out of `components/flightPhysics.ts`. `receivePose`/`RECEIVE_MS` are in `lib/game/exchangeTimeline.ts`. `deal.tsx`, `ExchangeLegs` and the server all import these.
    - Two inputs are the server's worst case and differ from the client's: the farthest seat's flight for every seat (the server has no geometry) and the mount offset (a rematch on a mounted table deals at 0). So the floor is never early. `exchangeTimeline.test.ts` samples `receivePose` and plants two seat geometries to prove it.
    - The client keeps its own wait: it never starts the give before its own receive has ended.
11. **The reading floor is a still rest**: each card holds still, face up, at `restPoint(receiver)` for `Hold.reveal` (600), a new token. I read the owner's "each reveal ≥600 ms" as still, not merely visible. The face is visible for longer, from the lift's midpoint to the tuck's midpoint: 1780 ms per leg into a fan.
12. **The exchange durations are `Motion.exchange.*`**, new tokens (rule 18 puts timing in tokens; ADR-0008 names only `Motion.throw`): `{ beat: 344, lift: 240, fly: 900, tuck: 320, highlight: 1000, giveWait: 420 }`.
    - The receive runs 2404 ms from the deal's end, against the mockup's 1714. The give runs 2480 ms from the choice, against 880.
    - `fly` is the owner's "a bit more time". It is proposed, and the Task 9 mockup settles it.
    - `exchangeTimeline.ts` symbols and `Motion.*` are both `oneClock` sources.
    - `REST_REACH` (0.7) and `REST_SCALE` (0.8) are geometry, module constants of `exchangeTimeline.ts`.
13. **Conflicts with plan 3. This plan lands first.**
    - `fanPoint(ring, dir, scale, count)` lives in `components/fanGeometry.ts` (Task 4) and keeps its count, by the lead's ruling; plan 3 does not drop it. Its `drawn = min(count, FAN_DRAWN_CARDS[dir])` matches today's fan, so `flightOrigin.spec` holds it within 2 pt against the fan the app draws now.
    - **Left to plan 3:** `seatLayout.ts` imports `seatFanArc` back from `fanGeometry.ts` (for `sideSlotHeight`/`topFanHeight`), a call-time cycle that plan 3's layering guard forbids. Plan 3 owns breaking it.
    - This plan keeps `flightOrigin` only for the hand zone's centre.
14. **Web audio in `landingContact.spec`:** the spec reads the scheduled `when` off `AudioBufferSourceNode.prototype.start`. If plan 1's web engine schedules another way (e.g. an `AudioWorklet`), the init script must wrap that entry instead. The assertion is unchanged. ADR-0009 now names react-native-audio-api; confirm its web build schedules through `AudioBufferSourceNode.start` before writing the init script.
15. **Resolved by the lead: the contact-frame haptic goes through `feedback.ts`.** Task 5's contact reaction calls `runLandingPulses(l.pulses)`, where `pulses` is `landingPulsesFor(...)` computed on JS with the payload; both come from `lib/device/feedback.ts` (plan 1 Task 7), never from `hapticsEngine`. Plan 1 owns the steps, their timing and cancellation.
    - **The exchange.** No haptic is added to the exchange legs; none fires there today.
    - **The turn tap.** Plan 1 silences a tap batched with a pulsing landing. Here the turn is its own `event` at `handsOffAt` (Task 6), so its tap, if plan 1 gives the turn one, sounds about 175 ms after the flight's end rather than being suppressed.
