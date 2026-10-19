# 11 — Loop and CI tooling: target design

Area: `tools/loop` (supervisor, adapters, `phaseOf`/`decide`, session env and limits, process
helper, guards) and `.github/workflows`. IDs: L-175 to L-216 except L-193, plus the soak.yml:41
Postgres remnant of the dropped L-162. All `path:line` references are at MAIN `a1d0ebb5`.

## 1. Summary

- **Now:** `decide()` and the settle stepper are already deep and pure. Around them, `queue-loop.mjs` (1721 lines, 40 exports) mixes route policy, adapters, board glue and constants. "Where the run stands" is computed in `derive`, `liveRoute` and `nextRoute`, linked by an env var. GitHub is reached by argv from about 15 places. `LOOP_*` is a hidden two-way interface. Two guards fail open without saying so. CI logic lives in bash copied between YAML files.
- **After:**
  - Each fact has one owner. `loop-derive.mjs` owns *the phase*: `readRun` does the I/O and `phaseOf` is pure.
  - `decide()` owns *every* routing choice, including route selection, through its existing `ask` protocol.
  - `tracker.mjs` owns *GitHub*: it is widened, trust policy lives there, and the repo is fixed by `GH_REPO` in `cli.mjs`.
  - `session-env.mjs` owns *`LOOP_*`*. `limits.mjs` owns *every cap*. `scripts/lib/proc.mjs` owns *spawning and killing a tree*.
  - `queue-loop.mjs` keeps only the composition: `runOnce`, `realPorts`, `main`.
  - The guards fail closed and have a floor. CI decisions are node modules that tests call directly.
- **Why:** most of the 42 entries are symptoms of five missing owners: phase/route, GitHub, session env, process, constants. Patching each symptom would leave each fact still computed in two places.

## 2. Current shape (evidence at MAIN)

**Phase and route: four computations and an env bridge (L-175, L-181).**
- The phase table sits in `derive()` at `tools/loop/loop-derive.mjs:488-531`.
- Supervisor routing rules sit in `nextRoute`:
  - `queue-loop.mjs:158`: a LAND ends the review.
  - `queue-loop.mjs:174-182`: an owner relabel releases the pin.
  - `queue-loop.mjs:146-148`: a closed issue becomes `skill:"closed"`.
- `liveRoute` (`queue-loop.mjs:99-119`) adds more.
- The supervisor passes the phase to the session through `sessionEnv`'s `LOOP_PHASE` (`queue-loop.mjs:695`). `derive` reads it back by default (`loop-derive.mjs:438`).
- `decide`'s `pick` step (`decide.mjs:197-212`) judges a route that `nextRoute` already chose. So `queue-loop.mjs:1086` ("Every routing choice is `decide()`'s") is false.
- git goes through module-level `run` (`loop-derive.mjs:18`); only gh is injectable (`exec`).
- `decide.mjs` exports 12 names. `queueLoop.test.ts:34` and `loopDerive.test.ts:27` test helpers directly.

**GitHub (L-176, L-206, L-210, L-212).**
- `tracker.mjs:1-78` covers only claim/release/park/comment/issue, with a real second adapter `fakeTracker`.
- Every other read is argv:
  - `loop-derive.mjs:347,356,401`
  - `queue-loop.mjs:629,634,658,926,940`
  - `next-ticket.mjs:178,297`
  - `workspace.mjs:239`
  - `settle.mjs:324,357,398,417,439,453,461,486`
- "Every gh names REPO" is prose (`cli.mjs:9`). Several calls omit `--repo` (`workspace.mjs:239`, `next-ticket.mjs:178`, `tracker.mjs:118`, `settle.mjs:324,357,461`).
- Trust policy is split. `TRUSTED_AUTHORS`/`trustedComments` are at `loop-derive.mjs:334-339`. `TRUSTED_SELECT`/`readIssue` are at `brief.mjs:53-62`; `guard-bash.mjs:19` and `next-ticket.mjs:3` import them from the prompt module.
- `openPrs` is a module-level mutable cache with `--limit 100` (`next-ticket.mjs:175-180`).

**The god module (L-177, L-178, L-179, L-205, L-213).**
- `queue-loop.mjs` holds:
  - route policy (`:99-184`)
  - spawn configuration (`:187-253`, `:687-717`)
  - git/disk adapters (`syncCheckout :294`, `removeWorktree :581`, `removeLanded :594`, `refreshWorktree :642`, `loopMoved :867`)
  - GitHub adapters (`park :474`, `repark :552`, `publishForReview :625`, `ticketFacts :655`, `pushedPr :909`)
  - board glue (`openTicket :732`, `sessionView :748`, `journaled :1302`, `screenEvents :1329`)
  - caps (`:380-422`, `:985`, `LIMITS :1044`)
  - the composition (`runOnce :1099`, `realPorts :1359`, `main :1520`)
- `decide.test.ts:7` imports caps from `queue-loop.mjs`. So do `scripts/await-run.mjs:8` and `run-loop.mjs:4`.
- `runOnce` reaches the disk past its ports: `parkAsked(n)` at `:1137`, `fs.rmSync(PARK_FILE)` at `:1139`, and `fs.existsSync(ciLogPath(n))` at `:1293`. `main` does the same at `:1693-1694`. Tests compensate with 24 `chdir` calls across `tools/loop/tests`.
- The claim runs as a subprocess whose tab-separated stdout is parsed (`:1451-1455`), although `claim()` is importable (`claim.mjs:110`). Worktree removal shells out through `npm run worktrees:remove` (`:582`, `:618`), although `removeWorktree` is importable (`workspace.mjs:154`).
- `queueLoopArgs` reads `.claude/commands/queue.md` relative to the cwd (`:241`). So does `defaultStamp` (`:270-277`).

**Session env (L-183).**
- One writer: `queue-loop.mjs:687-717`.
- Readers:
  - `guard-bash.mjs:109,212,410,442`
  - `loop-derive.mjs:434-438`
  - `loop-gate.mjs:226`
  - `loop-status.mjs:19,83,105,109,115`
  - `tools/ci/e2eGlobalTimeout.mjs:7`
  - `cli.mjs:33`
- Contract variables (`LOOP_TURNS/TICKET/PHASE/REASON`) and test seams (`LOOP_BASE/WORKTREE/GH_SCRIPT/GIT_SCRIPT`) share one namespace. `loop-derive.mjs:421-423` says nothing may set `LOOP_WORKTREE`, and nothing enforces it.
- `loop-gate.mjs:226` is a production gate that reads a test seam.

**Guards (L-208, L-207).**
- `guard-write.mjs:41` and `guard-agent-model.mjs:67` wrap evaluation, including `checkoutRoot()`, in `catch { process.exit(0) }`. They fail open with no message, so `onFailure:"block"` (`loop-settings.json:36,47`) never fires.
- ADR-0010 (Consequences) allows exit 0 only "on a payload it cannot read".
- The agent-check cache path is built twice (`agent-check.mjs:179`, `loop-gate.mjs:47`). A session can write that file with Bash, and no guard sees it.

**Process (L-184).**
- The npm/npx shim is handled separately in five places: `queue-loop.mjs:398-413`, `agent-check.mjs:104-110`, `scripts/e2e-server.mjs:40-52`, `scripts/ios-device.mjs:395-413`, `scripts/optimize-images.mjs:37`.
- Tree kill is handled separately in three: `loop-session.mjs:82-87`, `reap.mjs:218`, `ios-device.mjs` (`killTree`).
- A `shell:true` child killed by a timeout (`agent-check.mjs:109`) or by `c.kill()` (`e2e-server.mjs:39`) leaves its tree behind on Windows.

**CI (L-180, L-185, L-195, L-216, L-162).**
- The scope decision is inline bash (`ci.yml:52-150`). `tests/tooling/ciScope.test.ts:23-47` regex-parses that bash back out of the YAML.
- Six jobs install by hand instead of using `.github/actions/install` (which requires `node-version`):
  - `ci.yml:431,521,587,975`
  - `eas-build.yml:40-46`, `ios-app-cache.yml:26-32`, `ios-bench.yml:21-26`, `ios-device.yml:32-38`, `maestro.yml:109-115`, `soak.yml:60-64,130-134`
- Literal Node versions: `24` in seven places, `22` in three (`soak.yml:62,132`, `ci.yml:958`).
- The gate jobs at `ios.yml:44-52` and `maestro.yml:46-54` are byte-identical.
- The "find or create the open issue, then comment" step is copied four times: `soak.yml:108-114,177-183` (both look up by `--label soak`), `parity-nightly.yml:90-95`, and `tools/ci/report-device-run.sh:16-22`. `audio-soak.yml` does not report at all.
- `postgresMajor.test.ts:41` reads only `ci.yml`, so `soak.yml:41`'s `postgres:16` is unpinned.
- `ios-device.yml:7-14` push paths miss `modules/`, `plugins/`, `patches/`, `app.config.*` and `eas.json`. `nativeScope.mjs:9` lists all of them.

**Overlap:** open #1641 edits `reap.mjs`, `agent-check.mjs`, `queue-loop.mjs:1546-1551` (killed row), `loop-logs.mjs`/`loop-cost.mjs`, `loop-session.mjs` and `docs/agents/checks.md`. Every ticket below that touches those files is blocked by #1641.

## 3. Alternatives considered

### 3a. Who owns routing (the central decision)

| | A: run-state module | B: `decide()` owns every routing choice (picked) |
|---|---|---|
| Shape | `loop-derive.mjs` gains `readRun` + `phaseOf` + `routeOf` (pure). `nextRoute` becomes "read facts, call `routeOf`". `decide`'s `pick` step still judges the result. | `loop-derive.mjs` gains `readRun` + `phaseOf`, consumed by the session-side tools. `nextRoute`/`liveRoute` are deleted. `decide`'s `pick` step receives raw facts and returns the route, asking for facts lazily (`{kind:"ask", fact}`), as the `session` step does today. |
| Depth | Two modules each judge part of one pick: `routeOf` turns closed into `skill:"closed"`, and `decide` turns that into a repick. | One table answers "which ticket, which phase, or stop/park/repick". |
| Locality | Route rules sit next to phase rules, which the session-side tools need. Those tools must stay light (the SessionStart hook has a `CI_BUDGET_MS` of 10 s). | Session-side tools import `phaseOf` only. Supervisor-only policy stays in the supervisor's policy module. |
| Seam | `routeOf(facts)` is a new interface with one caller. | No new interface: a new input shape for an existing step. `queue-loop.mjs:1086` becomes true. |
| Migration risk | Lower: `nextRoute` keeps its call site. | Medium: `runOnce`'s pick sequence changes, including repick. It is pinned first by `queueLoopMain` replays. |

**Pick B.** It is the only option that removes a computation instead of relocating it, and the
`ask` protocol already exists for exactly this lazy-read shape.

### 3b. GitHub access

| | A: full GitHub port | B: `GH_REPO` in `cli.mjs` + `tracker.mjs` widened to the supervisor's reads (picked) |
|---|---|---|
| Scope | Every gh call goes through `github.mjs`: settle's arm/rerun/disarm effects, `ciVerdict.ts`, `mainHealth.ts`. One fake. | The supervisor's and session tools' issue/PR reads move into `tracker.mjs`. Settle's executor keeps `io.run` (its effects are the stepper's own vocabulary, already replay-tested). `ciVerdict.ts`/`mainHealth.ts` keep their injected `exec` (they fake the rollup REST shape, which is their subject). |
| `--repo` rule | Structural inside the port only. | Structural everywhere: `cli.mjs`'s `run("gh")` sets `GH_REPO=REPO` in the child env. gh honours it for every repo-scoped command, including `gh api` `{owner}/{repo}` placeholders. |
| Cost | Largest: every settle test is rewritten. | One L ticket. About 4 argv fakes become `fakeTracker` state; 3 stay, with a stated reason. |

**Pick B.** The verifier noted (L-176 `fix_ok`) that a full port is bigger than the rule needs.
`GH_REPO` enforces the rule for every caller in one line. Widening the existing two-adapter seam
buys the test-fake collapse where it pays.

### 3c. Session env

| | A: params everywhere, no env seams | B: `session-env.mjs` owns the namespace; seams ignored in a loop session; guard floor (picked) |
|---|---|---|
| | `derive`/the gate CLI take hidden flags. | Production code reads env only through `fromEnv()`/`testSeams()`. `testSeams` returns `{}` whenever `LOOP_TURNS` is set (fails closed). `guard-bash` refuses any loop-session command that assigns, exports or unsets a `LOOP_*` variable. That rule is the floor. |
| | `loop-derive.mjs:416-419` records the rejected reason: a documented flag is one the loop can misuse by reading its own usage text. | Keeps the deliberate env-seam design and makes "nothing in the loop may set it" a checked fact rather than prose. |

**Pick B.**

### 3d. Splitting `queue-loop.mjs`

- **(i)** Rename the ports to `github/workspace/...` as L-177 first proposed. The verifier showed the four-port grouping already exists (`queue-loop.mjs:1088`, `realPorts :1359`), so a rename is churn.
- **(ii)** Keep the port names. Move each adapter to the module that owns its dependency:
  - GitHub adapters go to `tracker.mjs`.
  - git/disk adapters go to `workspace.mjs`.
  - spawn configuration and `runTicket` go to `loop-session.mjs`.
  - board glue goes to a new `loop-board.mjs`.
  - caps go to `limits.mjs`.

**Pick (ii)**, in two tickets so that each merge is a small, reviewable move.

## 4. Target design

### 4.1 `tools/loop/loop-derive.mjs`: the phase, read and judged apart

```ts
type Git = (args: string[], opts?: RunOptions) => string;   // cli.mjs git(cwd)
type Gh  = (args: string[], opts?: RunOptions) => string;   // cli.mjs gh
type TrustedComment = { body: string; authorAssociation: string; createdAt?: string };
type CiRead = { pushed: boolean; pr: number|null; sha: string|null; state: "none"|"unreadable"|"settling"|"red"; step: string|null };

type RunFacts =
  | { kind: "none"; branch: string|null; why: string; ambiguous: boolean }
  | { kind: "unknown"; ticket: number|null; branch: string|null; cwd?: string; why: string; ambiguous?: boolean }
  | { kind: "ticket"; ticket: number; branch: string; cwd: string; base: string; head: string;
      headSubject: string; commits: number; changed: string[]; dirty: boolean;
      comments: TrustedComment[] | null;      // null: the tracker could not be read
      ci: CiRead | null };                    // null: not asked, or the head carries no LAND

/** I/O only. `ci` reads the PR only for a head a trusted VERDICT: LAND covers (verdictFor is a parser, not phase policy). */
export function readRun(o?: { cwd?: string; base?: string; worktree?: string; ci?: boolean;
  git?: (cwd: string) => Git; tracker?: Tracker }): RunFacts;

/** Pure: owns the table now at loop-derive.mjs:488-531. `handed` is the supervisor's phase for this session. */
export function phaseOf(facts: RunFacts, handed?: string|null): RunState;   // RunState = today's derive() return shape

/** Composition kept for its 9 callers; no env defaults. */
export const derive = (o = {}) => phaseOf(readRun(o), o.handed ?? null);
```

- **Invariants**
  - `phaseOf` never throws and never does I/O.
  - `reviewRounds`, `ciRounds` and `fixHolds` are `null`, never `0`, when `comments === null`. That keeps `loop-gate.mjs`'s fail-closed distinction.
  - `base` defaults to `"origin/main"`, `worktree` to none and `handed` to none. No env is read.
- **Deleted:** the module-level `run` (`:18`) and the env defaults (`:434-438`).
- **Callers:**
  - `loop-status.mjs` passes `handed: fromEnv().phase`.
  - `loop-gate.mjs` passes `base`/`worktree` from `testSeams()`.

### 4.2 `tools/loop/decide.mjs`: the `pick` step owns the route

```ts
type PickFacts = {
  standing?: RunState | null;          // derive({ci: true}); undefined = not read yet
  known?: IssueFacts | null;           // tracker.facts(standing.ticket)
  tally?: Tally;                       // ledger.tally(n) for the live or pinned ticket
  pinnedFacts?: IssueFacts | null;     // tracker.facts(pinned)
  picked?: PickerRoute;                // tracker.pick(): next-ticket's nextPick, read-only
  pinned: number|null; at: string|null; repicked: boolean; limits: Limits;
};
// decide({step: "pick", ...PickFacts}) returns, in order of need:
//   {kind: "ask", fact: "standing"|"known"|"tally"|"pinnedFacts"|"picked"}
//   {kind: "go", route: Route, redWhileDown: boolean}
//   {kind: "repick"|"stop"|"park", ...}
export function decide(input: DecideInput): Action;
export function afterSession(run, derived): After | null;
export const WAIT: { CAP: number; FLOOR: number; MARGIN: number; TRIES: number };   // re-exported from limits.mjs
```

- **What the step contains**
  - `liveRoute`'s rules (ambiguous → stop; not `in-progress` → not live).
  - `nextRoute`'s rules:
    - closed → repick.
    - A LAND on this head → E.
    - A pushed G head → settle.
    - `fix` → C.
    - The handoff phase comes from the tally.
    - An owner relabel releases the pin.
    - `ready-for-agent` still holds the pin.
  - Today's `pick` checks: handoff skill, ambiguous, `redWhileDown`.
- **Ordering contract:**
  1. `standing` is always asked first.
  2. `known` only when `standing.onTicket`.
  3. `tally` only for a live or pinned number.
  4. `pinnedFacts` only with no live run.
  5. `picked` only when neither applies.

  This is today's read order, so the gh call count per pass is unchanged.
- **Exports shrink from 12 to 3** (`decide`, `afterSession`, `WAIT`). `handoffOf`, `exhausted`, `RESUMABLE`, `resumePhase`, `apiFailure`, `waitFor`, `afterRefusal`, `outcomeOf` and `reasonFor` become private.
- **Deleted:** `liveRoute`, `nextRoute` and the `tracker.pick` composition in `realPorts` (`queue-loop.mjs:1366-1374`). The picker port remains `pick: () => nextPick()`, and the recap side effect stays in the port.

### 4.3 `tools/loop/tracker.mjs`: GitHub, widened (the file name is kept; docs already name it)

```ts
export const TRUSTED_AUTHORS: readonly ["OWNER","MEMBER","COLLABORATOR"];
export function trustedComments<T extends {authorAssociation?: string; author_association?: string}>(cs: T[]): T[];
export const TRUSTED_SELECT: string;             // the jq form, for rule 25's command
export const readIssue: (n: number) => string;   // rule 25's command text
export interface Tracker {
  claim(n): void; release(n): void; park(n): void; comment(n, bodyFile): void;
  issue(n, opts?): { state: string; labels: string[] };
  facts(n): IssueFacts | null;                       // was queue-loop ticketFacts; null on failure, never zeros
  comments(n, opts?): TrustedComment[];              // throws on failure; callers decide null
  openPrFor(branch, opts?): { number: number; headRefOid: string } | null;
  prsFor(q: { branch: string|null; ticket: number }): Pr[];   // pushedPr's listing, --state all
  pr(n): Pr | null;
  openPrs(): Pr[];                                   // --paginate; replaces next-ticket's module cache
  createPr(o: { head: string; title: string; bodyFile: string }): string;
  openLabelled(label): { number: number; title: string; createdAt: string }[];  // parityRed, sweep
}
export function ghTracker(gh?: Gh): Tracker;
export function fakeTracker(state?: FakeState, o?: { fail?: string[] }): Tracker & { held(n): HeldIssue };
```

- `cli.mjs`'s `run("gh")` sets `GH_REPO: REPO` in the child env. The explicit `--repo REPO` arguments become redundant and are left alone; the env is what enforces the rule.
- `pushedPr`'s matching policy stays a pure function: `mine`, `stale`, `take` at `queue-loop.mjs:917-924`. It moves beside its caller in the tracker port factory. The supervisor port is `trackerPort({gh, events})` in `tracker.mjs`.
- `brief.mjs` keeps the guard-oriented parsing (`apiMethod`, `readsComments`, `untrustedRead`) and imports `TRUSTED_SELECT` from `tracker.mjs`. The verifier warned that moving this parsing would be wrong.
- **Error modes:**
  - Reads that used to return a sentinel (`ticketFacts` → `reviewRounds: null`) keep doing so.
  - `comments()` throws, and `readRun` maps that to `comments: null`.

### 4.4 `tools/loop/session-env.mjs`: the only module naming `LOOP_*`

```ts
export type SessionFacts = { loop: boolean; ticket: number|null; phase: "B"|"C"|"D"|"E"|"F"|"G"|null; reason: string|null; turns: number|null };
/** `loop` is `Boolean(LOOP_TURNS)`, the CLAUDE.md definition. Malformed values read as null, never as a guess. */
export function fromEnv(env?: NodeJS.ProcessEnv): SessionFacts;
/** Writer: what queue-loop spawns a session with (moved from queue-loop.mjs:687-717, unchanged content). */
export function spawnEnv(o: { number: number; size: string|null; at: string|null; reason: string|null; turns: number; context: number }, base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
/** Test seams, renamed LOOP_TEST_{BASE,WORKTREE,GH_SCRIPT,GIT_SCRIPT}. Always {} when env.LOOP_TURNS is set. */
export function testSeams(env?: NodeJS.ProcessEnv): { base?: string; worktree?: string; ghScript?: string; gitScript?: string };
export const LOOP_VARIABLE: RegExp;   // /^LOOP_[A-Z_]+$/, read by guard-bash's floor
```

- **Constraint:** the module has no imports, so `cli.mjs`, `e2eGlobalTimeout.mjs` and Playwright's CommonJS loader can load it (as they load `limits.mjs`).
- **Floor:** a `guard-bash` rule that applies only in a loop session refuses any command that does one of these:
  - assigns `LOOP_*` (`X=1 cmd`, `export`, `env LOOP_…=`)
  - unsets it (`unset`, `env -u`)
  - sets or removes it in PowerShell (`$env:LOOP_…`, `Remove-Item env:LOOP_…`)

  It uses `shell.mjs`'s `literalAssignments` and `commands()`. `tests/tooling`'s scan (`loopTestEnv.test.ts`) becomes "no file under `tools/loop` or `tools/ci` except `session-env.mjs` names `LOOP_`". `clearLoopEnv.mjs` stays: RULES 3 cites it, and it is what lets the seams work under `loop:test` inside a loop session.

### 4.5 Guards fail closed (L-208, L-207)

- Each `PreToolUse` guard follows the same three steps:
  1. **Parse the payload.** On failure: stderr, exit 0. This is ADR-0010's recorded exception, kept.
  2. **No subject** (no `file_path`, not an Agent/Task dispatch): exit 0.
  3. **Evaluate.** If evaluation throws, `checkoutRoot()` included: stderr `"<guard>: could not judge this call (<first line>); refusing it."`, exit 2.

  No guard catches its own evaluation into an allow.
- `agent-check.mjs` exports `cachePath(cwd = process.cwd()): string`. `loop-gate.mjs:47` imports it.
- **Floor for the cache:** in a loop session, `guard-bash` refuses any command that names `agent-check-cache.json`. Only `agent-check.mjs` writes it.

### 4.6 `tools/loop/limits.mjs`: every cap

Plain constants, with no imports, as now (`limits.mjs:1`).

```ts
export const LIMITS: { BREAKER: 3; CI_ROUNDS: 3; MAX_HANDOFFS: 8; TICKET_HOLDS: 10; UPDATES: 3;
  WAIT: {...}; SETTLE: { DEADLINE_MS; STUCK_MS }; MAX_REVIEW_ROUNDS: 3; MAX_FIX_HOLDS: 2 };
export const SESSION_POLICY: { MODEL_BY_PHASE; EFFORT_BY_PHASE; CONTEXT_BY_SIZE; CONTEXT_DEFAULT;
  TURNS_BY_SIZE; TURNS_DEFAULT; USD_BY_SIZE; USD_DEFAULT; TICKET_BUDGET_USD };
export const STALL_MS, CHECK_BASH_TIMEOUT_MS, BASH_DEFAULT_TIMEOUT_MS, REFRESH_TIMEOUT_MS, HEARTBEAT_MS, RESTART = 75;
```

- `decide(input)` uses `input.limits ?? LIMITS`, so tests can still pass small caps.
- `loop-cost.mjs` keeps prices (`RATES`) and imports the caps.
- `settle.mjs`, `loop-gate.mjs` and `decide.mjs` import their caps from here.
- `run-loop.mjs`, `scripts/await-run.mjs` and `decide.test.ts` stop importing `queue-loop.mjs`.

### 4.7 `queue-loop.mjs` after the split

- **What it keeps:** `runOnce(ports, events, pinned, at, loop)`, `realPorts(book, screen, events)`, `main(deps)`, `holdFor`, `parkAndRecord`, `preflight`, the `HOLDS`/`PARKABLE` tables and the CLI block. That is about 600 lines.
- **Port additions (L-179):**
  - `workspace.parkAsked(n)`, `workspace.clearParkAsk()`, `workspace.ciLog(n): string|null`
  - `ledger.logOf(n)`, `ledger.prune()`

  `runOnce` and `main` stop importing `fs`.
- **CLI block (L-213):** calls `process.chdir(ROOT)` before `main()`. It is not inside `main`, which tests call in-process.
- **`--check`:** builds `realPorts` and performs only reads: `standing`, `tracker.facts(n)` for the standing ticket, `ledger.tally`, `nextPick` *without* claiming. It prints them and exits 0. It is the read-wiring smoke a session runs before pushing a loop change. It never syncs, prunes, claims or spawns.
- **Unchanged contracts:**
  - The path `tools/loop/queue-loop.mjs`: the running `run-loop.mjs` holds it in memory.
  - Exit code `75`.
  - `npm run queue:loop`.
  - The `PROTOCOL` list.
  - The CLI paths a session runs: `loop-status`, `loop-gate`, `brief`, `next-ticket`, `claim`, `workspace`.
  - Hook paths in `.claude/settings.json` and `loop-settings.json`.
- **Moved:**
  - spawn argv (`queueLoopArgs`, `allowedTools`, `turnsFor`, `contextFor`, `plannedModel`), `runTicket` and `ticketRun` go to `loop-session.mjs`.
  - `openTicket`, `sessionView`, `roundOf`, `journaled` and `screenEvents` go to `loop-board.mjs`.
  - `syncCheckout`, `reinstall`, `defaultStamp`, `peerWorktrees`, `removeLanded`, `refreshWorktree`, `loopMoved`, `loopSha`, `worktreeOf` and `standing` go to `workspace.mjs` as `workspacePort({root, git})`.
- **L-205:**
  - `session.spawn` calls `claim(n, title, run, tracker)` in-process. It reads `{branch, won, why}`, and on a throw uses `failedClaim(err)`'s reason. The tab-protocol parsing at `:1452,1455` is deleted.
  - `removeWorktree` is called in-process with `git: gitAt(ROOT)`. The supervisor's cwd is `ROOT` by the CLI's `chdir`, which `removeWorktree`'s own cwd refusal (`workspace.mjs:159`) requires.
  - The `npm run worktrees:remove` calls and their source-text pin (`loopDocsAreExecutable.test.ts:281`) are deleted. The npm script stays for sessions (RULES 39).

### 4.8 `scripts/lib/proc.mjs`: spawning a bin and killing its tree

```ts
/** npm/npx are .cmd shims on Windows: a quoted command line under shell, else file+args. Only argv this repo writes. */
export function runBin(file: string, args: string[], opts?: ExecFileSyncOptions): string | Buffer;
/** Async; on `timeoutMs` it kills the *tree* (taskkill /T /F on win32, process-group SIGKILL elsewhere), then resolves {status: null, timedOut: true}. */
export function spawnBin(file: string, args: string[], opts?: SpawnOptions & { timeoutMs?: number }): Promise<{ status: number|null; timedOut: boolean; stdout: string; stderr: string }>;
export function killTree(pid: number): void;   // never throws; "already gone" is success
export function sleepSync(ms: number): void;   // Atomics.wait, replacing dev-stack.mjs:95's child node
```

- Only `node:` imports. `cli.mjs` stays independent of it.
- **Callers:**
  - `queue-loop`/`workspace` `sh` (only `npm ci` remains after 4.7)
  - `agent-check.mjs` `runStep`
  - `loop-session.mjs` watchdog
  - `reap.mjs` kill
  - `scripts/e2e-server.mjs` (its children are killed via `killTree` on exit)
  - `scripts/ios-device.mjs`
  - `scripts/optimize-images.mjs`
  - `scripts/dev-stack.mjs`
- **Invariant:** no file outside `proc.mjs` passes `shell: true` or spawns `taskkill`. A scan pins this.

### 4.9 CI modules

- **`tools/ci/scope.mjs`** (only `node:` imports, since it runs before `npm ci`):
  - `scopeOf(changed: string[]): {app, harness, scans}`, with the two allowlists as exported regexes.
  - A CLI `node tools/ci/scope.mjs <base>` that prints `app=`, `harness=`, `scans=` and `native=` lines (`native` through `nativeScope.needsNative`).
  - `ci.yml` keeps only the "identical tree already green" short-circuit and the no-base fallback.
  - `ciScope.test.ts` calls `scopeOf`. Its derivations (docs a test reads, files the loop imports) are kept as they are.
- **`changedFiles(git, {base, range: "..."|"..", untracked: boolean, worktree: boolean})`** in `cli.mjs` (L-209). Each caller states its semantics explicitly:
  - `agent-check`: `...`, worktree, no untracked.
  - `related-tests`: `...`, worktree, untracked (RULES 3: a new test file is selected).
  - `nativeScope`/`scope.mjs`: `..`.

  `readRun` keeps its own `base...HEAD`.
- **`.github/actions/install`:**
  - `node-version` becomes optional; the default is `node-version-file: .node-version` (a new file, `24`).
  - A new input `restore: "true"|"false"`. With `false`, it always runs `npm ci` and never restores, for the jobs that avoid the cache on purpose (`ci.yml:372`).
  - The cache key uses `steps.setup.outputs.node-version`.
  - Every inline setup-node + `npm ci` uses it.
  - The only literal versions left are production pins (`22`: `soak.yml` jobs, `ci.yml` build). A test ties them to `deploy/runtime.json`.
- **`tools/ci/device-gate.sh`:** the gate both `ios.yml` and `maestro.yml` run. `deviceWorkflowsGate.test.ts` executes the script, not two YAML extractions.
- **`tools/ci/report-to-tracker.sh <label> <title> <body-file>`** (generalised from `report-device-run.sh`):
  - It finds the open issue keyed by label *and* exact title, passing `--arg t "$title"` to jq (L-203b). Then it comments on it or creates it.
  - Callers: both soak jobs (distinct titles), parity-nightly, ios/maestro, and audio-soak (newly reporting). Parity's close-on-pass step stays its own.
  - `docs/agents/issue-tracker.md`'s label rows name the script.
- **`ios-device.yml` push paths:** gain `app.config.*`, `eas.json`, `modules/**`, `plugins/**` and `patches/**`. A test asserts that every class `nativeScope.CONFIG` matches is covered.

## 5. Migration

The supervisor reads `tools/loop` from the shared checkout (main) and restarts itself with exit 75 when that changes (`loopMoved`, `queue-loop.mjs:867`). **Every merge is therefore a live deploy.** Every ticket keeps these fixed:

- the entry path and exit code (§4.7)
- every CLI path a session or hook runs
- the result schema's required fields
- `LOOP_TURNS`/`TICKET`/`PHASE`/`REASON`

Within a PR:

- A move is one commit: the move and every import updated together. No commit leaves an import pointing at a missing export.
- Each ticket adds no re-export shims, except where stated.
- `loop:test` imports every module, so an import-time throw or an ESM cycle reds CI.
- `queue-loop.mjs --check` (from T3) covers the wiring in `realPorts` that `loop:test` never executes.

| Step | Ticket | Deletes |
|---|---|---|
| 1 | T1: small loop defects (§8) | the duplicate test name; the leaked tmp dir; `landable`'s "cannot read" crash path |
| 2 | T2: guards fail closed; `session-env.mjs` | `guard-write`/`guard-agent-model`'s silent `catch`; 7 production env reads; the `LOOP_BASE`/`WORKTREE`/`*_SCRIPT` names |
| 3 | T3: `tracker.mjs` widened; `GH_REPO` | `ticketFacts`, `pushedPr`, `publishForReview`, `repark`'s argv; `openPrs` cache; `loop-derive`'s trust copy; about 4 argv gh fakes |
| 4 | T4: `readRun`/`phaseOf`; route in `decide` | `liveRoute`, `nextRoute`, `derive`'s env defaults, the module-level git `run`, 9 `decide` exports, about 190 helper-test lines (converted to `decide()` rows where a path exists) |
| 5 | T5a: caps to `limits.mjs`; board and spawn out | 8 constants and `LIMITS` in `queue-loop.mjs`; await-run's and run-loop's import of the god module |
| 6 | T5b: adapters into ports; in-process claim/remove; `chdir` | the tab protocol; `npm run worktrees:remove` from the supervisor; `runOnce`'s `fs`; 24 test `chdir`s; `stubPorts`/`place`/`OPTIONAL` (one fake per port) |
| 7 | T6: `proc.mjs` | 5 shim copies, 3 tree-kill copies, dev-stack's sleeping child |
| 8 | T7: `scope.mjs`, `changedFiles`, ios-device paths | about 75 lines of bash; the YAML regex extractor |
| 9 | T8: workflows | about 13 install blocks; 9 literal Node versions; one duplicate gate; 3 copies of the report step |
| 10 | T9: one owner per constant; unrunnable scripts | 2 `HARD_FACTOR` copies, `CROP`, 2 copies of `5199`, sample-count restatements, `db:reset` |
| — | T11 (ready-for-human) | the stale `soft_deny` sentence; stale `skills-lock.json` entries |

## 6. No-regression strategy

- **Behaviour pinned before each move (red-first where a bug is fixed):**
  - **T1:**
    - `decide.test.ts` gains: "HTTP 502 waits while not stuck"; "HTTP 502 goes to the owner once stuck"; "HTTP 403 still goes to the owner at once" (the existing row at `:216` stays).
    - `loopGate.test.ts` gains: "a merge whose second parent is not on main is refused as unreviewed (exit 1), not 'cannot read' (exit 2)". It goes red on today's code.
    - `claim.test.ts` gains: "a claim leaves no tmp dir".
    - `loopDocsAreExecutable.test.ts` keeps its example-field loop (verifier's `fix_ok`) and gains a check that the schema has `additionalProperties:false`.
  - **T2:** spawned-guard tests, each with its planted defect watched failing. The plant is to restore `catch {exit(0)}`.
    - An evaluation throw (a payload `cwd` outside any git repo) exits 2 with stderr.
    - An unreadable payload exits 0 with stderr.
    - `guardBash.test.ts` gains rows that refuse `LOOP_TEST_BASE=x node tools/loop/loop-gate.mjs`, `export LOOP_TURNS=`, `env -u LOOP_TURNS …`, `$env:LOOP_WORKTREE='…'` and `cat …/agent-check-cache.json` in a loop session, and allow them outside one.
    - `session-env` table test: `testSeams({LOOP_TURNS:"1", LOOP_TEST_BASE:"x"})` is `{}`.
  - **T3:** before moving, `queueLoop.test.ts`'s `pushedPr`/`ticketFacts` cases are rewritten against `fakeTracker` state and must pass on the *old* adapters through a thin wrapper first. `cli.test.ts` asserts that the spawned gh env carries `GH_REPO=metasito/murlan` (plant: drop it). `--check` is exercised in a child process with `LOOP_TEST_GH_SCRIPT`.
  - **T4:** first, record `nextRoute`'s current outputs for every existing `queueLoop.test.ts` `nextRoute` case and every `queueLoopMain` replay as `decide({step:"pick"})` rows, green against a wrapper that calls today's `nextRoute`. Then move the logic. The 12 `derive()` scratch-repo tests become a `phaseOf` table plus 3 `readRun` integration tests (detached, unreadable tracker, LAND with CI).
  - **T5a/T5b:** `queueLoopMain.test.ts` replays run unchanged before and after (they drive `main` through ports). A new "port contract" test asserts that `realPorts` exposes every member `runOnce` reads, derived by scanning `runOnce`'s source for `tracker.`/`workspace.`/`ledger.`/`session.` member accesses. It goes red if a move drops one.
  - **T6:** Windows-only test: `spawnBin("npm", ["exec","--","node","-e","setInterval(()=>{},1e3)"], {timeoutMs: 2000})` leaves no descendant alive (process table read through `reap.mjs`'s reader). It is skipped off win32 and named in the PR body for CI.
  - **T7:** `ciScope.test.ts` runs its existing derivations against `scopeOf` and against the old YAML extraction in one commit. Both must agree; the extractor is deleted in the next commit.
  - **T8:** `workflowsParse`, `ciWorkflowsPinned`, `workflowScriptPathExists` and `deviceWorkflowsGate` stay green. New tests:
    - `postgresMajor.test.ts` reads every `.github/workflows/*.yml` (the L-162 remnant).
    - `deployRuntime.test.ts` checks that every literal `node-version` equals `manifest.node` and that every other job uses the install action or `.node-version`.
    - Report-script table test with a stub gh: two titles under one label reach two issues.
- **What catches what:**
  - `loop:test` runs the CI job and every import. `npm test` runs `tests/tooling` scans.
  - The PR's own `ci.yml` exercises the install action and scope job.
  - Scheduled and dispatch-only workflows (soak, ios, maestro, eas-build, ios-device, audio-soak) are not run by a PR. T8's DoD dispatches `soak.yml` and `parity-nightly.yml` on the branch (`gh workflow run … --ref agent/<n>-…`, then `scripts/await-run.mjs`). macOS workflows are left to their schedule, whose red now files an issue.
  - No layout is involved: nothing here reaches `tests/e2e`. `ci.yml`'s scope already runs the full app suite on any non-test `tools/loop` change (`ci.yml:144-146`).
- **Live-loop guard:** each loop ticket's "before pushing" gate includes `node tools/loop/queue-loop.mjs --check` (from T3 on). Before T3, `node -e "import('./tools/loop/queue-loop.mjs')"` from the worktree.

## 7. Coverage table

| ID | Covered by | Note |
|---|---|---|
| L-162 (remnant) | T8 | `postgresMajor.test.ts` reads every workflow; soak.yml:41 pinned. The deployRuntime half is dropped as redundant (verifier). |
| L-175 | T4 | `readRun`/`phaseOf`; route into `decide` (§3a B). Only `{git, tracker}` ports, per `fix_ok`. |
| L-176 | T3 | `GH_REPO` structural; `tracker.mjs` widened (§3b B). Settle, ciVerdict and mainHealth keep their fakes, with the reason stated. |
| L-177 | T5a + T5b | Port names kept (verifier); adapters move by dependency; `github.mjs` not created. |
| L-178 | T5a | `limits.mjs` with `LIMITS` + `SESSION_POLICY`; `decide`'s `limits` stays injectable. |
| L-179 | T5b | Port additions; `chdir`s deleted. |
| L-180 | T7 | `scope.mjs` carries `native` and stays `node:`-only (correction). |
| L-181 | T4 | Exports 12 → 3; tests with no `decide()` path are kept (`fix_ok`). `exhausted` goes private (no external caller, correction). |
| L-182 | T1 | Transient classes only (5xx, 429, rate limit) wait until `stuck`; 403 stays an immediate owner verdict. |
| L-183 | T2 | `session-env.mjs` + guard floor + seams ignored in a loop session. |
| L-184 | T6 | Light `proc.mjs`; `cli.mjs` stays independent (`fix_ok`). |
| L-185 | T8 | The install action defaults from `.node-version` (the input already exists, per the correction); `restore` input; device-gate script; production pins tested. |
| L-186 | T9 (script + README + runbook), T11 (`soft_deny` text) | `db:reset` is removed; README:60-71 and DEPLOY-RUNBOOK:53 name the direct command. |
| L-187 | T9 | `isInvokedDirectly`; check first that `measureHeadsUpBalance.ts` can import `.mjs` (correction). |
| L-188 | T1 | Exit 1 of `--is-ancestor` breaks the walk into the "no review" refusal (corrected defect). |
| L-189 | T1 | `.on("error", () => {})` on the detached child. |
| L-190 | T1 | `rmSync` the dir in `finally` (`claim.mjs:118` at MAIN). |
| L-191 | T9 | `clearPort(port, {pids: chosen.clear})` kills only the verified pids. |
| L-192 | No change | `record()`'s read feeds `billOf(entry, prior)` (`loop-logs.mjs:304,333`), and the ledger is permanent by design. The verifier recommends not changing it; see §10. |
| L-194 | T1 | `printDetail` prints `npm run queue:claim -- <n> "<title>"` for `implement`; comments read with `--paginate`. |
| L-195 | T7 | Paths mirror `nativeScope.CONFIG` plus `patches/`, pinned by a test (correction: `app.config.*`, `eas.json`). |
| L-196 | T9 | `HARD_FACTOR` is exported once from `e2e-budget.mjs`; RULES 46's file list is updated (rule 43). |
| L-197 | T9 | `build-court-art.mjs` imports `COURT_ART_BOX`. |
| L-198 | T9 | A pin test over `recorder.ts`, `diagnostics-collector.mjs`, `ios-device.mjs` and `checks.md:47`. No app-code import into scripts (`fix_ok`). |
| L-199 | T9 | `server:dev` drops the prefix (`app.ts:59` treats unset as dev). `server:prod` runs `node scripts/server-prod.mjs`, which sets `NODE_ENV` and then imports `server_dist/index.mjs`. |
| L-200 | T8 | `checks.md:96` reworded to "refuses a dispatch from any branch but …". |
| L-201 | T1 | All four test fixes; `workspace.mjs` gains an `rm` seam for `workspace.test.ts:344`. |
| L-202 | T1 | `additionalProperties:false`; the example loop is kept. |
| L-203 | T8 | (a) `sort -V`; (b) `--arg t` in the shared report script; (c) skipped (verifier: moot). |
| L-204 | T11 | Owner decision: regenerate to the installed skills (default) or delete. |
| L-205 | T5b | In-process `claim()` and `removeWorktree()`; requires cwd = ROOT, which T5b provides. |
| L-206 | T3 | Trust policy moves into `tracker.mjs`; `brief.mjs` keeps the guard parsing (`fix_ok`). |
| L-207 | T2 | `cachePath()` export + guard-bash floor (path-only duplication, per the correction). |
| L-208 | T2 | Evaluation failure exits 2; payload failure stays exit 0 (ADR-0010). |
| L-209 | T7 | `changedFiles` with explicit options per caller; no forced single answer (`fix_ok`). |
| L-210 | T9 | tools/ci and scripts import `cli.mjs`'s `gh`/`git`/`MAX_BUFFER`; the `cli.test.ts` scan widens to `tools/ci`, `scripts`. |
| L-211 | T9 | `BASE_PORT`/`PORT_SPAN` exported; `reap` sweeps the span (the real defect). The process-table move is not done (optional per the verifier). |
| L-212 | T3 (`openPrs`), T4 (`git(cwd).lines/.text` in `cli.mjs`; loop-derive, loop-gate, brief), T6 (agent-check wrapper; dev-stack `sleepSync`) | |
| L-213 | T5b | `chdir(ROOT)` in the CLI block (verifier's better fix), not three `ROOT` joins. |
| L-214 | T8 | Delete the `--pr` sentence from `checks.md:103-106`. |
| L-215 | T9 | Each scenario exports `samples`; pulseCost's is derived (21 − 1 cold). |
| L-216 | T8 | `report-to-tracker.sh`, title-keyed; audio-soak reports. |

## 8. Proposed tickets

The ticket bodies below are specs; each fits in 40–80 lines when written out. "While iterating" and "Before pushing" are the checks.

### T1 — Loop: six small defects in settle, the gate, the screen, claim, the picker and the result schema
- **Size:** S. **Labels:** loop, bug.
- **Files:**
  - `tools/loop/settle.mjs:46,144-148`, `decide.mjs:286-289`
  - `loop-gate.mjs:152`, `loop-screen.mjs:478`, `claim.mjs:118`, `next-ticket.mjs:276-283,297`, `result-schema.json`, `workspace.mjs` (`rm` seam)
  - tests: `decide`, `loopGate` (`:643,662` duplicate name), `claim`, `loopHoldSurvives:36`, `worktreeRemoveCommand:257`, `workspace:344`, `loopDocsAreExecutable`, `nextTicket`
- **Blocked by:** none.
- **DoD:**
  - [ ] A transient gh read error (5xx, 429, "rate limit") waits until `stuck`, then goes to the owner. 403 still goes to the owner at once.
  - [ ] `landable` refuses a merge with an off-main second parent as "no review" (exit 1).
  - [ ] `openExternally`'s child has an error listener.
  - [ ] `claim()` removes its tmp dir.
  - [ ] `printDetail` prints `queue:claim` for implement; comments are read across pages.
  - [ ] The schema rejects extra fields; the example check is kept.
  - [ ] The four test defects are fixed; the duplicate name is renamed.
- **Checks:**
  - While iterating: `node --import ./tools/loop/tests/helpers/clearLoopEnv.mjs --test tools/loop/tests/decide.test.ts tools/loop/tests/loopGate.test.ts`.
  - Before pushing: each changed test file alone; `npm run agent:check`; `node -e "import('./tools/loop/queue-loop.mjs')"`.

### T2 — Loop: guards fail closed, and `LOOP_*` has one owner with a guard floor
- **Size:** M. **Labels:** loop.
- **Files:**
  - new `tools/loop/session-env.mjs`
  - `guard-write.mjs:40-43`, `guard-agent-model.mjs:66-68`, `guard-bash.mjs:109,212,410,425-447` (+ two rules)
  - `cli.mjs:19-34`, `loop-derive.mjs:416-438`, `loop-gate.mjs:47,226`, `loop-status.mjs`, `tools/ci/e2eGlobalTimeout.mjs`, `queue-loop.mjs:687-717` (`sessionEnv` → `spawnEnv`), `agent-check.mjs:178-180` (`cachePath`)
  - tests: `guardWrite`, `guardAgentModel`, `guardBash`, `loopTestEnv`, `loopGate`, `loopDerive`, `cli`, `loopStatus`, `brief`
- **Blocked by:** T1, #1641.
- **DoD:**
  - [ ] `guard-write` and `guard-agent-model` exit 2 with a stderr reason when evaluation throws. An unreadable payload exits 0 with stderr (ADR-0010).
  - [ ] Only `session-env.mjs` names `LOOP_` under `tools/loop` and `tools/ci` (scan).
  - [ ] The seams are renamed `LOOP_TEST_*` and ignored whenever `LOOP_TURNS` is set.
  - [ ] guard-bash refuses `LOOP_*` assignment, export or unset, and any command naming `agent-check-cache.json`, in a loop session only. Each refusal is shown red with the rule removed.
  - [ ] `loop-gate.mjs` reads the cache through `cachePath()`.
- **Constraint:** never touch `.claude/settings.json` or `loop-settings.json`; hook registration is unchanged.
- **Checks:** guard tests alone; `npm run agent:check`; import smoke.

### T3 — Loop: GitHub through `tracker.mjs`, repo fixed by `GH_REPO`, trust policy in one place
- **Size:** L. **Labels:** loop.
- **Files:**
  - `tools/loop/cli.mjs` (`GH_REPO` in the child env), `tracker.mjs` (§4.3)
  - `loop-derive.mjs:334-414` (`trustedComments`, `parityRed`, `readComments`, `readCi` via tracker)
  - `queue-loop.mjs:474-578,625-676,909-945,1365-1415` (into `trackerPort`), add `--check`
  - `next-ticket.mjs:3,9-11,175-180,229,297`, `workspace.mjs:239`, `claim.mjs`, `brief.mjs:45-62`, `guard-bash.mjs:19`, `settle.mjs:17,322-325` (import only)
  - `docs/agents/issue-tracker.md` (`TRUSTED_AUTHORS` location)
  - tests: `tracker`, `queueLoop`, `loopDerive`, `nextTicket`, `workspace`, `cli`, `issueReadsAreTrusted`
- **Blocked by:** T2.
- **DoD:**
  - [ ] Every gh child env carries `GH_REPO` (test with the plant removed).
  - [ ] No `tools/loop` module except `cli.mjs`, `tracker.mjs`, `settle.mjs`'s executor, `ciVerdict.ts` and `mainHealth.ts` builds a gh argv (scan).
  - [ ] The open-PR listing paginates; the module cache is gone.
  - [ ] Trust policy lives only in `tracker.mjs`.
  - [ ] `queue-loop.mjs --check` prints standing, facts, tally and pick without writing.
  - [ ] The PR body names which fakes stayed and why.
- **Checks:** `node tools/loop/queue-loop.mjs --check` from the worktree; changed tests alone; `npm run agent:check`.

### T4 — Loop: the phase read and judged apart; `decide()` owns every routing choice
- **Size:** L. **Labels:** loop.
- **Files:**
  - `tools/loop/loop-derive.mjs:18,416-558`
  - `decide.mjs` (the `pick` step absorbs `queue-loop.mjs:99-184`; exports narrowed)
  - `queue-loop.mjs:1123-1131` (pick asks loop), `:1086` comment
  - `cli.mjs` (`git(cwd).lines/.text`), `loop-gate.mjs:31-33`, `brief.mjs:24-31`, `loop-status.mjs`
  - tests: `loopDerive`, `decide`, `queueLoop:1127-1310`, `queueLoopMain`
- **Blocked by:** T3.
- **DoD:**
  - [ ] `phaseOf(facts, handed)` is pure; `derive` is the composition.
  - [ ] `nextRoute`/`liveRoute` are deleted; their rows pass as `decide({step:"pick"})` rows recorded *before* the move.
  - [ ] The gh/git call count per pass is unchanged (a counting fake asserts it).
  - [ ] `decide.mjs` exports exactly `decide`, `afterSession`, `WAIT`.
  - [ ] Helper tests with no `decide()` path are kept as named private-path tests via a `__test` export in the test file only. If none remain, the PR says so.
- **Checks:** `--check`; `decide`/`loopDerive` alone; `npm run agent:check`.

### T5a — Loop: caps into `limits.mjs`; spawn config and board glue out of `queue-loop.mjs`
- **Size:** M. **Labels:** loop.
- **Files:**
  - `tools/loop/limits.mjs`
  - `queue-loop.mjs:186-253,380-422,720-855,985,1044,1302-1352`
  - `loop-session.mjs`, new `loop-board.mjs`, `loop-cost.mjs:20-71`, `decide.mjs:73`, `settle.mjs:34-40`, `loop-gate.mjs:95-98`, `run-loop.mjs:4`, `scripts/await-run.mjs:8`
  - tests: `decide:7-9`, `runLoop`, `queueLoop`, `loopDocsAreExecutable:6`, `ticker`, `loopRender`
- **Blocked by:** T4, #1641.
- **DoD:**
  - [ ] Every cap is defined once, in `limits.mjs`.
  - [ ] No file imports `queue-loop.mjs` but its tests.
  - [ ] Each move is one commit.
  - [ ] `queue-loop.mjs` path and exit 75 are unchanged.
  - [ ] `--check` passes.
- **Checks:** `--check`; `npm run agent:check`.

### T5b — Loop: adapters behind their ports; in-process claim and removal; the supervisor runs from ROOT
- **Size:** M. **Labels:** loop.
- **Files:**
  - `tools/loop/queue-loop.mjs:255-365,581-647,867-884,987-1014,1137-1139,1293,1416-1498,1693,1712-1721`
  - `workspace.mjs` (`workspacePort`), `claim.mjs`, `loop-logs.mjs` (ledger port `logOf`/`prune`)
  - tests: `queueLoop:38-60`, `queueLoopMain:47-67,1948-2004`, `ticker:435-504`, `loopRender:498`, `lockDrift:131`, `loopDocsAreExecutable:281`
- **Blocked by:** T5a.
- **DoD:**
  - [ ] `runOnce` and `main` import no `fs`.
  - [ ] No test calls `process.chdir`.
  - [ ] The claim and worktree removal run in-process; the tab protocol is gone.
  - [ ] The CLI `chdir`s to ROOT before `main`.
  - [ ] The port-contract test passes.
  - [ ] `stubPorts`/`place`/`OPTIONAL` are replaced by one fake per port.
- **Checks:** `--check`; `npm run agent:check`.

### T6 — Tooling: one process helper that kills the tree on Windows
- **Size:** M. **Labels:** loop.
- **Files:**
  - new `scripts/lib/proc.mjs`
  - `tools/loop/workspace.mjs` (`sh`), `agent-check.mjs:104-110,174-176`, `loop-session.mjs:82-87`, `reap.mjs:218`
  - `scripts/e2e-server.mjs:38-52`, `ios-device.mjs:395-413`, `optimize-images.mjs:37`, `dev-stack.mjs:95`
  - tests: `agentCheck*`, `reap`, `loopSession`, new `proc`
- **Blocked by:** T5b, #1641.
- **DoD:**
  - [ ] An agent-check step timeout leaves no descendant (win32 test).
  - [ ] e2e-server's children die as a tree on exit.
  - [ ] No `shell: true`/`taskkill` outside `proc.mjs` (scan).
  - [ ] `cli.mjs` does not import it.
- **Checks:** `node --test` on the new and changed tests; `npm run agent:check`; `npm run play` boots locally once.

### T7 — CI: the scope decision as a module, one change-set helper, ios-device paths from nativeScope
- **Size:** M. **Labels:** ci.
- **Files:**
  - new `tools/ci/scope.mjs`
  - `.github/workflows/ci.yml:52-150`, `tools/ci/nativeScope.mjs:54-60`, `tools/loop/cli.mjs` (`changedFiles`), `agent-check.mjs:40-52`, `related-tests.mjs:60-66`, `.github/workflows/ios-device.yml:7-14`
  - tests: `ciScope`, `nativeScope`, `agentCheckSubject`, new ios-device paths test
- **Blocked by:** T6 (`agent-check.mjs`).
- **DoD:**
  - [ ] ci.yml's scope step is the short-circuit + `node tools/ci/scope.mjs "$base"`.
  - [ ] `ciScope.test.ts` calls `scopeOf`; the extractor is gone.
  - [ ] Each `changedFiles` caller's semantics is named in a table test.
  - [ ] ios-device paths cover every nativeScope class.
- **Checks:** `node tools/ci/scope.mjs origin/main` locally; the PR's own CI scope job; `npm test` scoped files alone.

### T8 — CI: one install action, one device gate, one tracker reporter; Node and Postgres pins checked
- **Size:** M. **Labels:** ci.
- **Files:**
  - `.github/actions/install/action.yml`, new `.node-version`, all `.github/workflows/*.yml` install blocks
  - `tools/ci/device-gate.sh` (new), `tools/ci/report-to-tracker.sh` (from `report-device-run.sh`), `tools/ci/rebundle-android-app.sh:12`
  - `docs/agents/checks.md:96-106`, `docs/agents/issue-tracker.md` label rows
  - tests: `deviceWorkflowsGate`, `postgresMajor`, `deployRuntime`, new report-script test
- **Blocked by:** T7 (ci.yml).
- **DoD:**
  - [ ] No inline setup-node + `npm ci` remains.
  - [ ] Only production pins carry a literal Node version, tied to `deploy/runtime.json`.
  - [ ] Every workflow's Postgres major is checked.
  - [ ] Both gates run one script.
  - [ ] Soak, offline-soak, parity, audio-soak and device reds reach distinct title-keyed issues.
  - [ ] `checks.md` gate wording fixed and `--pr` sentence deleted.
- **Checks:** `npm test` on the touched tooling tests; the PR's CI; dispatch `soak.yml` and `parity-nightly.yml` on the branch and `await-run` them.

### T9 — Scripts and CI helpers: one owner per constant; every documented script runs
- **Size:** M. **Labels:** tooling.
- **Files:**
  - `tools/ci/e2e-budget.mjs:22`, `ios-wall.mjs:8,57`, `native-budget.mjs:21`, `budget-gate.mjs:131`, `await-artifact.mjs:52`, `nativeScope.mjs:54`, `e2ePort.mjs:17,131`
  - `tools/loop/reap.mjs:14,290-319`
  - `scripts/e2e-server.mjs:32`, `ios-device.mjs:99-103,338,436`, `e2eBuildMark.mjs:33`, `mockupParityPage.mjs:162`, `measureHeadsUpBalance.ts:556`, `build-court-art.mjs:31`, `diagnostics-verdict.mjs` + 6 scenarios, new `scripts/server-prod.mjs`
  - `package.json:12,16,27`, `README.md:18,60-71`, `docs/DEPLOY-RUNBOOK.md:53`, `docs/agents/RULES.md` 46
  - tests: `e2eBudget`, `iosWall`, `cli` (scan widened), `reap`, new 5099 pin
- **Blocked by:** T3 (`cli.test.ts`), T6 (`reap.mjs`, scripts), T7 (`nativeScope.mjs`), #1641.
- **DoD:** each L-ID's line in §7, plus:
  - [ ] `npm run server:dev` runs under cmd.exe.
  - [ ] `db:reset` is gone and its docs name the direct command.
  - [ ] RULES 46 names one `HARD_FACTOR` home.
- **Checks:** touched tests alone; `npm run server:dev` boots once; `npm run agent:check`.

### T11 — Owner: `loop-settings.json` soft_deny wording and `skills-lock.json` (ready-for-human)
- **Size:** XS. **Labels:** ready-for-human, loop.
- **Files:** `tools/loop/loop-settings.json:24`, `skills-lock.json`, `.claude/workflows/audit.mjs:255`.
- **Blocked by:** T9.
- **Why human:** a loop session editing the settings it runs under is refused as self-modification. The skills CLI may read the lock.
- **DoD:**
  - [ ] soft_deny names `scripts/reset-db.mjs` and drops the false "bundles --yes" claim.
  - [ ] skills-lock lists only installed skills, or is deleted (§10).

**Count:** 11 tickets: XS 1 (human), S 1, M 7, L 2.

```
T1 ─► T2 ─► T3 ─► T4 ─► T5a ─► T5b ─► T6 ─► T7 ─► T8
            │                         │     └──► T9 ─► T11
            └─────────────────────────┴──────────┘
#1641 ─► T2, T5a, T6, T9
```

## 9. Cross-area contracts

- **I give:**
  - `cli.mjs` `changedFiles`, `git(cwd).lines/.text`, and `GH_REPO`.
  - `scripts/lib/proc.mjs` (`runBin`, `spawnBin`, `killTree`, `sleepSync`) for any area that spawns npm/npx or needs to kill a tree.
  - `limits.mjs` as the only home of loop caps.
  - `session-env.mjs` as the only reader of `LOOP_*`, so test-harness helpers must not read `LOOP_*` directly.
  - `tools/ci/report-to-tracker.sh` for any workflow that files issues.
- **Files other areas may also touch (must be ordered by blocked-by edges):**
  - **static-checks / test-harness:**
    - `.github/workflows/ci.yml` (jobs, scope allowlists), owned here by T7/T8
    - `tests/tooling/ciScope.test.ts`, `docReferences.test.ts`, `rulesAreSingleSourced.test.ts`
    - `package.json` `loop:test`/`test` scripts
    - `tests/helpers/*` named in the harness allowlist (`ci.yml:133`)

    A ticket of theirs editing `ci.yml` is blocked by T8, or T8 by it.
  - **server-runtime:** `package.json` `server:*` (T9), `deploy/runtime.json` (read by T8's pin test), and any new server entry that `scripts/server-prod.mjs` imports (`server_dist/index.mjs`, from `server:build`).
  - **client / table-ui:** `lib/diagnostics/recorder.ts:24` and `components/cardFaceModel.ts:263` are read, not edited, by T9's pins and import. A move of `COURT_ART_BOX` must update `build-court-art.mjs`.
  - **test-harness:** `tools/loop/tests/helpers/clearLoopEnv.mjs` stays (RULES 3 cites it).
- **Protocol docs:**
  - No ticket needs `queue.md`. Its word budget (`claudeMdScope.test.ts`) is untouched.
  - `docs/agents/checks.md` is touched by #1641, T8 and possibly T6. Edges order them.
  - RULES 46 is edited by T9 to name one file (rule 43). The rulings are not changed.

## 10. Owner decisions needed

1. **L-192 (no change).** `record()` reads the whole ledger because billing needs the prior rows, and the ledger is the permanent record by design. The cost is parsing a few hundred lines per ticket, and the supervisor already reads the ledger in full several times per pass (`tally`, `rows`). Recommendation: close it without a change. The alternative is an in-memory tally in the single supervisor process (ADR-0004), at a staleness risk.
2. **L-204 `skills-lock.json`.** Regenerate it to the one installed project skill (default), or delete it if `npx skills` is not used to restore project skills.
3. **Guard failure mode (L-208).** The design keeps ADR-0010's "exit 0 on a payload it cannot read" and makes *evaluation* failures exit 2. If the owner wants unreadable payloads blocked too, ADR-0010's Consequences line changes. Recommendation: keep it as designed.
4. **Unrun workflows in T8.** The install-action change reaches macOS and dispatch-only workflows (ios, maestro, eas-build, ios-app-cache, ios-bench, ios-device) only on their next schedule or dispatch. Choose one:
   - Accept a first red that files an issue (default).
   - Have T8 dispatch `ios-app-cache.yml` once on its branch, at macOS minutes.
5. **`queue-loop.mjs --check`.** It is a new read-only flag on the supervisor. `loop-derive.mjs:416-419` rejects documented flags for *test seams*; this one gates nothing and writes nothing. Confirm it is acceptable.
