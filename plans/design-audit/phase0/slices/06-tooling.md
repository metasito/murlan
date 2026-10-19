# 06-tooling — slice review (SRC 50144087)

## Findings

### 06-tooling-F1 (P2, S) settle turns one transient gh error into an owner verdict
- files: tools/loop/decide.mjs:285-288, tools/loop/settle.mjs:144-148
- problem: Two cases become `verdict("owner","could not read CI")`: any single non-offline `gh` read error, and an offline error that no wake follows. So one transient 5xx parks the ticket for the owner, even though the settle machine already has a `stuck` bound that would let a retry happen.
- proposed: Make the read error a retryable state inside `settle`'s pure machine, retried until the existing `stuck` bound and only then escalated to the owner. One branch, in the module that already owns the bound.
- effect: Locality: the retry policy lives in one state table. Fewer owner escalations for noise.
- overlap: extends prior F1 (settle/decide seam); new instance
- confidence: medium-high

### 06-tooling-F2 (P3, S) queue-loop resolves paths against the cwd despite its HERE/ROOT contract
- files: tools/loop/queue-loop.mjs:89-92, :240, :269-276, :856
- problem: The HERE/ROOT comment at :89-92 says paths resolve from the script. They do not:
  - `queueLoopArgs` reads `.claude/commands/queue.md` relative to the cwd (:240).
  - `defaultStamp` reads relative paths (:269-276).
  - `git = gitAt()` uses the cwd (:856).
  
  Started from any other directory, the supervisor silently reads the wrong tree.
- proposed: Route all three through `ROOT`.
- effect: The interface matches its stated contract.
- overlap: new
- confidence: high

### 06-tooling-F3 (P3, XS) loop-gate `landable` throws when a parent is not on main
- files: tools/loop/loop-gate.mjs:152
- problem: `git merge-base --is-ancestor` exits 1 for "not an ancestor". `landable` lets that throw, so the CLI exits 2 (crash) instead of reporting "not landable".
- proposed: Treat exit 1 as false and rethrow only other codes.
- effect: The gate gives an answer instead of a crash.
- overlap: new
- confidence: high

### 06-tooling-F4 (P3, XS) loop-screen `openExternally` has no spawn error listener
- files: tools/loop/loop-screen.mjs:469-482
- problem: The detached `spawn` has no `'error'` handler, so a missing opener binary raises an unhandled error and takes the supervisor's screen down with it.
- proposed: Attach `.on('error', …)` and log.
- effect: An optional convenience can no longer kill the loop.
- overlap: new
- confidence: high

### 06-tooling-F5 (P3, XS) claim.mjs leaks its mkdtemp directory
- files: tools/loop/claim.mjs:95
- problem: The `mkdtempSync` directory is never removed, so one directory accumulates per claim.
- proposed: Remove it in a `finally` block.
- effect: Hygiene only.
- overlap: new
- confidence: high

### 06-tooling-F6 (P3, XS) wrong-model kill is SIGTERM only, with no win32 tree kill
- files: tools/loop/loop-session.mjs:349-352 (line numbers per the earlier read; the slice wc shows 122 lines, so they may refer to the session kill path reached from queue-loop.mjs)
- problem: On Windows, SIGTERM to `claude` leaves its child tree (jest workers and so on) alive. This is the class prior F5 names, and this is one more site.
- proposed: Use the same tree-kill that shell.mjs already uses elsewhere.
- effect: Kills come from one place; no orphans.
- overlap: extends prior F5
- confidence: medium

### 06-tooling-F7 (P3, XS) e2ePort kills every listener on the chosen port, not the verified pids
- files: tools/ci/e2ePort.mjs:131
- problem: `clearPort(chosen.port)` lists the port again and kills whatever is listening by then, rather than the pids the claim verified. If a peer grabs the port in between, its server is killed.
- proposed: Pass the verified pids through.
- effect: Removes a cross-worktree race.
- overlap: new
- confidence: medium

### 06-tooling-F8 (P3, XS) loop-logs ledger.record re-reads the whole ledger, which is never pruned
- files: tools/loop/loop-logs.mjs:304
- problem: Every `record` call parses the full append-only ledger, so the cost grows without bound.
- proposed: Append without reading, or prune by age.
- effect: Small; latent.
- overlap: new
- confidence: low

### 06-tooling-F9 (P3, XS) two definitions of a spec's duration
- files: tools/ci/e2e-timings.mjs:56, tools/ci/e2e-budget.mjs:65-69
- problem: One tool sums all attempts; the other takes the slowest attempt. They agree only because `playwright.config.ts:59` has `retries: 0`. The parity config has `retries: CI?1:0`.
- proposed: Make one exported `specSeconds()` and import it in both tools.
- effect: Locality. Latent until retries are turned on.
- overlap: new
- confidence: medium

### 06-tooling-F10 (P3, XS) next-ticket prints the wrong claim command, and its comment read is capped
- files: tools/loop/next-ticket.mjs:275-283, :297
- problem: `printDetail` always prints `gh issue edit --add-label in-progress`. For the implement route, queue.md prescribes `npm run queue:claim`. Separately, the comment fetch stops at `per_page=100` with no pagination.
- proposed: Print the route's own claim command, and paginate (`--paginate`).
- effect: Removes a doc/tool contradiction.
- overlap: new
- confidence: high

### 06-tooling-F11 (P3, XS) more gh calls without `--repo`
- files:
  - tools/loop/brief.mjs:47
  - tools/loop/loop-derive.mjs:349-351
  - tools/loop/settle.mjs:356, :460
  - tools/loop/next-ticket.mjs (`pr list`)
  - tools/loop/workspace.mjs:239
  - scripts/await-run.mjs:17
- problem: These sites infer the repo from the cwd remote, which is the class prior F3 names. They are additional to the sites F3 lists.
- proposed: Route them through cli.mjs's repo-pinned `gh`.
- effect: One seam owns the repo.
- overlap: extends prior F3
- confidence: high

### 06-tooling-F12 (P3, S) checks.md documents an `await-run --pr` mode that does not exist
- files: docs/agents/checks.md:103-108, scripts/await-run.mjs:34-36, tests/tooling/awaitRun.test.ts:69
- problem: The doc says that with `--pr <n>`, a passed run that is over budget also exits 1. In fact `runArgs` rejects every non-numeric argument, and the test asserts `runArgs(["--pr","7","1"]) === null`, so the command prints usage and exits 2.
- proposed: Delete the paragraph. The budget gate already covers over-budget runs.
- effect: The doc stops promising a check that runs nowhere.
- overlap: new
- confidence: high

### 06-tooling-F13 (P3, S) Maestro install and NDK pick are copied three times; only two copies are pinned
- files:
  - Maestro install: .github/workflows/ios.yml:160-179, maestro.yml:244-256, audio-soak.yml:137-142
  - NDK pick: ci.yml:529-532, maestro.yml:134-137, audio-soak.yml:34-37
  - pin: tests/…/realAppNotExpoGo.test.ts:69
- problem: `DEVICE_JOBS = [ios.yml, maestro.yml]` leaves audio-soak's Maestro version free to drift.
- proposed: Move both blocks into composite actions under `.github/actions/`, so each lives in one module. Failing that, add audio-soak.yml to `DEVICE_JOBS`.
- effect: Locality. One version bump instead of three.
- overlap: extends prior F9
- confidence: high

### 06-tooling-F14 (P3, XS) ios-device.yml's push path filter misses native inputs
- files: .github/workflows/ios-device.yml:300-307 (the paths block), scripts/ios-device.mjs
- problem:
  - The filter lists package.json, the lock, app.json, assets/images and the workflow itself.
  - It misses `modules/**` (murlan-diagnostics, murlan-audio-session, murlan-orientation), `plugins/**` (withSwiftUIFilters.js) and `patches/**`.
  - So a native change on main never rebuilds the dev-client IPA, and ios-device.mjs installs the newest successful build, which carries a stale fingerprint.
- proposed: Add the three globs.
- effect: Device runs test the code that is on main.
- overlap: new
- confidence: medium-high

### 06-tooling-F15 (P3, S) diagnostics gates restate each scenario's sample count
- files:
  - gate asserts in scripts/diagnostics-verdict.mjs: :156 (60), :174 (40), :181 (20), :191 (30), :212 (40), :223 (>= 40)
  - loop bounds in lib/diagnostics/scenarios: tapBurst.ts:17, scheduledOnset.ts:7, pulseCost.ts:23, hapticOnset.ts:21, musicSwitch.ts:10, landingSync.ts:8
- problem: Each count is written twice, so changing a scenario's iterations reds the gate for a reason unrelated to performance.
- proposed: Export a `samples` constant from each scenario and import it in the verdict. `lampVariants` already does this with `LAMP_SWAY.samples`.
- effect: One owner per count.
- overlap: new
- confidence: high

### 06-tooling-F16 (P3, XS) `HARD_FACTOR = 3` is defined three times
- files:
  - definitions: tools/ci/e2e-budget.mjs:22, tools/ci/ios-wall.mjs:8, tools/ci/native-budget.mjs:21
  - pins: e2eBudget.test.ts:86, iosWall.test.ts:49
- problem: RULES.md rule 46 states it as one owner ruling, but each copy has its own `<= 3` pin, so the copies can drift apart. `RATIO` already shows the right shape: one export, imported by budget-gate.
- proposed: Export it once from e2e-budget.mjs, import it in the other two, and keep a single pin.
- effect: Locality.
- overlap: new
- confidence: high

### 06-tooling-F17 (P3, XS) build-court-art `CROP` duplicates `COURT_ART_BOX`
- files: scripts/build-court-art.mjs:31, components/cardFaceModel.ts:263
- problem: The two are kept equal only by a "keep in step" comment. bake-card-art.mjs already imports from cardFaceModel.ts, so the import path exists.
- proposed: Import `COURT_ART_BOX`.
- effect: One owner.
- overlap: new
- confidence: high

### 06-tooling-F18 (P3, XS) measureHeadsUpBalance mirrors a private bot predicate, and tests import the script
- files: scripts/measureHeadsUpBalance.ts:343, lib/game/bot.ts:267-270, tests/engine/royalStraightBlindSpotHelpers.test.ts
- problem:
  - `isCertainLead` mirrors the module-private `takesTheTrick`; the two are identical today.
  - A test imports the predicate from the script.
  - The script in turn imports tests/helpers/offlineMatch.ts and tests/engine/helpers.ts.
  - So the coupling runs both ways between scripts/ and tests/.
- proposed: Export `takesTheTrick` from bot.ts and use it in both places.
- effect: The test checks the real predicate, and one dependency direction goes away.
- overlap: new (inventory "production importing tests")
- confidence: high

### 06-tooling-F19 (P3, XS) diagnostics collector port 5099 is a literal in three places
- files: lib/diagnostics/recorder.ts:24, scripts/diagnostics-collector.mjs:34, scripts/ios-device.mjs:338
- problem: The three literals are not tied to each other. The E2E mark, by contrast, is pinned by e2eBuildMark.test.ts:22.
- proposed: Export it once from lib and have both scripts import it, or add a pin.
- effect: Locality.
- overlap: new
- confidence: high

### 06-tooling-F20 (P3, XS) stale premises in tooling config
- files:
  - .github/workflows/ci.yml:539
  - .claude/workflows/audit.mjs:394-402
  - eas.json
  - .github/workflows/eas-build.yml
- problem:
  - ci.yml:539 says "Expo SDK 54 ships AGP 8", but package.json has expo ~57.0.25.
  - audit.mjs still requires an `expo_go_exit` schema field. Expo Go is retired, and the lens itself says to test on a build of the app.
  - eas.json sets `channel` preview/production, but there is no expo-updates dependency; its submit block holds placeholders.
  - eas-build.yml uses `eas-version: latest`, which goes against the pin policy.
- proposed: Correct the comment, drop the field, drop the channels, and pin the version.
- effect: Removes misleading premises.
- overlap: new
- confidence: high

### 06-tooling-F21 (P3, XS) `server:dev` and `server:prod` use POSIX env prefixes
- files: package.json (`server:dev`, `server:prod`), README.md:18
- problem: `NODE_ENV=x cmd` fails under npm's default cmd shell on Windows, which is the owner's machine. README.md:18 tells developers to run `server:dev`, and there is no .npmrc setting `script-shell`. Production on Linux is unaffected.
- proposed: Set NODE_ENV inside the entry point, or use `node --env-file`.
- effect: The documented dev command works on the dev machine.
- overlap: new
- confidence: medium

### 06-tooling-F22 (P3, XS) checks.md:96-97 describes the dispatch gate backwards
- files: docs/agents/checks.md:96-97, .github/workflows/ios.yml:47, maestro.yml:53
- problem: The doc says the gate refuses a dispatch off an `agent/<n>-` or `claude/<n>-` branch. The gate actually allows only those branches.
- proposed: Reword it.
- effect: Correct doc.
- overlap: new
- confidence: high

### 06-tooling-F23 (P3, S) failure reporting to the tracker is copied about four times, and two soak jobs share one issue
- files: .github/workflows/soak.yml:89-114 and :162-183, parity-nightly.yml:256-293 (per the earlier read), tools/ci/report-device-run.sh, audio-soak.yml
- problem:
  - The same "find the open labelled issue, else create it, then comment" logic is copied about four times.
  - The two soak.yml jobs share the `soak` label and its one-open-issue lookup, so offline-match failures and socket-soak failures comment on each other's issue.
  - audio-soak.yml does not report at all.
- proposed: Use report-device-run.sh, or one composite action, as the single implementation, with a per-job label or title key.
- effect: Locality. Failures land on the right issue.
- overlap: new
- confidence: high

### 06-tooling-F24 (P3, S) layer edges, import weight and a phantom `playwright`
- files: scripts/await-run.mjs:8, tools/loop/queue-loop.mjs, scripts/contextSurface.mjs:18, tools/loop/loop-derive.mjs, .github/workflows/ci.yml:144-148, scripts/build-sounds.mjs, scripts/build-court-art.mjs, tools/loop/related-tests.mjs:21
- problem:
  - await-run.mjs imports `BASH_DEFAULT_TIMEOUT_MS` from the 1706-line queue-loop.mjs.
  - contextSurface.mjs imports `WORKTREE_DIR` from loop-derive.mjs, and ci.yml:144-148 has to special-case that import.
  - related-tests.mjs imports jest.config.
  - build-sounds and build-court-art import `"playwright"`, which package.json does not declare; only `@playwright/test` is declared.
- proposed:
  - Move the two constants into tools/loop/limits.mjs, which already exists for this.
  - Import `chromium` from `@playwright/test`.
- effect: Shallower imports, and no reliance on hoisting.
- overlap: confirms prior F6; the playwright part is new
- confidence: high

### 06-tooling-F25 (P3, XS) dependency hygiene: phantom and unused packages from the phase-0 knip run
- files: package.json, jest.config.js:69, scripts/assertNotE2EFast.js:4, tools/loop/related-tests.mjs:20
- problem:
  - These are used but not declared, resolving only through hoisting:
    - `@jest/globals` (243 files)
    - `canvaskit-wasm` (tests import it directly)
    - `jest-util`
    - `@expo/env`
    - `babel-jest`
    - `playwright`
  - `@types/bcryptjs` is declared but unused, because bcryptjs 3 ships its own types.
  - The same class outside this slice: `express-serve-static-core`, `expo-keep-awake`, `eslint-plugin-react-hooks`, `@typescript-eslint/parser`.
  - Memory records the failure mode: npm install hoists, npm ci obeys the lockfile.
- proposed: Declare the phantoms as devDependencies at the hoisted versions, except `babel-preset-expo` (see Inventory), and drop `@types/bcryptjs`.
- effect: A version bump can no longer silently drop a tool.
- overlap: new (tool items)
- confidence: high

### 06-tooling-F26 (P3, XS) export lists wider than their callers
- files:
  - tools/loop/loop-stream.mjs, loop-render.mjs, loop-logs.mjs
  - tools/loop/mainHealth.ts, loop-gate.mjs (`lineResolver`), loop-derive.mjs (`currentBranch`), settle.mjs (`failingFiles`), decide.mjs (`RESUMABLE`, `handoffOf`)
  - tools/ci/e2ePort.mjs, tools/ci/analyze-maestro-run.mjs
  - scripts/iconSubsetChars.mjs, scripts/contextSurface.mjs, scripts/backupNaming.mjs
- problem: These exports are used only inside their own file, or only by tests. The interface is wider than the module's real seam.
- proposed: Trim them in passing, during the next edit to each file.
- effect: Small, narrower interfaces.
- overlap: confirms prior F10
- confidence: medium (some are test seams; keep any that a test imports)

## Prior findings that are wrong or already fixed

- **Prior F13 (cache schema duplicated): partly wrong.**
  - The schema is shared: loop-gate imports `cleanPassFor` from agent-check.
  - Only the cache path is duplicated (loop-gate.mjs:47, agent-check.mjs:179). That is an XS fix, not a schema split.
- **Prior F9 (install action): partly wrong.**
  - `.github/actions/install` already takes a required `node-version` input, so the proposal should be "give it a default from runtime.json", not "add an input".
  - The rest of F9 holds:
    - the inline install blocks (ci.yml:429-433, 519-523, 585-589, 956-975);
    - a literal Node 24 in eas-build, ios-app-cache, ios-bench, ios-device and maestro;
    - Node 22 in soak.yml:62 and :132 with no runtime.json check;
    - byte-identical gate jobs.
- **Prior F17 (`post-merge.sh` and agent model map): still true, but out of slice.**
  - `scripts/post-merge.sh` exists.
  - No slice list carries `.sh` files: `tools/ci/rebundle-*.sh`, `tools/ci/report-device-run.sh` and `.github/scripts/gitleaks-scan.sh` are also unsliced. This is a coverage gap for the coordinator.
  - `MODEL_BY_KIND` at brief.mjs:15 matches the agent frontmatter.
- **Prior F12:** not re-verified in this pass; no contrary evidence found.
- **Confirmed as written:** F1–F8, F10, F11, F14–F16, F18–F21.
  - F15: the two-dot diff at ci.yml:117.
  - F16: `db:reset` at package.json:27, guarded by reset-db.mjs:30-43.
  - F19: entry checks at ios-device.mjs:436, mockupParityPage.mjs:162, e2eBuildMark.mjs:33 and measureHeadsUpBalance.ts:556-557.

## Inventory items checked

- **Long functions: all real.**
  - loop-render `ticker` (386 lines), queue-loop `runOnce` (194), `main` (191), `realPorts` (129), loop-derive `derive` (122).
  - `runOnce` and `ticker` are the deepening candidates.
  - `realPorts` is adapter wiring and acceptable.
- **Production importing tests: real.** measureHeadsUpBalance.ts imports tests/helpers/offlineMatch.ts and tests/engine/helpers.ts (F18).
- **Layer edges: real.** scripts→tools (await-run, contextSurface) and tools→jest.config (related-tests.mjs:21) (F24).
- **Test-only export lists: real** (F26).
- **jscpd:** tools/ci edgePixels.mjs and feltPixels.mjs are a small clone. Low value; leave unless one of them changes. No other duplicated blocks touch the slice.
- **Phantom dependencies:** real, except `babel-preset-expo`.
  - `babel-preset-expo` is a false positive by policy: CLAUDE.md forbids a second copy, so it stays transitive from expo.
  - `expo-updates` (read from app.json/eas.json) is a stale-config signal (F20).
- **Unused dependencies:** `@types/bcryptjs` is real (F25). The other three are false positives:
  - `pino-pretty` is a transport string (server/http/logger.ts:83).
  - `@breezystack/lamejs` is used by build-sounds.mjs.
  - `subset-font` is used by build-fonts, build-icon-fonts and iconSubset.test.
- **Scripts with no entry point: all false positives.** Each is a documented by-hand tool, so keep it:
  - react-compiler-probe, which the reactCompiler test points to;
  - the asset regenerators build-icon-fonts, build-fonts, build-court-art, build-sounds and optimize-images;
  - reset-password, deliberately not an npm script;
  - bundle-report (docs/BUNDLE.md);
  - dev-stack (checks.md);
  - .claude/workflows/audit.mjs, run via audit.md.
- **Unused exports in tools/ and scripts/:** real but low (F26), with one exception. The `eslint.selectors.cjs` constants are a false positive: tests/ui-rules/spacingLint.test.ts:22 requires them.
- **Vendored skill:** `.claude/skills/react-native-best-practices` (Software Mansion prose).
  - Its Expo Go mentions all say "not supported, use prebuild", which is consistent with the repo.
  - Its audio guidance is react-native-audio-api, which matches ADR-0009.

## Coverage

| file | lines | verdict |
|---|---|---|
| babel.config.js | 8 | clean |
| drizzle.config.ts | 22 | clean |
| eslint.config.js | 249 | clean (selectors shared with spacingLint test) |
| eslint.selectors.cjs | 111 | clean (knip unused-export is a false positive) |
| jest.config.js | 74 | F25 (`babel-jest` phantom) |
| metro.config.js | 37 | clean |
| scripts/assertNotE2EFast.js | 21 | F25 (`@expo/env` phantom) |
| scripts/await-run.mjs | 76 | F11, F12, F24 |
| scripts/backup-db.mjs | 60 | leave-alone |
| scripts/backupNaming.mjs | 15 | F26 (minor) |
| scripts/bake-card-art.mjs | 185 | clean |
| scripts/bench-gates.mjs | 46 | clean |
| scripts/build-court-art.mjs | 104 | F17, F24 |
| scripts/build-fonts.mjs | 57 | clean (by-hand tool) |
| scripts/build-icon-fonts.mjs | 49 | clean (by-hand tool) |
| scripts/build-sounds.mjs | 218 | F24 (phantom playwright) |
| scripts/bundle-budget.mjs | 126 | leave-alone |
| scripts/bundle-report.mjs | 211 | clean (by-hand tool) |
| scripts/bundleRoutes.mjs | 68 | leave-alone |
| scripts/checkStrictIndexed.mjs | 143 | leave-alone |
| scripts/contextSurface.mjs | 138 | F24, F26 |
| scripts/dev-stack.mjs | 218 | clean (by-hand tool) |
| scripts/devStackPort.mjs | 138 | leave-alone |
| scripts/diagnostics-collector.mjs | 35 | F19 |
| scripts/diagnostics-verdict.mjs | 423 | F15 |
| scripts/dockerEngine.mjs | 67 | leave-alone |
| scripts/e2e-server.mjs | 101 | clean |
| scripts/e2eBuildMark.mjs | 48 | prior F19 confirmed |
| scripts/fontSubsetChars.mjs | 55 | clean |
| scripts/iconSubsetChars.mjs | 553 | leave-alone; F26 (minor) |
| scripts/ios-device.mjs | 436 | F14, F19; prior F19 confirmed |
| scripts/lib/commentShape.ts | 54 | leave-alone |
| scripts/lib/entry.mjs | 23 | leave-alone |
| scripts/lib/zipEntry.mjs | 67 | leave-alone |
| scripts/measureHeadsUpBalance.ts | 559 | F18 |
| scripts/mockupParityPage.mjs | 169 | prior F19 confirmed |
| scripts/moveSourceMaps.mjs | 37 | clean |
| scripts/optimize-images.mjs | 40 | clean (by-hand tool) |
| scripts/probe-health.mjs | 16 | clean |
| scripts/prune-backups.mjs | 76 | leave-alone |
| scripts/react-compiler-probe.mjs | 31 | clean (by-hand tool) |
| scripts/reactCompilerOptions.mjs | 50 | clean |
| scripts/reset-db.mjs | 91 | clean (prior F16 guarded) |
| scripts/reset-password.mjs | 59 | clean (deliberately not an npm script) |
| tools/ci/analyze-maestro-run.mjs | 226 | leave-alone; F26 (minor) |
| tools/ci/await-artifact.mjs | 54 | clean |
| tools/ci/budget-gate.mjs | 172 | clean |
| tools/ci/clamp-timings.mjs | 39 | clean |
| tools/ci/e2e-budget.mjs | 90 | F9, F16 |
| tools/ci/e2e-shard.mjs | 162 | clean |
| tools/ci/e2e-timings.mjs | 116 | F9 |
| tools/ci/e2eGlobalTimeout.mjs | 8 | clean |
| tools/ci/e2ePort.mjs | 135 | F7, F26 |
| tools/ci/edgePixels.mjs | 109 | small jscpd clone (leave) |
| tools/ci/feltPixels.mjs | 111 | small jscpd clone (leave) |
| tools/ci/find-native-crash.mjs | 122 | clean |
| tools/ci/gate.mjs | 31 | clean |
| tools/ci/ios-wall.mjs | 58 | F16 |
| tools/ci/native-budget.mjs | 130 | F16 |
| tools/ci/nativeScope.mjs | 66 | clean |
| tools/ci/pick-simulator.mjs | 75 | clean |
| tools/ci/preflightMemory.mjs | 153 | clean |
| tools/loop/agent-check.mjs | 254 | prior F13 (path duplication only) |
| tools/loop/brief.mjs | 131 | F11 |
| tools/loop/check-steps.mjs | 25 | leave-alone |
| tools/loop/ciVerdict.ts | 394 | leave-alone |
| tools/loop/claim.mjs | 134 | F5 |
| tools/loop/cli.mjs | 71 | leave-alone |
| tools/loop/decide.mjs | 434 | F1, F26; leave-alone otherwise |
| tools/loop/guard-agent-model.mjs | 69 | clean |
| tools/loop/guard-bash.mjs | 447 | leave-alone |
| tools/loop/guard-write.mjs | 44 | clean |
| tools/loop/land.ts | 129 | leave-alone |
| tools/loop/limits.mjs | 27 | clean (target home for F24 constants) |
| tools/loop/loop-cost.mjs | 284 | clean |
| tools/loop/loop-derive.mjs | 547 | F11, F24, F26; `derive` 122 lines |
| tools/loop/loop-gate.mjs | 287 | F3, F26; prior F13 |
| tools/loop/loop-logs.mjs | 518 | F8, F26 |
| tools/loop/loop-render.mjs | 774 | F26; `ticker` 386 lines |
| tools/loop/loop-screen.mjs | 496 | F4 |
| tools/loop/loop-session.mjs | 122 | F6 |
| tools/loop/loop-status.mjs | 115 | clean |
| tools/loop/loop-stream.mjs | 362 | leave-alone; F26 |
| tools/loop/mainHealth.ts | 263 | leave-alone; F26 |
| tools/loop/next-ticket.mjs | 318 | F10, F11 |
| tools/loop/queue-loop.mjs | 1706 | F2, F24; `runOnce`/`main`/`realPorts` long |
| tools/loop/reap.mjs | 364 | clean |
| tools/loop/related-tests.mjs | 88 | F24, F25 |
| tools/loop/run-loop.mjs | 16 | clean |
| tools/loop/settle.mjs | 547 | F1, F11, F26 |
| tools/loop/shell.mjs | 310 | leave-alone |
| tools/loop/tracker.mjs | 78 | leave-alone |
| tools/loop/workspace.mjs | 520 | F11 |
| package.json | 127 | F21, F25 |
| tsconfig.json | 28 | clean |
| app.json | 73 | clean |
| eas.json | 35 | F20 |
| .github/ISSUE_TEMPLATE/config.yml | 9 | clean |
| .github/workflows/audio-soak.yml | 171 | F13, F23 |
| .github/workflows/ci.yml | 1074 | F13, F20, F24; prior F8/F9/F15 confirmed |
| .github/workflows/eas-build.yml | 55 | F20; prior F9 |
| .github/workflows/health.yml | 26 | clean |
| .github/workflows/ios-app-cache.yml | 38 | clean (prior F9 literal Node) |
| .github/workflows/ios-bench.yml | 54 | clean (prior F9 literal Node) |
| .github/workflows/ios-device.yml | 106 | F14; prior F9 |
| .github/workflows/ios.yml | 482 | F13, F22 |
| .github/workflows/maestro.yml | 481 | F13, F22; prior F9 |
| .github/workflows/parity-nightly.yml | 110 | F23 |
| .github/workflows/soak.yml | 183 | F23; prior F9 (Node 22) |
| .github/actions/drive-android-flows/action.yml | 185 | leave-alone |
| .github/actions/install/action.yml | 25 | prior F9 corrected (input exists; add default) |
| .github/actions/ios-app/action.yml | 135 | leave-alone |
| .claude/settings.json | 39 | clean |
| .claude/agents/loop-completeness.md | 28 | clean |
| .claude/agents/loop-fix.md | 25 | clean |
| .claude/agents/loop-review.md | 35 | clean |
| .claude/agents/loop-scope.md | 19 | clean |
| .claude/commands/audit.md | 77 | clean |
| .claude/commands/queue.md | 261 | F10 (tool disagrees with it) |
| .claude/commands/triage.md | 28 | clean |
| .claude/commands/wayfinder.md | 28 | clean |
| .claude/workflows/audit.mjs | 613 | F20 |
| .claude/skills/react-native-best-practices/README.md | 108 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/SKILL.md | 24 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/animations/animation-functions.md | 168 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/animations/animations-performance.md | 189 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/animations/animations.md | 285 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/animations/canvas-animations.md | 467 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/animations/canvas-atlas.md | 89 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/animations/gpu-animations.md | 393 | leave-alone (vendored; Expo Go note consistent) |
| .claude/skills/react-native-best-practices/references/animations/layout-animations.md | 149 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/animations/scroll-and-events.md | 185 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/animations/SKILL.md | 28 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/animations/svg-animations.md | 75 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/audio/audio.md | 182 | leave-alone (vendored; matches ADR-0009) |
| .claude/skills/react-native-best-practices/references/audio/effects-and-analysis.md | 358 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/audio/playback.md | 313 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/audio/recording.md | 298 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/audio/SKILL.md | 30 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/audio/system-and-notifications.md | 418 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/audio/worklets.md | 236 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/gestures/continuous-gestures.md | 278 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/gestures/gesture-composition.md | 211 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/gestures/gestures.md | 240 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/gestures/SKILL.md | 111 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/gestures/swipeable-and-drawer.md | 155 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/gestures/tap-handling.md | 145 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/gestures/testing.md | 149 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/calling-js-and-async.md | 224 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/casting-and-serialization.md | 174 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/core-types.md | 316 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/cpp-memory-patterns.md | 169 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/debugging-and-pitfalls.md | 314 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/module-approaches.md | 336 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/overview.md | 231 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/performance.md | 137 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/setup-and-templates.md | 358 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/SKILL.md | 25 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/jsi/threading-safety.md | 108 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/multithreading/setup-and-advanced.md | 248 | leave-alone (vendored; Expo Go note consistent) |
| .claude/skills/react-native-best-practices/references/multithreading/shared-memory.md | 182 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/multithreading/SKILL.md | 77 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/multithreading/threading-api.md | 259 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/on-device-ai/llm.md | 400 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/on-device-ai/setup.md | 312 | leave-alone (vendored; Expo Go note consistent) |
| .claude/skills/react-native-best-practices/references/on-device-ai/SKILL.md | 75 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/on-device-ai/speech.md | 322 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/on-device-ai/vision.md | 440 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/rich-text/SKILL.md | 302 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/svg/SKILL.md | 17 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/svg/svg.md | 190 | leave-alone (vendored) |
| .claude/skills/react-native-best-practices/references/svg/when-to-use.md | 45 | leave-alone (vendored) |
| docs/agents/checks.md | 531 | F12, F22 |
| docs/agents/issue-tracker.md | 224 | clean |
| docs/agents/loop-audit-2026-10-12.md | 597 | leave-alone (dated record pinned to efbb5f89, cited by ADR 0010/0011) |
| docs/agents/RULES.md | 118 | clean (rule 46 constants verified; see F16) |
