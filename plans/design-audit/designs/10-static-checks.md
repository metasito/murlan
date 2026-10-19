# 10 — Static checks: source scans, test/jest/eslint config, duplicated test helpers

IDs: L-122, L-125, L-128, L-130, L-131, L-132, L-134, L-138, L-139, L-141, L-143, L-145, L-149,
L-152, L-153, L-155, L-156, L-158, L-161, L-164, L-165, L-166, L-167, L-170, L-174.
Evidence was re-read at MAIN (`a1d0ebb5`). MAIN is a snapshot, not a git checkout, so line
numbers below are MAIN's, read with `grep -n` and `sed -n`.

## 1. Summary

- **Now.** About 230 node:test files each answer "does the source have shape X?". Each one has
  its own walker (58 test files outside integration call `readdirSync` and also match `.ts`
  sources), its own stripper, and its own floor. About 20 of them ask a question an esquery
  selector answers exactly. Several of those can be fooled by a decoy (a comment, a line break,
  a string), and four of them exempt themselves (L-122).
- **After.** Every "this shape is forbidden here" rule lives in one registry,
  `eslint.guards.cjs`. Each guard there has its own `murlan/<id>` rule, its own file scope, and a
  planted sample that must fire. One floor test checks all guards against the real config. It
  also refuses any inline disable of a guard, and any block that switches a guard off.
- **After, for scans with no lint shape** (counts, cross-file facts, docs, YAML, layout
  relations): they stay as scans, but they share one walk (`trackedFiles`/`sourcesUnder`), one
  stripper (`blankCommentsAndStrings`/`jsxTags`), one YAML loader (`tests/helpers/workflow.ts`)
  and paths resolved from `import.meta.url`.
- **After, for facts held in two places** (timing constants, the e2e tier list, HOLD_MS, the
  font manifest, completeness registries): they get one home, imported by both sides, or a
  `satisfies Record<K, …>` table, so the bridging scan is deleted.
- **Why.** Most findings in this area come from one root cause: the repository has no shared
  home for a static rule, so each rule built its own. A registry with a floor makes the decoy
  class and the self-exemption class structurally impossible for everything that moves into it.
  It also gives editor feedback. And it gives later areas (L-129 layering, L-120 motion, L-066
  e2e flags) one place to add their bans.

## 2. Current shape (evidence at MAIN)

**Lint infrastructure already exists, but it is shaped for three core rules.**
- `eslint.config.js:137` and `:164`: `no-restricted-syntax` is fed selector lists.
- `:138-146`: `no-restricted-properties` (`router.back`).
- `:155-171`: `@typescript-eslint/no-restricted-imports` (audio and palette owners).
- `:82`: "A later block replaces a rule's options rather than adding to them, so this one
  restates both". The `NOTICES_DIR` block (`:161-166`) restates `TOKEN_SYNTAX` by hand to keep
  it. Any new selector added to the client block silently does not apply under
  `components/table/notices/` unless it is restated there too. That is a live trap for anyone
  extending these core rules.
- `:150-152`: the `ScreenHeader.tsx` block turns `no-restricted-properties` off wholesale for
  that file.
- The lint pin pattern exists and works:
  - `tests/ui-rules/spacingLint.test.ts` (a `Linter` with the real selectors from
    `eslint.selectors.cjs`).
  - `tests/ui-rules/noticePaintLint.test.ts:13-27` (`new ESLint({cwd: ROOT}).lintText(code,
    {filePath})`, which is the real config).
- `npm run lint` is `expo lint . --max-warnings 0` (package.json `lint`), so it covers `tests/**`
  too. `ci.yml` `lint` job (`:476-495`) runs on `app` scope, and any change outside
  `tools/loop/` sets `app`. `harness` runs `npx eslint tools/loop` (`:443`). A doc-only change
  skips lint (checks.md "The loop is a second product"), but it cannot add code.
- `eslint-plugin-jest` is not a dependency (verifier, L-122). Most test files are node:test
  anyway.
- **Inline directives today** (all of them): 5 × `eslint-disable-next-line
  @typescript-eslint/no-require-imports`:
  - `app/bench.tsx:4`
  - `app/_layout.tsx:48`
  - `lib/diagnostics/index.ts:12`
  - `lib/flushSync.web.ts:2`
  - `lib/i18n.ts:67`

  `tests/helpers/hookSuppression.ts` already parses directives through the TS scanner, so a
  string or regex cannot fool it. Both `hooksLint` and `reactCompiler` use it.

**Scans that are lint rules in disguise (L-141, L-132, L-122, L-134):**
- `tests/tooling/noFocusedTests.test.ts:33`: the walk filters out its own file, because its
  fixtures (`:20-22`) are strings that `blankComments` (`:13`) does not blank.
- `tests/ui-rules/workletScheduling.test.ts:15-23`: a private walker plus `/\brunOnJS\b/` over
  raw text. A comment that names `runOnJS` turns it red falsely.
- `tests/ui-rules/intentsGoThroughSend.test.ts:13`, `:29-31`: `BARE_EMIT` is tested line by
  line, so `.emit(\n "room:…"` passes. Comments are not blanked.
- `tests/ui-rules/motion.test.ts:71-98`: a private walker, raw `damping(Ratio)?\s*:`.
- `tests/ui-rules/seatLayout.test.ts:167-186`: a line regex over 3 named files.
- `tests/ui-rules/homeCardField.test.ts:101-104`: `!/Math\.random\(/` over raw `app/index.tsx`.
- `tests/ui-rules/orientation.test.ts` hand-parses `Modal` imports. `:169-176` pins the
  `lockAsync(…LANDSCAPE)` spelling.
- `tests/ui-rules/fontScaling.test.ts:37-50`: the `<Text|Animated.Text>` tag regex with its own
  `COMMENT` stripper. It exports `bareText` (`:41`).
- `tests/ui-rules/layoutChildren.test.ts:33-75`: a conditional `Screen` regex, and a
  whitespace-collapsed literal of `<Stack.Protected …>`.
- `tests/native/signOutClearsQueryCache.test.tsx:77-96`: `([\w.]+)\.clear\(\)` over raw text
  under jest, compared against a 4-entry list. `queryClient.clear ()` or `removeQueries()`
  passes.

**Self-exemptions (L-122):**
- `noFocusedTests.test.ts:33`.
- `tests/tooling/wallClockBudgets.test.ts:22-31`: a private walker with `rel !== SELF`, although
  it already imports `blankCommentsAndStrings` (`:19`).
- `tests/tooling/docReferences.test.ts:100`: drops its own path. Its `git ls-files` runs with no
  `cwd` (`:97-99`).
- `tests/tooling/rulesAreSingleSourced.test.ts:149-163`: excludes `CLAUDE.md`,
  `components/CLAUDE.md` and `server/CLAUDE.md`, "because a later, separate task owns their
  rewrite". None of the three names `loops.md`/`TESTING.md` today (verifier).

**Decoyable scans that have no lint shape (L-132, L-145):**
- `tests/ui-rules/keyboardAvoidance.test.ts:73-85`: `src.includes(wrapper)` on raw source.
- `tests/ui-rules/renameCopy.test.ts:84-91`: `/catch[\s\S]{0,120}setError\(serverErrorMessage\(/`
  on raw source.
- `tests/ui-rules/lampRig.test.ts:266-277`: a cwd-relative `ROOTS` walk, plus literal numbers.
- `tests/ui-rules/tableProportions.test.ts:111-114` pins the string `bottom: frame.surplus,`.
- `tests/ui-rules/tableFrame.test.ts:88-97` counts `topPad={frame.tableTop}` == 2.
- `tests/ui-rules/touchTargets.test.ts:331-391` pins seven source spellings.
- `tests/ui-rules/gameTableVeil.test.ts:100-128` keys on the indentation of `GameTable.tsx`.

**Walkers and cwd (L-131):**
- The shared helpers exist: `tests/helpers/sourceScan.ts:14-26` (`sourcesUnder`, which honours
  gitignore, used by 25 files) and `tests/helpers/trackedFiles.ts:10-17` (used by 8).
- Strippers: `blankComments` (23 users) and `blankCommentsAndStrings` (5).
- `process.cwd()` as the repo root:
  - `tests/server/appLinks.test.ts:16`
  - `tests/server/noWebBuild.test.ts:14`
  - `tests/server/sourceMaps.test.ts:13`
  - `tests/tooling/entry.test.ts:29`
  - `tests/tooling/relatedTests.test.ts:59,64`

  The integration suites' `originalCwd` save and restore is legitimate.
- `server/store/stats.ts` and `validate.test.ts:27-30` in the ledger are mis-citations (verifier).

**Facts with two homes:**
- e2e tier: the same regex sits at `tests/e2e/playwright.config.ts:50` (`testIgnore`) and
  `tests/e2e/playwright.parity.config.ts:8` (`testMatch`). It is scraped back out by
  `tools/ci/e2e-shard.mjs:48` (`/testIgnore: \/(.+)\/,$/m`) and again by
  `tests/tooling/e2eShardSplit.test.ts:35`. The config comment at `:49` says "One line:
  tools/ci/e2e-shard.mjs scrapes it" (L-128).
- `HOLD_MS`: `components/table/hand.tsx:140` and `tests/e2e/helpers/press.ts:20`, bridged by
  `tests/tooling/e2eRealPresses.test.ts:185-199` (L-149).
- Timing constants:
  - `context/OnlineGameContext.tsx:250-251` (unexported), copied in
    `tests/native/rejoinFailed.test.tsx:54-56`.
  - `components/table/pile.tsx:582` `TRICK_WINNER_MS`, copied as `HOLD_MS` in `trickClose`.
  - `lib/reconnectDelay.ts:1` `RETRY_BASE_MS`; socketReconnect pins `Math.random` (L-125).
- Fonts: `tests/tooling/fontSubset.test.ts:19-32` compares against `scripts/font-subset.json`
  and never opens `public/fonts/*.woff2`. `tests/tooling/iconSubset.test.ts:125-176` has a
  format-4 cmap reader for `.ttf` (L-139).
- YAML:
  - `yaml` is a devDependency.
  - `ciGate`, `deviceWorkflowsGate`, `parityNightly` and `workflowsParse` parse with it.
  - `androidFlowMarker.test.ts:9-11` and `gameTableTapSettle.test.ts:14-16` say "no YAML parser
    is a dependency".
  - Regex YAML in `ciJobTimeouts:12-22`, `iosShards`, `iosAppCache`, `deviceWorkflowsRun`,
    `androidApkReuse`, `e2eBudget`, `nativeBudget`, `e2eShardSplit:23-31`, `noDockerHubPulls`
    (L-166).

**Nightly-only layout guards (L-138):**
- `handParity.spec.ts` (202 lines, ~100 s, `docs/research/2026-09-25-ci-speed.md:52`) is pure
  geometry against hard-coded prototype ratios.
- `lampSeats.spec.ts`: 3 of its 4 test groups are geometry (`tracedLamp`, `seatAnchor`). Only
  `:123-140` reads `feltPixels`.
- `mockupPolish.spec.ts` opens the mockup page (`mockupAt`, `:47`), so it is parity by nature.

**Production seams the scans stand in for:**
- `tests/ui-rules/submitEditingGuards.test.ts:113-117` pins 10 handlers and 8 submitters across
  `app/(online)/friends.tsx:255`, `app/auth.tsx:177,199,220`, `app/profile.tsx:168,298,407`,
  `app/recover.tsx:90,145` and `app/verify-email.tsx:134` (L-130).
- `server/socket/payload.ts:10-14` already types `payload<C extends ServerCode>`. Rendered
  literal codes remain at:
  - `server/game/gameTurn.ts:345,375,414`
  - `server/socket/friendships.ts:180`
  - `server/http/errorHandler.ts:27`

  so `tests/ui-rules/i18n.test.ts:636-680` regex-harvests them (L-167).
- `tests/native/cardMemoComparators.test.tsx:16-22` regex-parses interface bodies to get prop
  names (L-134, L-174).

**Helpers:**
- The same `gate()` subprocess is in `tests/native/lampVariantsScenario.test.tsx:25-27` and in
  `seatAnchorsScenario.test.tsx:28-30` (L-155).
- `oneTapOneCommit.test.tsx:22-115` has 9 spy-through factories, each re-wrapping `memo.type`
  by hand (L-143).
- `tests/helpers/instance.ts:24` sets `LOG_LEVEL` (dead; `server/http/logger.ts:74` never reads
  it). Its `:31-34` give-up timer rejects without `child.kill()` (L-158).
- `scripts/measureHeadsUpBalance.ts:45-50` imports `tests/helpers/offlineMatch.ts` and
  `tests/engine/helpers.ts`, while `tests/engine/royalStraightBlindSpotHelpers.test.ts:8`
  imports back from the script (L-170).
- `tests/tooling/recycledLayoutPatch.test.ts:33-41` never asserts that `COVERED` still has the
  stale reset, unlike `reanimatedSyncPropsPatch.test.ts:16` (`DROP`) (L-161).

## 3. Alternatives considered

The central module is the home of a "forbidden shape" rule.

**A. Guard registry plus a local plugin with one rule per guard (picked).**
- `eslint.guards.cjs` exports `GUARDS: Guard[]` and a plugin whose rules are generated from them.
  Each rule's `create` returns `{ [guard.selector]: node => report }`.
- `eslint.config.js` adds one block per guard (`files`, `ignores`, `rules: {
  "murlan/<id>": "error" }`).
- One floor test drives the real config.

**B. Append to the three core rules, with option lists merged at config time.**
- New selectors join `TOKEN_SYNTAX`. Import bans join `paletteLayers`.
- A helper computes, for each block, the union of guards whose globs apply.

**C. Keep node:test scans, rebuilt on the TypeScript AST.**
- One `astScan(files, visitor)` replaces the 463-line `sourceScan.ts` lexer.
- Each scan keeps its own test and floor.

| | A: registry and plugin | B: merge into core rules | C: AST scans |
|---|---|---|---|
| Depth (interface a contributor learns) | one record: `{id, why, selector, files, ignores, plant}` | a selector plus knowing which blocks to restate it in | a visitor plus a walker plus a floor per test |
| Option-replacement trap (`eslint.config.js:82`) | gone: each guard is its own rule id, and blocks never overlap on one rule | central: glob intersections cannot be computed statically, so the merge is approximate | n/a |
| Decoy / self-exemption classes | gone for moved rules: AST matching, plus a floor that refuses inline disables and off-blocks | AST matching, but one `eslint-disable no-restricted-syntax` disables every selector at once, the token rules included | AST matching; per-test walkers still each decide the file set |
| Escape hatch | `ignores: [{glob, reason}]` in the registry is the only one; floor-checked | inline disable; it hides several unrelated rules at once | none |
| Editor feedback | yes | yes | no |
| Import semantics | selectors over `ImportDeclaration`/`ImportSpecifier`/`ImportNamespaceSpecifier`/`require()` (written per guard) | core `no-restricted-imports` handles namespace and `export … from` for free | moduleEdges already exists |
| Migration risk | new rule ids, existing core-rule config untouched | edits the live token and palette config, which spacingLint and noticePaintLint pin | rewrites ~25 kept tests that work |
| Cost per check run | lint already runs; the floor test lints ~2×N tiny snippets (noticePaintLint does 8 in seconds) | same | the test suite is unchanged |

**Pick: A for every forbidden shape; C-lite (no lexer rewrite) for what stays a scan.**
- B is rejected because it deepens the trap `eslint.config.js:82` already documents. It also
  makes one disable comment switch off many guards.
- C, done wholesale, fails the deletion test in reverse. `sourceScan.ts` serves ~25 kept scans
  (`jsxTags` 3 users, `pressableNodes`, `styleSheetEntries`, …). Replacing it would rewrite
  tests that have no named defect, and the verifier says "apply per category, not wholesale"
  (L-141).
- So the lexer stays. It shrinks only as its callers move to lint, and new kept scans use
  `moduleEdges`/TS AST.
- Existing core-rule config (token syntax, audio and palette owners, `router.back`) is left
  alone. It is pinned and working; moving it is L-129's call, and it can move into the registry
  later.

**Secondary choice: registries that are completeness questions (L-174).**
- (i) A `satisfies Record<K, Spec>` table, enforced by tsc.
- (ii) A config-time generated lint selector built from an `as const` registry.
- Pick (i) where the key union is a type, e.g. `cardMemoComparators` `VALUES satisfies
  Record<keyof CardViewProps, …>`.
- Pick (ii) where the keys are JSX attribute names, e.g. harness `dataSet` channels.
- Leave uniqueness and derived-list checks (`integrationPorts`, `timerEnvIsLive`) and
  "module has a caller" wiring pins (`soakGateBudget:53-60`, `soakInvariants:20-26`) as they
  are. Those are the "extraction with no callers" class the owner wants pinned, not a
  completeness question (verifier: "roughly half fit").

## 4. Target design

### 4.1 `eslint.guards.cjs` (repo root, CommonJS, beside `eslint.selectors.cjs`)

```ts
// Types as JSDoc in the .cjs; shown as TS for clarity.
export interface Guard {
  /** Rule id under the `murlan` plugin: `murlan/${id}`. kebab-case, unique. */
  id: string;
  /** Reported at the site. Names the owner module or doc and what to do instead. */
  why: string;
  /** esquery; several shapes joined with ", ". Must match the AST, never raw text. */
  selector: string;
  /** Flat-config globs the guard applies to. */
  files: string[];
  /** The only exemption form. Each glob must match a tracked file; reason is non-empty. */
  ignores?: { glob: string; reason: string }[];
  /** Must fire exactly `hits` times when linted as `file` under the real config. */
  plant: { file: string; code: string; hits: number };
  /** Shapes the guard must not catch (the false positive the old scan avoided), linted as `file`. */
  spare?: { file: string; code: string }[];
}
export const GUARDS: readonly Guard[];
/** ESLint plugin: one rule per guard, `create: ctx => ({ [g.selector]: node => ctx.report({ node, message: g.why }) })`. */
export const plugin: { meta: { name: "murlan" }; rules: Record<string, import("eslint").Rule.RuleModule> };
/** Flat-config blocks: `{ plugins: { murlan: plugin } }`, then one `{ files, ignores, rules: { [`murlan/${id}`]: "error" } }` per guard. */
export function guardBlocks(): import("eslint").Linter.Config[];
```

`eslint.config.js` changes in three places:
1. It appends `...guardBlocks()` after the existing blocks.
2. It adds `linterOptions: { reportUnusedDisableDirectives: "error" }`.
3. Nothing else.

**Invariants a contributor must know:**
- A guard is the whole rule. There is no per-site exemption. An inline
  `eslint-disable[-next-line|-line] murlan/…`, and a bare `/* eslint-disable */` anywhere, is
  red in the floor test.
- A legitimate exception is an `ignores` entry with a reason, reviewed in the registry diff.
- `plant.file` must be inside `files` and outside `ignores`, or the plant tests nothing.
- The `files` globs must match at least one tracked file under the real config. Otherwise the
  guard watches a directory that moved.
- No config block may set a `murlan/*` rule to `off`, `warn`, `0` or `1`.
- Selectors are AST-only. A selector that matches a `Literal` value carries a `spare` showing
  that a comment or an unrelated string naming the token does not fire.

**Error modes:**
- A violation shows in `npm run lint` and in the editor, with `why`.
- A broken selector (it matches nothing) fails the floor test at its `plant`. A selector that
  is too wide fails at its `spare`.
- A registry edit that weakens both the selector and its plant is visible in review, the same
  as spacingLint today (rule 6).

**Ordering:** none at runtime. In CI it runs in the `lint` job (app scope) and in `harness`
(`eslint tools/loop`). The floor test runs in `verify` (`npm test`).

### 4.2 Floor test: `tests/tooling/lintGuards.test.ts`

It uses `new ESLint({ cwd: ROOT })` (the real config, as `noticePaintLint` does),
`trackedFiles`, and `hookSuppression.directives`. It asserts:
1. For each guard: `plant` fires `murlan/<id>` exactly `hits` times, and each `spare` fires it
   zero times.
2. For each guard: `calculateConfigForFile` of at least one tracked file in `files` has the rule
   at `error`.
3. For each guard: every `ignores[].glob` matches a tracked file, and every `reason` is
   non-empty.
4. No block in the flattened config sets a `murlan/*` rule below `error`. This generalises
   `hooksLint.test.ts` `blocksTurningOff`.
5. No tracked `*.{ts,tsx,js,mjs,cjs}` carries a directive that names a `murlan/` rule or names
   no rule. `directives()` is TS-scanner based, so this one cannot be decoyed either.
6. The registry ids are unique, and every guard's `why` names a path that exists. This reuses
   docReferences' resolution.

### 4.3 Guards in this area (batch A, ticket T1)

Selectors are indicative. The builder pins each one with the old scan's own planted samples
before deleting the scan.

| id | replaces | files | selector (shape) | ignores |
|---|---|---|---|---|
| `no-focused-test` | noFocusedTests scan (L-122) | `tests/**/*.{ts,tsx}`, `tools/loop/tests/**/*.{ts,mjs}` | `MemberExpression[property.name="only"]`, `CallExpression[callee.name=/^f(it\|describe)$/]`, `CallExpression > ObjectExpression > Property[key.name="only"][value.value=true]` | none (the floor's own fixtures are strings) |
| `no-run-on-js` | workletScheduling | `app/**`, `components/**`, `context/**`, `lib/**` | `ImportSpecifier[imported.name="runOnJS"]`, `MemberExpression[property.name="runOnJS"]`, `Identifier[name="runOnJS"]` in call position | none |
| `one-modal` | orientation (Modal half) | client trees | `ImportDeclaration[source.value="react-native"] > ImportSpecifier[imported.name="Modal"]`, `MemberExpression[property.name="Modal"]` on an `react-native` namespace | `components/AppModal.tsx` |
| `landscape-only` | orientation `:155-176` | client trees | `CallExpression[callee.property.name="lockAsync"]` | `components/GameTable.tsx` (reason: the one screen that needs the width) |
| `no-portrait-lock` | orientation `:172-175` | client trees | `MemberExpression[object.property.name="OrientationLock"][property.name=/^PORTRAIT/]`, and the same on `OrientationLock` | none |
| `table-text` | fontScaling bare-Text half | `components/table/**`, `components/CardView.tsx`, `components/GameTable.tsx` | `ImportSpecifier[imported.name="Text"]` from `react-native`, `JSXOpeningElement[name.object.name="Animated"][name.property.name="Text"]` | `components/table/TableText.tsx` |
| `intents-through-send` | intentsGoThroughSend (L-132) | client trees and `shared/**` | `CallExpression[callee.property.name="emit"]:matches([arguments.0.value=/^(room\|game):/], [arguments.0.quasis.0.value.raw=/^(room\|game):/])` | `lib/sendIntent.ts` |
| `spring-tokens` | motion.test.ts spring scan | client trees | `Property[key.name=/^damping(Ratio)?$/]` | `lib/tokens.ts` |
| `seat-identity` | seatLayout `:167-186`, widened from 3 files to the client | `components/**`, `app/**` | `BinaryExpression[operator="==="]:matches([left.name=/^(viewerSeat\|mySeatIndex)$/],[right.name=/^(viewerSeat\|mySeatIndex)$/])` | `components/seatLayout.ts` |
| `field-not-random` | homeCardField `:101-104` | `app/index.tsx` | `CallExpression[callee.object.name="Math"][callee.property.name="random"]` | none |
| `screens-unconditional` | layoutChildren conditional-Screen half | `app/**/_layout.tsx` | `JSXExpressionContainer :matches(LogicalExpression, ConditionalExpression) JSXElement[openingElement.name.property.name="Screen"]` | none |
| `query-cache-owner` | signOutClearsQueryCache scan (L-134) | client trees | `CallExpression[callee.property.name=/^(removeQueries\|resetQueries)$/]`, `CallExpression[callee.property.name="clear"][arguments.length=0]` | `context/SocketContext.tsx` (sign-out); `lib/device/audioEngine.ts`, `lib/errorReporting.ts`, `lib/reactions.ts` (a Set/Map they own) |
| `no-cwd-root` | the cwd class in L-131 | `tests/**` | `CallExpression[callee.object.name="process"][callee.property.name="cwd"]` | `tests/integration/e2e.test.ts`, `tests/integration/httpCaching.test.ts` (save and restore around a chdir); `tests/tooling/relatedTests.test.ts` only if `localProjectOf` genuinely takes cwd |

**What deliberately stays a scan:**
- `motionEscapes` (a count of 21 decisions; a lint rule would need 21 inline disables, which the
  floor refuses; verifier says leave).
- `e2eFixedSleeps` (a ratchet with wrapper-following; L-148's area).
- `hooksLint` and `reactCompiler` (ADR-0005).
- `frameCallbackIdentity` (compiled output).
- Every docs, CI and YAML scan.
- `claudeMdScope`, `rulesAreSingleSourced`, `loaderConstraintIsSingleSourced` (load-bearing for
  agents; they read prose, which lint cannot).

**Residual for `intents-through-send`:** an event name held in a variable still evades it, as it
evades today. The typed socket seam (L-119, client area) closes that: once `room:*`/`game:*`
exist only on `send()`'s intent type, `socket.emit` cannot name them.

### 4.4 Production seams that replace scans (ticket T2)

**`lib/useGuardedSubmit.ts` (L-130).** It owns the in-flight state, so neither half of the guard
can be forgotten.

```ts
export function useGuardedSubmit<A extends unknown[]>(
  run: (...args: A) => Promise<void>,
): {
  /** true from the call until `run` settles; drives spinners and copy. */
  busy: boolean;
  /** Re-entry is refused synchronously (a ref, not state), so a held return key on web submits once. */
  submit: (...args: A) => Promise<void>;
  /** Spread on the TextInput: `editable: !busy` (native) and `onSubmitEditing: submit` (web's
   *  react-native-web fires it on Enter ignoring readOnly, hence the ref inside `submit`). */
  field: Pick<TextInputProps, "editable" | "onSubmitEditing">;
};
/** For a field whose return key only moves focus (app/auth.tsx:177,199). */
export function returnFocuses(next: RefObject<TextInput | null>): Pick<TextInputProps, "onSubmitEditing" | "returnKeyType" | "submitBehavior">;
```

- Contract: `submit` returns immediately and does nothing while a previous call is in flight.
- Contract: `field.editable` is false exactly while `busy`.
- Contract: an error thrown by `run` propagates to the caller after `busy` clears.
- Lint guard `submit-through-hook`: `JSXAttribute[name.name="onSubmitEditing"]` and
  `Property[key.name="onSubmitEditing"]` across client trees, ignoring `lib/useGuardedSubmit.ts`.
- Deletes `tests/ui-rules/submitEditingGuards.test.ts` (185 lines, its count pins and its JSX
  parser).
- Added: `tests/native/guardedSubmit.test.tsx`:
  - a held return (three `onSubmitEditing` before the promise settles) calls `run` once;
  - `editable` flips;
  - a rejected `run` clears `busy`.

**Rendered server codes (L-167).**
- Every `{ code, message }` that reaches a player is built by `payload()`. That covers
  `gameTurn.ts:345,375,414`, `friendships.ts:180` and `errorHandler.ts:27`. Functions that
  return a rendered code (`seatClaimCode` and siblings) get the return type `ServerCode`,
  exported from `payload.ts`.
- Guard `codes-through-payload`: `ObjectExpression:has(> Property[key.name="message"]) >
  Property[key.name="code"]` in `server/**`, ignoring `server/socket/payload.ts`.
- Machine-read acks (`{ ok: false, code }`, no `message`) are untouched.
- Deletes the harvest at `tests/ui-rules/i18n.test.ts:636-680`.
- The `:584-601` declaration regex goes too: `Record<keyof typeof en, string>` already holds it.
  The builder confirms with a planted missing key under `tsc`.
- The `rejoin_failed` count becomes a native or integration assertion on the emitted payload.

**Completeness by type (L-174, L-134):**
- `cardMemoComparators`: `const VALUES = {…} satisfies Record<keyof CardViewProps, [unknown,
  unknown]>` (and the same for the hand item props). The props types are exported as types
  (type-only, so nothing changes at runtime). `propsOf()` regex parsing is deleted.
- Harness channels: `lib/harnessChannels.ts` (node-loadable, no RN) exports `CHANNELS = {…} as
  const`.
  - `tests/e2e/helpers/selectors.ts` builds its `data-*` selectors from it.
  - A generated guard `known-channel` (`JSXAttribute[name.name="dataSet"] > JSXExpressionContainer
    > ObjectExpression > Property[key.name!=/^(…keys…)$/]`, with the regex built from `CHANNELS`
    at config time) refuses an unregistered writer.
  - `harnessChannels.test.ts` shrinks to "every channel has a writer". This is a reachability
    question that stays a scan, now on `jsxTags`.
- `soakRejoinOracle`: a narrow `seatSocket(seat)` accessor in `tests/soak/` replaces reading the
  private `Seat.socket`.
- `errorBoundary` (`tests/native/errorBoundary.test.tsx:59-66`): move now from raw `split(tag)`
  counting onto `jsxTags(blankCommentsAndStrings(layout))`. It becomes a render test when the
  client area exports `AppProviders` (L-121); until then it is decoy-proof.

### 4.5 Kept scans share one walk, one stripper, one YAML loader (tickets T3, T4)

- **Walk:** `trackedFiles(repoRoot, ...pathspec)` for "what is in the repo". Use `sourcesUnder`
  only where untracked-but-not-ignored files must count (a new file before `git add`).
- **Root:** `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")`; `git`
  always gets `cwd: repoRoot`.
- **Stripper:** `blankCommentsAndStrings` by default; `blankComments` only where the scan reads
  string contents (i18n keys, doc paths).
- **JSX:** `jsxTags`.
- **Imports:** `moduleEdges`.
- **`tests/helpers/workflow.ts` (L-166):**

  ```ts
  export interface Step { name?: string; id?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; env?: Record<string, string>; "timeout-minutes"?: number }
  export interface Job { name?: string; needs?: string | string[]; if?: string; "runs-on"?: unknown; "timeout-minutes"?: number; strategy?: { matrix?: Record<string, unknown> }; steps?: Step[] }
  export interface Workflow { name?: string; on: unknown; jobs: Record<string, Job> }
  /** Parses .github/workflows/<file> with `yaml`; throws naming the file on a parse error. */
  export function loadWorkflow(file: string): Workflow;
  export function workflowFiles(): string[];               // tracked .github/workflows/*.y?ml
  /** The step whose `name` or `id` equals `key`; throws (never undefined) so a rename is a named red. */
  export function step(job: Job, key: string): Step;
  /** Index order of steps, for "A runs before B" claims (androidFlowMarker's real question). */
  export function stepIndex(job: Job, key: string): number;
  ```

  The claims about line order in `androidFlowMarker` become `stepIndex` comparisons. The three
  false comments are deleted.
- **`tests/helpers/cmap.ts` (L-139):**

  ```ts
  /** Codepoints mapped to a non-zero glyph by a font's cmap (format 4 and 12). Accepts TTF/OTF or WOFF2. */
  export function cmapCodepoints(bytes: Buffer): Promise<Set<number>>;
  ```

  - WOFF2 is decoded to SFNT through `fontverter` (already installed as `subset-font`'s
    dependency; added as an explicit devDependency at the lockfile's version, so knip sees no
    phantom import). Then iconSubset's existing table walk runs on it.
  - `fontSubset` test 1 reads every `public/fonts/*.woff2` and asserts that `subsetCharacters()`
    is covered by the real glyphs. The manifest comparison becomes a second, cheaper message.

### 4.6 One home per shared fact (tickets T4, T5)

- **e2e tier (L-128):** `tests/e2e/tiers.mjs` (plain ESM, importable from `playwright.config.ts`,
  `tools/ci/e2e-shard.mjs` and node:test):

  ```js
  /** Report-only, out of PR CI: the parity/pixel specs. A file is nightly iff it ends in `.nightly.spec.ts`. */
  export const NIGHTLY = /\.nightly\.spec\.ts$/;
  /** Recorded only by playwright.perf.config.ts. */
  export const PERF = /(^|\/)webPerf\.spec\.ts$/;
  /** What the PR run executes: Playwright's default match minus NIGHTLY and PERF. */
  export function prSpec(file: string): boolean;
  ```

  - The tier is the filename suffix. A rename to or from `.nightly.spec.ts` is the only way to
    change tier, and it shows in the diff.
  - Both configs import `NIGHTLY`/`PERF`. `e2e-shard.mjs` `specFilesIn` uses `prSpec`, and the
    regex scrape at `:48` and in `e2eShardSplit.test.ts:35` are deleted.
  - The 23 one-line stub specs **stay**. Each is one heavy moment per file so the shard planner
    can place them apart (`tests/e2e/helpers/mockupParity.ts:2-3`, `feltParityGrid.ts:224`), and
    checks.md row 26 tells agents to run one variant's file alone. The ledger's "stub files go"
    would break both. They are renamed, not deleted.
  - `timings.json` keys only PR-tier specs, so a nightly rename needs no key migration. The specs
    moving *into* PR tier (L-138) get measured timings from their first CI run;
    `UNMEASURED_SECONDS = 60` covers them until then.
- **L-138:**
  - `handParity.spec.ts` stays PR-tier (no suffix).
  - `lampSeats.spec.ts` splits. `lampSeats.spec.ts` (PR) keeps `:46-121` (geometry), and
    `lampSeats.nightly.spec.ts` keeps `:123-140` (`feltPixels`).
  - `mockupPolish` becomes `mockupPolish.nightly.spec.ts`, because it opens the mockup.
  - `lampLegibility` becomes nightly (pixels).
- **HOLD_MS (L-149):** `lib/tokens.ts` gains the long-press threshold, e.g. `Gesture.longPress =
  500`, keeping hand.tsx:135-139's *why* comment with it. `components/table/hand.tsx` and
  `tests/e2e/helpers/press.ts` import it, so press.ts:17-19's "a copy" comment goes.
  `e2eRealPresses.test.ts:185-199` is deleted. lib/tokens.ts is node-loadable (checks.md
  "Node's TypeScript loader").
- **Timing constants (L-125):**
  - `REJOIN_RETRY_DELAY_MS` and `MAX_REJOIN_RETRIES` are exported from `OnlineGameContext.tsx`.
  - `TRICK_WINNER_MS` is exported from `pile.tsx`. It stays a module literal, so
    `motionEscapes`'s 21 is unchanged.
  - The tests import them.
  - `socketReconnect` calls `reconnectDelayMs(0, () => 0.123)` instead of pinning
    `Math.random`.

## 5. Migration (each step leaves main green)

1. **T1 — registry, floor, batch A, exemptions.**
   - Add `eslint.guards.cjs`, `guardBlocks()` and `reportUnusedDisableDirectives`.
   - Add `lintGuards.test.ts`.
   - For each batch-A guard:
     - (a) port the old scan's planted samples into `plant`/`spare` and watch them fire;
     - (b) run `npm run lint` over the tree, which must be clean (any hit is a real violation
       the old scan missed: fix it or add an `ignores` with a reason);
     - (c) delete the scan or its half.
   - Then fix the L-122 exemptions:
     - remove the three CLAUDE.md pathspecs;
     - give `wallClockBudgets` `trackedFiles` and `blankCommentsAndStrings`, without `SELF`;
     - give `docReferences` `cwd: repoRoot`, without the self-filter (rewrite any of its own
       illustrative `docs/` comments that then go red).
   - Update checks.md § "A scan needs a planted floor" with one paragraph: a forbidden shape is
     a guard in `eslint.guards.cjs`, and its plant is its floor.
   - Deletes:
     - `noFocusedTests` scan (its `forbidOnly` assertion stays in the file);
     - `workletScheduling.test.ts`;
     - `intentsGoThroughSend.test.ts` (its floor "the scan reads the client" becomes guard
       assertion 2);
     - the motion.test.ts spring half;
     - the seatLayout identity test;
     - homeCardField `:101-104`;
     - orientation's Modal parser and its lockAsync pins;
     - the fontScaling bare-Text half and the `bareText` export;
     - the layoutChildren conditional-Screen half;
     - the signOutClearsQueryCache scan `it`.
2. **T2 — seams.**
   - `useGuardedSubmit` and its native test land first, alongside the old scan. The 5 screens
     migrate.
   - The `submit-through-hook` guard lands, and `submitEditingGuards.test.ts` is deleted in the
     same PR, after the guard is green.
   - Then `payload()` sites and `ServerCode` returns, the `codes-through-payload` guard, and the
     i18n regex halves deleted.
   - Then `satisfies` tables, the harness channel registry with its generated guard,
     `seatSocket`, and errorBoundary on `jsxTags`.
3. **T3 — kept scans.**
   - Route every remaining private walker through `trackedFiles`/`sourcesUnder`, and every
     stripper through `blankCommentsAndStrings`/`jsxTags`.
   - Fix the decoys, adding to each a planted decoy (a comment naming the token) that must stay
     red:
     - keyboardAvoidance: the wrapper found as a JSX tag via `jsxTags`, not `includes`;
     - renameCopy: an AST check that the `catch` clause of the rename handler calls
       `setError(serverErrorMessage(...))`;
     - lampRig: `trackedFiles` and blanked source.
   - Rewrite the L-145 literal pins that do not wait on table-ui:
     - `tableProportions:111-114` and `tableFrame:88-97` become native-render assertions: the
       rendered bottom edge's style equals `computeTableFrame(...).surplus`, and the rail and
       sheet receive `frame.tableTop`/`tableBottom` as props, via `testID`;
     - `touchTargets:331-391` becomes rendered props in native, where the model function is
       already imported;
     - delete the four flightPhysics literal pins that `pileFlinch` covers (the builder confirms
       each against pileFlinch first).
   - Move the batch-B lint candidates, each only if every planted sample of its scan fires under
     the selector; otherwise it stays as a fixed scan: `a11yProps`, `animatedStyle`,
     `tableTextFloor`, `contextSlices` (lint half only; the CONTEXT.md pin stays),
     `onlineTableHarness` test 1, `a11yLabels`, `a11yOneNode`.
   - L-152: delete `gameRuleDecisions.test.ts` and the `lampShape.test.ts:93` `console.log`.
4. **T4 — e2e tiers and CI facts.**
   - `tiers.mjs`, the renames, and the config and shard planner switched over. The scrape is
     deleted, and the e2eShardSplit count assertion now reads `NIGHTLY`.
   - L-138 split.
   - `workflow.ts`, with the regex YAML tests moved onto it.
   - `cmap.ts`, with fontSubset reading the woff2.
   - recycledLayoutPatch tripwire:
     - `assert.ok(staleResets(read(COVERED)).length > 0, "react-native contains #57590: delete
       modules/murlan-diagnostics/ios/MurlanRecycledLayout.mm and this test")`;
     - an `NSCAssert(method, …)` after `class_getInstanceMethod` in `MurlanRecycledLayout.mm:15`.
       The verifier notes there is no null guard today, so a rename crashes on first recycle;
       the assert names it.
   - checks.md rows 26-28 renamed to `*.nightly.spec.ts`.
5. **T5 — test helpers single-sourced.**
   - L-125 and L-149 exports.
   - L-155 `tests/native/helpers/scenarioGate.ts` `runGate(name, rows)`, one subprocess per call.
     The verifier notes the rows differ per test, so no `beforeAll`.
   - L-156: one `t` (from `@/lib/i18n`), and expected copy built with `t(key, vars)` in the 7
     files with literal English.
   - L-153: delete `friendRequestReconcile.test.tsx:100-110` (a strict subset of `:85-96`); check
     the bomb-burst and clock pairs and delete only a proven subset.
   - L-143: `tests/native/helpers/renderCounts.ts`.
   - L-158: instance.ts.
   - L-170: the balance core moves to `scripts/headsUpBalance.ts`; tests and script import it,
     and the cycle goes.

## 6. No-regression strategy

- **Before any scan is deleted:**
  - its own planted samples (the `// The floor` cases, e.g. `noFocusedTests.test.ts:17-26`,
    `motion.test.ts:100-106`, `intentsGoThroughSend.test.ts:22`) are copied into the guard's
    `plant`/`spare`;
  - and `npm run lint` over the whole tree must be clean.
  - A guard that finds a violation the scan missed is evidence the scan had a decoy hole. Fix
    the site in the same PR and name it in the PR body. That is the red/green pair.
- **Floor checks that catch a regression of the safeguard itself:** `lintGuards.test.ts`
  assertions 1-5, covering a selector broken, a scope moved, a rule switched off, or an inline
  disable.
- **Seams (T2):**
  - `guardedSubmit.test.tsx` is written against the current screen behaviour first (render
    `recover.tsx`, hold return, count requests), so it is red-free before and after.
  - The payload migration is pinned by the existing `i18n.test.ts` "every code has a server.*
    key" until the guard replaces it. Delete the harvest only in the commit after the guard is
    green.
- **e2e tiers (T4):**
  - Before renaming, record `specFilesIn()` output (PR list) and the nightly match list. After
    the rename, the PR list must equal the old list plus `handParity` and `lampSeats`, and the
    nightly list must equal the old list with suffixes. Assert both in `e2eShardSplit.test.ts`
    with the counts.
  - `parity-nightly.yml` keeps its config path.
- **Layout:** no step changes layout code. The L-145 rewrites move wiring pins from source text
  to native rendered props. They cannot see flexbox and do not claim to. Geometry stays covered
  by `tests/e2e/` (CLAUDE.md invariant), now including `handParity`/`lampSeats` on PRs.
- **Fonts:** `cmap.ts` must reproduce iconSubset's current result on the `.ttf`s before
  fontSubset uses it on woff2. Plant: a subset built without one needed glyph must go red (build
  it into a temp dir with `subset-font`).
- **Which check catches what afterwards:** forbidden shapes are caught by `lint` (app scope and
  harness) and floor-checked by `verify`; registry completeness by `tsc`; layout by e2e;
  everything else unchanged.

## 7. Coverage table

| ID | covered by | note |
|---|---|---|
| L-122 | T1 | All four exemptions removed. noFocusedTests becomes guard `no-focused-test`. `eslint-plugin-jest` is not used (verifier). |
| L-125 | T5 | The four constants are exported. socketReconnect uses an injected `random`. |
| L-128 | T4 | `tests/e2e/tiers.mjs` plus the `.nightly.spec.ts` suffix. Both scrapes are deleted. The stub specs are renamed, not deleted (shard placement, checks.md row 26). No timings.json key migration, because only PR-tier specs are keyed. |
| L-130 | T2 | `useGuardedSubmit` plus the `submit-through-hook` guard. The parser and count pins are deleted. |
| L-131 | T1 (`no-cwd-root` guard), T3 (walkers and strippers) | About 29 private source walkers and ~5-7 cwd sites (verifier's count). The class is pinned by the guard. |
| L-132 | T1 (intentsGoThroughSend, motion, seatLayout become guards), T3 (keyboardAvoidance, renameCopy, lampRig) | reducedMotion and infiniteAnimations are left to L-120 (motion seam area), which retires them. |
| L-134 | T1 (query-cache guard), T2 (cardMemoComparators `satisfies`; errorBoundary on `jsxTags`) | The guard keeps the "nothing else clears the cache" guarantee the verifier said deletion would drop. The errorBoundary render test is blocked on L-121. |
| L-138 | T4 | handParity goes PR-tier. lampSeats is split. mockupPolish and lampLegibility stay nightly (mockup and pixels). |
| L-139 | T4 | `tests/helpers/cmap.ts` covers WOFF2 and TTF. fontverter becomes an explicit devDependency. |
| L-141 | T1 (batch A), T3 (batch B candidates) | Applied per category (verifier). The lexer is kept; frameCallbackIdentity, hooksLint and reactCompiler are kept (ADR-0005). |
| L-143 | T5 | A `renderCounts` helper replaces the hand-wrapped memo spy factories. The `getAllValidPlays` call-count spy stays (it is a real spy, not a render count). The "25 mocks go" claim is not promised. |
| L-145 | T3 (touchTargets, tableFrame, tableProportions, flightPhysics), T1 (orientation lockAsync, homeCardField, layoutChildren conditional) | gameTableVeil is blocked on table-ui L-102 (`VeilRegion`). The layoutChildren `Stack.Protected` literal waits on the route-tree render (client L-121). handTurnScale and handLayout restate model functions on purpose; left. |
| L-149 | T5 | Moves to lib/tokens.ts, not hand.tsx (verifier: Playwright cannot import RN). |
| L-152 | T3 | gameRuleDecisions is deleted. lampShape `console.log` is removed. The motionEscapes comment is correct today and is kept (verifier). |
| L-153 | T5 | friendRequestReconcile `:100-110` is deleted. The bomb-burst and clock pairs are deleted only if proven subsets. |
| L-155 | T5 | `runGate` is shared. There is no `beforeAll`, since the rows differ per test (verifier). |
| L-156 | T5 | One `t`, and copy built from keys. |
| L-158 | T5 | `LOG_LEVEL` knob deleted. The child is killed on give-up and in `finally`. The knip claims about other exports are re-run before deleting any. |
| L-161 | T4 | `COVERED` tripwire with DROP guidance, plus `NSCAssert` on the method lookup. |
| L-164 | none: no change | The list fails safe: every test runs on both platforms unless listed, and each listed entry carries its reason (`jest.config.js:380-387`). The proposal is "measure first"; a wrongly listed test costs one platform's run of a test whose path does not branch. No ticket, so a fresh session isn't spent to re-confirm that. |
| L-165 | none: no change | Verifier and source agree: leave. A suite-wide fake-timer default would change 100+ files' timing semantics for no named defect. |
| L-166 | T4 | `tests/helpers/workflow.ts`. The three false comments are deleted. |
| L-167 | T2 | Rendered codes go through `payload()`. Guard `codes-through-payload`. The harvest is deleted. |
| L-170 | T5 | The balance core moves to `scripts/headsUpBalance.ts`. Placement moves for botFill and bot-search tests come only if their imports already point there; otherwise they are left (placement-only churn). |
| L-174 | T2 | Applied per registry: cardMemoComparators (`satisfies`), harness channels (registry plus generated guard), soakRejoinOracle (accessor). Not applied to integrationPorts (uniqueness), timerEnvIsLive (derived on purpose), soak wiring pins (caller pins), or contextSlices registry (CONTEXT.md pin). |

## 8. Proposed tickets

Every ticket uses the same iteration loop:
- **While iterating:** `node --test tests/tooling/lintGuards.test.ts` (from T1 on), plus the
  changed test files, plus `npx eslint <changed files>`.
- **Before pushing:** `npm run typecheck && npm run lint && node --test` on every test file
  touched or deleted, plus its replacements. The rest runs in CI (RULES 3).

### T1 — Static rules: one guard registry with a floor, and the scans it replaces (size M)

- **Files:**
  - `eslint.guards.cjs` (new) and `eslint.config.js`
  - `tests/tooling/lintGuards.test.ts` (new)
  - `tests/tooling/{noFocusedTests,wallClockBudgets,docReferences,rulesAreSingleSourced}.test.ts`
  - `tests/ui-rules/{workletScheduling,intentsGoThroughSend,motion,seatLayout,homeCardField,orientation,fontScaling,layoutChildren}.test.ts`
  - `tests/native/signOutClearsQueryCache.test.tsx`
  - `tests/server/{appLinks,noWebBuild,sourceMaps}.test.ts`, `tests/tooling/entry.test.ts`
    (cwd)
  - `docs/agents/checks.md` (§ "A scan needs a planted floor")
  - Any app file a new guard finds in violation.
- **Blocked by:** none.
- **Blocks:** T2, T3, and other areas' lint bans (L-129 layering, L-120 motion seam, L-066 e2e
  flags) that should land as guards.
- **Definition of done:**
  - [ ] `eslint.guards.cjs` exports `GUARDS`, `plugin` and `guardBlocks()`.
  - [ ] `eslint.config.js` appends `guardBlocks()` and sets `reportUnusedDisableDirectives:
    "error"`.
  - [ ] `lintGuards.test.ts` asserts §4.2's six points. Each is watched failing once: a broken
    selector, a `files` glob matching nothing, an `ignores` entry naming a missing file, an
    `"off"` block, an inline `eslint-disable-next-line murlan/x`, and a bare `/* eslint-disable
    */`.
  - [ ] The 13 guards of §4.3 land, each with the old scan's planted samples as `plant`/`spare`.
    `npm run lint` is clean over the tree.
  - [ ] The scans and halves listed in §5 step 1 are deleted. No test file exports a helper
    another test imports (`bareText` goes).
  - [ ] L-122:
    - rulesAreSingleSourced loses the three CLAUDE.md pathspecs;
    - wallClockBudgets uses `trackedFiles` and `blankCommentsAndStrings`, with no `SELF`;
    - docReferences passes `cwd: repoRoot` and has no self-filter.
  - [ ] The `process.cwd()` sites resolve the root from `import.meta.url`. Each remaining one is
    an `ignores` entry with a reason.
  - [ ] checks.md says where a forbidden-shape rule goes, in one paragraph.

### T2 — Scans that become a seam or a type (size M)

- **Files:**
  - `lib/useGuardedSubmit.ts` (new)
  - `app/(online)/friends.tsx`, `app/auth.tsx`, `app/profile.tsx`, `app/recover.tsx`,
    `app/verify-email.tsx`
  - `tests/native/guardedSubmit.test.tsx` (new)
  - `tests/ui-rules/submitEditingGuards.test.ts` (deleted)
  - `server/socket/payload.ts`, `server/game/gameTurn.ts`, `server/socket/friendships.ts`,
    `server/http/errorHandler.ts`
  - `tests/ui-rules/i18n.test.ts`
  - `components/CardView.tsx`, `components/table/hand.tsx` (type exports only)
  - `tests/native/cardMemoComparators.test.tsx`
  - `lib/harnessChannels.ts` (new), `tests/e2e/helpers/selectors.ts`, the screens writing
    `dataSet`, `tests/tooling/harnessChannels.test.ts`
  - `tests/soak/*` (accessor), `tests/tooling/soakRejoinOracle.test.ts`
  - `tests/native/errorBoundary.test.tsx`
  - `eslint.guards.cjs`
- **Blocked by:** T1.
  - Cross-area: the client area's tickets on these five screens and on `CardView`/`hand.tsx`.
  - Cross-area: server-output's ticket if it reshapes `gameTurn.ts`/`friendships.ts` emits.
  - Cross-area: table-ui's ticket touching `hand.tsx`.
- **Definition of done:**
  - [ ] `useGuardedSubmit` per §4.4. The native test shows a held return submits once, `editable`
    flips, and a reject clears `busy`.
  - [ ] All 10 `onSubmitEditing` sites use `field` or `returnFocuses`. The `submit-through-hook`
    guard is green. `submitEditingGuards.test.ts` is deleted.
  - [ ] Every rendered `{code, message}` in `server/` comes from `payload()`. Code-returning
    helpers return `ServerCode`. The `codes-through-payload` guard is green.
    `i18n.test.ts:584-601,636-680` is deleted; the rejoin count is a behaviour assertion.
  - [ ] `cardMemoComparators` uses `satisfies Record<keyof …Props, …>`, and `propsOf` is deleted.
    A prop added to `CardViewProps` fails `tsc` (watched once).
  - [ ] Harness channels come from one registry. The generated `known-channel` guard refuses an
    unregistered `dataSet` key (plant).
  - [ ] soakRejoinOracle reads `seatSocket()`, not the private field.
  - [ ] errorBoundary counts tags through `jsxTags`; a commented-out `<ErrorBoundary>` does not
    count (plant).

### T3 — The scans that stay: one walk, one stripper, no decoys (size M)

- **Files:**
  - `tests/ui-rules/{keyboardAvoidance,renameCopy,lampRig,tableProportions,tableFrame,touchTargets,flightPhysics,a11yProps,animatedStyle,tableTextFloor,contextSlices,a11yLabels,a11yOneNode,hooksLint,reactCompiler,i18n,tokenRoles,workletCallees,infiniteAnimations?}.test.ts`
    (walker only; leave content to L-120)
  - `tests/tooling/{onlineTableHarness,assetBarrels,ciScope,e2eRunnableImports,noDockerHubPulls,postgresImage,skiaOpaquePatch,soakRejoinOracle,testHangs,timerEnvIsLive,gameRuleDecisions}.test.ts`
  - `tests/ui-rules/lampShape.test.ts`
  - Native render tests for the L-145 wiring pins (new, under `tests/native/`).
  - `eslint.guards.cjs` (batch B).
- **Blocked by:** T1 (same test files; registry).
  - Cross-area: L-120 (motion seam) for `reducedMotion`/`infiniteAnimations`/`withDelayReduceMotion`
    content. Walker-only edits there conflict, so order T3 after L-120's ticket or leave those
    three to it.
  - Cross-area: table-ui L-102 for `gameTableVeil` (not in this ticket).
- **Definition of done:**
  - [ ] `grep -rln readdirSync tests | xargs grep -lE "\.tsx\?"` names only fixture walkers; each
    remaining source walk uses `trackedFiles`/`sourcesUnder`. No hand comment stripper remains
    (`contextSlices:192-194`, `noDockerHubPulls:61`, `reducedMotion:77-79` → L-120).
  - [ ] keyboardAvoidance, renameCopy and lampRig each carry a planted comment decoy that stays
    red, and pass on the real tree.
  - [ ] `tableProportions:111-114`, `tableFrame:88-97` and `touchTargets:331-391` are replaced by
    native rendered-prop assertions against the model functions. The four flightPhysics pins
    covered by pileFlinch are deleted, each with its covering pileFlinch test named in the PR
    body.
  - [ ] Each batch-B candidate is a guard (plant = its scan's samples) or stays a scan with the
    reason in the PR body.
  - [ ] `gameRuleDecisions.test.ts` is deleted. The `lampShape.test.ts:93` `console.log` is
    removed.

### T4 — e2e tiers and CI facts read structurally (size M)

- **Files:**
  - `tests/e2e/tiers.mjs` (new)
  - `tests/e2e/playwright.config.ts`, `tests/e2e/playwright.parity.config.ts`
  - 28 nightly spec renames (18 `mockupParity*`, 6 `feltParityGrid*`, `cardShadowParity`,
    `cardGlowParity`, `lampLegibility`, `mockupPolish`), plus `lampSeats.spec.ts` split into
    `lampSeats.nightly.spec.ts`.
  - `tools/ci/e2e-shard.mjs`, `tests/tooling/e2eShardSplit.test.ts`
  - `tests/tooling/e2eRealPresses.test.ts:33` (path list)
  - `docs/agents/checks.md` rows 26-28
  - `tests/helpers/workflow.ts` (new), plus
    `tests/tooling/{ciJobTimeouts,iosShards,iosAppCache,deviceWorkflowsRun,androidApkReuse,androidFlowMarker,gameTableTapSettle,realAppNotExpoGo,e2eBudget,nativeBudget,ciSkipGuards}.test.ts`
  - `tests/helpers/cmap.ts` (new), `tests/tooling/{fontSubset,iconSubset}.test.ts`,
    `package.json`/`package-lock.json` (fontverter devDependency)
  - `tests/tooling/recycledLayoutPatch.test.ts`,
    `modules/murlan-diagnostics/ios/MurlanRecycledLayout.mm`
- **Blocked by:** none within this area.
  - Cross-area: the loop/tooling ticket for L-185 (device-workflow duplication) edits
    `deviceWorkflowsGate`/workflows. Order it after T4 so it uses `workflow.ts`.
  - Cross-area: `ciScope`'s bash extraction (tooling-F8) is the loop area's.
- **Definition of done:**
  - [ ] No file outside `tiers.mjs` spells the nightly list. The regex scrape at
    `e2e-shard.mjs:48` and `e2eShardSplit.test.ts:35` is deleted.
  - [ ] The PR spec list equals the old one plus `handParity.spec.ts` and `lampSeats.spec.ts`;
    the nightly list equals the old one renamed (asserted).
  - [ ] `lampSeats.spec.ts` holds only geometry, and the felt-pixel test is nightly.
  - [ ] checks.md rows name `*.nightly.spec.ts`.
  - [ ] `workflow.ts` per §4.5. The listed tests use `loadWorkflow`/`step`/`stepIndex`. The three
    "no YAML parser" comments are gone.
  - [ ] `fontSubset` reads the woff2 cmap. A subset missing one needed glyph goes red (planted in
    a temp dir). iconSubset uses the shared `cmap.ts`.
  - [ ] recycledLayoutPatch fails with the DROP message when `COVERED` has no stale reset (planted
    by pointing it at a fixture). The `.mm` asserts the method lookup.
  - [ ] **Before pushing,** also: dispatch nothing. CI's browser shards run the two newly PR-tier
    specs. Watch their shard time against `MAX_SHARDS`.

### T5 — Test-side facts and helpers in one place (size M)

- **Files:**
  - `context/OnlineGameContext.tsx`, `components/table/pile.tsx`, `components/table/hand.tsx`,
    `lib/tokens.ts`, `lib/reconnectDelay.ts` (exports only)
  - `tests/native/{rejoinFailed,trickClose,socketReconnect,lampVariantsScenario,seatAnchorsScenario,friendRequestReconcile,oneTapOneCommit,…}.test.tsx`
  - `tests/native/helpers/{scenarioGate,renderCounts}.ts` (new)
  - `tests/e2e/helpers/press.ts`, `tests/tooling/e2eRealPresses.test.ts`
  - `tests/helpers/instance.ts`
  - `scripts/measureHeadsUpBalance.ts`, `scripts/headsUpBalance.ts` (new),
    `tests/engine/royalStraightBlindSpotHelpers.test.ts`
  - The 7 native files with hard-coded English.
- **Blocked by:** T4 (both edit `e2eRealPresses.test.ts`).
  - Cross-area: client and table-ui tickets editing `OnlineGameContext.tsx`, `pile.tsx` and
    `hand.tsx`. Exports are one-line edits but share the files.
  - Cross-area: test-harness L-142 if it moves `tests/helpers/offlineMatch.ts`/`tests/engine/helpers.ts`.
- **Definition of done:**
  - [ ] No test restates `REJOIN_RETRY_DELAY_MS`, `MAX_REJOIN_RETRIES`, `TRICK_WINNER_MS`,
    `RETRY_BASE_MS` or `HOLD_MS`; each is imported. socketReconnect passes `random` and does not
    patch `Math.random`.
  - [ ] The long-press threshold lives in `lib/tokens.ts`. hand.tsx and press.ts import it.
    `e2eRealPresses.test.ts:185-199` is deleted.
  - [ ] `runGate` is shared by both scenario tests.
  - [ ] One `t`. The literal multi-word English in `getByText` calls is built from keys.
  - [ ] friendRequestReconcile's subset test is deleted. Other deletions only with the covering
    test named.
  - [ ] `renderCounts.counting(modulePath, names, counter)` replaces the hand-written memo spy
    factories in oneTapOneCommit and the files using the same shape. Render counts are unchanged
    (the same assertions pass).
  - [ ] instance.ts: no `LOG_LEVEL`. On give-up it kills the child and rejects. Callers kill in
    `finally`.
  - [ ] `scripts/` imports nothing from `tests/`; tests import the balance core from `scripts/`.

## 9. Cross-area contracts

- **I give:**
  - `eslint.guards.cjs` (the `Guard` record, `guardBlocks()`, and the floor test). L-129
    (layering, shared-is-a-leaf, audio owners), L-120 (ban raw `withRepeat`/`withDelay` outside
    the motion seam) and L-066 (`EXPO_PUBLIC_E2E_*` read outside one module) should land as
    guards there, not as new `no-restricted-*` options in `eslint.config.js`, whose block
    replacement drops them under `components/table/notices/`.
  - `tests/helpers/workflow.ts` for the loop area's workflow tickets (L-185, tooling-F8).
  - `tests/e2e/tiers.mjs` for anyone adding a parity spec: the suffix is the tier.
  - `lib/useGuardedSubmit.ts` for the client area's form screens.
- **I need:**
  - Client L-121 `AppProviders` export, before errorBoundary and layoutChildren `Stack.Protected`
    become render tests.
  - Client L-119 typed socket seam, to close the residual variable-name decoy of
    `intents-through-send`.
  - Table-ui L-102 `VeilRegion`, before gameTableVeil can drop indentation.
  - L-091 is not needed by any T1-T5 item.
- **Files shared with other areas** (order, never parallel):
  - `OnlineGameContext.tsx`, `pile.tsx`, `hand.tsx`, `CardView.tsx` (client, table-ui);
  - `server/game/gameTurn.ts`, `server/socket/friendships.ts`, `server/http/errorHandler.ts`
    (server-output);
  - `tests/helpers/offlineMatch.ts` and `tests/engine/helpers.ts` (test-harness L-142, engine);
  - `reducedMotion`/`infiniteAnimations` tests (L-120);
  - `eslint.config.js` (L-129).

## 10. Owner decisions needed

1. **No inline eslint suppression of a guard, and no bare `/* eslint-disable */` anywhere.**
   - Exceptions live only in the registry's `ignores`, with a reason.
   - This extends hooksLint's existing refusal (ADR-0005's ESLint-semantics stance) to every
     guard. It changes nothing on the tree today: the only 5 directives name
     `no-require-imports`.
   - I recommend it, because it is what keeps the registry from becoming a self-defeating
     safeguard. It is flagged because it is a repo-wide policy.
2. **Two PR-tier specs added to the browser shards** (`handParity` ~100 s, the `lampSeats`
   geometry half). This trades CI wall clock for catching a layout regression before merge
   (CLAUDE.md layout invariant; memory "correctness over CI wall clock", target under 5 min).
   Recommended. Measured shard deltas come from the first run, not estimated.
3. **The ledger's "23 stub specs go" (L-128) is not done.** They are renamed instead, because
   per-file placement and "run one moment's file alone" (checks.md row 26) depend on them.
   Confirm, or rule that the parity moments may share files.
4. **The `fontverter` devDependency** (already in the tree under `subset-font`), so the woff2 cmap
   is read rather than hand-parsing WOFF2's table directory. Technical; listed only because it is
   a dependency change, which memory flags as passing locally and failing in CI if not
   `npm ci`-checked.
