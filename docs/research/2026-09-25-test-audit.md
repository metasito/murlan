# Test audit: what the suites miss, what flakes, what it costs (2026-09-25)

Every suite was audited against origin/main `a3c9ac94`–`c6523120`: `npm test` (node:test), `npm run
test:native` (jest), the Playwright suite, `npm run loop:test`, the device and soak workflows, and
the guard steps and tooling tests that pin CI. CI wall-clock speed is #1285's (shard balance, the
hang watchdog, the parity capture, install caching, `--test-concurrency`). Findings of that kind
were handed to it, not fixed here.

**Method.** Six lenses, and every report had to carry evidence: a planted defect, a CI run id, a
log line or a measurement. Inferred findings were dropped.

- *Blind spots*: 17 defects planted against 16 invariants from `CLAUDE.md`, `components/CLAUDE.md`,
  `server/CLAUDE.md` and `docs/GAME-RULES.md` § Decisions, one test file run per plant.
  **9 stayed green.**
- *Flakiness*: 428 `ci.yml` runs over 14 days, every `Flaky, passed on retry` annotation, and every
  head SHA whose conclusion differed between attempts.
- *Speed*: per-job and per-step durations of green `main` runs, per-test durations from job logs
  and merged Playwright reports.
- *Quality* and *coverage by layer*: duplicated helpers, dead or stale tests, and scans a decoy can
  pass. Ten bug classes were placed against the cheapest layer that can see them
  (`docs/agents/checks.md`).
- *Guard integrity*: for every guard step and tooling pin: can it pass without the guarded thing
  being true, does it have a floor, and does it run at all?

## Findings

Severity is what the defect lets through. "Ratchet" is the check that fails if the class returns;
the last column is where it landed.

| # | Finding | Lens | Evidence | Sev | Fix | Ratchet | Where |
|---|---|---|---|---|---|---|---|
| 1 | The rotating deal was asserted on the stored `dealFirstSeat`, never on who got the cards | blind spot | `tableHandlers.ts:450` passing `0` left `rematch.test.ts` green | high | assert which seats hold 14 cards | `tests/integration/rematch.test.ts` | #1297 |
| 2 | A weak (taken-over) seat's strength was never read through `runBotTurn` | blind spot | `gameTurn.ts:164` `useAi = true`: 4 suites green | high | drive `armTurn` → `runBotTurn` on a weak seat | `tests/server/weakSeatTakeover.test.ts` | #1297 |
| 3 | Nothing checked that the server entry calls `checkBootEnv` | blind spot | `server/index.ts:10` → `void checkBootEnv`: 90 tests green | high | spawn the entry without `SESSION_SECRET` | `tests/server/dbTls.test.ts` | #1297 |
| 4 | The offline bot's strength rode a hand-copied harness | blind spot | `GameContext.tsx:322` `true`→`false`: green; `offlineMatch.ts:6-11` "carried by hand" | high | one `offlineBotMove` in `lib/game/autoMove.ts`, called by both | wiring test in `tests/engine/matchState.test.ts` | #1297 |
| 5 | The check that `AppModal` is the only `<Modal>` was a text match | decoy | `import { Modal as Sheet }` in `OfflineBanner.tsx`: green | high | scan react-native `Modal` imports: aliased, namespaced or destructured | self-test in `tests/ui-rules/orientation.test.ts` | #1296 |
| 6 | Gitleaks honoured the scanned tree's own `gitleaks:allow` and `.gitleaksignore` | guard | planted AWS key behind `gitleaks:allow`: `no leaks found` on v8.30.1; with the flag, `leaks found: 1` | high | `--ignore-gitleaks-allow --gitleaks-ignore-path=/dev/null` | `tests/tooling/gitleaksAllowlist.test.ts` pins both flags and the two exemptions | #1295 |
| 7 | The integration guard counted skipped files as run | guard | a `describe.skip`, a `{skip}` and an empty file each printed as run, exit 0 | high | count only a test that ran | `tests/tooling/ciSkipGuards.test.ts` | #1295 |
| 8 | A narrowed `npm test` glob dropped whole directories at exit 0 | guard | glob cut to `tests/integration/**` with a failing engine test: green | high | reporter fails the run on any unloaded `*.test.ts` under a touched root | same file; a narrowed run prints 273 `never loaded` lines, exit 1 | #1295 |
| 9 | `scope` routes prose and whole-repo scanners' inputs to `app=false` | guard | `docReferences.test.ts` reads every tracked `.md`; 21 of 37 route to `app=false` | high | route every file a whole-repo scan reads to a job that runs it | extended `ciScope.test.ts` | #1291 |
| 10 | A retry hid real races and reported them only as a warning | flake | #998 set `retries: 1`; `oneAccessibleNode` flaked twice since (35575548733, 35183902716) | med | `e2e-flaky.mjs` exits 1 unless `KNOWN_FLAKY` names an open issue | `tests/tooling/e2eFlaky.test.ts` | #1295 |
| 11 | `oneAccessibleNode` read the AX tree once, before Chrome rebuilt it | flake | `Received length: 0` at `:181`; the DOM checks above it passed | med | every tree read waits for its screen | #10 | #1295 |
| 12 | `bot.ts` blamed the app when its search had answered a stale table | flake | `No combination … PASSA is disabled` at `bot.ts:391` (35693173202) | low | require the same description the search answered | #10 | #1295 |
| 13 | Glyph coverage counted icons mid-transition | flake | `measured 2 … expected at least 6` (35608735367) | low | sweep until the screen shows its icons | #10 | #1295 |
| 14 | 95 fixed real-time waits in the browser suite, and nothing stopped a 96th | speed | `reorderHand.spec.ts`: 17 waits ≈ 15.9 s of 29.2 s | med | per-file `LEGACY` count that may only fall (93); a new wait needs `// fixed wait on purpose:`, as `press.ts`'s two now carry | `tests/tooling/e2eFixedSleeps.test.ts` | #1295; removal #1292 |
| 15 | A spec quadrupled and nobody was told | speed | `tapTargets.spec.ts` 154.8 s / 184 s vs 36.2 s measured (main 36118149853, 36063749055) | med | a shard fails past 2× its committed timing + 30 s | Playwright budget reporter | #1291 |
| 16 | A committed `.only` would silently narrow jest or a shard | guard | no `forbidOnly`, no lint rule | med | `forbidOnly` on CI | `tests/tooling/noFocusedTests.test.ts` | #1295 |
| 17 | `CARD_W`/`CARD_H` scan saw only `const/let/var` | decoy | `export function CARD_W` in `handLayout.ts`: green | med | every declaration form, a default import included | self-test in `layoutConstantsPinned.test.ts` | #1296 |
| 18 | `zIndex` scan could not parse a type annotation or a comma declaration | decoy | `const EMOJI_Z: number = 60`: green | med | read declarations from the TypeScript AST | self-test in `tokenRoles.test.ts` | #1296 |
| 19 | Impact feedback timing checked two of seven calls | decoy | `playImpact` moved to the throw; land timer on `FLIGHT_MS`: 153/153 green | med | every feedback call inside an `impactDelayMs` timeout | `flightPhysics.test.ts` | #1296 |
| 20 | Settle delay read raw source, so a comment satisfied it | decoy | old expression moved into a comment: green | med | blank comments, read the `withDelay(` argument | same file | #1296 |
| 21 | Listener-before-await probed only a room handler | blind spot | `await` moved after `registerRoomHandlers`: pin green | med | one probe per `register*Handlers` group, derived from `socket.ts` | `tests/integration/gameplay.test.ts` | #1297 |
| 22 | Auth refusals accepted any rejection | weak | `auth.test.ts:28,35` check `ok === false` only | med | assert `Not authenticated` | same file | #1297 |
| 23 | An assertion *message* counted as asserting a refusal code | decoy | `assert.ok(true, "SESSION_REVOKED")` and `assert.rejects(p, "CODE")` satisfied the check | med | only compared positions count | self-test in `refusalCodesTested.test.ts` | #1296 |
| 24 | Two integration files kept their own `waitFor` that resolved `null` and ignored `DEADLINE_SCALE` | quality | `crossInstance.test.ts:47`, `restartConvergence.test.ts:115` | med | shared `waitFor` / `waitForOrNull` | `tests/tooling/integrationWaitFor.test.ts` | #1297 |
| 25 | Strict-indexed ratchet could drop a glob or add an `exclude` | guard | only an empty list or empty area failed | med | areas pinned | `checkStrictIndexed.test.ts` | #1295 |
| 26 | `loop:test` has no floor at all | guard | a glob matching nothing exits 0 | med | same reporter as `npm test` | `ciSkipGuards.test.ts` | #1291 |
| 27 | Five Win32-only loop tests never run anywhere | guard | run 36120725579: `ℹ skipped 5`, CI is Linux | med | a Windows leg that fails on a skip | the leg itself | #1291 |
| 28 | Maestro's native-crash detection only warns | guard | `maestro.yml:347-372` emits `::warning::`, exit 0 | med | owner's call: device policy | — | #1293 |
| 29 | `advancePile` put the same cards in both layers on a repeated play | blind spot | new "same play again" case: `+ ['a']`; `pile.tsx` guards its one caller today | low | a repeated play changes nothing | `flightPhysics.test.ts` | #1296 |
| 30 | A bare `fireEvent` read back synchronously | quality | `replayControls.test.tsx:176`, `handReorderActions.test.tsx:48` | low | `await` | `nativeActPairing.test.ts`, same line or next | #1296 |
| 31 | Royal-straight test title contradicted the rule and never varied length | weak | `combinations.test.ts:186` passed the length mutation | low | retitle, vary length | same file | #1297 |
| 32 | A soak that played nothing reported "no disagreement" | guard | `soak.ts:808` checks only violations | low | `progressViolations` | `soakInvariants.test.ts` | #1295 |
| 33 | Deferred bundle budget could double in the same change | guard | pinned only `< BUDGET_BYTES / 2` (~500 KB) | low | pinned ≤ 250 KB | `bundleBudget.test.ts` | #1295 |
| 34 | Device and health workflows go red with nobody told | guard | last 3 `main` runs of `ios.yml`/`maestro.yml` failed; `health.yml` 40/40 red, now disabled | low | owner's call | — | #1293 |
| 35 | The comment budget does not judge `yml`/`sh` | guard | `commentShape.ts:37` `JUDGED_EXTENSIONS` | low | owner's call: changes the loop's budget | — | #1294 |
| 36 | `reconnect.test.ts` (50 s) and `accountRecovery.test.tsx` (17 s × 2) spend most of their time in real timers | speed | job 108017050345; job 108017050424 | low | wait on the timer the code schedules | — | #1292 |

## Coverage by layer

Every class sampled sits at the cheapest layer that can see it:
- layout: Playwright only;
- hook order: lint (`hooksLint.test.ts`);
- protocol shape: `tests/server/`; handlers: `tests/integration/`;
- schema DDL as text: `tests/server/`; its creation: `tests/integration/`;
- i18n, contrast, roles and bot choice: `node --test`;
- `Platform.OS` branches: jest, once per platform.

The two gaps are the documented ones, the on-device resume path and iOS paint order, which
`docs/agents/checks.md` already lists as device-only. No jest test asserts a layout property and no
snapshot test exists.

## What the retry was hiding

Over 14 days, three tests passed only on a retry, and all three were real races rather than slow
runners. Every retry-pass now fails the run by name (#10). The alternative, `retries: 0`, loses the
distinction the report still draws between a race and a regression. An allowance needs an open
issue, so an excuse ends when its issue closes. Two other re-runs were infrastructure, a Docker Hub
502 on `postgres:16-alpine` and an artifact 403, and those are not the suite's to fix.

## Sources

- Node.js test runner, for custom reporters, the `test:pass` event's `skip`/`todo` fields, and exit
  status: <https://nodejs.org/api/test.html#custom-reporters>. Verified on Node 24.13.1: a
  reporter's `process.exitCode = 1` fails the run, and a file that declares no test is reported as
  a pass named after its own path.
- Node.js assert: when `assert.throws`/`rejects` gets a string as its second argument, that string
  is the message, not a matcher: <https://nodejs.org/api/assert.html#assertthrowsfn-error-message>.
- Playwright:
  - a reporter's `onEnd` may override the run's status and exit code:
    <https://playwright.dev/docs/api/class-reporter#reporter-on-end>;
  - `forbidOnly`: <https://playwright.dev/docs/api/class-testconfig#test-config-forbid-only>;
  - retries and the `flaky` verdict: <https://playwright.dev/docs/test-retries>;
  - `page.waitForTimeout`, whose docs warn that tests which wait for time are inherently flaky:
    <https://playwright.dev/docs/api/class-page#page-wait-for-timeout>;
  - `expect.poll`: <https://playwright.dev/docs/test-assertions#expectpoll>.
- Jest: `maxWorkers`: <https://jestjs.io/docs/configuration#maxworkers-number--string>; `test.only`:
  <https://jestjs.io/docs/api#testonlyname-fn-timeout>.
- Gitleaks: `--ignore-gitleaks-allow` and `--gitleaks-ignore-path`, as the pinned image's own
  `detect --help` lists them (`zricethezav/gitleaks:v8.30.1`).
