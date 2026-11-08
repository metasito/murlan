# Device runs

Read when a change needs a simulator, emulator or phone: dispatching `ios.yml` or `maestro.yml`,
a native build, an iOS capture, the diagnostics bench, or a release. Reached from
`docs/agents/checks.md`; rules live in `docs/agents/RULES.md` (36 closes an iOS defect on an iOS
capture).

## The device jobs

`.github/workflows/ios.yml` restores a release `.app`; `maestro.yml` compiles a release APK. Both
drive `smoke`, `offline-game`, `exchange-phase` and `new-match` on a real simulator or
emulator; `ios.yml` runs them as parallel shards, one macOS job each, and its `Drive the app on a
real iOS simulator` job is green only when every shard ran and passed
(`tests/tooling/iosShards.test.ts`) and the run's attempt, first job start to last job end, took at most
`HARD_FACTOR` times `BUDGET_S` in `tools/ci/ios-wall.mjs`, read from the run's own jobs API; past `BUDGET_S` alone it warns. Each shard boots its
simulator beside the app job and waits for that job's upload (`tools/ci/await-artifact.mjs`),
going red when the app job ends without one. A shard never builds: when no native build for the branch's
fingerprint is cached (a native change), it fails saying so, and `gh workflow run
ios-app-cache.yml --ref <branch>` builds one (~21 min) before `ios.yml` is dispatched again. A ticket dispatches them from its own branch when its work needs a device run
(`gh workflow run ios.yml --ref agent/<n>-<slug>`, or `claude/<n>-<slug>` from a side session), and both run on `main` twice a week: a branch
can read only its own cache and main's, so a branch's first run restores main's native build
instead of compiling it cold, and a cache unread for 7 days is evicted. `ios-app-cache.yml` saves
that build on every push to main whose native fingerprint has none yet, and looks it up in about a
minute when it has; it drives no device (`tests/tooling/iosAppCache.test.ts`).

**By the owner's decision, verified intended:** the device jobs run on dispatch and on that
twice-weekly schedule, which keeps the native-build cache from eviction, and never gate a PR —
not an oversight to "fix" by running them on `push` or wiring them into `ci.yml`. A
red run is diagnosed from its artifacts, never rerun: a `gate` job refuses a dispatch off an
`agent/<n>-`/`claude/<n>-` branch, the device jobs run only on attempt 1, and a job under `always()`
is red on any rerun or any job that did not pass, so neither goes green with no device run
(`tests/tooling/deviceWorkflowsGate.test.ts`). A red scheduled run files or comments on
that workflow's open `device-run` issue.

`gh run list --workflow=ios.yml --branch
agent/<n>-<slug>` (or `maestro.yml`) is a ticket's current status — without `--branch` the list
mixes in main's scheduled runs. Wait on runs with `node scripts/await-run.mjs <run-id>
[<run-id>…]`, which exits 0 when all passed, 1 when one did not, 2 when `gh` cannot find a run id,
and 3 when some are still going: then run the same command again.
`CI gate`, the one check a merge waits on, needs every other `ci.yml` job, that one included, and is
red unless each passed or was skipped by scope (`tools/ci/gate.mjs`). `await-run.mjs` returns before the default
Bash timeout, so it needs no `timeout` of its own; a loop session's `gh run watch`, `gh pr checks
--watch` and a sleep loop over `gh run view|list`, `gh pr checks|view|status` or `gh api`
`…actions/runs|check-runs` are refused because a device run
outlasts any Bash timeout. `ios.yml` and `maestro.yml` run side by side,
so dispatch both and wait on both run ids at once; a second dispatch of the same workflow on one
branch cancels the first.

**These two release builds are the only device path**: a release build carries its
own bundle, so no packager, dev server or `adb reverse` is involved, and the flows take the app id
from `MAESTRO_APP_ID` with no default. No host client can stand in for them: a host's dev-menu
window sits above the app's own and eats the touch — `tapOn` reports `COMPLETED` regardless
(#627). Both jobs pin the same Maestro version and check it reads back off the
installed binary, so a version drift is a named failure (`tests/tooling/realAppNotExpoGo.test.ts`
holds both to it). Reproducing locally needs the same pin: `export MAESTRO_VERSION=2.10.0` before
`curl -Ls https://get.maestro.mobile.dev | bash` — read from the installer's own environment, so
it must be exported above the pipe.

CI compiles the Android and iOS projects on a pull request that changes `package.json`'s
`dependencies`, the app config, or a patch whose own diff touches native sources
(`tools/ci/nativeScope.mjs`), and weekly. When a ticket asks for
a native build otherwise, request one: `gh workflow run ci.yml --ref agent/<n>-<slug> -f
native=true`, then wait on it with `await-run.mjs`.

One `ios.yml` shard also runs `.maestro/felt-opaque.yaml`: the felt's Metal layer is opaque only through
`patches/@shopify+react-native-skia+2.14.0.patch`, and an opaque layer whose drawable misses its
bounds shows black. `tools/ci/feltPixels.mjs` fails its two screenshots (the table as it appears and
settled, both after the landscape lock resized the felt) on a black band along an edge or over 5 %
black; they upload as `felt-ios`. They show no black, not that the layer is opaque: the bench's
`feltOpaque` gate is that proof. `tools/ci/edgePixels.mjs` fails the settled one where the rotated
cards' edges against the felt are a staircase rather than anti-aliased.
`ci.yml`'s `ios-build` fails when the patch did not apply.

A device job proves the flows still run and the app renders *something* — it does not replace
looking at the device (rule 36); a green Chromium run closed #602 while the owner still saw the
same broken screen.

## Getting a capture

States are `lib/captureStates.ts` — the contract `app/capture.tsx` (device) and
the Chromium specs walk, so a photograph and a web run are of the same state; add a state there,
not in a spec. `CAPTURE_STATES` puts the lamp on each seat (`tests/e2e/lampSeats.spec.ts`);
`SEAT_COUNT_STATES` shrinks the hands and puts a seat out, the deal first
(`tests/e2e/seatsDoNotMove.spec.ts`); `LINK_STATES` holds the online table with the viewer's link
down; `MOMENT_STATES` lands a bomb as the link opens. The capture screen lists all four, in a development build or one built with
`EXPO_PUBLIC_E2E_FAST`, where `murlan://capture?state=<id>` opens one. The `ios.yml` felt shard
photographs `lamp-bottom`, `pile-right`, `play-right-landed` (a play flown in from the right seat), `bomb-landed` (the flare, shot without waiting) and `held` with `.maestro/captures.yaml` and uploads them as
`ios-captures`: fetch that before asking the owner. Otherwise open `/capture`, pick a
state, hold landscape, and ask for it verbatim: *"send one landscape screenshot of each state:
`lamp-bottom`, `lamp-right`, `lamp-top`, `lamp-left`, `pile-right`, `play-right-landed`, named after its state."*
**Sample pixels, don't describe them** — measuring beats eyeballing, every time (#209).

## Maestro traps

Found by actually running these, not by writing the YAML:

- A center-tap on a fanned/overlapping hand card can select the neighbour — the reported bounds
  are correct, but the next card's z-order covers the center point. Tap ~20px into a card's
  exposed left sliver instead.
- Reanimated's always-on glow/pulse on the game table blocks Maestro's default `tapOn` — which
  waits for the UI to "stop changing" — for its full timeout on a screen that never settles. Pin
  `waitToSettleTimeoutMs: 500` on every `tapOn` there.
- A Maestro step name is not evidence of what was on screen when it ran — the next assertion can
  pass against whatever hierarchy Maestro already read if the app died mid-flow; the screenshot
  beside a failing step is the evidence. Both device workflows fail a run in which the app itself
  died of a native crash — a tombstone or an `ANR in <app>` in the logcat, a report in the simulator host's
  DiagnosticReports (`tools/ci/find-native-crash.mjs`, #629, #1293, #1557). `node tools/ci/analyze-maestro-run.mjs
  <maestro.log> <logcat.txt>` separates a command starved by animation from one paying a flat
  per-fetch cost (#823), from the `maestro-debug`/`maestro-debug-ios-<shard>` artefact.

## Device bench (diagnostics builds)

- The bench (`app/bench.tsx`, `components/BenchScreen.tsx`, `lib/diagnostics/`) and
  `modules/murlan-diagnostics` are reachable only when `EXPO_PUBLIC_DIAGNOSTICS=1`.
- `npm run ios:device -- --ref <branch> --bench` installs the Release bench build
  (`ios-bench.yml`) and starts the collector on :5099, whose NDJSON lands in `diagnostics/`.
  `--diagnostics` serves Metro JS on the dev client instead, for iterating on a scenario.
- `node scripts/diagnostics-verdict.mjs <file> all` computes every gate from the raw rows, and
  reports `pass: null` with `unrun` for any run not on a Release build with an embedded bundle:
  Debug and Release differ 2.6–3× on JS-thread stall (the lantern review, #1259), so a Debug
  verdict would fail for work no player runs.
- ci.yml `build` checks that production carries no recorder, and that a diagnostics export does.
- The device gates, each judged on the owner's iPhone in the Release bench build:

  | Gate | Metric | Threshold | Scenario |
  | --- | --- | --- | --- |
  | P | The worklet pulse's own UI-thread cost: the first fire after launch, and p90 of 20 warm fires | cold ≤ 8.33 ms; warm p90 ≤ 1 ms | `pulseCost`, registered first |
  | G1 | `burstStalls`: any UI frame or JS-lag interval ≥ 34 ms, merged within 100 ms; the share of 250 ms windows at ≥ 100 Hz; a tap with no app-track onset in [tap, tap + 150 ms), one onset per tap | 0 stalls, fast share ≥ 0.8, 0 missing | `tapBurst`: 60 card presses at 6 Hz, feedback off then on |
  | G2 | Tap to heard onset, p90: app onset + `outputMs` + `ioMs`/2 − tap | ≤ 40 ms | `tapBurst`, "on" arm |
  | G3 | Scheduled onset error, p90 of \|mic onset − `inputMs` − at\|, with the app-track error beside it | ≤ 25 ms | `scheduledOnset`: 40 `turn` events at now + 300 ms |
  | G4 | Pulse to accelerometer onset (> 0.02 g), p90; none within 150 ms is missing | ≤ 40 ms; 0 | `hapticOnset`: 30 heavy pulses from `scheduleOnUI` |
  | G5 | Music deaths (2 s below −50 dB) and gaps (below −50 dB for over 250 ms) | 0 and 0, median level > −40 dB | `musicSwitch`: 40 switches, one every 3 s |
  | G6 | The soak gate | as `audio-soak.yml` | `soak`, 30 minutes, capture off |
  | Seats | Each opponent's `seat-ring` in window points (`measureInWindow` every 250 ms, during this scenario only), against its first sample in the deal's hold; every `seatState` recorded with one `of`, and every ring sampled in each state's own hold | all three rings in the deal's hold, finite and at distinct positions; drift ≤ 0.5 pt per axis | `seatAnchors`: each of `SEAT_COUNT_STATES`, settled 1.5 s, held 1 s |
  | Lamp | Each seat's worst `lampLegibility` ratio (on-move ring ÷ brightest other, `feltOnly` pixels of the felt canvas's snapshot) over one sway period | every seat ≥ `LAMP_FLOOR`, worst ÷ best ≥ `LAMP_SYMMETRY`, `LAMP_SWAY.samples` per seat | `lampVariants`: the four `lamp-*` capture states, settled 4 s, `LAMP_SWAY` 20 snapshots over 8 s |
  | Throws | `burstStalls` over every interval overlapping [throw, throw + 1200 ms] (the bot's 1200 ms think time lands the play in it); hitches per second beside the true mean rate | 0 stalls; ≥ 10 throws, frames covering ≥ 80 % of the 1200 ms in every window, JS ticks > 0 | `throwStalls`: one bot round through `driveBots`, recording opened before each `throw` row, kept to the first frame past 1200 ms, capped at 1300 ms (a cap reached records the gap as one interval) |
  | Rest | Mean frame rate (frames over frame time, not the median that snaps to the display rate), p95 frame interval, `burstStalls` and hitches per second per `half` | every swaying half ≥ 0.95 × the display's `maxFps` (120 without `sys`), p95 ≤ 1.5 frame intervals, 0 stalls; four pairs, every half framed | `restCost`: a quiet table, `lampFreeze` 1 and 0, four pairs of 30 s halves |
  | Felt | Per pair, stalls and the p95 frame interval of each half | four pairs recorded; `outcome` `keep` when the opaque half has no more stalls in any pair and the lower p95 in ≥ 3 of 4, else `drop` | `feltOpaque`: a quiet table, `feltOpaque` on and off, four pairs of 20 s halves |
  | Notices | Each shape's p90 entrance from `notice` rows, timed in UI frames; the `net` dot's median `blink` period; `burstStalls` over every showing | each entrance no shorter than 160 ms (pill, panel, D2) or 100 ms (mark, float, Q1) and over it by no more than its finishing frame's own interval plus 1 ms, at the p90; 900 ms within one frame (the median interval, at most 1/60 s); under reduced motion no blink and the dot at 1 in every 100 ms sample, at least 10 a showing; 0 stalls; every showing entered | `noticeGallery`: every `NOTICE_GALLERY` fixture for 2 s over a bot-played table, five rounds, then one under reduced motion |
  | Sustained | Per 30 s window of a bot-played table: `medianHz`, `burstStalls`, the thermal state, process CPU % and GPU memory from the `sys` rows | every window ≥ 0.85 × the display's own `maxFps` with 0 stalls; first-to-worst window drop ≤ 10 %; thermal never reaches serious (2); a phone that sent no `sys` row fails | `sustained`: `minutes` (default 8) of bots playing, frames recorded for the whole run |
  | Deals | Per fresh table mount (ten windows, the table unmounted 700 ms before each): mean rate, p95 interval, stalls, hitches per second, from the `sys` rows' `maxFps` | every window ≥ 0.85 × `maxFps` with 0 stalls, ten windows; a phone that sent no `sys` row or is in Low Power Mode fails | `dealBurst` |

  Every scenario's verdict also carries a `sys` summary (thermal max and at the end, Low Power Mode, CPU % p50/p90, GPU memory) from the once-a-second `sys` rows `probe.sampleSystem()` writes beside the drain, printed beside the gate's numbers. It is context, not a gate: GPU time itself is not readable in-app (Skia owns the Metal queue), so the shader's cost is judged by `sustained` and `restCost` moving, or by Instruments on a Mac.

  A **hitch** is a frame at least 1.6× its neighbours' median (neighbours under 11 ms, frame at least 12 ms), so a governor rate step is not one; every gate reports hitches per second, none gates on them until a device run sets a number. A verdict also fails on a lost batch (`lostBatches`), a native-side drop (`nativeDropped`) or a failed capture (`captureStopped`).

  **Resuming:** `npm run ios:device -- --gates --resume <ndjson>` appends to that log and skips every scenario with an `end` row and no error from a Release bundle (`doneScenarios`); the phone's own progress file also lasts seven days. Audio capture runs only for the scenarios marked `capture: true` (`tapBurst`, `scheduledOnset`, `captureProbe`, `musicSwitch`, `landingSync`), so the rest run without ReplayKit's cost.

  The 150 ms window is shorter than the 167 ms between taps, so a silent tap cannot borrow the
  next tap's onset. G3 reads the mic because the app track is stamped before the output path, so
  only the mic hears when the speaker sounds. A window's frames reach the recorder at once when
  it closes, so none may exceed its 5000 rows: 30 s at 120 Hz is 3600. A dropped row fails the
  gate. Pairs run ABBA (pairs 1 and 3 reversed), so drift over the run favours neither half; a p95
  interval, unlike `medianHz`, does not snap to the display rate. Recording is a shared value the
  frame probe reads, so opening or closing a window renders nothing
  (`tests/native/benchRecording.test.tsx`). The probe's frame loop runs only while a scenario that
  records frames has armed it for its whole run (`registerFramedScenario`; a window opened unarmed
  throws, and its body starts only after the loop's first frame), so
  each window's first frame has an interval (one without is recorded with a null `dt`) and the other scenarios see the governor as a player
  does (`tests/native/frameProbe.test.tsx`, `tests/native/framedScenarios.test.tsx`). The iOS build keeps the worklets frame-rate governor
  on, as these gates measured it; `tests/tooling/workletsGovernor.test.ts` fails a build that
  turns it off.
- Running them (about 66 minutes of the phone, untouched): an agent runs
  `npm run ios:device -- --ref <branch> --gates`, which writes the PC's LAN address into the
  IPA's `EXConstants.bundle/app.config` before signing, so the bench build opens the bench on a
  plain icon tap (`lib/diagnostics/BenchAutostart.tsx`); the `murlan://bench?host=…` link is an
  alternative to the icon, never both. It waits for the run's `run`/`end` row, prints one table
  of every gate (one with no verdict is `missing`, never a pass), writes it to
  `diagnostics/<stamp>.md`, and prints the `gh issue comment 1259 --body-file …` command without
  running it. The phone must be on the PC's Wi-Fi. The first install, and an expired Apple ID
  session, need the owner at the keyboard (sign-in, Trust, Developer Mode). Until
  `npm run ios:device` reinstalls the dev build, every cold launch of the bench build starts a
  full run. The owner:
  1. Plugs the iPhone into the PC, unlocks it, and leaves it face up (volume about half, ringer
     on; allow the microphone and screen-recording prompts the first time).
  2. Taps the Murlan icon and leaves it until the PC prints the table.
  3. Reads the table.

## What no automated layer here covers

Real device/web divergences, verifiable only on hardware:

- **Reanimated v4 worklets** — the native-renderer suite's shim runs no UI thread and no frame
  loop; jank and a UI-thread crash are device-only.
- **Audio** — the engine's calls into the mocked `react-native-audio-api` graph are asserted;
  whether sound is audible, mixed correctly, or survives the silent switch is device-only.
- **Screen orientation** — `expo-screen-orientation` is a no-op on web; the landscape lock has
  never run under any automated layer.
- **Haptics** — gated and asserted (`tests/native/hapticsEngine.test.tsx` and siblings), but whether
  the phone actually buzzes is device-only.
- **Safe-area insets** — the native renderer injects fixed metrics; a real notch, dynamic island
  or gesture bar is device-only.
- **Text rendering** — font-weight synthesis and line breaking differ from the browser.
- **The New Architecture** — Fabric and TurboModules are not what Jest renders into. The React
  Compiler runs only in jest's `compiled` project (`tests/native/*.compiled.test.tsx`,
  `jest.config.js`); the `ios` and `android` projects render the uncompiled tree.

## Manual device checklist

Run by hand on a real phone before a release — nothing above can see these. The owner's iPhone
gets the dev build from `npm run ios:device` (README, #1316):

1. Landscape lock holds on game screens; menus rotate freely.
2. Card lift and the exchange animation land smooth (the exactly-once invariant is unit-tested,
   `tests/ui-rules/exchangeModel.test.ts` — smoothness itself is not).
3. Sound plays with the ringer off, and the settings toggle silences it.
4. Haptics fire on select, play and win, and stop when switched off.
5. The notification banner slides in and out clear of the notch and gesture bar.
6. Fonts render at the right weight; nothing clips.
7. Backgrounding mid-game and returning reconnects inside the 60s grace window (the server-side
   timer is integration-tested, `tests/integration/reconnect.test.ts`; the on-device resume path
   is not).
