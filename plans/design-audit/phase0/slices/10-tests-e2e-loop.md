# 10-tests-e2e-loop — slice review (SRC 50144087)

## Findings

### 10-tests-e2e-loop-F1 (P2, M) Hand-written saves and seating outside the offlineSeed module
- files: tests/e2e/a11yOverlays.spec.ts:38, tests/e2e/exchangeAnnounceNodes.spec.ts:35, tests/e2e/exchangeNoOverlap.spec.ts, tests/e2e/exchangePickChange.spec.ts, tests/e2e/exchangeTeleport.spec.ts, tests/e2e/handClearance.spec.ts:40 (the midExchangeSave copies); tests/e2e/bombShakeBounds.spec.ts:100-134 and tests/e2e/cardRects.spec.ts:129-146 (bombSave twice); tests/e2e/startAnnouncement.spec.ts:26-75 and tests/e2e/mockupPolish.spec.ts:311-341 (openingSave, nearly identical), mockupPolish.spec.ts:137-160 (exchangeBetweenBots) and :309 (card() builder); tests/e2e/playedRound.spec.ts:88-156 (save/exchangeSave); the suspend key written inline at bombShakeBounds.spec.ts:266, cardRects.spec.ts:153, :227 and :267, pileBeaten.spec.ts:49 (holdSeededTurn already exists); seat-and-wait copies of resumeSaved at tests/e2e/helpers/mockupParity.ts:213-231 (seatTable) and exchangeAttribution.spec.ts:60-77 (open); botPlays at pileBeaten.spec.ts:28-32 and pileHandoff.spec.ts:35-37.
- problem: the save shape (the SavedGame JSON plus its storage key) has about 12 homes. When the save schema changes, every copy must change too, and a copy that drifts still seeds a table, but the wrong one. jscpd finds 28–53-line shared setup blocks across exchangeAnnounceNodes, exchangeNoOverlap, exchangePickChange, a11yOverlays and startAnnouncement. tests/e2e/helpers/offlineSeed.ts is already the deep module for this (offlineGameSave, holdSeededTurn, openSeededGame, resumeSaved), but these specs bypass it.
- proposed: add the four recurring shapes to offlineSeed: `exchangeSave(opts)`, `bombSave(opts)`, `openingSave(opts)` and `card(rank, suit)`, all built on offlineGameSave. Route every inline suspend key through holdSeededTurn. Delete seatTable and exchangeAttribution.open in favour of resumeSaved. Move `botPlays` into offlineSeed.
- effect: about 400 lines removed from specs. The save schema gets one test-side home, and the duplicate-setup class goes away (jscpd blocks drop out).
- overlap: extends tests-T7; folds in the jscpd setup-block report.
- confidence: high

### 10-tests-e2e-loop-F2 (P2, M) Fixed sleeps and networkidle where a settle signal exists
- files: tests/e2e/a11yOverlays.spec.ts:241 (2500); tests/e2e/cardScale.spec.ts (1000, 1000, 1500); tests/e2e/controlRail.spec.ts:69-79 (settledBoxes polls in 150 ms waits); tests/e2e/exchangeFit.spec.ts:130 (1500); tests/e2e/feltIdle.spec.ts:40 (3000); tests/e2e/feltNap.spec.ts:89 and tests/e2e/helpers/feltParityGrid.ts:239 (waitForTimeout(DEALT_MS)); tests/e2e/handBudget.spec.ts (2000, 2000, 1500); tests/e2e/handClearance.spec.ts:173; tests/e2e/handTapStrips.spec.ts (1500, 600); tests/e2e/seatFans.spec.ts:118, :156, :187 (1500) and :219 (400×4); tests/e2e/profileSignedOut.spec.ts:76 (600) and :62, :86 (networkidle); tests/e2e/offlineResume.spec.ts:41 (networkidle); tests/e2e/resultCutout.spec.ts:49-64 (600); tests/e2e/tutorialSkip.spec.ts:38 (1000); tests/e2e/helpers/bot.ts:276 (80) and :473-475 (250×2), plus a hand-rolled poll in waitForChange at :642; tests/e2e/onlineTableSurvey.spec.ts:154 and :386 (fixed gaps) and :424 (redundant waitFor); tests/e2e/reorderHand.spec.ts (5 redundant TABLE waits).
- problem: a fixed sleep is either too long, which wastes shard time, or too short, which flakes on a 7x-slower CI runner. tests/e2e/helpers/settle.ts (`settled`/`atRest`), the virtual clock and data-dealing attributes already give event-based waits. The tests/tooling/e2eFixedSleeps.test.ts ratchet keeps 58 legacy sleeps alive. networkidle never settles while a socket is open, and Playwright discourages it.
- proposed: replace each sleep with `atRest(locator)`, an `expect.poll` on the measured quantity, or a wait on the dealt attribute. Lower the LEGACY counts in the same change so the ratchet tightens.
- effect: tens of seconds of fixed wait per full run, a shrinking LEGACY table, and fewer CI-only flakes.
- overlap: extends tests-T-fixed-sleep finding (the e2eFixedSleeps ratchet); new per-file evidence.
- confidence: high for the listed sites; medium that each one has a usable signal

### 10-tests-e2e-loop-F3 (P2, S) Whole-match drives used only to reach the result board
- files: tests/e2e/resultActions.spec.ts, tests/e2e/resultCutout.spec.ts (driveGameToCompletion with 5-minute budgets); tests/e2e/tapTargets.spec.ts:388-402 (4-minute budget), with inline unique-username builders at :252-255, :292-294 and :456-459; tests/e2e/onlineTableSurvey.spec.ts:530-549 (boots tables to exercise a pure guard); tests/e2e/menuHeight.spec.ts (9 registrations); tests/e2e/oneAccessibleNode.spec.ts test 3.
- problem: these specs check the result screen, but they play a whole match to get there. A match-point seed already exists (tests/e2e/tableMoments.spec.ts:169-175 matchPointSave; tableUnmount's `offlineGameSave(2,1,0)`). The guard test checks a pure function through a browser.
- proposed: seed the match-point state and play the last trick. Move matchPointSave into offlineSeed (as part of F1). Move the onlineTableSurvey guard to a jest test of the pure function.
- effect: each spec drops from minutes to seconds. This is the largest runtime cut in the slice.
- overlap: new
- confidence: high (medium for menuHeight and oneAccessibleNode)

### 10-tests-e2e-loop-F4 (P2, S) The nightly list is a regex copied into four places, plus 23 stub specs
- files: tests/e2e/playwright.config.ts:50 (testIgnore), tests/e2e/playwright.parity.config.ts:8, tools/ci/e2e-shard.mjs:48 and tests/tooling/e2eShardSplit.test.ts:35 and :120-123 (which regex-parse the config source); stub specs feltParityGrid{Phone,Tablet}{2,3,4}.spec.ts (3 lines each) and mockupParity*.spec.ts (17 stubs, 3–4 lines each); stale shard comments at tests/e2e/helpers/mockupParity.ts:2-3 and :401 and tests/e2e/helpers/feltParityGrid.ts:224.
- problem: the decision "is this spec nightly?" is written as a regex in the config and then read back by parsing the config's source text in two more places. Renaming a spec silently moves it between tiers. The stubs exist only so that the regex and the shard split can see one file per shard.
- proposed: use location as the interface. Move nightly specs to `tests/e2e/parity/` (or give them a `*.parity.spec.ts` suffix). Then playwright.config uses `testIgnore: '**/parity/**'`, the parity config uses `testDir`, and e2e-shard.mjs globs the directory instead of parsing a regex. Generate shards with Playwright's `--shard` rather than one stub file per shard.
- effect: two regex parsers and their test are deleted, the 23 stub files go, and so does the class of bugs where a rename changes the tier.
- overlap: extends tests-T13
- confidence: high on the duplication; medium on replacing the stubs with `--shard` (their per-region split may be deliberate)

### 10-tests-e2e-loop-F5 (P2, S) Layout guards demoted to the nightly parity run
- files: tests/e2e/handParity.spec.ts, tests/e2e/lampSeats.spec.ts (also carries Italian copies at :20-21 and an inline Rec.709 luma at :136), tests/e2e/mockupPolish.spec.ts (the parts that assert geometry, not pixels); the nightly list at tests/e2e/playwright.config.ts:50.
- problem: CLAUDE.md says only tests/e2e catches layout bugs. These three specs assert geometry, not pixel parity, but they share the nightly list with the pixel specs. A layout regression therefore lands green and surfaces the next morning; the parity nightly is red as of today (#1645).
- proposed: split the geometric assertions out into PR-tier specs and leave the pixel comparisons nightly.
- effect: layout regressions in the hand and lamp seats are caught before merge.
- overlap: new
- confidence: medium (I did not time these specs; their cost may be why they were demoted)

### 10-tests-e2e-loop-F6 (P3, S) Four copies of the "find a legal play" search
- files: tests/e2e/helpers/bot.ts (playOrPass), tests/e2e/helpers/motionPath.ts (lead), tests/e2e/handBudget.spec.ts (playOneCombination), tests/e2e/tableFit.spec.ts:303-318 (playFirstLegalCard).
- problem: each copy taps cards until the GIOCA button enables. The tap-and-probe loop and the button selector are repeated, and bot.ts also hard-codes Italian regexes (:49, :201, :208-211).
- proposed: export `playAnyLegal(page): Promise<boolean>` from bot.ts and have the other three call it. Use the labels.ts and selectors.ts constants instead of the Italian literals.
- effect: three copies deleted; a copy change touches one place.
- overlap: new
- confidence: high

### 10-tests-e2e-loop-F7 (P3, XS) Copied press constants and a duplicated drag
- files: tests/e2e/handClearance.spec.ts:33-35 (local TAP_MS and HOLD_PAST_MS), tests/e2e/handScroll.spec.ts:25 (HELD_MS=800); tests/e2e/helpers/press.ts (exports TAP_MS and HOLD_MS, which nothing imports); the drag in tests/e2e/playedRound.spec.ts:221-229 copies reorderHand.spec.ts:67-77 (dragCard), and webPerf repeats it.
- problem: tests/tooling/e2eRealPresses.test.ts:188-192 pins press.ts against hand.tsx HOLD_MS, but the local copies sit outside that pin and can drift.
- proposed: import TAP_MS and PAST_HOLD_MS from press.ts, and move dragCard into press.ts.
- effect: the pin covers every use of the constants, and two drag copies are deleted.
- overlap: new (knip's "unused TAP_MS export" is the other side of the same gap)
- confidence: high

### 10-tests-e2e-loop-F8 (P3, S) Duplicated pixel and environment helpers, and the mockup HTML fixtures
- files: Rec.601 luma at tests/e2e/helpers/parityRegions.ts:63 while the rest of the suite uses Rec.709 (inline at lampSeats.spec.ts:136); WCAG maths twice in seatNameContrast.spec.ts:30-36 and :68-72; mulberry32 in helpers/seededRandomness.ts:10-15 and helpers/virtualClock.ts:19-25; the wide check in tableFit.spec.ts:49-72 repeated in onlineTableSurvey.spec.ts; the PHONES list in tableProportions.spec.ts:19-24 copies helpers/phones.ts; console collectors hand-rolled in helpers/online.ts:64-73 and reconnect.spec.ts instead of the fixtures.ts one; setSafeArea in resultCutout.spec.ts:49-64 copies helpers/safeArea.ts; bundle() in helpers/mockupParity.ts:874-892 copies helpers/reconnectParity.ts:137-157; feltParityGrid clothRow copies feltNap's sample; the e2e HTML mockup fixtures share 150–217-line blocks (jscpd).
- problem: each pair is one fact in two homes. The luma mismatch is a real inconsistency: two specs measuring "brightness" disagree by up to a few percent.
- proposed: add one `pixels.ts` helper (luma709, contrastRatio, sample), have virtualClock import mulberry32, and have specs import phones, safeArea and the console fixture. For the HTML fixtures, extract the shared block into one template the mockup pages include.
- effect: about 10 copies deleted, and luma is consistent across the suite.
- overlap: new; folds in the jscpd HTML-fixture report
- confidence: high (medium for the HTML-fixture template, which I did not open block by block)

### 10-tests-e2e-loop-F9 (P3, S) Small defects in e2e helpers and specs
- files:
  - tests/e2e/helpers/navigation.ts:86-90: dismissStartAnnouncement calls count() and then click with `.catch(()=>{})`. It races the announcement's own dismissal and hides a real failure.
  - tests/e2e/fixtures.ts:126-133: consoleErrors hides reduced-motion emulation.
  - tests/e2e/helpers/bot.ts:160-167: an orphaned JSDoc; and a positional `nth` at :472.
  - tests/e2e/tableMoments.spec.ts:1-3 and :131: the comments promise a flight-shadow test that does not exist (a false comment).
  - tests/e2e/reducedMotionWobbleReset.spec.ts:27-62: stepUntil re-implements virtualClock.
  - tests/e2e/exchangeFit.spec.ts:133: a hard-coded gold colour.
  - tests/e2e/howToPlay.spec.ts:34: a literal 44 in place of the tap-target constant.
- problem: the race and the swallowed error are flake sources. The false comment is a guard that looks present but is not.
- proposed: replace dismissStartAnnouncement's body with `await locator.click({ timeout }).catch(isDetached)`, or a wait for the hidden state. Write the flight-shadow test or delete the promise. Have reducedMotionWobbleReset use virtualClock. Import the gold token and the tap-target constant.
- effect: one flake source and one false claim removed.
- overlap: new
- confidence: high

### 10-tests-e2e-loop-F10 (P3, S) Specs that repeat cheaper-tier coverage
- files: tests/e2e/homeArena.spec.ts (tests 1-3), tests/e2e/gameSettingsSheet.spec.ts, tests/e2e/seatFans.spec.ts (tests 1-2).
- problem: these assert presence, text or toggle state, which RNTL tests already cover. They do not assert geometry, so the browser adds cost but no extra coverage.
- proposed: delete them after confirming the matching native test exists. Keep the geometric assertions.
- effect: fewer e2e registrations.
- overlap: new
- confidence: medium (the native counterparts were not opened in this slice)

### 10-tests-e2e-loop-F11 (P3, XS) Exports used only inside their own module (knip)
- files: tests/e2e/helpers/press.ts (TAP_MS, HOLD_MS, pressFor, pressPointFor), helpers/glyphCoverage.ts (sweepGlyphs, GlyphFailure, GlyphSweep), helpers/traceDiff.ts (flightSegments, RegionSample), helpers/reconnectDiff.ts (JITTER_MS, GREY_TOLERANCE), helpers/lanternDepartures.ts (MOCKUP_POOLS), helpers/navigation.ts (the LobbyMode type), tools/loop/tests/helpers/probeFixtures.mjs (ownerOf).
- problem: these exports widen the helper interfaces for no caller. Verified by grep over SRC: each symbol is used only inside its own file. press.ts TAP_MS should instead gain callers (F7).
- proposed: drop `export`, except for TAP_MS, which gets callers via F7.
- effect: smaller interfaces.
- overlap: knip.md
- confidence: high

### 10-tests-e2e-loop-F12 (P2, M) Loop tests fake gh and git at the argv level
- files: tools/loop/tests/ciVerdict.test.ts:258-263, :303-321, :452-461; claim.test.ts:24-106; lockDrift.test.ts:126-129; loopDerive.test.ts:459-479 (a fakeGh script swapped in through LOOP_GH_SCRIPT about 17 times); mainHealth.test.ts:41-72 and the exact joined-argv keys at :322-332, :382-400, :422-434; queueLoop.test.ts:267-277 (syncCheckout matches by `key.startsWith`) and :1018-1028 (the park recorder uses `args.includes`); settleReplay.test.ts:42-122 (rollupFake); workspace.test.ts:65-80; loopGate.test.ts:68-73 (stubGh).
- problem: the tests fake at the CLI argv, so they pin the adapter's exact command lines rather than the behaviour behind the interface. Reordering a flag reds the tests while behaviour stays the same, and a wrong flag that the fake also matches stays green. Two seams already show the better shape. The tracker port (fakeTracker and ghTracker, which tracker.test.ts proves agree) has two real adapters. derive already takes an injected `exec` (loopDerive.test.ts:706-710, :720-724), which makes the LOOP_GH_SCRIPT env swap redundant there.
- proposed: give the gh-facing modules (ciVerdict, mainHealth, settle, park) a port of named operations (`prChecks(n)`, `rerun(runId)`, `mainRuns()`…), modelled on the tracker port. Keep one argv-shape test per real adapter. In loopDerive, use the `exec` injection everywhere and drop the env-script fake.
- effect: argv strings are pinned once per adapter instead of in every scenario, and rollupFake, the fakeGh scripts and the mainHealth keyed maps shrink to in-memory port fakes.
- overlap: confirms tooling-F2, tooling-F3
- confidence: high on the problem; medium on the port's exact surface

### 10-tests-e2e-loop-F13 (P2, M) The same scenarios tested at the pure tier and again through the shell
- files:
  - tools/loop/tests/settleReplay.test.ts: the pure stepSettle replays (:165-188) cover scenarios that runSettle repeats through rollupFake. The pairs (stepSettle line / runSettle line) are: cleared green armed :205/:419, update-branch re-arms :253/:466, rerun once :310/:563, flake on rerun green :317/:574, ledgered flake after restart :343/:614, standby :359/:715, armed disarmed before red :261/:487.
  - loopGate.test.ts:463-484: the --build table spawns the CLI 15 times, though dodVerdict is pure, exported and already tested at :506-540. Its "the review decides the exit code" block (:204-278) repeats the pure `landable` tests at :587-673. The binary runs in real worktrees of the shared checkout (:32-47, :80-97).
  - loopDerive.test.ts: real repos at :327-336, :490-502, :572-591 and :874-899, where the parsers they reach are pure.
- problem: each scenario has two homes, and the slow one is the spawned or real-repo tier. Creating worktrees in the shared checkout also interferes with a live loop.
- proposed: keep the scenario logic in the pure tier. Keep one runSettle test per effect kind (post, read retry, file body) and one CLI test per exit code. Point loopGate at a temp clone, or at the pure functions only.
- effect: about 20 spawns and 7 duplicate scenarios deleted, and the loop test suite gets faster.
- overlap: extends tooling-F2
- confidence: medium-high

### 10-tests-e2e-loop-F14 (P2, S) decide.test's name registry forces routing tests into two homes; decide.mjs tests live in queueLoop.test
- files: tools/loop/tests/decide.test.ts:439-455 (it regex-reads queueLoopMain test names and requires a same-named ROW or an ELSEWHERE entry), :362-430 (ELSEWHERE), :434-437 (EXPANDED); same-named pairs (queueLoopMain line = decide line): :167=:236, :180=:239, :266=:160, :367=:158; tools/loop/tests/queueLoop.test.ts:1127-1192 (outcomeOf), :1194-1246 (reasonFor), :1250-1288 (exhausted/resumePhase), :1291-1324 (waitFor), :1364-1413 (afterRefusal) test decide.mjs from the wrong file.
- problem: the guard keys on test names, not behaviour. Every new main test pays an ELSEWHERE entry, and a renamed test drifts the registry. It guards the shallow tier (main) instead of making the decide table the single home of routing.
- proposed: the decide table is the only place routing is specified. queueLoopMain keeps tests that observe effects (park called, worktree removed) without restating the route. Delete the name guard and ELSEWHERE. Move the five queueLoop.test describes into decide.test.
- effect: about 70 lines of registry deleted, and routing has one home.
- overlap: confirms tooling-F10 (the misplaced describes); the name guard part is new
- confidence: medium (the guard may have been added after a routing test went missing; its commit was not read)

### 10-tests-e2e-loop-F15 (P2, S) Control files resolved against the cwd force process.chdir in tests
- files: tools/loop/tests/ticker.test.ts:435, :454, :471, :504, :660; queueLoop.test.ts:1339 (holdFor); queueLoopMain.test.ts:1948, :1972, :1989 (`.loop-park`); loopRender.test.ts:498; lockDrift.test.ts:131; env mutation at queueLoop.test.ts:761-771 (LOOP_PHASE).
- problem: ticker, holdFor and main read and write `.loop-stop` and `.loop-park` relative to the cwd. process.chdir is process-global, so these tests cannot run concurrently and a failed restore leaks into later tests. parkAsked already takes a reader (queueLoopMain.test.ts:2000-2004), but main does not take a directory.
- proposed: add `{ dir }` (or `paths: { stop, park }`) to the options of ticker, holdFor and main, defaulting to `process.cwd()`. Tests pass a temp directory.
- effect: 10 chdir calls deleted; the tests are parallel-safe.
- overlap: confirms tooling-F7
- confidence: high

### 10-tests-e2e-loop-F16 (P2, XS) A live-network test and a machine-state test
- files: tools/loop/tests/deleteBranchOnMerge.test.ts:11-15 (a live `gh api graphql` with no skip guard); tools/loop/tests/reap.test.ts:487-494 (runs the real `reap({dryRun:true})` against this machine's process table and asserts that an e2e port line is present).
- problem: the result depends on network, auth or what is running on the machine, so the test is red offline or on a fork without a token and says nothing about the code.
- proposed: move deleteBranchOnMerge to a scheduled repo-settings check, or skip it without GH_TOKEN and say so in the output. Point the reap test at the injected readTable, which workspace.test.ts:488-503 already uses.
- effect: two environment-dependent tests become deterministic.
- overlap: new
- confidence: medium (CI may always have a token)

### 10-tests-e2e-loop-F17 (P3, S) Source and prose scans that a seam or a behaviour test would replace
- files: tools/loop/tests/reap.test.ts:408-418 (scans the source for the killPid order; workspace.test.ts:488-503 already reaches killPid through readTable, so the scan is redundant); loopDocsAreExecutable.test.ts:281 (scans queue-loop.mjs for `"worktrees:remove", "--"`); cli.test.ts:101 (an OTHER_BINARIES regex on a literal line); brief.test.ts:54-107 (role() regexes over prose); agentCheckDelegation.test.ts.
- problem: a text scan falls to a decoy (a comment or a dead branch satisfies it), and it reds on harmless edits.
- proposed: delete the reap scan now. Replace the others with behaviour tests where a seam exists (spawn the command and assert the argv through the existing injection). Keep loopDocsAreExecutable's deliberate doc-to-parser binding.
- effect: four brittle scans fewer.
- overlap: confirms tooling-F5, tooling-F11
- confidence: high for reap; medium for the others

### 10-tests-e2e-loop-F18 (P3, S) Tests import queue-loop.mjs for constants and helpers
- files: tools/loop/tests/decide.test.ts:7, lockDrift.test.ts:8, loopDerive.test.ts:25, nextTicket.test.ts:7, runLoop.test.ts:4, loopDocsAreExecutable.test.ts:6, loopHoldSurvives.test.ts:18.
- problem: importing the orchestrator to reach BREAKER, CI_ROUNDS, park and RESTART loads the whole entry module and its side imports. It is also why queue-loop.mjs carries test-only exports (inventory).
- proposed: move the constants and park/holdFor into the modules that own them (decide.mjs, park.mjs) and import from there.
- effect: queue-loop.mjs loses its test-only exports, and tests stop loading the entry point.
- overlap: extends tooling-F10
- confidence: medium

### 10-tests-e2e-loop-F19 (P3, XS) Small loop-test defects
- files:
  - tools/loop/tests/loopGate.test.ts:643 and :662: two tests have the same name, and the second is a superset of the first, so delete the first.
  - loopHoldSurvives.test.ts:36: rmSync runs after the assert, so a failure leaves `.loop-logs/hold-probe` in the repo. Use try/finally or t.after.
  - worktreeRemoveCommand.test.ts:257: on win32, a fixed 700 ms sleep waits for a child's chdir. Wait for a ready line from the child instead.
  - workspace.test.ts:344 and :358: `t.mock.method(fs, "rmSync")` patches the global fs, because sweep has no rm injection. Add `rm` to sweep's options.
- problem: a duplicate name hides which test failed, cleanup leaks on failure, the fixed sleep is flake-prone, and the global mock is a missing seam.
- proposed: as listed in each item.
- effect: four small fixes.
- overlap: new
- confidence: high

## Prior findings that are wrong or already fixed
- tooling-F1 (stubPorts/io placeholders): still real at queueLoop.test.ts:38-60 and queueLoopMain.test.ts:47-136. Not fixed.
- tooling-F2 and F3 (spawned or real-repo tests; argv fakes): still real (F12, F13 above).
- tooling-F5 (the cli OTHER_BINARIES literal-line regex): still at cli.test.ts:101.
- tooling-F7 (chdir for control files): still real (F15).
- tooling-F10 (decide.mjs tests in queueLoop.test): still real at queueLoop.test.ts:1127-1413.
- tooling-F11 (the worktrees:remove source scan): still at loopDocsAreExecutable.test.ts:281.
- tests.md items in this slice: re-checked against SRC; none found wrong or already fixed.
- knip "tools/loop/tests/helpers/probeFixtureRace.mjs is unused": **false positive**. It is spawned by path at loopGate.test.ts:31 (`RACE`) and :116.

## Inventory items checked
- queue-loop.mjs test-only exports (BREAKER, CI_ROUNDS, MAX_HANDOFFS, SETTLE, TICKET_HOLDS, UPDATES, RESTART, park, holdFor): real. They are imported by the tests listed in F18.
- The large test files (queueLoopMain 2422, queueLoop 1646, loopDerive 988, settleReplay 966, mockupParity.ts 960): real sizes. The bulk is the duplication in F12, F13 and F14, apart from mockupParity.ts, whose size is its scene table (leave-alone apart from F1 and F8).
- Duplicated blocks in e2e setup (jscpd 28–53 lines): real, F1.
- Duplicated HTML mockup fixture blocks (jscpd 150–217 lines): real, F8.
- knip unused exports in press, glyphCoverage, traceDiff and reconnectDiff: real (internal-only), F11.
- knip unused file probeFixtureRace.mjs: false positive (above).

## Coverage
| file | lines | verdict |
|---|---|---|
| tests/e2e/a11yOverlays.spec.ts | 258 | F1, F2 |
| tests/e2e/accountRecovery.spec.ts | 82 | clean |
| tests/e2e/ariaTwins.spec.ts | 61 | clean |
| tests/e2e/bannerDisplaces.spec.ts | 140 | clean |
| tests/e2e/bombShakeBounds.spec.ts | 354 | F1 |
| tests/e2e/browserErrors.spec.ts | 55 | clean |
| tests/e2e/cardGlowParity.spec.ts | 133 | F4 |
| tests/e2e/cardRects.spec.ts | 291 | F1 |
| tests/e2e/cardScale.spec.ts | 133 | F2 |
| tests/e2e/cardShadowParity.spec.ts | 240 | F4 |
| tests/e2e/controlRail.spec.ts | 197 | F2 |
| tests/e2e/copyRoomCode.spec.ts | 41 | clean |
| tests/e2e/exchangeAnnounceNodes.spec.ts | 139 | F1 |
| tests/e2e/exchangeAttribution.spec.ts | 271 | F1 |
| tests/e2e/exchangeFit.spec.ts | 171 | F2, F9 |
| tests/e2e/exchangeNoOverlap.spec.ts | 151 | F1 |
| tests/e2e/exchangePickChange.spec.ts | 130 | F1 |
| tests/e2e/exchangeTeleport.spec.ts | 91 | F1 |
| tests/e2e/feltIdle.spec.ts | 77 | F2 |
| tests/e2e/feltNap.spec.ts | 161 | F2, F8 |
| tests/e2e/feltParityGridPhone2.spec.ts | 3 | F4 |
| tests/e2e/feltParityGridPhone3.spec.ts | 3 | F4 |
| tests/e2e/feltParityGridPhone4.spec.ts | 3 | F4 |
| tests/e2e/feltParityGridTablet2.spec.ts | 3 | F4 |
| tests/e2e/feltParityGridTablet3.spec.ts | 3 | F4 |
| tests/e2e/feltParityGridTablet4.spec.ts | 3 | F4 |
| tests/e2e/fixtures.ts | 136 | F9 |
| tests/e2e/flightOrigin.spec.ts | 68 | clean |
| tests/e2e/friendsLadder.spec.ts | 62 | clean |
| tests/e2e/gameSettingsSheet.spec.ts | 334 | F10 |
| tests/e2e/handBudget.spec.ts | 143 | F2, F6 |
| tests/e2e/handClearance.spec.ts | 229 | F1, F2, F7 |
| tests/e2e/handParity.spec.ts | 202 | F5 |
| tests/e2e/handScroll.spec.ts | 168 | F7 |
| tests/e2e/handTapClick.spec.ts | 49 | clean |
| tests/e2e/handTapStrips.spec.ts | 135 | F2 |
| tests/e2e/helpers/bot.ts | 650 | F2, F6, F9 |
| tests/e2e/helpers/deviceNetwork.ts | 10 | clean |
| tests/e2e/helpers/feltParityGrid.ts | 295 | F2, F4, F8 |
| tests/e2e/helpers/glyphCoverage.ts | 155 | F11 |
| tests/e2e/helpers/labels.ts | 15 | clean |
| tests/e2e/helpers/lanternDepartures.ts | 92 | F11 |
| tests/e2e/helpers/mailSink.ts | 61 | clean |
| tests/e2e/helpers/mockupParity.ts | 960 | F1, F4, F8 |
| tests/e2e/helpers/mockupStage.ts | 126 | clean |
| tests/e2e/helpers/motionPath.ts | 191 | F6 |
| tests/e2e/helpers/navigation.ts | 123 | F9, F11 |
| tests/e2e/helpers/offlineRound.ts | 57 | clean |
| tests/e2e/helpers/offlineSeed.ts | 191 | leave-alone: the deep seed module F1 routes into |
| tests/e2e/helpers/online.ts | 71 | F8 |
| tests/e2e/helpers/onlineTable.ts | 156 | clean |
| tests/e2e/helpers/parityRegions.ts | 70 | F8 |
| tests/e2e/helpers/phones.ts | 15 | clean |
| tests/e2e/helpers/press.ts | 78 | F7, F11 |
| tests/e2e/helpers/reconnectDiff.ts | 143 | F11 (otherwise leave-alone: pure diff) |
| tests/e2e/helpers/reconnectParity.ts | 160 | F8 |
| tests/e2e/helpers/safeArea.ts | 27 | clean |
| tests/e2e/helpers/seededRandomness.ts | 27 | F8 |
| tests/e2e/helpers/selectors.ts | 24 | clean |
| tests/e2e/helpers/settle.ts | 100 | leave-alone: the settle seam F2 routes into |
| tests/e2e/helpers/tableTrace.ts | 112 | clean |
| tests/e2e/helpers/tapTargets.ts | 61 | clean |
| tests/e2e/helpers/traceDiff.ts | 376 | F11 (otherwise leave-alone: pure diff) |
| tests/e2e/helpers/virtualClock.ts | 95 | F8 |
| tests/e2e/homeArena.spec.ts | 201 | F10 |
| tests/e2e/homeCardField.spec.ts | 61 | clean |
| tests/e2e/homeOrientationOnLoad.spec.ts | 77 | clean |
| tests/e2e/howToPlay.spec.ts | 45 | F9 |
| tests/e2e/iconGlyphs.spec.ts | 154 | clean |
| tests/e2e/lampLegibility.spec.ts | 63 | F4 |
| tests/e2e/lampSeats.spec.ts | 148 | F5, F8 |
| tests/e2e/landingContact.spec.ts | 66 | clean |
| tests/e2e/landingShadowStill.spec.ts | 81 | clean |
| tests/e2e/menuFit.spec.ts | 281 | clean |
| tests/e2e/menuHeight.spec.ts | 223 | F3 |
| tests/e2e/mockupParity.spec.ts | 61 | F4 |
| tests/e2e/mockupParityBombFallback.spec.ts | 4 | F4 |
| tests/e2e/mockupParityBombSkia.spec.ts | 4 | F4 |
| tests/e2e/mockupParityDealFallback.spec.ts | 4 | F4 |
| tests/e2e/mockupParityDealSkia.spec.ts | 4 | F4 |
| tests/e2e/mockupParityMloseFallback.spec.ts | 4 | F4 |
| tests/e2e/mockupParityMloseSkia.spec.ts | 4 | F4 |
| tests/e2e/mockupParityMwinFallback.spec.ts | 4 | F4 |
| tests/e2e/mockupParityMwinSkia.spec.ts | 4 | F4 |
| tests/e2e/mockupParityPloseSkia.spec.ts | 4 | F4 |
| tests/e2e/mockupParityPwinSkia.spec.ts | 4 | F4 |
| tests/e2e/mockupParityReconnect.spec.ts | 3 | F4 |
| tests/e2e/mockupParityRestAirFallback.spec.ts | 4 | F4 |
| tests/e2e/mockupParityRestAirSkia.spec.ts | 4 | F4 |
| tests/e2e/mockupParityScoreOpen.spec.ts | 4 | F4 |
| tests/e2e/mockupParityTrickFallback.spec.ts | 4 | F4 |
| tests/e2e/mockupParityTrickLandingsSkia.spec.ts | 4 | F4 |
| tests/e2e/mockupParityTrickSkia.spec.ts | 4 | F4 |
| tests/e2e/mockupPolish.spec.ts | 631 | F1, F5 |
| tests/e2e/motionMatch.spec.ts | 20 | clean |
| tests/e2e/motionThirdDeal.spec.ts | 18 | clean |
| tests/e2e/musicLoops.spec.ts | 139 | clean |
| tests/e2e/offline.spec.ts | 6 | clean |
| tests/e2e/offlineBannerFit.spec.ts | 124 | clean |
| tests/e2e/offlineFour.spec.ts | 6 | clean |
| tests/e2e/offlineMatch.spec.ts | 54 | clean |
| tests/e2e/offlineResume.spec.ts | 85 | F2 |
| tests/e2e/oneAccessibleNode.spec.ts | 189 | F3 |
| tests/e2e/online.spec.ts | 206 | F8 |
| tests/e2e/onlineTableSurvey.spec.ts | 549 | F2, F3, F8 |
| tests/e2e/pendingRequests.spec.ts | 155 | clean |
| tests/e2e/pileBeaten.spec.ts | 89 | F1 |
| tests/e2e/pileHandoff.spec.ts | 55 | F1 |
| tests/e2e/playedRound.spec.ts | 316 | F1, F7 |
| tests/e2e/playwright.config.ts | 118 | F4, F5 |
| tests/e2e/playwright.parity.config.ts | 11 | F4 |
| tests/e2e/playwright.perf.config.ts | 14 | clean |
| tests/e2e/profileSignedOut.spec.ts | 145 | F2 |
| tests/e2e/reconnect.spec.ts | 148 | F8 |
| tests/e2e/reducedMotionWobbleReset.spec.ts | 85 | F9 |
| tests/e2e/reorderHand.spec.ts | 245 | F2, F7 |
| tests/e2e/resultActions.spec.ts | 92 | F3 |
| tests/e2e/resultCutout.spec.ts | 118 | F2, F3, F8 |
| tests/e2e/rulesScroll.spec.ts | 79 | clean |
| tests/e2e/seatFans.spec.ts | 231 | F2, F10 |
| tests/e2e/seatNameContrast.spec.ts | 239 | F8 |
| tests/e2e/seatsDoNotMove.spec.ts | 96 | clean |
| tests/e2e/smokeFlowCopy.spec.ts | 74 | clean |
| tests/e2e/startAnnouncement.spec.ts | 145 | F1 |
| tests/e2e/tableFit.spec.ts | 405 | F6, F8 |
| tests/e2e/tableMoments.spec.ts | 199 | F3, F9 |
| tests/e2e/tableProportions.spec.ts | 172 | F8 |
| tests/e2e/tableUnmount.spec.ts | 57 | clean |
| tests/e2e/tapTargets.spec.ts | 472 | F3 |
| tests/e2e/tapTargetsOnlineRound.spec.ts | 39 | clean |
| tests/e2e/tapTargetsVotes.spec.ts | 64 | clean |
| tests/e2e/throwLeavesTheFan.spec.ts | 33 | clean |
| tests/e2e/tutorialSkip.spec.ts | 40 | F2 |
| tests/e2e/webFonts.spec.ts | 97 | clean |
| tests/e2e/webPerf.spec.ts | 258 | F7 (otherwise leave-alone: perf tier, own config) |
| tools/loop/tests/agentCheckDelegation.test.ts | 72 | F17 |
| tools/loop/tests/agentCheckSubject.test.ts | 275 | clean |
| tools/loop/tests/brief.test.ts | 251 | F17 |
| tools/loop/tests/ciVerdict.test.ts | 548 | F12 |
| tools/loop/tests/claim.test.ts | 117 | F12 |
| tools/loop/tests/cli.test.ts | 138 | F17 |
| tools/loop/tests/decide.test.ts | 455 | F14, F18 |
| tools/loop/tests/deleteBranchOnMerge.test.ts | 17 | F16 |
| tools/loop/tests/guardAgentModel.test.ts | 148 | clean |
| tools/loop/tests/guardBash.test.ts | 721 | clean |
| tools/loop/tests/guardWrite.test.ts | 36 | clean |
| tools/loop/tests/helpers/clearLoopEnv.mjs | 6 | clean |
| tools/loop/tests/helpers/ledgerFixture.ts | 16 | clean |
| tools/loop/tests/helpers/probeFixtureRace.mjs | 51 | clean (knip "unused file" is a false positive) |
| tools/loop/tests/helpers/probeFixtures.mjs | 76 | F11 |
| tools/loop/tests/incrementalTypecheck.test.ts | 68 | clean |
| tools/loop/tests/land.test.ts | 338 | clean |
| tools/loop/tests/lintCache.test.ts | 49 | clean |
| tools/loop/tests/lockDrift.test.ts | 144 | F12, F15, F18 |
| tools/loop/tests/loopCost.test.ts | 361 | clean |
| tools/loop/tests/loopDerive.test.ts | 988 | F12, F13, F18 |
| tools/loop/tests/loopDocsAreExecutable.test.ts | 353 | F17, F18 |
| tools/loop/tests/loopGate.test.ts | 757 | F12, F13, F19 |
| tools/loop/tests/loopHoldSurvives.test.ts | 38 | F18, F19 |
| tools/loop/tests/loopLogs.test.ts | 834 | leave-alone: pure with injected fs, golden fixtures |
| tools/loop/tests/loopRender.test.ts | 824 | F15 |
| tools/loop/tests/loopSession.test.ts | 246 | clean |
| tools/loop/tests/loopSettings.test.ts | 39 | clean |
| tools/loop/tests/loopStatus.test.ts | 114 | clean |
| tools/loop/tests/loopStream.test.ts | 732 | leave-alone: pure parser tests |
| tools/loop/tests/loopTestEnv.test.ts | 68 | clean |
| tools/loop/tests/mainHealth.test.ts | 445 | F12 |
| tools/loop/tests/nextTicket.test.ts | 417 | F18 |
| tools/loop/tests/pruneWorktreesLinks.test.ts | 78 | clean |
| tools/loop/tests/queueLoop.test.ts | 1646 | F12, F14, F15 |
| tools/loop/tests/queueLoopMain.test.ts | 2422 | F14, F15 |
| tools/loop/tests/reap.test.ts | 495 | F16, F17 |
| tools/loop/tests/runLoop.test.ts | 16 | F18 |
| tools/loop/tests/settleReplay.test.ts | 966 | F12, F13 |
| tools/loop/tests/shell.test.ts | 34 | clean |
| tools/loop/tests/ticker.test.ts | 688 | F15 |
| tools/loop/tests/tracker.test.ts | 62 | leave-alone: fake/real adapter parity, the model for F12 |
| tools/loop/tests/verdictSeam.test.ts | 98 | leave-alone: exhaustive walk with a floor |
| tools/loop/tests/workspace.test.ts | 544 | F12, F19 |
| tools/loop/tests/worktreeRemoveCommand.test.ts | 320 | F19 |
