# 08-tests-rules-tooling — slice review (SRC 50144087)

The slice is 230 files: 132 in tests/tooling and 98 in tests/ui-rules. Every file was read in full.

In the coverage table, `F#` means `08-tests-rules-tooling-F#`.

The main finding: most of the decoy risk sits in about 25 scans, and the repo's eslint config can already express them.
- eslint.config.js already ships `@typescript-eslint/no-restricted-imports` (:84-96, :153-171), `no-restricted-syntax` driven by selectors (:137, :164) and `no-restricted-properties` (:138-146).
- noticePaintLint and spacingLint already show how to test a lint rule against the selectors that ship.
- So moving these scans to lint needs no new infrastructure. It only needs the rules written down.

## Findings

### 08-tests-rules-tooling-F1 (P1, M) Reduced motion is guarded by four overlapping text scans; a motion seam would replace them
- **files:**
  - tests/ui-rules/reducedMotion.test.ts:
    - :45-74 decides from the whole file, via `includes("usePrefersReducedMotion")`.
    - :77-79 has its own `stripComments`, which is not string-aware.
    - :119 `CONSULTS_PREFERENCE = /\breduced\b/` matches inside a string literal.
    - :177 `ungatedLayoutAnimations` uses `includes("reduceMotion")`.
  - tests/ui-rules/infiniteAnimations.test.ts:66 accepts `src.includes("cancelAnimation(name)")` anywhere in the file, and strings are not blanked.
  - tests/ui-rules/withDelayReduceMotion.test.ts (a TS AST check, and sound).
  - tests/ui-rules/answeredMotionOptsOut.test.ts.
- **problem:** Calls to Reanimated's `withTiming`, `withRepeat` and `withDelay` are scattered through components. Four tests then search the text for evidence that each call site consulted the reduce-motion preference or cancels on unmount.
  - Two of the four pass on proximity alone. A comment or string that mentions `reduced` or `cancelAnimation(name)` satisfies them (decoy class).
  - The rule "every animation respects reduced motion" has no single owner. The tests are where it is written down.
- **proposed:** A deep motion module (e.g. `lib/motion.ts`) that owns the vendor calls. Candidate interface:
  - `timing(to, step, reduce: boolean)`
  - `delayed(ms, anim)`, which always passes `ReduceMotion.System`
  - `useLoop(sv, anim)`, which owns `cancelAnimation` on unmount
  Add `no-restricted-imports` of `withTiming`, `withRepeat` and `withDelay` from `react-native-reanimated` everywhere except that module, reusing the `paletteLayers` style at eslint.config.js:153-156.
- **effect:**
  - infiniteAnimations and withDelayReduceMotion are deleted.
  - Most of reducedMotion is deleted.
  - answeredMotionOptsOut becomes a check of the seam's one branch.
  - The decoy class leaves this area.
  - Native tests of the components are unaffected.
  - motionMs (lib/tokens.ts:658) returns `number`, so the seam has to take the reduce flag explicitly. That is a real API change, which is why this is M and not S.
- **overlap:** extends tests-T6 (the "vendor-API decisions" row).
- **confidence:** medium (the shape of the seam is a proposal; the decoy holes at reducedMotion:119 and infiniteAnimations:66 were verified).

### 08-tests-rules-tooling-F2 (P2, M) About 25 forbidden-API and forbidden-shape scans are lint rules the config can already express
- **files**, each with the rule that replaces it:
  - **Imports** (`@typescript-eslint/no-restricted-imports` with `importNames`):
    - orientation.test.ts:65-87,131-156 hand-parses RN `Modal` imports → ban `Modal` from `react-native` outside components/AppModal.tsx. Its parser and the parser's planted test go with it.
    - workletScheduling.test.ts:27-38 scans for `runOnJS` → ban `runOnJS` from reanimated/worklets. The file's header (:4-6) says the scan exists because the code "lints clean"; a lint rule is the fix for that.
    - fontScaling.test.ts:37-50,74-83 scans for a bare `<Text>` in table files → ban `Text` from `react-native` in components/table/**, CardView and GameTable, except TableText.tsx.
    - flightHooks.test.ts:18-22.
    - e2eFixturesImport.test.ts.
    - assetBarrels.test.ts.
    - skiaOpaquePatch.test.ts (the import half).
  - **Syntax** (`no-restricted-syntax`):
    - intentsGoThroughSend.test.ts:12-33 → `CallExpression[callee.property.name='emit'] > Literal[value=/^(room|game):/]` outside lib/sendIntent.ts. Its `BARE_EMIT` regex works line by line (see F17).
    - motion.test.ts:71-98 (inline spring config) → `Property[key.name=/^damping(Ratio)?$/]` outside lib/tokens.ts.
    - seatLayout.test.ts:167-186 (seat identity compared by hand; a line regex over 3 files) → `BinaryExpression[operator='==='] > Identifier[name=/^(viewerSeat|mySeatIndex)$/]`.
    - layoutChildren.test.ts:33-50 (a conditionally rendered `Screen`) → a JSX selector scoped to app/**/_layout.tsx.
    - tableTextFloor.test.ts:10-24 (`FontSize.x * scale`).
    - layering.test.ts:15-22,46-52 (storage-key literals) → `Literal[value=/^@murlan_/]` outside lib/storageKeys.ts.
    - a11yProps.test.ts:28-29,174-185,246-258.
    - animatedStyle.test.ts.
    - contextSlices.test.ts:175-203.
    - onlineTableHarness.test.ts (the first test).
    - a11yLabels.test.ts and a11yOneNode.test.ts. These are JSX attribute rules and need a small local rule, or a selector over `JSXOpeningElement`.
    - flightPhysics.test.ts (the SEAT_DISC literal).
  - **Properties** (`no-restricted-properties`):
    - homeCardField.test.ts:101-104 (`Math.random` in app/index.tsx).
  - **Plain lint rules:**
    - noFocusedTests.test.ts → `jest/no-focused-tests`, or a `no-restricted-properties` on `test.only`/`describe.only`.
    - e2eFixedSleeps.test.ts → `no-restricted-properties` on `page.waitForTimeout`.
    - integrationWaitFor.test.ts.
  - **Partial:**
    - tokenRoles.test.ts. The fill-token-as-colour half could be a selector list generated at config time. Keep the zIndex hop scan.
    - motionEscapes.test.ts:1-2 claims "a rule eslint.config.js cannot see". That is false: `VariableDeclarator[id.name=/_MS$/] > Literal` sees it. The count ratchet of 21 could become counted `eslint-disable` lines.
- **problem:** Each scan re-lexes source with regexes or the hand-written lexer, and fails only in CI with no editor feedback. Many are line-level or do not blank comments and strings, so they can be decoyed (F17). The eslint infrastructure already exists, and spacingLint.test.ts shows how to pin "the selectors under test are the ones that ship".
- **proposed:**
  - Move the selectors into eslint.selectors.cjs.
  - Add one blocks entry per rule.
  - Keep one spacingLint-style test per selector file, which asserts that the shipped selector flags a planted sample.
- **effect:**
  - About 25 scan tests, or the halves named above, are deleted.
  - The rnModalImports parser, BARE_EMIT and the hand comment strippers go.
  - Violations surface in the editor.
  - The decoy and self-exemption classes shrink to the docs/CI scans.
  - Native and e2e tests are unaffected.
- **overlap:** extends tests-T6, which named workletScheduling, noFocusedTests, e2eFixedSleeps and orientation. This finding adds 20 files and a concrete selector for each. It partly contradicts T6 for fontScaling: T6 files it under "layout constants, keep", but its bare-`Text` half is an import ban.
- **confidence:** high that each is expressible (the selectors are standard esquery). Medium for a11yLabels and a11yOneNode, which need a custom rule.

### 08-tests-rules-tooling-F3 (P2, S) Import-graph rules are kept in three text scans, one of which duplicates eslint, and none catches the violations the tools found
- **files:**
  - tests/tooling/audioOwners.test.ts:13-22 is an owner table identical to eslint.config.js:25-35 (`PACKAGE_OWNERS`/`GROUP_OWNERS`).
  - tests/ui-rules/layering.test.ts:24-41 has a private `IMPORT` regex at :25 and an `UPWARD` set at :24 that omits `lib`.
  - tests/tooling/diagnosticsGate.test.ts:9-20.
  - orientation.test.ts:65-87.
  - flightHooks.test.ts:18-22.
  - e2eRunnableImports.test.ts:37-41.
  - assetBarrels.test.ts:36-38.
- **problem:**
  - The audio-owner rule has two homes. eslint enforces it for app/components/context/lib (:154). audioOwners re-derives it with moduleEdges and adds `modules/`, the one directory eslint's glob misses.
  - layering checks only `lib/ shared/ → context|components|app|server`, so it passes while `shared/protocol.ts → lib/game/gameEngine`, `lib/wire` and `lib/game/matchState`, and `shared/schema.ts → lib/game/{gameEngine,replay}`, all exist. Those are the five layer violations the inventory and dependency-cruiser both report.
  - The rule "shared is a leaf" is written nowhere that runs.
- **proposed:** Put every layer and ownership rule in one place: the eslint config, using `no-restricted-imports` patterns per glob.
  - Add `modules/**` to the client glob at eslint.config.js:154.
  - Add a `shared/**` block that bans `@/lib/**`, `../lib/**` and the client trees.
  - Add a `lib/**` block that bans the client trees and server.
  - Add a diagnostics block.
  - Alternatively, one `.dependency-cruiser.cjs`, run in CI. Only one of the two should be chosen, because two would be a second home for the rule.
  - The shared→lib ban lands red until the two misplaced types move: `TranslationKey` to shared/i18n, and the wire DTOs. Land it as the red half of that fix.
- **effect:** audioOwners (the second test) and layering's upward half are deleted. diagnosticsGate shrinks to its non-import assertions. The shared-is-a-leaf rule becomes enforced and catches the existing cycle class.
- **overlap:** confirms tests-T6 ("audioOwners duplicates eslint.config.js:25-41"). It extends the 04-lib-shared cycle finding, which would land a layer rule.
- **confidence:** high (layering:24 and eslint.config.js:154 were read; the violations are in inventory.md "Layer violations").

### 08-tests-rules-tooling-F4 (P2, S) submitEditingGuards hand-parses JSX to check a two-part contract that should be a component
- **files:** tests/ui-rules/submitEditingGuards.test.ts. The whole file, about 185 lines, parses JSX props and handler bodies. Counts are pinned at :116-117 (10 fields, 8 handlers).
- **problem:**
  - The contract is that every `onSubmitEditing` field has `editable={!busy}` and the handler returns early when busy. It is restated at every site and checked by parsing them.
  - The pinned counts go red on any honest addition, and adding to them is the reflex fix ("ratchet that loosens itself").
- **proposed:** A `<SubmitField busy onSubmit …TextInputProps>` component, or a `useGuardedSubmit(busy, fn)` hook, that applies both halves. Then add `no-restricted-syntax` on the `onSubmitEditing` attribute outside it.
- **effect:** The parser and the count pins are deleted. The double-submit bug class becomes unrepresentable. One native test of the component replaces the scan.
- **overlap:** new.
- **confidence:** medium (the seam is a proposal; the parsing and the pins were verified).

### 08-tests-rules-tooling-F5 (P2, XS) Checks that exempt themselves or carry a spare exemption
- **files:**
  - tests/tooling/rulesAreSingleSourced.test.ts:149-163. Its `git grep` excludes `":!CLAUDE.md" ":!components/CLAUDE.md" ":!server/CLAUDE.md"` "because a later, separate task owns their rewrite".
    - Verified: none of the three files in SRC mentions loops.md or TESTING.md.
    - So the exemption excludes nothing today. It has no expiry, and it would silently pass a reintroduction in exactly the files most likely to restate a rule.
  - tests/tooling/noFocusedTests.test.ts:33 skips its own file because its source contains the pattern. A string-aware `blankCommentsAndStrings` makes the skip unnecessary.
  - tests/tooling/wallClockBudgets.test.ts:31 (`rel !== SELF`).
  - tests/tooling/docReferences.test.ts:100.
- **problem:** These match the "no self-defeating safeguards" invariant (CLAUDE.md). A check that excludes the files where its subject lives reports green by not looking.
- **proposed:**
  - Delete the three pathspecs in rulesAreSingleSourced.
  - Switch noFocusedTests and wallClockBudgets to `blankCommentsAndStrings` and drop the self-filter. F2 retires noFocusedTests entirely.
  - Make the docReferences exemption name the reference it tolerates, rather than the file.
  - soakRejoinOracle:37, refusalCodesTested:255, loaderConstraintIsSingleSourced and rootScanRace:154-159 are already narrow and stated, and are the model.
- **effect:** Four exemptions go. The single-sourcing rule covers the CLAUDE.md files again.
- **overlap:** new.
- **confidence:** high for rulesAreSingleSourced and noFocusedTests; medium for wallClockBudgets and docReferences.

### 08-tests-rules-tooling-F6 (P3, S) About 40 scans re-implement the file walk, ignore .gitignore, or depend on cwd
- **files:**
  - **cwd-relative paths:**
    - auditLensPaths:7, docReferences:14,17-21,97, edgePixels:61, entry:21
    - integrationPorts:9-10, integrationWaitFor:27-29, issueReadsAreTrusted:17,21
    - probeHealth:10, rulesAreSingleSourced:17-25, relatedTests:59,64
    - lampRig:266-277 (relative `ROOTS` through `readdirSync`)
  - **Hand `readdirSync` walkers instead of `sourcesUnder`/`trackedFiles`:**
    - fontScaling:29-34, hooksLint:50-56, i18n:33-41,822-829, infiniteAnimations:11-15
    - keyboardAvoidance:21-30, layoutChildren:26-30, motion:72-80, orientation:22-31
    - reactCompiler:104-109,386-391, reducedMotion:22-30, tableTextFloor:19, tokenRoles:55-64
    - workletCallees:14-22, workletScheduling:15-23
    - a11yLabels:20-28, a11yOneNode:61-69, a11yProps:18-26, animatedStyle:26-34
    - contrast:93, flightHooks:18-22, contextSlices
    - assetBarrels:36-38, ciScope:78-80,101, e2eRunnableImports:37-41
    - noDockerHubPulls:9-23, onlineTableHarness:27-35, postgresImage:9-15, skiaOpaquePatch:81-86
    - soakRejoinOracle:29-44, testHangs:119-123, timerEnvIsLive:98, wallClockBudgets:25-34
  - **Hand comment strippers:** contextSlices:192-194, noDockerHubPulls:61, reducedMotion:77-79.
- **problem:**
  - Each walker makes its own decision about which files count. A raw `readdirSync` reads untracked scratch, build output and `.claude/worktrees` checkouts.
  - The cwd-relative paths pass only when jest runs from the repo root.
  - Layering's private `IMPORT` regex (:25) duplicates moduleEdges.
- **proposed:** Use one walk, `trackedFiles(repoRoot, …pathspec)` or `sourcesUnder`, and one stripper, `blankComments(AndStrings)`. Resolve every path from `import.meta.url`. intentsGoThroughSend:15 (git ls-files), layering (trackedFiles) and withDelayReduceMotion (sourcesUnder plus the AST) already do this.
- **effect:** About 40 private walkers and 3 strippers are deleted. Every scan agrees on the file set. Many of these files go anyway under F1-F3.
- **overlap:** extends tests-T6 (13 private import regexes).
- **confidence:** high (each line was read). The note on reactCompiler:27-31 running git with no cwd is medium, since git resolves upward.

### 08-tests-rules-tooling-F7 (P3, S) Workflow YAML is parsed with regexes on the false premise that there is no YAML parser
- **files:**
  - **False comments:** androidFlowMarker:9-11, gameTableTapSettle:14-16, realAppNotExpoGo:45-47. All say there is no YAML parser, but `yaml` is a direct dependency (package.json:124).
  - **Regex YAML parsing:**
    - ciJobTimeouts:12-22, iosShards:16-36, iosAppCache, deviceWorkflowsRun
    - androidApkReuse (`step()`), e2eBudget:77, nativeBudget:107,121, e2eShardSplit:23
    - ciSkipGuards, realAppNotExpoGo (installStep/flowBody), noDockerHubPulls (`YAML_IMAGE`)
- **problem:** Indentation-sensitive regexes break on harmless reformatting, and the false comments stop anyone from fixing them ("a premise in prose decays").
- **proposed:** One `tests/helpers/workflow.ts`: `loadWorkflow(name) → { jobs: Record<string, {steps, timeout-minutes, …}> }` built on `yaml`. Then delete the three false comments.
- **effect:** About 13 private parsers go. Step lookup becomes structural.
- **overlap:** extends tooling-F8 (ci.yml regex-parsed bash out of YAML).
- **confidence:** high.

### 08-tests-rules-tooling-F8 (P2, S) E2E build flags are read from `process.env` at about 15 sites and pinned by literal-text tests
- **files:**
  - e2eBotSuspend.test.ts and e2eRealExchange.test.ts are near-duplicate files.
  - e2eOpenerWiring.test.ts:13-28, exchangeE2EHold.test.ts:84-102, e2eBuildMark.test.ts:11-23.
  - reducedMotion.test.ts:249-278 (the `EXPO_PUBLIC_E2E_REDUCE_MOTION` setter).
- **problem:** `EXPO_PUBLIC_E2E_*` and the derived E2E_FAST decision are computed at each reader. The tests pin the literal text of each reader instead of one definition.
- **proposed:**
  - `lib/e2eFlags.ts` exports `const E2E = { fast, botSuspend, realExchange, reduceMotion } as const`, with each key a literal `process.env.EXPO_PUBLIC_E2E_X === "1"` so Metro can inline it.
  - Add `no-restricted-syntax` on `MemberExpression[object.property.name='env'][property.name=/^EXPO_PUBLIC_E2E_/]` outside that file.
- **effect:** The two duplicate tests merge into one table test. Three literal-pin tests are deleted. A flag cannot be read two ways.
- **overlap:** extends tooling-F4 (env as a hidden interface).
- **confidence:** medium (the reader count is from grep; it was not re-counted at SRC).

### 08-tests-rules-tooling-F9 (P3, XS) HOLD_MS lives in two places and a test keeps them equal
- **files:** tests/tooling/e2eRealPresses.test.ts:185-199. It pins components/table/hand.tsx HOLD_MS against tests/e2e/helpers/press.ts.
- **problem:** One fact has two homes, and a text scan is the bridge.
- **proposed:** Export it once (e.g. from lib/tokens.ts, or hand.tsx's model module) and have press.ts import it. Playwright helpers can import TS consts.
- **effect:** The test is deleted.
- **overlap:** new.
- **confidence:** high.

### 08-tests-rules-tooling-F10 (P2, M) Literal-line pins: tests that go red on unrelated edits and green on a moved bug
- **files:**
  - touchTargets.test.ts:331-391. It pins `minHeight: physicalTouchTarget(scale)`, `style={reach("roundVote", scale)}`, `const maxVisible = isLandscape ? 2 : 3;`, `const knobSize = physicalTouchTarget(scale)`, and counts == 2 for `size={actionBtn}` and `width: size, height: size`.
  - tableFrame.test.ts:88-97 (`topPad={frame.tableTop}` count == 2).
  - tableProportions.test.ts:111-114 (`bottom: frame.surplus,`).
  - layoutChildren.test.ts:62-75 (the exact `<Stack.Protected guard={captureEnabled()}>` and the CaptureScreen prologue).
  - renameCopy.test.ts:84-91 (`catch[\s\S]{0,120}setError\(serverErrorMessage\(`). Its own :78-83 says nothing can drive it (#523).
  - orientation.test.ts:169-176 (the lockAsync LANDSCAPE regex).
  - gameTableVeil.test.ts:100-128,152-198. It reads GameTable children by exact indentation (`^ {6}<Animated\.View style=\{\[styles\.kick`, `^ {8}`).
  - flightPhysics.test.ts:515-520,747-751,798-816,825-834. pileFlinch already covers the behaviour.
  - homeCardField.test.ts:101.
  - lampRig.test.ts:273-278 (the literal numbers `(457|712|202)\s*,\s*(292|196|116)`).
  - blockingOverlays.test.ts (the NON_MODAL_OVERLAYS list).
  - contrast.test.ts:304.
  - onlineTableHarness.test.ts:80-115.
  - refusalCodesTested.test.ts.
  - tests/tooling/iosDevice.test.ts.
- **problem:** Each pins the spelling of a line, not the behaviour it stands for ("a counterfactual anchored on a literal line"). A reformat goes red. The same bug written differently, or in a sibling file, stays green.
  - gameTableVeil's indentation coupling is the most brittle: a wrapper `View` breaks it.
- **proposed:**
  - For geometry pins (touchTargets, tableFrame, tableProportions): assert on the computed layout (the pure frame/geometry functions these tests already import elsewhere) or on rendered props in a native test.
  - For layoutChildren and orientation: render the route tree.
  - For flightPhysics: delete the four literal pins that pileFlinch covers.
  - Keep gameTableVeil and blockingOverlays as a11y registries, but match on a `testID`/`role` attribute through `jsxTags`, not on indentation.
- **effect:** About 30 brittle assertions go or become behaviour tests. Fewer false reds after table refactors (cf. #1602 extracting from GameTable).
- **overlap:** extends tests-T6 ("behaviour by proximity").
- **confidence:** high for brittleness. Medium for "pileFlinch covers it" and for refusalCodesTested/iosDevice.

### 08-tests-rules-tooling-F11 (P3, XS) Duplicate fixtures inside the slice
- **files:**
  - **mulberry32 copied five times:** bombFx:7, coneRain:8, particles:18, roundMotes:6, trick:20. The canonical copy is tests/engine/helpers.ts:73.
  - **Three sRGB→linear implementations with different thresholds:** contrast:20-45 (0.04045), cosmetics:19-26 (0.03928), suitColours:20-21 (0.04045).
  - **Three scans over one fact (the Postgres image):** postgresImage, postgresMajor and noDockerHubPulls.
  - **fakeGh fakes duplicated** in budgetGate.
  - contrast:98-123 hand-parses `StyleSheet.create`, where `styleSheetEntries` exists in sourceScan.ts.
- **problem:** Copies drift. The 0.03928 vs 0.04045 split already means two contrast tests disagree at the boundary.
- **proposed:**
  - Import mulberry32 from tests/engine/helpers.ts.
  - Move a single `relativeLuminance` to tests/helpers, or to lib if the app needs it.
  - Merge the three Postgres checks into one test.
  - Reuse `styleSheetEntries`.
- **effect:** About 80 lines go. One WCAG formula remains.
- **overlap:** extends tests-T7.
- **confidence:** high.

### 08-tests-rules-tooling-F12 (P3, M) Registry and harness facts checked by scans where a typed table would carry them
- **files:**
  - harnessChannels.test.ts, integrationPorts.test.ts, e2eSentinels.test.ts.
  - soakRejoinOracle.test.ts (it reaches the private `Seat.socket`).
  - soakInvariants.test.ts:25-26, soakGateBudget.test.ts:53-60, soakRefusalReport.test.ts:95-110.
  - timerEnvIsLive.test.ts:28,103, contextSlices.test.ts (the slice registry).
  - cardRects.test.ts:106-110, relatedTests.test.ts:26-28.
- **problem:** Each of these is a completeness question ("every channel, port, sentinel, invariant or env timer has an entry"). It is answered by scanning text, where a `satisfies Record<Key, …>` table would answer it at compile time.
- **proposed:**
  - A per-registry `as const satisfies Record<UnionOfKeys, Spec>`.
  - For soakRejoinOracle, expose a narrow accessor rather than reading a private field.
- **effect:** About 10 scans become `tsc` errors.
- **overlap:** extends tests-T6 ("registry completeness") and tests-T5.
- **confidence:** medium (per-file payoff varies; each is small).

### 08-tests-rules-tooling-F13 (P3, S) i18n: two halves re-check facts the types already carry
- **files:**
  - tests/ui-rules/i18n.test.ts:584-601 checks locale declaration text with a regex. tsc already enforces this through `Record<keyof typeof en, string>`.
  - :636-680 harvests codes with regexes (`code: "X"`, `return "X";`, `payload("X"`). Its own comment at :663-666 says ServerCode is already checked at compile time.
  - :691-713 checks that a line containing `"game:rejoin_failed"` occurs exactly once.
- **problem:** The regex halves duplicate the type check, and anything that spells the code differently decoys them.
- **proposed:**
  - Make `payload(code: ServerCode)`, with `ServerCode = keyof typeof en.server`, the only constructor. Then delete :584-601 and :636-680.
  - Turn the rejoin count into a behaviour assertion.
  - Keep the rest of the file, which already uses the TS AST.
- **effect:** About 120 lines go.
- **overlap:** extends tests-T6.
- **confidence:** medium.

### 08-tests-rules-tooling-F14 (P3, S) Slow tests that could be cheaper
- **files:**
  - soundAssets: `readMp3` re-reads and decodes per test. Memoise it.
  - benchGates, importShellGuard, processGuards, ciSkipGuards, testHangs, preflightMemoryIsWired: these spawn processes.
  - cardArt, and lampShape (CanvasKit).
- **Accepted as they are:** oneClock and seatLayoutTakesNoCount (a full `ts.createProgram`), reactCompiler (`npm ls` plus Babel), frameCallbackIdentity and hooksLint.
- **problem:** These dominate the ui-rules/tooling wall time. Only soundAssets has a free fix.
- **proposed:**
  - Memoise `readMp3`.
  - Share one `ts.Program` between oneClock and seatLayoutTakesNoCount through a cached helper.
- **effect:** Measure before claiming a delta (per memory, "loop cut estimates run high").
- **overlap:** new.
- **confidence:** medium (not measured: read-only brief).

### 08-tests-rules-tooling-F15 (P3, XS) Tests that write into the repo root or leak env changes
- **files:**
  - tests/tooling/checkStrictIndexed.test.ts:16-20 writes fixture files under REPO_ROOT.
  - tests/tooling/diagnosticsPlugin.test.ts:9-15 mutates `process.env` with no `finally` restore.
- **problem:**
  - A concurrent `git add`, or the root scan, picks up the fixture. rootScanRace exists because of this class.
  - A failing assertion leaves the env changed for later tests in the same worker.
- **proposed:** Use `mkdtempSync(os.tmpdir())` and pass a root, and wrap the env change in `try/finally`.
- **effect:** Removes a flake class.
- **overlap:** new.
- **confidence:** high.

### 08-tests-rules-tooling-F16 (P3, XS) Test files export helpers that other tests import
- **files:**
  - e2eFixedSleeps, handBuiltNodeModulesPaths, musicAssets, noDockerHubPulls, noFocusedTests, a11yLabels, a11yOneNode, blockingOverlays.
  - fontScaling (`bareText` :41).
  - gameTableVeil (`rootChildren`/`RootChild` :78,100).
  - reducedMotion (`topLevelBlocks`, `ungatedAnimationBlocks`, `ungatedLayoutAnimations` :88,122,177).
  - touchTargets (`pressableBoxes` :107).
  - workletCallees (`plainCallees` :30).
- **problem:**
  - Importing a test file registers its tests in the importer as well, or runs them twice.
  - The helper's real home is unclear.
  - These are among the 498 test-only exports in the inventory.
- **proposed:** Move the shared helpers to tests/helpers/. Many go entirely under F1/F2.
- **effect:** No double-registered tests. Test files have no exports.
- **overlap:** new (inventory "exports used only by tests").
- **confidence:** high for the exports; medium for which ones have an importer.

### 08-tests-rules-tooling-F17 (P2, S) Scans a decoy satisfies today
- **files:**
  - keyboardAvoidance.test.ts:73-85: `src.includes("<MenuLayout")` with comments not blanked. A comment satisfies it.
  - infiniteAnimations.test.ts:66 and reducedMotion.test.ts:119 (see F1).
  - intentsGoThroughSend.test.ts:12-33: `BARE_EMIT` is per line. `.emit(\n"room:…"` or an event held in a variable evades it.
  - renameCopy.test.ts:84-91: a 120-character window, comment-decoyable.
  - motion.test.ts:71-98: comments are not blanked.
  - seatLayout.test.ts:167-186: line-level, over 3 files only.
  - lampRig.test.ts:273-278: matches on literal numbers.
- **problem:** These go green when the guarded thing is not true, the "a source scan falls to a decoy" class.
- **proposed:**
  - F1/F2 retire most of them.
  - Until then, run each through `blankCommentsAndStrings`/`jsxTags`, and add a planted decoy sample (a comment that names the token) that must stay red.
- **effect:** Each check fails when it should.
- **overlap:** extends tests-T6.
- **confidence:** high for the comment and line-split holes, which were read in code.

### 08-tests-rules-tooling-F18 (P3, XS) Tooling-report findings confirmed from the test side
- **files:**
  - tests/tooling/awaitRun.test.ts confirms tooling-F6.
  - tests/tooling/ciScope.test.ts:78-80,101 regex-parses the scope bash from ci.yml, which confirms tooling-F8.
  - tests/tooling/deviceWorkflowsGate.test.ts pins the byte-identical device gate, which confirms tooling-F9.
- **problem / proposed:** As in tooling.md. These tests shrink or go when those land.
- **effect:** —
- **overlap:** confirms tooling-F6, tooling-F8, tooling-F9.
- **confidence:** high.

### 08-tests-rules-tooling-F19 (P3, XS) Dead or misleading leftovers
- **files:**
  - tests/tooling/gameRuleDecisions.test.ts is a one-off migration guard. Delete it once the decisions file format has settled (medium).
  - tests/ui-rules/motionEscapes.test.ts:1-2 makes a false claim that eslint cannot see the rule (F2).
  - tests/ui-rules/lampShape.test.ts:93 leaves a stray `console.log`.
- **problem / proposed / effect:** Delete or correct each.
- **overlap:** new.
- **confidence:** medium.

### Source-scan classification (tests-T6 categories), every scan in the slice

| Category | Files | Reason |
|---|---|---|
| Import ownership → `no-restricted-imports` | audioOwners, layering (upward half), diagnosticsGate, orientation (Modal), flightHooks, assetBarrels, e2eFixturesImport, e2eRunnableImports, fontScaling (Text), workletScheduling (runOnJS), skiaOpaquePatch | the fact is "X imports Y"; eslint already enforces this shape (F2, F3) |
| Forbidden API/shape → lint | noFocusedTests, e2eFixedSleeps, integrationWaitFor, intentsGoThroughSend, motion, seatLayout, homeCardField, layoutChildren (conditional Screen), tableTextFloor, layering (storage keys), a11yProps, animatedStyle, contextSlices (lint half), onlineTableHarness test 1, a11yLabels, a11yOneNode, motionEscapes, tokenRoles (fill half), flightPhysics SEAT_DISC | a syntax pattern; an esquery selector expresses it (F2) |
| Vendor → typed wrapper plus lint | reducedMotion, infiniteAnimations, withDelayReduceMotion, answeredMotionOptsOut, submitEditingGuards | every call site has to repeat a guard; the wrapper makes the guard unconditional (F1, F4) |
| Single path → typed seam | e2eRealPresses (HOLD_MS), e2eBotSuspend, e2eRealExchange, e2eOpenerWiring, exchangeE2EHold, e2eBuildMark, i18n code harvest | one fact read in several places (F8, F9, F13) |
| Registry completeness → `satisfies` | harnessChannels, integrationPorts, e2eSentinels, soakInvariants, soakGateBudget, soakRefusalReport, soakRejoinOracle, timerEnvIsLive, contextSlices (registry), cardRects, relatedTests, refusalCodesTested | "every K has an entry" (F12) |
| Behaviour by proximity → behaviour test | touchTargets literal pins, tableFrame, tableProportions, layoutChildren (Protected), renameCopy, orientation (lockAsync), flightPhysics pins, keyboardAvoidance (MenuLayout), onlineTableHarness test 2, iosDevice | asserts spelling, not behaviour (F10, F17) |
| Docs/CI → keep (fix the parser per F7) | the YAML set in F7, ciScope, ciSkipGuards, ciWorkflowsPinned, workflowsParse, workflowChainedGuards, workflowScriptPathExists, docReferences, rulesAreSingleSourced, loaderConstraintIsSingleSourced, claudeMdScope, commentShape, glossaryWords, noDockerHubPulls, postgresImage, postgresMajor, noReplitCoupling, gitleaksAllowlist, gitignoreNativeDirs, licence, lockfileRegistry, wallClockBudgets, testHangs, auditLensPaths, issueReadsAreTrusted, webPerfDoc, pointersAreTriggers, repoLayout, handBuiltNodeModulesPaths | no other place can check prose or YAML |
| Layout constants → keep | stackingIsStated, layoutConstantsPinned, blockingOverlays, gameTableVeil, touchTargets (registry half), tokenRoles (zIndex hop), lampRig (one-lamp scan) | the fact is a layout relation; move to jsxTags/AST matching (F10) |
| Keep as they are (accepted or already typed) | reactCompiler, hooksLint (ADR-0005); oneClock, seatLayoutTakesNoCount, workletCallees, i18n remainder (TS AST); noticePaintLint, spacingLint (lint self-tests); frameCallbackIdentity (compiled output) | already deep, or accepted by an ADR |

## Prior findings that are wrong or already fixed
- **tests-T6, frameCallbackIdentity:** T6 files it under "typed wrapper plus a lint ban". It reads compiled output (the Babel/React Compiler transform of each caller), which neither a wrapper nor a lint rule sees. Keep it. This contradicts T6 for that file only.
- **tests-T6, fontScaling:** T6 files it under "layout constants, keep". Its bare-`Text` half is an import ban (F2); only the scale-floor half is a layout constant.
- **tests-T6, citation:** T6 cites `layering:23` for the import regex. At SRC the regex is at layering.test.ts:25. This is cosmetic drift, not a wrong finding.
- **tests-T6, audioOwners:** T6 says "audioOwners duplicates eslint.config.js:25-41". This is correct. The one thing the test adds is `modules/`, outside eslint's glob (F3).
- **Not verified wrong:** No other tests.md or tooling.md finding in this area was found wrong or already fixed at SRC. tooling-F6, F8 and F9 are confirmed (F18).

## Inventory items checked (real / false positive, one line each)
- **Layer violations shared→lib (5):** real. No test in the slice catches them, because layering.test.ts:24 omits `lib` for shared (F3).
- **Import cycle air.ts ↔ particles.ts:** real (component code). air.test and particles.test test the pure functions and are unaffected.
- **Production importing tests/engine/helpers.ts (scripts/measureHeadsUpBalance):** real. It is relevant to F11: mulberry32's canonical home is a test helper that a script also imports, so move it to lib/ or scripts/ if it becomes shared.
- **knip "undeclared canvaskit-wasm"** at bundleBudget:152, feltWeave:52, lampShape:30: real phantom dependency, which works only through hoisting.
- **knip "undeclared @typescript-eslint/parser"** at spacingLint:19: real phantom dependency.
- **knip "pwsh" unlisted binary** at shellClaims: false positive. It is a system shell, and the test is local-only.
- **Exports used only by tests (498):** real for the test-file exports in F16.
- **jscpd test clones:** none of the reported clones is in this slice. The tableCardRects/tableCardShadows clone is in tests/native, not ui-rules cardRects/cardShadows.
- **Functions ≥80 lines / largest modules:** no slice file is listed.

## Coverage

`F#` = `08-tests-rules-tooling-F#`. Paths and line counts come from slices/08-tests-rules-tooling.txt and all08.txt.

| file | lines | verdict |
|---|---|---|
| tests/tooling/analyzeMaestroRun.test.ts | 99 | clean |
| tests/tooling/androidApkReuse.test.ts | 87 | F7 |
| tests/tooling/androidFlowMarker.test.ts | 407 | F7 |
| tests/tooling/appVersions.test.ts | 67 | clean |
| tests/tooling/assertNotE2EFast.test.ts | 42 | clean |
| tests/tooling/assetBarrels.test.ts | 107 | F2 F3 F6 |
| tests/tooling/audioApiPatch.test.ts | 19 | clean |
| tests/tooling/audioLibraries.test.ts | 31 | clean |
| tests/tooling/audioOwners.test.ts | 51 | F3 |
| tests/tooling/auditLensPaths.test.ts | 22 | F6 |
| tests/tooling/awaitArtifact.test.ts | 81 | clean |
| tests/tooling/awaitRun.test.ts | 81 | F18 |
| tests/tooling/benchGates.test.ts | 168 | F14 |
| tests/tooling/botProgress.test.ts | 71 | clean |
| tests/tooling/budgetGate.test.ts | 159 | F11 |
| tests/tooling/bundleBudget.test.ts | 155 | clean |
| tests/tooling/bundleRoutes.test.ts | 149 | clean |
| tests/tooling/captureStates.test.ts | 209 | clean |
| tests/tooling/cardArt.test.ts | 35 | F14 |
| tests/tooling/checkStrictIndexed.test.ts | 139 | F15 |
| tests/tooling/ciGate.test.ts | 84 | clean |
| tests/tooling/ciJobTimeouts.test.ts | 41 | F7 |
| tests/tooling/ciScope.test.ts | 159 | F6 F18 |
| tests/tooling/ciSkipGuards.test.ts | 206 | F7 F14 |
| tests/tooling/ciWorkflowsPinned.test.ts | 89 | clean |
| tests/tooling/clampTimings.test.ts | 30 | clean |
| tests/tooling/claudeMdScope.test.ts | 43 | clean |
| tests/tooling/commentShape.test.ts | 49 | clean |
| tests/tooling/deviceWorkflowsGate.test.ts | 67 | F18 |
| tests/tooling/deviceWorkflowsRun.test.ts | 79 | F7 |
| tests/tooling/devStackPort.test.ts | 221 | clean |
| tests/tooling/diagnosticsGate.test.ts | 56 | F3 |
| tests/tooling/diagnosticsPlugin.test.ts | 16 | F15 |
| tests/tooling/diagnosticsVerdict.test.ts | 314 | clean |
| tests/tooling/dockerEngine.test.ts | 120 | clean |
| tests/tooling/docReferences.test.ts | 118 | F5 F6 |
| tests/tooling/e2eBotSuspend.test.ts | 49 | F8 |
| tests/tooling/e2eBudget.test.ts | 132 | F7 |
| tests/tooling/e2eBuildMark.test.ts | 62 | F8 |
| tests/tooling/e2eFixedSleeps.test.ts | 177 | F2 F16 |
| tests/tooling/e2eFixturesImport.test.ts | 64 | F2 |
| tests/tooling/e2eGlobalTimeout.test.ts | 20 | clean |
| tests/tooling/e2eOpener.test.ts | 26 | clean |
| tests/tooling/e2eOpenerWiring.test.ts | 44 | F8 |
| tests/tooling/e2ePort.test.ts | 117 | clean |
| tests/tooling/e2eRealExchange.test.ts | 49 | F8 |
| tests/tooling/e2eRealPresses.test.ts | 205 | F9 |
| tests/tooling/e2eRunnableImports.test.ts | 157 | F3 F6 |
| tests/tooling/e2eSentinels.test.ts | 242 | F12 |
| tests/tooling/e2eShardSplit.test.ts | 291 | F7 |
| tests/tooling/e2eTimings.test.ts | 112 | clean |
| tests/tooling/edgePixels.test.ts | 77 | F6 |
| tests/tooling/emulatorDisplayOverride.test.ts | 149 | clean |
| tests/tooling/entry.test.ts | 62 | F6 |
| tests/tooling/exchangeE2EHold.test.ts | 148 | F8 |
| tests/tooling/feltPixels.test.ts | 102 | clean |
| tests/tooling/findNativeCrash.test.ts | 126 | clean |
| tests/tooling/fontSubset.test.ts | 64 | clean |
| tests/tooling/gameRuleDecisions.test.ts | 47 | F19 |
| tests/tooling/gameTableTapSettle.test.ts | 91 | F7 |
| tests/tooling/gitignoreNativeDirs.test.ts | 17 | clean |
| tests/tooling/gitleaksAllowlist.test.ts | 25 | clean |
| tests/tooling/glossaryWords.test.ts | 132 | clean |
| tests/tooling/handBuiltNodeModulesPaths.test.ts | 198 | F16 |
| tests/tooling/harnessChannels.test.ts | 74 | F12 |
| tests/tooling/iconSubset.test.ts | 185 | clean |
| tests/tooling/importShellGuard.test.ts | 88 | F14 |
| tests/tooling/integrationPorts.test.ts | 20 | F6 F12 |
| tests/tooling/integrationWaitFor.test.ts | 31 | F2 F6 |
| tests/tooling/iosAppCache.test.ts | 71 | F7 |
| tests/tooling/iosDevice.test.ts | 100 | F10 |
| tests/tooling/iosShards.test.ts | 155 | F7 |
| tests/tooling/iosWall.test.ts | 80 | clean |
| tests/tooling/issueReadsAreTrusted.test.ts | 32 | F6 |
| tests/tooling/lampVariantsGate.test.ts | 69 | clean |
| tests/tooling/landingSyncGate.test.ts | 35 | clean |
| tests/tooling/licence.test.ts | 54 | clean |
| tests/tooling/loaderConstraintIsSingleSourced.test.ts | 143 | leave-alone: docs/CI single-sourcing; its exemption is narrow and justified |
| tests/tooling/lockfileRegistry.test.ts | 41 | clean |
| tests/tooling/metroCacheVersion.test.ts | 36 | clean |
| tests/tooling/mockupParityPage.test.ts | 83 | clean |
| tests/tooling/musicAssets.test.ts | 121 | F16 |
| tests/tooling/nativeActPairing.test.ts | 202 | clean |
| tests/tooling/nativeBudget.test.ts | 170 | F7 |
| tests/tooling/nativeScope.test.ts | 85 | clean |
| tests/tooling/noDockerHubPulls.test.ts | 386 | F6 F7 F11 F16 |
| tests/tooling/noFocusedTests.test.ts | 36 | F2 F5 F16 |
| tests/tooling/noReplitCoupling.test.ts | 20 | clean |
| tests/tooling/oneAudioMock.test.ts | 37 | clean |
| tests/tooling/onlineTableHarness.test.ts | 115 | F2 F6 F10 |
| tests/tooling/parityNightly.test.ts | 22 | clean |
| tests/tooling/pickSimulator.test.ts | 177 | clean |
| tests/tooling/pointersAreTriggers.test.ts | 67 | clean |
| tests/tooling/postgresImage.test.ts | 40 | F6 F11 |
| tests/tooling/postgresMajor.test.ts | 48 | F11 |
| tests/tooling/preflightMemory.test.ts | 224 | clean |
| tests/tooling/preflightMemoryIsWired.test.ts | 78 | F14 |
| tests/tooling/probeHealth.test.ts | 36 | F6 |
| tests/tooling/processGuards.test.ts | 74 | F14 |
| tests/tooling/realAppNotExpoGo.test.ts | 374 | F7 |
| tests/tooling/reanimatedSyncPropsPatch.test.ts | 49 | clean |
| tests/tooling/recycledLayoutPatch.test.ts | 49 | clean |
| tests/tooling/refusalCodesTested.test.ts | 261 | F10 |
| tests/tooling/relatedTests.test.ts | 68 | F6 F12 |
| tests/tooling/repoLayout.test.ts | 183 | clean |
| tests/tooling/rootScanRace.test.ts | 174 | leave-alone: guards the shared repo-root scan race; exemption is scoped and stated |
| tests/tooling/rulesAreSingleSourced.test.ts | 246 | F5 F6 |
| tests/tooling/seatAnchorsGate.test.ts | 121 | clean |
| tests/tooling/shellClaims.test.ts | 54 | clean |
| tests/tooling/skiaOpaquePatch.test.ts | 93 | F2 F6 |
| tests/tooling/soakAwayWindow.test.ts | 69 | clean |
| tests/tooling/soakGateBudget.test.ts | 61 | F12 |
| tests/tooling/soakInvariants.test.ts | 136 | F12 |
| tests/tooling/soakRefusalReport.test.ts | 184 | F12 |
| tests/tooling/soakRejoinOracle.test.ts | 174 | F6 F12 |
| tests/tooling/soundAssets.test.ts | 246 | F14 |
| tests/tooling/sourceScan.test.ts | 276 | leave-alone: tests the shared lexer; goes only if T6 replaces the lexer with the TS AST |
| tests/tooling/swiftUIFiltersPlugin.test.ts | 36 | clean |
| tests/tooling/testHangs.test.ts | 133 | F6 F14 |
| tests/tooling/threadGates.test.ts | 304 | clean |
| tests/tooling/timerEnvIsLive.test.ts | 115 | F6 F12 |
| tests/tooling/verifyScript.test.ts | 40 | clean |
| tests/tooling/wallClockBudgets.test.ts | 135 | F5 F6 |
| tests/tooling/webPerfDoc.test.ts | 27 | clean |
| tests/tooling/workflowChainedGuards.test.ts | 24 | clean |
| tests/tooling/workflowScriptPathExists.test.ts | 23 | clean |
| tests/tooling/workflowsParse.test.ts | 17 | clean |
| tests/tooling/workletsGovernor.test.ts | 39 | clean |
| tests/ui-rules/a11yLabels.test.ts | 106 | F2 F6 F16 |
| tests/ui-rules/a11yOneNode.test.ts | 482 | F2 F6 F16 |
| tests/ui-rules/a11yProps.test.ts | 258 | F2 F6 |
| tests/ui-rules/air.test.ts | 166 | clean |
| tests/ui-rules/animatedStyle.test.ts | 114 | F2 F6 |
| tests/ui-rules/answeredMotionOptsOut.test.ts | 155 | F1 |
| tests/ui-rules/authRedirect.test.ts | 24 | clean |
| tests/ui-rules/authUser.test.ts | 37 | clean |
| tests/ui-rules/blockingOverlays.test.ts | 243 | F10 F16 |
| tests/ui-rules/bombFx.test.ts | 83 | F11 |
| tests/ui-rules/cardFace.test.ts | 177 | clean |
| tests/ui-rules/cardGloss.test.ts | 93 | clean |
| tests/ui-rules/cardNames.test.ts | 79 | clean |
| tests/ui-rules/cardRects.test.ts | 158 | F12 |
| tests/ui-rules/cardShadows.test.ts | 271 | clean |
| tests/ui-rules/coneRain.test.ts | 119 | F11 |
| tests/ui-rules/contextSlices.test.ts | 203 | F2 F6 F12 |
| tests/ui-rules/contrast.test.ts | 490 | F6 F10 F11 |
| tests/ui-rules/cosmetics.test.ts | 160 | F11 |
| tests/ui-rules/dealPose.test.ts | 58 | clean |
| tests/ui-rules/dealSchedule.test.ts | 40 | clean |
| tests/ui-rules/dealSlots.test.ts | 85 | clean |
| tests/ui-rules/deepLink.test.ts | 37 | clean |
| tests/ui-rules/emailNudge.test.ts | 52 | clean |
| tests/ui-rules/emberPath.test.ts | 69 | clean |
| tests/ui-rules/exchangeTimeline.test.ts | 125 | clean |
| tests/ui-rules/feltWeave.test.ts | 134 | clean |
| tests/ui-rules/flightHooks.test.ts | 53 | F2 F3 F6 |
| tests/ui-rules/flightPhysics.test.ts | 1510 | F2 F10 |
| tests/ui-rules/flightPose.test.ts | 91 | leave-alone: planted-ease counterfactual anchored on a construct, asserted once |
| tests/ui-rules/foilGlint.test.ts | 76 | clean |
| tests/ui-rules/fontScaling.test.ts | 92 | F2 F6 F16 |
| tests/ui-rules/frameCallbackIdentity.test.ts | 50 | leave-alone: asserts on Babel/React Compiler output, which no lint rule or wrapper can see |
| tests/ui-rules/gameTableVeil.test.ts | 230 | F10 F16 |
| tests/ui-rules/handLayout.test.ts | 323 | clean |
| tests/ui-rules/handOrder.test.ts | 161 | clean |
| tests/ui-rules/handTurnScale.test.ts | 136 | clean |
| tests/ui-rules/homeCardField.test.ts | 104 | F2 F10 |
| tests/ui-rules/homeMenuModel.test.ts | 132 | clean |
| tests/ui-rules/hooksLint.test.ts | 285 | leave-alone: ADR-0005 accepts it; asks ESLint itself which files report (F6 walker note only) |
| tests/ui-rules/i18n.test.ts | 1235 | F6 F13 |
| tests/ui-rules/infiniteAnimations.test.ts | 70 | F1 F6 F17 |
| tests/ui-rules/intentsGoThroughSend.test.ts | 34 | F2 F17 |
| tests/ui-rules/iosGrey.test.ts | 45 | clean |
| tests/ui-rules/keyboardAvoidance.test.ts | 163 | F6 F17 |
| tests/ui-rules/ladderQueryKeys.test.ts | 15 | clean |
| tests/ui-rules/lampLegibility.test.ts | 234 | clean |
| tests/ui-rules/lampRig.test.ts | 279 | F6 F10 F17 |
| tests/ui-rules/lampShape.test.ts | 100 | F14 F19 |
| tests/ui-rules/landingCueHasNoHaptic.test.ts | 11 | clean |
| tests/ui-rules/layering.test.ts | 59 | F3 |
| tests/ui-rules/layoutChildren.test.ts | 76 | F2 F6 F10 |
| tests/ui-rules/layoutConstantsPinned.test.ts | 174 | leave-alone: layout constants (T6 keep), already on scanSources |
| tests/ui-rules/matchEnding.test.ts | 74 | clean |
| tests/ui-rules/mixPolicy.test.ts | 136 | clean |
| tests/ui-rules/motion.test.ts | 106 | F2 F6 F17 |
| tests/ui-rules/motionEscapes.test.ts | 70 | F2 F19 |
| tests/ui-rules/motionScale.test.ts | 133 | clean |
| tests/ui-rules/noticeModel.test.ts | 189 | clean |
| tests/ui-rules/noticePaintLint.test.ts | 88 | leave-alone: tests the shipped lint selectors themselves; the model the rest should follow |
| tests/ui-rules/oneClock.test.ts | 177 | leave-alone: uses the type checker, not text; the model for typed scans |
| tests/ui-rules/orientation.test.ts | 189 | F2 F3 F6 F10 |
| tests/ui-rules/ownLink.test.ts | 106 | clean |
| tests/ui-rules/particles.test.ts | 161 | F11 |
| tests/ui-rules/particleSprites.test.ts | 68 | clean |
| tests/ui-rules/playRefusalParity.test.ts | 100 | clean |
| tests/ui-rules/reactCompiler.test.ts | 475 | leave-alone: ADR-0005 accepts the suppression scans (F6 walker and F14 cost notes only) |
| tests/ui-rules/reactions.test.ts | 102 | clean |
| tests/ui-rules/reconnectDiff.test.ts | 140 | clean |
| tests/ui-rules/reducedMotion.test.ts | 279 | F1 F6 F8 F16 F17 |
| tests/ui-rules/renameCopy.test.ts | 92 | F10 F17 |
| tests/ui-rules/resultActionLabels.test.ts | 55 | clean |
| tests/ui-rules/rotateGlyph.test.ts | 25 | clean |
| tests/ui-rules/roundEnding.test.ts | 72 | clean |
| tests/ui-rules/roundMotes.test.ts | 63 | F11 |
| tests/ui-rules/scorePillGeometry.test.ts | 47 | clean |
| tests/ui-rules/scorePillStandings.test.ts | 141 | clean |
| tests/ui-rules/seatLayout.test.ts | 219 | F2 F17 |
| tests/ui-rules/seatLayoutTakesNoCount.test.ts | 256 | leave-alone: type-checker program over the real call sites; already a typed check |
| tests/ui-rules/selection.test.ts | 80 | clean |
| tests/ui-rules/sendIntent.test.ts | 112 | clean |
| tests/ui-rules/settingsContext.test.ts | 145 | clean |
| tests/ui-rules/spacingLint.test.ts | 250 | leave-alone: asserts the selectors that ship (eslint.selectors.cjs); the model the rest should follow |
| tests/ui-rules/stackingIsStated.test.ts | 158 | leave-alone: layout constants (T6 keep); line proximity is the fact checked |
| tests/ui-rules/stagedPlay.test.ts | 158 | clean |
| tests/ui-rules/straightTopRank.test.ts | 27 | clean |
| tests/ui-rules/submitEditingGuards.test.ts | 185 | F4 |
| tests/ui-rules/suitColours.test.ts | 135 | F11 |
| tests/ui-rules/tableA11y.test.ts | 217 | clean |
| tests/ui-rules/tableArc.test.ts | 160 | clean |
| tests/ui-rules/tableFrame.test.ts | 239 | F10 |
| tests/ui-rules/tableProportions.test.ts | 159 | F10 |
| tests/ui-rules/tableTextFloor.test.ts | 31 | F2 F6 |
| tests/ui-rules/tokenRoles.test.ts | 372 | F2 F6 |
| tests/ui-rules/touchTargets.test.ts | 391 | F10 F16 |
| tests/ui-rules/traceDiff.test.ts | 306 | clean |
| tests/ui-rules/traceFrameOrder.test.ts | 122 | clean |
| tests/ui-rules/trick.test.ts | 151 | F11 |
| tests/ui-rules/turnTimerUi.test.ts | 210 | clean |
| tests/ui-rules/withDelayReduceMotion.test.ts | 68 | F1 |
| tests/ui-rules/workletCallees.test.ts | 73 | F6 F16 |
| tests/ui-rules/workletScheduling.test.ts | 51 | F2 F6 |
