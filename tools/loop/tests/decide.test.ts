// tools/loop/tests/decide.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decide } from "../decide.mjs";
import { ticketWindow } from "../loop-logs.mjs";
import { BREAKER, CI_ROUNDS, MAX_HANDOFFS, SETTLE, SETTLE_ROUNDS, USD_BY_SIZE, USD_DEFAULT, WAIT } from "../queue-loop.mjs";

const LIMITS = { BREAKER, CI_ROUNDS, MAX_HANDOFFS, USD_BY_SIZE, USD_DEFAULT, WAIT, ROUNDS: SETTLE_ROUNDS, SETTLE_MS: SETTLE.DEADLINE_MS };
const NOW = Date.parse("2026-10-12T20:00:00Z");
const PARK = { remove: ["in-progress", "ready-for-agent"], add: ["ready-for-human"] };
const RELEASE = { remove: ["in-progress"], add: [] };

const route = { n: 42, skill: "implement", title: "the ticket", phase: "C", size: "size:S", fix: false, head: null };
const empty = ticketWindow(42, []);
const fresh = { failures: 0, holds: 0, waits: 0, overloads: 0, pinned: null };
const base = { route, tally: empty, loop: fresh, limits: LIMITS, now: NOW, asked: false };
const seen = (...heads: (string | null)[]) => ({ ...empty, reruns: heads });

const pre = (over: object, top: object = {}) => ({ ...base, step: "pre", pre: { stop: false, unusable: false, moved: null, housekeeping: { verdict: "ok", why: null }, ...over }, ...top });
const pick = (over: object, top: object = {}) => ({ ...base, step: "pick", route: { ...route, ...over }, repicked: false, ...top });
const fixRoute = (top: object = {}) => pick({ fix: true, head: "h3" }, top);

const said = (over: object = {}) => ({ ticket: 42, branch: "agent/42-x", pr: null, phase: "C", handoff: null, stoodDown: false, why: null, ...over });
const ok = { subtype: "success", isError: false, apiStatus: null, cost: 2, turns: 30 };
const run = (over: object = {}) => ({ status: 0, phase: "C", declared: said({ handoff: "D" }), result: ok, stderr: "", blocked: false, blockedUntil: 0, accountError: null, apiErrorCode: null, lastFact: "result", wrongModel: null, strayPlugin: null, ...over });
const derived = { ticket: 42, branch: "agent/42-x", cwd: "/w/agent-42", head: "h1", commits: 3, changed: [], dirty: false, phase: "C" };
const session = (over: object = {}) => ({ ...base, step: "session", run: run(), after: derived, built: true, pushed: null, issue: null, ...over });
const silent = (over: object = {}) => run({ declared: null, ...over });
const finished = (over: object = {}) => run({ phase: "F", declared: said({ phase: "F", ...over }) });
const pr = (state: string) => ({ number: 7, state, sha: "h1" });
const g = (pushed: object | null) => ({ ...base, step: "session", route: { ...route, phase: "G" }, run: null, after: derived, pushed });
const api = (apiStatus: number | null, over: object = {}) => silent({ status: 1, result: { ...ok, isError: true, apiStatus }, ...over });

const ci = (over: object = {}) => ({ testIds: ["tests/a.test.ts › adds"], output: "✖ adds", logUnread: false, waiting: false, infrastructure: false, appearing: false, runId: 99, ...over });
const rounds = { update: 0, retry: 0, recheck: 0, appear: 0, ready: 0 };
const land = (over: object = {}, top: object = {}) => ({
  ...base,
  step: "landing",
  landing: { action: "recheck", reason: "the run has not finished", pr: 7, head: "h2", armed: false, overdue: false, rounds, cleared: { ok: true, why: null }, reviewed: true, ci: ci(), error: null, ...over },
  ...top,
});
const red = (over: object = {}, top: object = {}) => land({ action: "hand-back", reason: "CI failed at Typecheck and tests", ...over }, top);
const unnamed = (over: object = {}, top: object = {}) => red({ ci: ci({ testIds: [], output: "Process completed with exit code 1.", ...over }) }, top);
const green = (over: object = {}, top: object = {}) => land({ action: "arm", reason: "mergeStateStatus is CLEAN", ...over }, top);

const diagnosed = (d: object, ctx: object = {}, top: object = {}) => ({
  ...base,
  step: "diagnosed",
  after: derived,
  diagnosing: { why: "the session exited without a LOOP-RESULT", phase: "C", head: "h1", runId: null, unnamed: false, ...ctx },
  diagnosis: { ok: true, apiDown: false, error: null, action: "park", phase: null, cause: "x", rerunError: null, cost: 0.2, ...d },
  ...top,
});
const unnamedRed = { why: "CI failed at Browser test report", phase: "E", head: "2f2a885", runId: 35661862241, unnamed: true };

type Row = [name: string, input: object, want: Record<string, unknown>];

// Rows whose name is a queueLoopMain test's are that test's routing, ported; the rest name the
// branch of queue-loop.mjs they cover. The landing rows read PR 3's `landing()` actions on today's
// `poll` budgets: re-check them against PR 3's merged land.ts in Task 5.3.
const ROWS: Row[] = [
  // runOnce, before the pick
  ["the stop file stops before anything is picked", pre({ stop: true }), { kind: "stop", why: ".loop-stop", halt: undefined }],
  ["a stop file ends the night cleanly, before anything is picked", pre({ stop: true }), { kind: "stop", loop: fresh }],
  ["runOnce: an unusable shared checkout stops", pre({ unusable: true }), { kind: "stop", why: "the shared checkout is not usable" }],
  ["a moved tools/loop restarts the supervisor before any ticket is picked", pre({ moved: "abc1234" }), { kind: "restart", why: "tools/loop moved on main (now abc1234)" }],
  ["a moved tools/loop ends main with the restart code, before anything is picked", pre({ moved: "abc1234" }), { kind: "restart" }],
  ["a housekeeping hold holds, saying why; a stop still stops", pre({ housekeeping: { verdict: "hold", why: "the shared checkout is dirty" } }),
    { kind: "hold", wait: "preflight", why: "the shared checkout is dirty", hold: WAIT.FLOOR, loop: { ...fresh, holds: 1 } }],
  ["a refusal carries housekeeping's reason into why", pre({ housekeeping: { verdict: "stop", why: "lock drift" } }), { kind: "stop", why: "a pre-flight check refused: lock drift" }],
  ["runOnce: a clear pre-flight goes on to the pick", pre({}), { kind: "go" }],

  // runOnce, the pick
  ["a handoff route stops", pick({ skill: "handoff", title: "queue empty" }), { kind: "stop", why: "queue empty" }],
  ["an ambiguous pick stops rather than taking a third ticket", pick({ skill: "ambiguous", title: "two live worktrees" }), { kind: "stop", why: "two live worktrees" }],
  ["a closed ticket whose worktree still stands is torn down and the queue picked again, with no spawn on it", pick({ skill: "closed" }, { loop: { ...fresh, pinned: 42 } }),
    { kind: "repick", n: 42, label: RELEASE, loop: fresh }],
  ["a closed ticket unrelated to the pinned one keeps the pin, and its phase, on re-pick", pick({ skill: "closed", n: 9 }, { loop: { ...fresh, pinned: 42 } }),
    { kind: "repick", n: 9, loop: { ...fresh, pinned: 42 } }],
  ["runOnce: a closed ticket on the re-pick too stops", pick({ skill: "closed" }, { repicked: true }), { kind: "stop", why: "#42 is closed and its worktree still stands" }],
  ["runOnce: an implement route goes on to the spawn", pick({}), { kind: "go", redWhileDown: false }],
  ["a red round nobody recorded is written down before the fix round; a recorded one is not", fixRoute(), { kind: "go", redWhileDown: true }],
  ["runOnce: a fix route whose red head is already recorded writes nothing", fixRoute({ tally: { ...empty, retries: 1, lastRedHead: "h3" } }), { kind: "go", redWhileDown: false }],
  ["a red round nobody recorded counts toward the cap, and the last one parks before the refresh", fixRoute({ tally: { ...empty, retries: CI_ROUNDS - 1, lastRedHead: "h2" } }),
    { kind: "park", phase: "C", why: `${CI_ROUNDS} CI rounds on the same branch did not go green — the last one while the loop was down`, label: PARK }],
  ["a CI-RED already posted for the unrecorded head counts that round once, not twice", fixRoute({ tally: { ...empty, retries: 1, lastRedHead: "h2", ciRounds: 2 } }),
    { kind: "go", redWhileDown: true }],
  ["runOnce: a tracker's CI-RED count past the ledger's reaches the cap", fixRoute({ tally: { ...empty, ciRounds: CI_ROUNDS } }), { kind: "park", phase: "C" }],
  ["an ff failure before a fix parks", { ...base, step: "refresh", error: "fatal: Not possible to fast-forward" },
    { kind: "park", phase: "C", why: "could not fast-forward the worktree before the fix round — fatal: Not possible to fast-forward", label: PARK }],
  ["runOnce: a fast-forwarded worktree goes on to the fix round", { ...base, step: "refresh", error: null }, { kind: "go" }],

  // runOnce, after the session
  ["a stray plugin stops the run instead of parking the ticket it happened to meet", session({ run: run({ strayPlugin: "plugin superpowers loaded from user settings" }) }),
    { kind: "stop", why: "plugin superpowers loaded from user settings", halt: undefined, loop: fresh }],
  ["an expired login stops the run, and neither diagnoses nor parks the ticket it met", session({ run: silent({ accountError: "authentication_failed", status: 1 }) }),
    { kind: "stop", why: /^the account cannot run sessions \(authentication_failed\) — log in.*#42 resumes from its worktree$/, loop: fresh }],
  ["a session on the wrong model parks with the reason", session({ run: run({ wrongModel: "the session ran on claude-sonnet-5, not opus" }) }),
    { kind: "park", phase: "C", why: "the session ran on claude-sonnet-5, not opus", label: PARK, loop: { ...fresh, failures: 1 } }],
  ["starts the next process at the phase the session named", session(), { kind: "handoff", n: 42, phase: "D", why: null, publish: true, loop: { ...fresh, pinned: 42 } }],
  ["runOnce: the session's own why rides with its handoff", session({ run: run({ declared: said({ handoff: "D", why: "review abc" }) }) }), { kind: "handoff", said: "review abc" }],
  ["a D handoff without a --build pass re-routes to C, recorded as a C handoff", session({ built: false }),
    { kind: "handoff", phase: "C", publish: false, why: "the D handoff had no local pass or no full DOD-CHECK on HEAD: commit, agent:check, post DOD-CHECK, then loop-gate --build" }],
  ["a HOLD fix handed back to D needs the local pass too, and is pushed only with it", session({ run: run({ phase: "D", declared: said({ phase: "D", handoff: "D" }) }), built: false }),
    { kind: "handoff", phase: "C", publish: false }],
  ["a handoff anywhere but D pushes nothing", session({ run: run({ declared: said({ handoff: "C" }) }) }), { kind: "handoff", phase: "C", publish: false }],
  ["runOnce: a D handoff with no branch to push is not published",
    session({ run: run({ declared: said({ handoff: "D", branch: null }) }), after: { ...derived, branch: null } }), { kind: "handoff", phase: "D", publish: false }],
  ["a C handoff out of a refused D or a red E carries its reason to the next C session only",
    session({ run: run({ phase: "E", declared: said({ phase: "E", handoff: "C" }) }) }),
    { kind: "handoff", phase: "C", why: "phase E's agent:check was red: fix what it names, then go through D again" }],
  ["a declared stand-down parks on the session's own reason",
    session({ run: run({ declared: said({ handoff: "D", stoodDown: true, why: "premise false" }) }) }),
    { kind: "park", n: 42, phase: "C", why: "premise false", label: PARK, loop: { ...fresh, failures: 1 } }],
  ["a session that worked a different ticket stops the pass", session({ run: finished({ ticket: 41 }), pushed: pr("OPEN") }),
    { kind: "park", why: "the session worked #41, not #42", pr: 7 }],
  ["a handoff the supervisor makes for a cut-off session says why",
    session({ run: silent({ result: { ...ok, subtype: "error_max_turns" } }) }), { kind: "handoff", phase: "C", why: "the session ran out of turns" }],
  ["runOnce: cut off by the dollar cap resumes too",
    session({ run: silent({ stderr: "Budget limit reached ($15.08 of $15); stopping background agents.", phase: "B" }), after: { ...derived, phase: "B" } }),
    { kind: "handoff", phase: "B", why: "the session spent its budget mid-phase" }],
  ["runOnce: cut off in a phase it cannot resume parks, undiagnosed",
    session({ run: silent({ phase: "E", result: { ...ok, subtype: "error_max_turns" } }) }), { kind: "park", phase: "E", why: "the session ran out of turns" }],
  ["runOnce: cut off with its worktree gone parks, undiagnosed", session({ run: silent({ result: { ...ok, subtype: "error_max_turns" } }), after: null }),
    { kind: "park", why: "the session ran out of turns" }],
  ["a session stalled mid-retry is overloaded", session({ run: silent({ status: "stalled", lastFact: "api_retry", result: null }) }),
    { kind: "hold", wait: "api", n: 42, why: "the API could not be reached", hold: WAIT.FLOOR, loop: { ...fresh, overloads: 1, pinned: 42 } }],
  ["runOnce: the stall watchdog's kill with nothing pushed is diagnosed on its silence",
    session({ run: silent({ status: "stalled", lastFact: "assistant", result: null, phase: "D" }) }), { kind: "diagnose", phase: "D", why: "no output for 30m in phase D", head: "h1" }],
  ["runOnce: the stall watchdog's kill with a pull request open settles it",
    session({ run: silent({ status: "stalled", lastFact: "assistant", result: null }), pushed: pr("OPEN") }), { kind: "settle", n: 42, pr: 7, head: "h1" }],
  ["runOnce: the stall watchdog's kill after a declared handoff hands off", session({ run: run({ status: "stalled", lastFact: "assistant" }) }), { kind: "handoff", phase: "D" }],
  ["the 529 #1156 parked on is overloaded", session({ run: api(529) }), { kind: "hold", wait: "api", why: "the API answered 529", hold: WAIT.FLOOR }],
  ["a 429 is overloaded", session({ run: api(429) }), { kind: "hold", wait: "api", why: "the API answered 429" }],
  ["runOnce: a dropped connection with no status is overloaded", session({ run: api(null, { apiErrorCode: "server_error" }) }), { kind: "hold", wait: "api", why: "the API could not be reached" }],
  ["an error naming no status is parked", session({ run: api(null) }), { kind: "diagnose", why: "the session exited 1 in phase C" }],
  ["a non-zero exit with no result line is parked", session({ run: silent({ status: 1, result: null }) }), { kind: "diagnose", why: "the session exited 1 in phase C" }],
  ["an API 5xx never reaches diagnosis", session({ run: api(503) }), { kind: "hold", wait: "api" }],
  ["in phase E, with a pull request open, E is spawned again rather than the head settled",
    session({ run: api(529, { phase: "E" }), after: { ...derived, phase: "E" }, pushed: pr("OPEN") }), { kind: "hold", wait: "api", n: 42, loop: { ...fresh, overloads: 1, pinned: 42 } }],
  ["a refused session is neither landed nor parked", session({ run: silent({ status: 1, result: null, blocked: true, blockedUntil: NOW + 3_600_000 }) }),
    { kind: "hold", wait: "usage", n: 42, why: "the usage window is spent", hold: 3_600_000 + WAIT.MARGIN, loop: { ...fresh, waits: 1 } }],
  ["a 429 from a spent usage window (#1074's) is a refusal, waited out to its reset",
    session({ run: api(429, { blocked: true, blockedUntil: NOW + 7_200_000 }) }), { kind: "hold", wait: "usage", hold: 7_200_000 + WAIT.MARGIN }],
  ["runOnce: a usage reset already past is still held the floor", session({ run: silent({ result: null, blocked: true, blockedUntil: NOW - 1000 }) }), { kind: "hold", hold: WAIT.FLOOR }],
  ["runOnce: a usage reset days away is held at most the cap", session({ run: silent({ result: null, blocked: true, blockedUntil: NOW + 7 * 86_400_000 }) }), { kind: "hold", hold: WAIT.CAP }],
  ["runOnce: a usage refusal naming no reset is held the floor", session({ run: silent({ result: null, blocked: true, blockedUntil: 0 }) }), { kind: "hold", hold: WAIT.FLOOR }],
  ["a refused session that recovered and pushed is settled, not refused", session({ run: silent({ blocked: true, blockedUntil: NOW + 1000 }), pushed: pr("OPEN") }),
    { kind: "settle", pr: 7 }],
  ["is recorded closed, with no diagnosis and no park",
    session({ run: finished(), after: { ...derived, commits: 0 }, issue: { state: "CLOSED", stateReason: "COMPLETED" } }),
    { kind: "closed", n: 42, why: "the session closed the issue as done, with no diff to land", label: RELEASE, loop: fresh }],
  ["with commits of its own it still parks", session({ run: finished(), issue: { state: "CLOSED", stateReason: "COMPLETED" } }),
    { kind: "diagnose", why: "the session pushed no pull request" }],
  ["closed as not planned still parks", session({ run: finished(), after: { ...derived, commits: 0 }, issue: { state: "CLOSED", stateReason: "NOT_PLANNED" } }),
    { kind: "diagnose" }],
  ["a pull request already merged is a landing, and the claim comes off", session({ run: finished(), pushed: pr("MERGED") }),
    { kind: "landed", n: 42, pr: 7, why: "pull request #7 was already merged", label: RELEASE }],
  ["a torn-down worktree with a pull request open is settled, not parked", session({ run: finished(), after: null, pushed: pr("OPEN") }), { kind: "settle", pr: 7, head: "h1" }],
  ["a torn-down worktree with no pull request anywhere still parks", session({ run: finished(), after: null }),
    { kind: "diagnose", why: "the session pushed no pull request", head: null }],
  ["a pull request closed without merging is the owner's", session({ run: finished(), pushed: pr("CLOSED") }),
    { kind: "diagnose", why: "pull request #7 is closed" }],
  ["a session that pushed nothing parks the ticket", session({ run: finished() }), { kind: "diagnose", why: "the session pushed no pull request", phase: "F" }],
  ["a session that exits without a LOOP-RESULT is diagnosed, and resumed where it says", session({ run: silent() }),
    { kind: "diagnose", n: 42, why: "the session exited without a LOOP-RESULT", phase: "C", head: "h1", runId: null }],
  ["a second stop on the same head parks without a second diagnosis", session({ run: silent(), tally: seen("h1") }),
    { kind: "park", why: "the session exited without a LOOP-RESULT", label: PARK }],
  ["a G route settles without spawning", g(pr("OPEN")), { kind: "settle", pr: 7 }],
  ["runOnce: phase G whose pull request merged meanwhile lands", g(pr("MERGED")), { kind: "landed", pr: 7 }],
  ["a G pass with no open pull request says so", g(null), { kind: "diagnose", phase: "G", why: "phase G found no open pull request for the pushed head" }],

  // runOnce, the diagnosis a stop no rule names asks for
  ["a failed diagnosis parks with the original reason", diagnosed({ ok: false, error: "no diagnosis here" }),
    { kind: "park", phase: "C", why: "the session exited without a LOOP-RESULT", label: PARK }],
  ["a park the diagnosis asks for carries its cause, not the exit", diagnosed({ action: "park", cause: "the ticket's premise is gone: #900 removed the file" }),
    { kind: "park", why: "the ticket's premise is gone: #900 removed the file" }],
  ["runOnce: a diagnosis that resumes hands off where it says, marked as the diagnosis's", diagnosed({ action: "resume", phase: "C", cause: "tsc is red" }),
    { kind: "handoff", phase: "C", why: "tsc is red", diagnosed: true, loop: { ...fresh, pinned: 42 } }],
  ["a diagnosis the API refused holds the ticket, and the next stop on that head is diagnosed", diagnosed({ ok: false, apiDown: true, error: "529" }),
    { kind: "hold", wait: "api", n: 42, why: "the diagnosis could not reach the API", hold: WAIT.FLOOR }],
  ["#1100's report-upload red is rerun, not handed to a fix round", diagnosed({ action: "rerun", cause: "the artifact store answered 403" }, unnamedRed),
    { kind: "handoff", phase: "G", why: "rerun of 35661862241: the artifact store answered 403", diagnosed: true }],
  ["runOnce: a rerun that fails parks on the diagnosis's cause", diagnosed({ action: "rerun", cause: "403", rerunError: "HTTP 404" }, unnamedRed),
    { kind: "park", phase: "E", why: "403 — the rerun failed: HTTP 404" }],
  ["a resume C on an unnamed red is a counted fix round, and the next session gets the cause", diagnosed({ action: "resume", phase: "C", cause: "a flaky upload" }, unnamedRed),
    { kind: "retry", head: "2f2a885", why: "CI failed at Browser test report", ciRed: true }],
  ["runOnce: a resume C on an unnamed red at the round cap parks", diagnosed({ action: "resume", phase: "C", cause: "x" }, unnamedRed, { tally: { ...empty, retries: CI_ROUNDS - 1 } }),
    { kind: "park", phase: "E", ciRed: true }],
  ["runOnce: a resume D on an unnamed red hands off to D", diagnosed({ action: "resume", phase: "D", cause: "x" }, unnamedRed), { kind: "handoff", phase: "D", diagnosed: true }],

  // poll and runOnce, one read of the landing
  ["a ticket that pushes and merges is landed, in one pass", land({ action: "already-merged", reason: "the pull request is already merged" }),
    { kind: "landed", pr: 7, head: "h2", label: RELEASE, loop: fresh }],
  ["a red verdict hands the ticket back, and still writes its row",
    red(), { kind: "retry", n: 42, head: "h2", why: "CI failed at Typecheck and tests", ciRed: true, disarm: false, loop: { ...fresh, pinned: 42 } }],
  ["a CI fix round keeps the worktree, and hands it back", red(), { kind: "retry" }],
  ["a red settle leaves the worktree standing and the next pass spawns C with the fix", red(), { kind: "retry", loop: { ...fresh, pinned: 42 } }],
  ["the retry row carries the head CI judged, not the one before update-branch", red({ head: "h9" }), { kind: "retry", head: "h9" }],
  ["a CI red naming its failing tests is a fix round, with no diagnosis", red(), { kind: "retry" }],
  ["poll: a red on an armed pull request disarms before the fix round", red({ armed: true }), { kind: "retry", disarm: true }],
  ["poll: a compile error with a place in a file is named without a test id", unnamed({ output: "app/a.ts:3:5 - error TS2322: no" }), { kind: "retry" }],
  ["poll: a red naming no test is diagnosed, once per head", unnamed(), { kind: "diagnose", phase: "E", head: "h2", runId: 99, unnamed: true, why: "CI failed at Typecheck and tests" }],
  ["poll: a second unnamed red on the same head parks", unnamed({}, { tally: seen("h2") }), { kind: "park", phase: "E", why: "CI failed at Typecheck and tests" }],
  ["poll: a red whose log is unread is asked again, from the retry budget", red({ ci: ci({ logUnread: true }) }), { kind: "settle", act: "wait", spend: "retry" }],
  ["poll: a red whose log never comes is diagnosed once the retry budget is spent", red({ ci: ci({ output: "" }), rounds: { ...rounds, retry: SETTLE_ROUNDS.retry } }),
    { kind: "diagnose", why: "CI is red and its log could not be read — CI failed at Typecheck and tests" }],
  [`runOnce: red round ${CI_ROUNDS} parks, with its CI-RED`, red({}, { tally: { ...empty, retries: CI_ROUNDS - 1 } }),
    { kind: "park", phase: "E", ciRed: true, why: `${CI_ROUNDS} CI rounds on the same branch did not go green — last: CI failed at Typecheck and tests` }],
  ["a restart mid fix round keeps the round count: the third red run parks", red({}, { tally: { ...empty, retries: CI_ROUNDS - 1 } }), { kind: "park" }],
  ["runOnce: the tracker's CI-RED count stands in for rounds the ledger missed", red({}, { tally: { ...empty, ciRounds: CI_ROUNDS - 1 } }), { kind: "park", ciRed: true }],
  ["poll: main moved, so the branch is updated", land({ action: "update-branch", reason: "main moved" }), { kind: "settle", act: "update-branch", spend: "update", disarm: false }],
  ["poll: an armed branch is disarmed before it is updated", land({ action: "update-branch", reason: "main moved", armed: true }), { kind: "settle", act: "update-branch", disarm: true }],
  [`poll: update-branch past ${SETTLE_ROUNDS.update} rounds is diagnosed`, land({ action: "update-branch", reason: "main moved", rounds: { ...rounds, update: SETTLE_ROUNDS.update } }),
    { kind: "diagnose", why: `update-branch did not settle in ${SETTLE_ROUNDS.update} rounds — last: main moved` }],
  ["poll: a run still going is waited on, spending no budget", land({ ci: ci({ waiting: true }) }), { kind: "settle", act: "wait", spend: null, why: "the run has not finished" }],
  ["poll: a recheck spends the recheck budget", land(), { kind: "settle", act: "wait", spend: "recheck" }],
  [`poll: recheck ${SETTLE_ROUNDS.recheck + 1} is diagnosed`, land({ rounds: { ...rounds, recheck: SETTLE_ROUNDS.recheck } }),
    { kind: "diagnose", why: `recheck did not settle in ${SETTLE_ROUNDS.recheck} rounds — last: the run has not finished` }],
  ["poll: a run not yet appearing spends the appear budget", land({ ci: ci({ infrastructure: true, appearing: true }), rounds: { ...rounds, recheck: SETTLE_ROUNDS.recheck } }),
    { kind: "settle", act: "wait", spend: "appear" }],
  [`poll: appear ${SETTLE_ROUNDS.appear + 1} is diagnosed`, land({ ci: ci({ infrastructure: true, appearing: true }), rounds: { ...rounds, appear: SETTLE_ROUNDS.appear } }),
    { kind: "diagnose", why: `recheck did not settle in ${SETTLE_ROUNDS.appear} rounds — last: the run has not finished` }],
  ["poll: a runner that said nothing spends the retry budget", land({ ci: ci({ infrastructure: true }) }), { kind: "settle", act: "wait", spend: "retry" }],
  ["poll: a head past its deadline is diagnosed", land({ overdue: true }), { kind: "diagnose", phase: "E", why: `CI did not settle in ${SETTLE.DEADLINE_MS / 60_000}m` }],
  ["poll: a cleared, reviewed green head is armed on that head", green(), { kind: "settle", act: "arm", head: "h2" }],
  ["poll: a cleared green draft is marked ready, from the ready budget", green({ action: "ready" }), { kind: "settle", act: "ready", spend: "ready" }],
  ["poll: a draft still a draft after its ready rounds is diagnosed", green({ action: "ready", rounds: { ...rounds, ready: SETTLE_ROUNDS.ready } }),
    { kind: "diagnose", why: "the draft is still a draft after gh pr ready" }],
  ["poll: a green head no review clears is diagnosed", green({ cleared: { ok: false, why: "no VERDICT: LAND names h2" } }),
    { kind: "diagnose", why: "h2 was pushed for review, not cleared — no VERDICT: LAND names h2" }],
  ["poll: arming waits for the D round's reviewer", green({ reviewed: false }), { kind: "settle", act: "wait", spend: null }],
  ["poll: a head already armed is waited on, not armed again", green({ armed: true }), { kind: "settle", act: "wait" }],
  ["a settle only a person can move parks the ticket rather than dropping it", land({ action: "owner", reason: "the branch conflicts with main", armed: true }, { tally: seen("h2") }),
    { kind: "park", why: "the branch conflicts with main", disarm: true, label: PARK }],
  ["poll: what only a person can move is diagnosed first, disarmed", land({ action: "owner", reason: "the branch conflicts with main", armed: true }),
    { kind: "diagnose", why: "the branch conflicts with main", disarm: true }],
  ["poll: CI unreadable since the machine woke is asked again", land({ error: { why: "ENOTFOUND api.github.com", offline: true, woke: true } }), { kind: "settle", act: "wait", spend: null }],
  ["poll: CI unreadable for any other reason is diagnosed", land({ error: { why: "HTTP 403", offline: false, woke: false } }), { kind: "diagnose", why: "could not read CI — HTTP 403" }],
  ["an unrecognised settle action parks too, rather than returning silently", land({ action: "merge", reason: "x" }, { tally: seen("h2") }), { kind: "park", why: /^landing\(\) answered merge/ }],

  // main, over a handoff or a fix round
  ["runOnce: a handoff that takes the ticket over its dollar ceiling parks",
    session({ tally: { ...empty, spend: USD_BY_SIZE["size:S"] - 1, processes: 4 } }),
    { kind: "park", phase: "D", why: `$${(USD_BY_SIZE["size:S"] + 1).toFixed(2)} across 5 processes — over this ticket's ceiling`, publish: true }],
  ["main: a ticket with no size is held to the default ceiling", session({ route: { ...route, size: null }, tally: { ...empty, spend: USD_DEFAULT - 2 } }),
    { kind: "park", why: /over this ticket's ceiling$/ }],
  ["the retry session's cost counts toward the spend ceiling", red({}, { tally: { ...empty, spend: 31, processes: 6 } }),
    { kind: "park", phase: "E", why: "$31.00 across 6 processes — over this ticket's ceiling" }],
  ["main: a diagnosis's own cost counts toward the ceiling", diagnosed({ action: "resume", phase: "C", cause: "x", cost: 2 }, {}, { tally: { ...empty, spend: USD_BY_SIZE["size:S"] - 1 } }),
    { kind: "park", why: /over this ticket's ceiling$/ }],
  [`main: handoff ${MAX_HANDOFFS} on one ticket parks`, session({ tally: { ...empty, handoffs: MAX_HANDOFFS - 1 } }), { kind: "park", why: `${MAX_HANDOFFS} phase handoffs on one ticket`, publish: true }],
  ["main: an owner's park of a D handoff still publishes the branch first", session({ asked: true }), { kind: "park", why: "parked by owner", publish: true }],
  ["main: a park over the ceiling publishes only what a D handoff would have", session({ run: run({ declared: said({ handoff: "C" }) }), tally: { ...empty, spend: 40 } }),
    { kind: "park", publish: false }],
  ["does not spend the next one, because CI would answer the same", red({}, { tally: { ...empty, retries: 1, lastRedHead: "h2" } }),
    { kind: "park", phase: "E", why: "the fix round pushed no commit — CI would answer CI failed at Typecheck and tests again" }],
  ["a fix round whose head equals lastRedHead parks even after a restart", red({}, { tally: { ...empty, retries: 1, lastRedHead: "h2" } }), { kind: "park" }],
  ["parks the ticket once its session exits, and forgets the request", session({ asked: true }),
    { kind: "park", phase: "D", why: "parked by owner", label: PARK, halt: null, loop: fresh }],
  ["a red CI round parks in the phase git reports, with its worktree", red({}, { asked: true, after: { ...derived, phase: "E" } }), { kind: "park", phase: "E", why: "parked by owner" }],
  ["a ticket that lands before the park can act says the request was dropped", session({ asked: true, run: finished(), pushed: pr("MERGED") }), { kind: "landed" }],
  ["a request naming another ticket parks nothing", session({ asked: false }), { kind: "handoff" }],
  ["main: a park asked from the board takes a usage hold", session({ asked: true, run: silent({ result: null, blocked: true, blockedUntil: 0 }) }), { kind: "park", phase: "C", why: "parked by owner" }],
  ["main: a park asked from the board takes an API hold", session({ asked: true, run: api(529) }), { kind: "park", why: "parked by owner" }],
  ["main: the owner's park neither counts toward the breaker nor resets a counter",
    session({ asked: true, loop: { failures: BREAKER - 1, holds: 2, waits: 3, overloads: 4, pinned: 42 } }),
    { kind: "park", halt: null, loop: { failures: BREAKER - 1, holds: 2, waits: 3, overloads: 4, pinned: null } }],

  // main, the run's own counters
  ["three tickets in a row that do not land stop the night", session({ run: run({ wrongModel: "w" }), loop: { ...fresh, failures: BREAKER - 1 } }),
    { kind: "park", halt: `${BREAKER} tickets in a row did not land`, loop: { ...fresh, failures: BREAKER } }],
  ["main: a park short of the breaker does not halt", session({ run: run({ wrongModel: "w" }) }), { kind: "park", halt: null }],
  ["a landing clears the breaker, so a bad ticket between good ones is not fatal",
    land({ action: "already-merged", reason: "merged" }, { loop: { failures: 2, holds: 1, waits: 5, overloads: 3, pinned: 42 } }), { kind: "landed", loop: fresh }],
  ["a ticket closed as done clears the breaker as a landing does",
    session({ run: finished(), after: { ...derived, commits: 0 }, issue: { state: "CLOSED", stateReason: "COMPLETED" }, loop: { ...fresh, failures: 2, waits: 4 } }),
    { kind: "closed", loop: fresh }],
  ["main: a handoff resets the pre-flight and API counts, and neither the breaker nor the usage count",
    session({ loop: { failures: 2, holds: 3, waits: 4, overloads: 5, pinned: null } }), { kind: "handoff", loop: { failures: 2, holds: 0, waits: 4, overloads: 0, pinned: 42 } }],
  ["main: a park resets the pre-flight and API counts, and keeps the usage count", session({ run: run({ wrongModel: "w" }), loop: { failures: 0, holds: 3, waits: 4, overloads: 5, pinned: 42 } }),
    { kind: "park", loop: { failures: 1, holds: 0, waits: 4, overloads: 0, pinned: null } }],
  [`${WAIT.TRIES} in a row end the run and say why; a served session in between resets the count`,
    session({ run: api(529), loop: { ...fresh, overloads: WAIT.TRIES - 1, pinned: 42 } }),
    { kind: "stop", why: `the API answered 529, ${WAIT.TRIES} sessions in a row`, halt: `the API answered 529, ${WAIT.TRIES} sessions in a row` }],
  [`main: API hold ${WAIT.TRIES - 1} still holds`, session({ run: api(529), loop: { ...fresh, overloads: WAIT.TRIES - 2 } }), { kind: "hold", loop: { ...fresh, overloads: WAIT.TRIES - 1, pinned: 42 } }],
  ["main: an API hold leaves the pre-flight count", session({ run: api(529), loop: { ...fresh, holds: 2 } }), { kind: "hold", loop: { ...fresh, overloads: 1, pinned: 42 } }],
  [`main: pre-flight hold ${WAIT.TRIES + 1} stops the run`, pre({ housekeeping: { verdict: "hold", why: "busy" } }, { loop: { ...fresh, holds: WAIT.TRIES } }),
    { kind: "stop", why: `busy, ${WAIT.TRIES + 1} times running`, halt: `busy, ${WAIT.TRIES + 1} times running` }],
  [`main: pre-flight hold ${WAIT.TRIES} still holds`, pre({ housekeeping: { verdict: "hold", why: "busy" } }, { loop: { ...fresh, holds: WAIT.TRIES - 1, pinned: 42 } }),
    { kind: "hold", loop: { ...fresh, holds: WAIT.TRIES, pinned: 42 } }],
  [`main: usage refusal ${WAIT.TRIES + 1} stops the run`, session({ run: silent({ result: null, blocked: true, blockedUntil: 0 }), loop: { ...fresh, waits: WAIT.TRIES } }),
    { kind: "stop", why: `refused ${WAIT.TRIES} times running, each after waiting out the window it named`, halt: `refused ${WAIT.TRIES} times running, each after waiting out the window it named` }],
  ["main: a usage refusal neither pins nor touches the API count", session({ run: silent({ result: null, blocked: true, blockedUntil: 0 }), loop: { ...fresh, holds: 2, overloads: 3 } }),
    { kind: "hold", loop: { ...fresh, waits: 1, overloads: 3 } }],
  ["releases the claim on the ticket it was holding", { ...base, step: "threw", error: "boom", after: { ...derived, phase: "D" }, loop: { ...fresh, holds: 2, pinned: 42 } },
    { kind: "park", n: 42, phase: "D", why: "the loop threw: boom", label: PARK, loop: { ...fresh, failures: 1, holds: 2, pinned: 42 } }],
  ["a throw before anything is claimed parks nothing", { ...base, step: "threw", route: null, error: "boom" },
    { kind: "fail", why: "the loop threw: boom", loop: { ...fresh, failures: 1 } }],
  [`main: throw ${BREAKER} in a row trips the breaker`, { ...base, step: "threw", route: null, error: "boom", loop: { ...fresh, failures: BREAKER - 1, pinned: 9 } },
    { kind: "fail", halt: `${BREAKER} tickets in a row did not land`, loop: { ...fresh, failures: BREAKER, pinned: 9 } }],
];

const matches = (got: Record<string, unknown>, want: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(want)) {
    if (value instanceof RegExp) assert.match(String(got[key]), value, key);
    else assert.deepEqual(got[key], value, key);
  }
};

for (const [name, input, want] of ROWS) test(name, () => matches(decide(input), want));

test("every row's name is its own", () => {
  const names = ROWS.map(([name]) => name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

/**
 * queueLoopMain's tests that check something other than the routing decision: the I/O around it,
 * the picker, the ledger's tally, the recap, or a helper tested where it lives.
 */
const ELSEWHERE: Record<string, string> = {
  "settle runs before the pass returns": "io",
  "every teardown is told which ticket's claim it is releasing": "io",
  "no terminal outcome leaves the worktree standing": "io",
  "housekeeping is asked about the pinned ticket, and waited for": "io",
  "a pinned ticket is what the picker is asked for": "picker",
  "a park rings once and a landing does not": "io",
  "a G route announces itself before it settles": "io",
  "loopMoved answers a diff, not an error": "io",
  "a snapshot that throws during an account error is logged, and the run still stops": "io",
  "the sweep in housekeeping runs before the pick": "io",
  "nextRoute replays 2026-09-21/22: every session starts where the ledger before it pointed": "picker",
  "nextRoute: a pinned ticket with no worktree rebuilds at A": "picker",
  "nextRoute: a pinned ticket the tracker no longer shows as ours goes back to the picker": "picker",
  "nextRoute: a LAND on the head outranks a handoff to review, and nothing else does": "picker",
  "refreshWorktree fetches the branch and fast-forwards onto it": "io",
  "publishForReview pushes, then opens a draft only when no pull request is open": "io",
  "a landed or parked ticket removes the worktree from the main checkout": "io",
  "an unreadable CI read on a head not known pushed is not a no-spawn G": "picker",
  "a handed phase wins over a derived fix; only a pushed G outranks it": "picker",
  "a fix round's spawn carries the rounds already spent": "io",
  "landing deletes the branch after the worktree, from the shared checkout": "io",
  "a branch -d refuses is said, and the land still returns": "io",
  "a worktree kept for its unwritten leftovers keeps its branch too": "io",
  "a landed worktree with leftovers is saved as a binary patch, then force-removed": "io",
  "a leftover patch that cannot be written keeps the worktree": "io",
  "a clean landed worktree is removed without --force": "io",
  "a dirtied shared checkout is named, not fatal": "io",
  "nothing said and nothing derived is nothing": "helper: afterSession",
  "the declaration alone is enough once the worktree is gone": "helper: afterSession",
  "derive alone still answers, for a session that declared nothing": "helper: afterSession",
  "the phase is the session's own, not the one derive computed": "helper: afterSession",
  "the worktree's own readings are never taken from the declaration": "helper: afterSession",
  "a stood-down session is never asked about the issue": "io",
  "boot names the session the last supervisor died with": "io",
  "the run file says why the run stopped, not only its total": "io",
  "a restart's run file says restarting, not stopped": "io",
  "a standing() that throws still releases the claim": "io",
  "a park that itself throws is reported, not raised": "io",
  "counts a wait still running as waiting, not working": "recap",
  "books a standby as asleep, not working": "recap",
  "says so when the picker read no open Launch tickets": "recap",
  "names a size this run's busiest process left short of turn headroom": "recap",
  "names a red nightly parity run, read once per pass": "recap",
  "a supervisor that dies in the CI wait still counts the session, and the restarted G pass adds nothing": "tally",
  "merged: the session is counted once, and the tally reads as before": "tally",
  "red: the session is counted once, and the tally reads as before": "tally",
  "owner: the session is counted once, and the tally reads as before": "tally",
  "the recorded time carries the land, not just the session": "io",
  "a retry resets handoffsThisRound and the handed phase": "tally",
  "overSpend, overHandoffs, the no-commit park and a thrown iteration each write exactly one parked row": "io",
  "a throw during a resumed run parks with standing().cwd": "io",
  "a hold is not a handoff: the ticket's handoff count stays where it was": "tally",
  "is recorded with the steps that failed": "repark",
  "is applied again at the start of the next pass, once, and a restart does not repeat it": "repark",
  "a failed diagnosis keeps the tail of what it wrote": "io",
  "nextRoute: a diagnosis handoff outranks the pushed head until a session has run on it": "picker",
};

// The two parameterised tables in queueLoopMain, spelled out: a name the regex below cannot expand
// fails the guard rather than passing it unread.
const EXPANDED: Record<string, string[]> = {
  "`${name}: the session is counted once, and the tally reads as before`": ["merged", "red", "owner"].map((n) => `${n}: the session is counted once, and the tally reads as before`),
  "`${name} is ${outcome}`": ["the 529 #1156 parked on is overloaded", "a 429 is overloaded", "an error naming no status is parked", "a non-zero exit with no result line is parked"],
};

test("every routing test in queueLoopMain has a row of the same name", () => {
  const source = readFileSync(new URL("./queueLoopMain.test.ts", import.meta.url), "utf8");
  const names = [...source.matchAll(/\btest\(\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/g)].flatMap(([, quoted]) => {
    if (quoted.startsWith('"')) return [JSON.parse(quoted)];
    if (EXPANDED[quoted]) return EXPANDED[quoted];
    const plain = quoted.slice(1, -1).replaceAll("${WAIT.TRIES}", String(WAIT.TRIES));
    assert.doesNotMatch(plain, /\$\{/, `${quoted} is a template this guard cannot expand: add it to EXPANDED`);
    return [plain];
  });
  assert.ok(names.length >= 120, `read ${names.length} test names; the regex has stopped matching`);
  for (const name of Object.keys(ELSEWHERE)) assert.ok(names.includes(name), `ELSEWHERE names a test that no longer exists: ${name}`);
  const rows = new Set(ROWS.map(([name]) => name));
  const missing = names.filter((n) => !(n in ELSEWHERE) && !rows.has(n));
  assert.deepEqual(missing, []);
});
