# Why defects recur in murlan — evidence report (read-only, 2026-11-07)

Data: 921 closed issues + 31 open (REST, raw dumps in this scratchpad: `all.json`, `titles.txt`,
`open.txt`), 6305 commits, 1585 non-merge commits on `components/ app/ context/ lib/ hooks/`
(`prodcommits.txt`).

## 0. Summary of what was actually found

The repo does not lack tests. What it lacks is a **check on what the player sees, at the speed
the player sees it, on the device the owner plays on, that is allowed to fail a merge**. Every
visual or motion gate that exists is one or more of these: (a) off the PR path (nightly, report
only, routed away from the agents), (b) run under reduced motion or on a virtual clock, so jank
and timing are invisible, (c) compared against a mockup that is itself edited to follow the app,
(d) exempted region by region where the app diverges. Meanwhile the review that does gate merges
reads text diffs and may only block on bugs, DoD boxes and rules 47–49, so "looks wrong" is a
Nit, and Nits ship unfixed.

---

## 1. Recurrence: top topics, in order, and why each earlier fix did not hold

### 1.1 Table frame rate at rest / per-frame re-record (the owner's "super laggy")

Chronology (each commit "fixes" redraw-at-rest; each later feature re-adds per-frame work):
- 09-25 `25268d85` "Draw the Skia felt only when it can and only when the lamp moves" (#1257);
  `50804464` "bake only what the lamp changes".
- 10-01 `1629cb74` "shadow paths build once per registry change"; `b34eedea` "a glow alone
  rebuilds no shadow path"; `61309d16` card no longer re-renders on glow.
- 10-07 `21e991a4`, `a47565df`, `28f4b60d` (particles built once, air waits for tick).
- 10-08 #1414 "A card flight re-records every card's shadow on every frame".
- 10-10 `e59934f6` "Rebuild only the shadow clusters whose cards moved"; **same day**
  `f6fff818` "Light every table card with the lamp's gloss" and 10-11 `118e3957` "every back
  glints through its own foil mask" add 139 per-card lamp layers driven by a sway that never stops.
- 10-11/12 #1466 hand shade canvas, then `43867fb6` perf fix for it.
- 11-03 owner: "the whole game once we log into a table is super laggy"; research
  `docs/research/2026-11-03-table-perf/REPORT.md`: settled table 15–17 fps at 4x CPU; a 1x deal
  16.3 fps; "**The existing perf check never measured animation**" — `npm run perf:web` ran
  through the `consoleErrors` fixture, which forces reduced motion (`tests/e2e/fixtures.ts:131`,
  unchanged since `6525330a` 08-16). Follow-ups #1957, #1959, #1962, #1965, #1966; still open:
  #1963 (one lamp layer per card instead of five), #1964 (deal clock after mount).
- 11-03 rule 51 added to `docs/agents/RULES.md` after the fact.

Why earlier fixes didn't hold:
- The pins are **per-feature build counters** (`tests/native/handShadeRebuild.test.tsx`,
  `shadowClusterBuilds`, `feltRailDispose`, `tests/e2e/landingShadowStill.spec.ts`). Each proves
  "this canvas doesn't rebuild"; none proves "the table costs X ms/frame". A new layer (gloss,
  foil, hand shade, motes) is not covered by any old pin.
- Every e2e spec using `consoleErrors` (and the e2e build's `EXPO_PUBLIC_E2E_FAST`) runs with
  motion reduced: `docs/agents/traps.md` § "What a green loop does not mean" admits it.
- The parity harness runs on **one virtual clock** (#1255) — every frame is rendered regardless
  of cost, so frame drops cannot show.
- The device gates built in #1259 (`d0cb4073` "device gates for throw stalls, the table at rest")
  need the owner's iPhone; #1393 "Owner device pass: the #1259 bench gates…" has been open since
  10-07. CI's VM has no GPU (SwiftShader: Skia table ~1.2 fps), so no CI number is meaningful for
  the platform the owner plays.
- `perf:web` is outside `test:e2e` and outside PR CI (`docs/WEB-PERF.md`: "It is not part of
  npm run test:e2e"). Rule 51 asks for before/after numbers "in the PR body": self-reported.

### 1.2 HUD chip row overlap (tablet 1024x768)

- 08-22 `22a697f2` top bar becomes two chips (#197); 09-25 `dde60f72` turn pill top centre,
  score pill top right (#1265); 09-30 seven commits re-painting the pill through TableNotice,
  including two "plant" commits to prove `mockupPolish` can go red (`3ef2056a`/`cc5c19c1`).
- 11-04 `4d38fa2f` "Table polish: … centred oval" makes the table box symmetric; "the mockup
  fixtures, pins and tests follow".
- 11-04 `3264ca0c`: the symmetric box leaves the 1024x768 row with no slack, so the **Italian
  label is shortened** ("Nessuna carta 3–10" → "Niente da 3–10") to make the overlap go away;
  "en/sq were not checked at that width"; the 57-polish-audit captures re-recorded with
  `AUDIT_UPDATE=1`, phone-se row "derived, not measured".
- 11-04 #1981 filed: pill and chip overlap by 11 px; cause stated: chip scale comes from the
  window's short edge (`cardScale(Math.min(W,H))`, `components/GameTable.tsx:331`).
- 11-04 `d22d3ca0` restores the label; 11-05 `ec4e77e8` "Hold the top chips' scale to the
  window's width" → 90 s later `c4adc9b9` "against the window's long edge" → 12 min later
  `dc2a1165` "against the window width **again**" → `5af8d97e` pins whatever value resulted.

Why it recurs: no layout owner for the HUD row (each chip sized independently from one global
scale); the fix-of-record changed **copy**, not layout; the capture baseline was re-recorded in the
same commit that broke it; overlap is checked only by specific state+viewport specs
(`exchangeNoOverlap.spec.ts`, `oneWayExchange.spec.ts`), not by a generic "no two HUD boxes
intersect at any supported viewport × locale" property.

### 1.3 Deal / turn gating timing (soft-locks, bot plays over the deal)

- 09-21 `99816aa6` per-seat flight time; 09-29 `32fd6724` seat keeps dealt count mid-deal.
- 10-09 #1432 the viewer's turn shows during the deal (mockup gives it on landing) → `201fd510`.
- 10-15 #1612 reused deal clock soft-locks the table (owner: "stuck on exchange, doing nothing")
  → #1624 "every deal and exchange gate has an exit" (watchdogs `fe7b0cf5`, `b9858092`).
- 10-16 #1639 offline bot plays over round 1's deal; `app/game.tsx` `botTurnKey` didn't gate on
  the deal.
- 10-16 #1726 **the same defect online**: #1624 "named the online half 'a server ticket of its
  own'; that ticket was never filed" (issue body). Fixed 10-19 in `server/game/gameTurn.ts`.
- 10-21 #1729/#1730 move the decision into `lib/game/turnSchedule.ts` (now a CLAUDE.md invariant).
- 11-03 #1964 (open): deal clock starts on the frames React mounts the hand on: `17 17 17 17 17 17
  100 333 83 383` ms frame intervals.
- 11-04 `96884a90` "Slow the native card flight and anchor it to the first drawn frame".

Why: two drivers (offline `context/` vs server `armTurn`) decided "when may a seat act" until
10-25; gates exited only on an animation frame; the deal's animation clock is wall-anchored rather
than first-frame-anchored, and the virtual-clock harness can't see a stall at mount.

### 1.4 Exchange ceremony: device flow `exchange-phase.yaml`

#55 (08-20) → #915 (overlay unobservable on iOS, 09-04: "0x0 by design") → #940 (09-07, "possible
#915 regression") → #1158 (09-21, "#940 class, reproduces on main") → #1222 (Android, 09-22) →
#1526 (10-11) → #1560 (10-12) → #1557 (Android ANR, "same chain as #1222/#1240, a trigger #1240's
fix did not remove"). 24 commits on `.maestro/exchange-phase.yaml`, among them
`2c4633cc` "stop chasing a measured tap round-trip for the E2E hold" and `3261e1b2` (10-12) "Hold
the device e2e exchange overlay until exchange-phase.yaml taps it" — **product code
(`components/table/ExchangeLegs.tsx`, `GameTable.tsx`) changed so the test can observe it**; its
body notes the emulator "janked through the end of the hand, the deal and the exchange" with view
reads of 22 s — the real perf signal, explained away as test latency.
Parallel UX thread: #533 rebuild around mockups → #602 owner (08-30): "Exchange interaction at
the moment sucks … doesn't look like the mockup" → #665, #1806, #1833.
Why: the test targets a transient overlay timed against wall clock on a janky emulator; each fix
lengthened or removed the hold rather than fixing the jank; device runs never gate a PR
(`docs/agents/device-runs.md` § The device jobs).

### 1.5 Felt / lamp look (the material keeps being reimplemented)

Felt implementations, each re-opening contrast, parity and perf:
SVG gradient (08-16 `fc701667`) → "felt a light source" (08-22 `d2f526b0`) → cloth with a nap
(08-28 `97879dc5`, #341) → **Skia twill shader** (09-25 #1257, `4afb83d6`/`73e3c12e`) → web
fallback felt + CanvasKit → baked cloth per lamp target (11-03 `bfdd7324`, `2de69a88`) → bake
through glides (`b5688798`) → sway by cross-fading two baked ends (11-05 `bf05f4cc`, `da39ff80`).
Knock-on, seat-name ink: `49efb321`/`99005121` (09-30) → `5ac421ed` → `1f52ad34` (10-01) →
`8b8db164` "no dimming under the seat names (owner ruling)" + `0324186d` alpha 0.7 (10-07) →
`afe1c825` alpha 0.75 "over the baked cloth's pool" (11-04) → `2a544c3e`.
Vignette: `bf9ef9a9` ".45, not .72 (owner ruling)".
Why: three renderers of one surface (`feltSkia.tsx`, `feltSkia.web.tsx`, `feltFallback.tsx`),
every parity moment doubled into `*Skia` and `*Fallback` specs with **different exemptions**;
the native Skia felt — what the owner sees — is rendered by no automated check (Jest has no Skia,
CI has no GPU; checks.md § "What no automated layer here covers").

### 1.6 Card shadows

`f79a0c93` (08-24) contact shadow → `c45a7d38` backs → `480e0b28` makeShadow on native (09-17) →
`aafb18f7` → `dcdbfcc8` felt draws every shadow from a registry (10-01) → #1401 iOS shadow sits at
the pile while the card rests beside the seat → #1412 flaky overlap gap → #1466 hand cards cast no
shadow under Skia → #1524 pile cards cast no shadow → `24ddb83a`/`1b7739c9` hold shadow through
wobble (#1414) → #1966 (11-03) "contact-only between cards, tighter cast" with `e73d57e7` "**the
mockup and theme tests carry the #1966 ruling**" (fixture `lantern-table/index.html` edited).
Why: shadows moved from per-view to a felt-drawn registry, so each card kind (hand, pile, flight,
fan) needed its own wiring and each was found missing separately; the target was changed in the
mockup together with the code.

### 1.7 Hand fan size / position

`17419b29` (08-19) right seat's fan pointed off-screen → #68 (08-20) "Fan geometry is derived in
four places, and two have drifted" → #193 hand meets bottom edge → #344/#420 hand snaps between two
sizes → `27f836e7`, `02120f87`, `65574399` (10-11, three resize fixes in one day) → #1806 ceremony
row one slot wider → #1829 (10-21) cards pop to new size for a frame → #1653 "one layout function,
one hit test" (the #68 remedy, two months later) → `4d38fa2f` (11-04) "steadier re-fan … 320 ms
instead of snapping"; `tests/fixtures/handRow.json` regenerated in the same commit.
Why: geometry copies (#68) persisted until #1653; size and scale were two drives (width plain
style, scale animated — #1829 body, `hand.tsx:265,461` vs `:365-376`); the fixture of record is
regenerated with the code.

### 1.8 Nightly mockup parity red

#1544 (10-12), #1645 (red 10-16 → 10-20, five nightly comments), #1799 (10-17 → 10-20), #1867
(red 10-26 → 11-01, six nights), #1951 (11-03), #1985 (open, 11-05).
Mechanism: `e0bcc1bc` (10-11) "The 24 mockup-parity specs leave pull-request CI … runs them
nightly … files a red scheduled run" (rule 46's 5-minute target); `1d1dcb3d` (10-12) "a red
nightly parity run is named to the owner, **never routed**" — "the issue the nightly files carries
only `parity`, which routes nowhere"; `6753604f` "a scheduled green closes the open failure
issue". So any PR may break parity, the loop is forbidden from picking the breakage up, and the
issue closes itself if the nightly flips green (flake or otherwise). Fixes for #1645 were to the
harness (`c8413ec4` "Parity chapters share one zero with the mockup's", `e3c35232`, `e344ef92`);
#1799 to the test (`3ba1ce8f`).

### 1.9 Reconnect / disconnect

#432 → #560 → #820/#850 policy → #844 (09-02) "Players drop often on a healthy network, and
nothing records why" → #870 (open since 09-03, `ready-for-human`) "Name and fix the real disconnect
cause" — blocked on the host move (#1107) → #1268 reconnect UX → #1403 iOS grey → #1449 reconnect
parity red on unrelated diffs → #1765 second socket on Riprova.
Why: the root cause was never measured; the loop built UX around drops (pill, grey, Riprova,
parity of the grey) instead.

### 1.10 iOS/Android-only rendering divergence

#1403 (RN view filter drops grayscale on iOS) → `56e3c991`, `ff5e55b9`, `ee8a7a20`, `3f7a5fb8`
(SwiftUI grayscale, scrims); #1401 (iOS shadow at pile); #1211/#1378 (portrait lock);
#1222/#1240/#1557 (Android svg ANR chain). Rule 36 requires an iOS capture to close an iOS defect,
while device jobs "run on dispatch and twice-weekly … never gating a PR" (checks.md § Owner
decisions).

Count of closed issues whose own text says it is a regression / "again" / "same class" /
"did not hold": 155 of 921.

---

## 2. Target drift

There is a spec, but it moves:
- `docs/FEEL-BAR.md` (487 lines, 16 commits) is a ceiling of external references, not a pass/fail
  target, and names its own floor as a claude.ai prototype artifact (line 3) that is not in the repo.
- The art direction itself was replaced: the August "prototype" (#200, #203 "Prototype parity")
  → the "lantern" direction (#1236 exaggerated mockups, 09-23; #1252 spec; ADR 0008, 09-28).
- The lantern mockup is `tests/e2e/fixtures/lantern-table/index.html` (`FIXTURE`,
  `tests/e2e/helpers/mockupParity.ts:36`). After `fcafe294` created it (09-24), it was edited in
  `e73d57e7`, `4d38fa2f`, `5bf42f27`, `3264ca0c`, `2a544c3e`, `d22d3ca0` — **all in the same
  commits as the product change they measure**. `d22d3ca0`: "The mockup's score pill and its parity
  region sit 40 pt left, where the app's symmetric table box puts it"
  (`RIGHT=846.2` → `805.7`). `4d38fa2f`: "the mockup fixtures, pins and tests follow".
- Since 09-24, **101 commits edited the parity harness or mockup HTML; 43 of them also changed
  product code in the same commit.** `mockupParity.ts`/`parityRegions.ts`/`traceDiff.ts`: 27
  commits in Sep, 59 in Oct, 6 in Nov.
- `TOLERANCES` (`tests/e2e/helpers/traceDiff.ts:61-73`) is stable (5 commits) — the drift is in the
  per-moment exemptions instead: `regionsAt`/`regionAt`/`fallbackRegionsAt`/`fallbackRegionAt`
  (`mockupParity.ts:463-470, 490, 512, 540, 563-569`), e.g. `mlose` `fallbackRegionAt: { pool: [] }`
  ("the fallback holds no pool") and bomb's `pile` "never read at 1440, on either felt". Each
  exemption is justified in a comment, each removes exactly where app and mockup disagree.
- App pixel baselines: only `tests/e2e/57-polish-audit/captures/*.png` (4 captures), re-recorded
  in `3264ca0c` and `ec4e77e8` alongside the change. `tests/fixtures/tableLayout.json` and
  `handRow.json` regenerated in `4d38fa2f`.
- Budgets: `tests/e2e/timings.json` 104 commits; rule 46 edited 9 times under five owner rulings.
- 588 of 680 commits touching `components/` since 09-01 also change `tests/` — the test moves
  with the code in the same commit as a matter of course.

Verdict: the fixed point is not fixed. When the app and the mockup disagree the cheapest move —
and the one the history shows — is editing the mockup, an exemption, or a capture.

---

## 3. Process cost

Sizes (chars / ≈tokens at 4 chars/token):

| File | When the docs say it is mandatory | chars | ≈tokens |
|---|---|---|---|
| `CLAUDE.md` | always (auto) | 5,686 | 1.4k |
| `components/CLAUDE.md` | any `components/` change | 5,062 | 1.3k |
| `.claude/commands/queue.md` | every loop ticket | 14,475 | 3.6k |
| `docs/agents/RULES.md` | "Read now" (queue.md:8) | 11,331 | 2.8k |
| `docs/agents/checks.md` | "Before any rendering, animation or test change" | 52,159 | 13k |
| `docs/agents/issue-tracker.md` | before claiming/labelling | 15,567 | 3.9k |
| `CONTEXT.md` | before naming a domain term | 10,044 | 2.5k |
| ticket body (median of ready-for-agent; p90 5.9k) | always | 2,617 | 0.7k |

A visual ticket's mandatory reading ≈ **29k tokens** before any product code (`GameTable.tsx`
≈15k, `hand.tsx` ≈14k). Each of the 3–4 loop subagents (scope, completeness, review, fix;
`.claude/agents/*.md`) re-reads CLAUDE.md files plus the brief: +3–6k each. Because the
conversation is re-read each turn (CLAUDE.md's own "seven cents"), a 100-turn ticket carries
~3M input tokens of process. Plus `FEEL-BAR.md` (8.7k) and `GAME-RULES.md` (10k) where relevant.

The harness is a second product: `tools/loop` 31.6k lines, **768 commits** (more than double
`GameTable.tsx`'s 364); `tools/loop/tests` 20k lines + `tests/tooling` 19k lines (112/159 files
read source text); 877 commits to `tests/tooling`+`tools/loop` since 10-01. Process docs churn:
RULES.md 80 commits, checks.md 174, queue.md 120, CLAUDE.md 102 — the agent re-learns a moving
protocol each ticket.

Internal tensions that matter for quality (not style):
1. **Review cannot block on a visual defect.** `.claude/agents/loop-review.md:24`: "Blocking is
   only: a bug … a DoD box left unmet … a regression or red CI … security … rule 47, 48 or 49".
   `queue.md:202`: "Nits go in the PR body, unfixed." The reviewer has Read/Grep/Glob/Bash only and
   no step in queue.md or any loop agent mentions a screenshot (grep: 0 hits).
2. **Review rounds forbid fixing siblings**: queue.md phase D "fix exactly the Blocking findings
   (no sweep for siblings, no nits)" vs phase C (queue.md:135) "Fix the root cause across every
   caller". #1726 is the outcome: the online half of #1624 was named and not filed.
3. **Rule 46 (5-min CI) vs visual gating**: it drove parity out of PRs (`e0bcc1bc`); rule 51
   (11-03) then asks for perf numbers by hand in the PR body. Speed of CI is enforced by code;
   speed of the game is enforced by prose.
4. **CLAUDE.md "No self-defeating safeguards"** vs a report-only nightly that routes nowhere and
   closes itself on green (`1d1dcb3d`, `6753604f`), and exemptions placed exactly where the gate
   would fail (`mockupParity.ts:563-569`). These are the safeguards that "report green by not
   looking" the invariant bans.
5. **Rule 48 "one decision has one copy"** vs the mockup fixture being maintained as a copy of the
   app ("mockup fixtures follow"). A spec kept in sync with code is a second copy, not a spec.
6. **Rule 36** (iOS defect closes only on an iOS capture) vs device runs that never gate and an
   owner device pass (#1393) open for a month.

---

## 4. Decomposition: is `GameTable.tsx` the god component?

Partly, and less than the commit count suggests.
- Size over time: 1607 (08-20) → 1527 → 1433 → 1530 → 1682 (10-15) → 1350 (11-01) → 1355. The
  #1650 design-audit wave (80 tickets, 10-16 → 10-25) already removed ~330 lines
  (`69b8c6d6` −223, `61d138ec` −95, `1ce199f8` −89, `56bdc9c8`, `3339fab2`).
- It is a **wiring hub**: 82 imports, 33 props, 10 `useState`, 7 `useEffect`, 12 `useMemo`; it owns
  the scale (`GameTable.tsx:331-332`), the z-order of every layer (`:144-165`) and the lamp aim.
  Since 09-01, **223 of 680** commits touching `components/` touched it, mostly 1–10 line
  wiring edits (chips scale, a layer z, a new prop), plus whole-repo renames
  (`980c6d55`, a glossary rename to "round", ±70 lines; `64207d9c`).
- The real god surface is the layered table as a whole: `hand.tsx` 1295, `seats.tsx` 909,
  `pile.tsx` 867, `feltCanvas.tsx` 517, `scorePill.tsx` 530 — five independently-scaled layers
  whose spatial relationships (chips vs pills vs seats vs fan vs rail) no single module owns.
  #1981 is the example: `cardScale(Math.min(W,H))` drives everything, and no layout pass reasons
  about whether the HUD row fits.

Splitting `GameTable.tsx` further would not have prevented any of §1's top five. A single
**table-layout solver** (pure function: viewport × locale × state → rects for every HUD element,
seat, fan, pile, with no-overlap/no-offscreen asserted over the full matrix) would have prevented
§1.2 and §1.7 and is the missing owner.

---

## 5. Structural causes ranked by impact, with the durable remedy

1. **No merge-blocking check sees the table as played (motion on, real clock, real cost).**
   Evidence §1.1, §1.3, §1.4. Remedy: one blocking PR spec, `tablePlayed`, motion on, real time,
   4x CPU throttle, production export: plays a round and fails on settled-table main-thread ms/s,
   deal p95 frame interval, and long tasks, against numbers the owner set once and only the owner
   may change (stored outside the agent-writable tree, or CODEOWNERS-protected). Pay for it in CI
   minutes by cutting tooling/loop suites, not by moving it to nightly.
2. **The visual target moves with the code.** Evidence §2. Remedy: freeze the mockup fixtures and
   parity exemptions under CODEOWNERS (owner approval needed). A loop commit that touches
   `tests/e2e/fixtures/**/*.html`, `regionAt`/`fallbackRegionAt`, captures or `TOLERANCES`
   together with `components/` is refused by CI. When the app is "right" and the mockup "wrong",
   that is an owner ticket that changes the mockup first, alone.
3. **Parity is report-only, routes nowhere and closes itself.** Evidence §1.8. Remedy: put the
   ~6 cheapest parity moments (rest, deal, trick on the fallback felt) back on PRs as blocking,
   sharded. A red nightly reverts or bisects to the culprit PR (`git bisect run` over the night's
   merges) and reopens that PR's ticket. Remove auto-close on green; close only on a named fix.
4. **Review is text-only and cannot block on what the player sees.** Evidence §3 tensions 1–2.
   Remedy: for any diff touching `components/` or `lib/tokens.ts`, phase D attaches
   before/after screenshots and one short recording (a fixed set of states × 4 viewports × 3
   locales) generated by CI. The reviewer gets a Blocking category "visible regression against
   the before image". Allow review rounds to fix the siblings of a Blocking finding.
5. **No owner of table layout. Layers are sized independently from one scalar.** Evidence §1.2,
   §1.7, §4. Remedy: `components/tableLayout.ts`, a pure solver returning every rect. A generic
   property test over viewports {SE, 12, Max, 1024x768, 640x360} × {it, en, sq} × capture states
   asserts no HUD overlap, nothing off-screen and touch floors. GameTable consumes the rects. This
   replaces the per-spec overlap checks.
6. **Three renderers of the felt, and the owner's (native Skia) is unseen by any automated
   check.** Evidence §1.5, §1.10. Remedy: pick one for web (the baked fallback, which is what CI
   can render) and delete or freeze the CanvasKit path. Run iOS simulator captures of the fixed
   state set on every `components/` PR (the device workflow exists) as blocking on diff vs the
   previous main. Close #1393 by turning its gates into that job, not by waiting for the owner.
7. **Process overhead crowds out product work and moves under the agent.** Evidence §3: ≈29k
   tokens of mandatory reading, `tools/loop` 768 commits, protocol docs re-edited 80–174 times.
   Remedy: freeze the loop for a month (no `tools/loop`, `.claude`, `docs/agents` commits except
   owner-filed). Cut checks.md to the "which check for which change" table (≤3k tokens) and move
   the rest behind on-demand links. Make RULES.md the only always-read file.
8. **Root causes parked as owner decisions while the loop builds around the symptom.** Evidence
   §1.9 (#870 open 2 months; UX built around drops), §1.4 (overlay hold rather than jank). Remedy:
   a ticket cannot close a symptom fix in a topic that has an open root-cause issue without linking
   it. The weekly recap lists topics with ≥3 closed issues in 30 days as "recurring: root cause
   unowned".
