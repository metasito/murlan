// tools/loop/tests/decide.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decide, WAIT } from "../decide.mjs";
import { ticketTally } from "../loop-logs.mjs";
import { BREAKER, CI_ROUNDS, MAX_HANDOFFS, TICKET_HOLDS, USD_BY_SIZE, USD_DEFAULT } from "../queue-loop.mjs";

const LIMITS = { BREAKER, CI_ROUNDS, MAX_HANDOFFS, TICKET_HOLDS, USD_BY_SIZE, USD_DEFAULT, WAIT };
const NOW = Date.parse("2026-10-12T20:00:00Z");

const route = { n: 42, skill: "implement", title: "the ticket", phase: "C", size: "size:S", fix: false, head: null };
const empty = { ...ticketTally(42, []), ciRounds: 0 };
const fresh = { failures: 0, holds: 0, waits: 0, overloads: 0, pinned: null, held: {} };
const own = { cwd: "/w/agent-42", branch: "agent/42-x", dirty: false, phase: "C" };
const base = { route, tally: empty, loop: fresh, limits: LIMITS, now: NOW, asked: false, own };

const pre = (over: object, top: object = {}) => ({ ...base, step: "pre", pre: { stop: false, unusable: false, moved: null, housekeeping: { verdict: "ok", why: null }, ...over }, ...top });
const pick = (over: object, top: object = {}) => ({ ...base, step: "pick", route: { ...route, ...over }, repicked: false, ...top });
const fixRoute = (top: object = {}) => pick({ fix: true, head: "h3" }, top);

const said = (over: object = {}) => ({ ticket: 42, branch: "agent/42-x", pr: null, phase: "C", handoff: null, stoodDown: false, why: null, ...over });
const ok = { subtype: "success", isError: false, apiStatus: null, cost: 2, turns: 30 };
const run = (over: object = {}) => ({ status: 0, phase: "C", declared: said({ handoff: "D" }), result: ok, stderr: "", blocked: false, blockedUntil: 0, accountError: null, apiErrorCode: null, lastFact: "result", ...over });
const derived = { ticket: 42, branch: "agent/42-x", cwd: "/w/agent-42", head: "h1", commits: 3, changed: [], dirty: false, phase: "C" };
const session = (over: object = {}) => ({ ...base, step: "session", run: run(), after: derived, built: true, pushed: null, issue: null, ...over });
const silent = (over: object = {}) => run({ declared: null, ...over });
const finished = (over: object = {}) => run({ phase: "F", declared: said({ phase: "F", ...over }) });
const pr = (state: string) => ({ number: 7, state, sha: "h1" });
const g = (pushed: object | null) => ({ ...base, step: "session", route: { ...route, phase: "G" }, run: null, after: derived, pushed });
const api = (apiStatus: number | null, over: object = {}) => silent({ status: 1, result: { ...ok, isError: true, apiStatus }, ...over });

const ci = (over: object = {}) => ({ testIds: ["tests/a.test.ts › adds"], output: "✖ adds", logUnread: false, waiting: false, infrastructure: false, appearing: false, runId: 99, attempt: 2, failedStep: "Typecheck and tests", ...over });
const land = (over: object = {}, top: object = {}) => ({
  ...base,
  step: "landing",
  landing: { n: 42, pr: 7, action: "recheck", reason: "the run has not finished", head: "h2abcdef9", armed: false, cleared: { ok: true, why: null }, ci: ci(), error: null, ...over },
  ...top,
});
const red = (over: object = {}, top: object = {}) => land({ action: "hand-back", reason: "CI failed at Typecheck and tests", ...over }, top);
const green = (over: object = {}, top: object = {}) => land({ action: "arm", reason: "mergeStateStatus is CLEAN", ...over }, top);
const merged = (top: object = {}) => land({ action: "already-merged", reason: "the pull request is already merged" }, top);
const owner = (over: object = {}, top: object = {}) => land({ action: "owner", reason: "the branch conflicts with main", ...over }, top);
const heldRed = (top: object = {}) => land({ error: "CI-RED for h1abcde could not be posted", head: "h1abcdef9" }, top);
/** The ledger's note of the head the supervisor armed. */
const armedAt = (head = "h2abcdef9", over: object = {}) => ({ tally: { ...empty, armedHead: head, ...over } });

type Row = [name: string, input: object, want: Record<string, unknown>];

// Rows whose name is a queueLoopMain test's are that test's routing, ported; the rest name the
// branch of queue-loop.mjs they cover.
const ROWS: Row[] = [
  // runOnce, before the pick
  ["the stop file stops before anything is picked", pre({ stop: true }), { kind: "stop", why: ".loop-stop", halt: undefined }],
  ["a stop file ends the night cleanly, before anything is picked", pre({ stop: true }), { kind: "stop", loop: fresh }],
  ["runOnce: an unusable shared checkout stops", pre({ unusable: true }), { kind: "stop", why: "the shared checkout is not usable" }],
  ["a moved tools/loop restarts the supervisor before any ticket is picked", pre({ moved: "abc1234" }), { kind: "restart", why: "tools/loop moved on main (now abc1234)" }],
  ["a moved tools/loop ends main with the restart code, before anything is picked", pre({ moved: "abc1234" }), { kind: "restart" }],
  ["a housekeeping hold holds, saying why; a stop still stops", pre({ housekeeping: { verdict: "hold", why: "the shared checkout is dirty" } }),
    { kind: "hold", wait: "preflight", n: undefined, why: "the shared checkout is dirty", hold: WAIT.FLOOR, loop: { ...fresh, holds: 1 } }],
  ["a refusal carries housekeeping's reason into why", pre({ housekeeping: { verdict: "stop", why: "lock drift" } }), { kind: "stop", why: "a pre-flight check refused: lock drift" }],
  ["runOnce: a clear pre-flight goes on to the pick", pre({}), { kind: "go" }],

  // runOnce, the pick
  ["a handoff route stops", pick({ skill: "handoff", title: "queue empty" }), { kind: "stop", why: "queue empty" }],
  ["an ambiguous pick stops rather than taking a third ticket", pick({ skill: "ambiguous", title: "two live worktrees" }), { kind: "stop", why: "two live worktrees" }],
  ["a closed ticket whose worktree still stands is torn down and the queue picked again, with no spawn on it", pick({ skill: "closed" }, { loop: { ...fresh, pinned: 42 } }),
    { kind: "repick", n: 42, loop: fresh }],
  ["a closed ticket unrelated to the pinned one keeps the pin, and its phase, on re-pick", pick({ skill: "closed", n: 9 }, { loop: { ...fresh, pinned: 42 } }),
    { kind: "repick", n: 9, loop: { ...fresh, pinned: 42 } }],
  ["runOnce: a closed ticket on the re-pick too stops", pick({ skill: "closed" }, { repicked: true }), { kind: "stop", why: "#42 is closed and its worktree still stands" }],
  ["runOnce: an implement route goes on to the spawn", pick({}), { kind: "go", redWhileDown: false }],
  ["stops on handoff", pick({ skill: "handoff", title: "nothing to do" }), { kind: "stop" }],
  ...["implement", "triage", "wayfinder"].map((skill): Row => [`keeps going on ${skill}`, pick({ skill }), { kind: "go" }]),
  ["a red round nobody recorded is written down before the fix round; a recorded one is not", fixRoute(), { kind: "go", redWhileDown: true }],
  ["runOnce: a fix route whose red head is already recorded writes nothing", fixRoute({ tally: { ...empty, retries: 1, lastRedHead: "h3" } }), { kind: "go", redWhileDown: false }],
  ["a red round nobody recorded counts toward the cap, and the last one parks before the refresh", fixRoute({ tally: { ...empty, retries: CI_ROUNDS - 1, lastRedHead: "h2" } }),
    { kind: "park", phase: "C", why: `${CI_ROUNDS} CI rounds on the same branch did not go green — the last one while the loop was down` }],
  ["a CI-RED already posted for the unrecorded head counts that round once, not twice", fixRoute({ tally: { ...empty, retries: 1, lastRedHead: "h2", ciRounds: 2 } }),
    { kind: "go", redWhileDown: true }],
  ["runOnce: a tracker's CI-RED count past the ledger's reaches the cap", fixRoute({ tally: { ...empty, ciRounds: CI_ROUNDS } }), { kind: "park", phase: "C" }],
  ["an ff failure before a fix parks", { ...base, step: "refresh", error: "fatal: Not possible to fast-forward" },
    { kind: "park", phase: "C", why: "could not fast-forward the worktree before the fix round — fatal: Not possible to fast-forward" }],
  ["runOnce: a fast-forwarded worktree goes on to the fix round", { ...base, step: "refresh", error: null }, { kind: "go" }],

  // runOnce, the facts a session's exit is read against, each asked for only where it decides
  ["runOnce: a D handoff asks whether the build passed", session({ built: undefined }), { kind: "ask", fact: "built" }],
  ["runOnce: a C handoff never asks about the build", session({ built: undefined, run: run({ declared: said({ handoff: "C" }) }) }), { kind: "handoff", phase: "C" }],
  ["runOnce: a session that did not hand off asks for its pull request", session({ run: finished(), pushed: undefined }), { kind: "ask", fact: "pushed" }],
  ["runOnce: an API failure is held before any pull request is asked for", session({ run: api(529), pushed: undefined }), { kind: "hold", wait: "api" }],
  ["runOnce: a finished session with no pull request asks after the issue", session({ run: finished(), issue: undefined }), { kind: "ask", fact: "issue" }],
  ["a session on the wrong model parks with the reason", session({ run: run({ wrongModel: "the session ran on claude-sonnet-5, not opus" }) }),
    { kind: "park", phase: "C", why: "the session ran on claude-sonnet-5, not opus", loop: { ...fresh, failures: 1 } }],
  ["a stood-down session is never asked about the issue", session({ run: finished({ stoodDown: true, why: "moot" }), issue: undefined }), { kind: "park", why: "moot" }],

  // runOnce, after the session
  ["an expired login stops the run, and does not park the ticket it met", session({ run: silent({ accountError: "authentication_failed", status: 1 }) }),
    { kind: "stop", why: /^the account cannot run sessions \(authentication_failed\) — log in.*#42 resumes from its worktree$/, loop: fresh }],
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
    { kind: "park", n: 42, phase: "C", why: "premise false", loop: { ...fresh, failures: 1 } }],
  ["a session that worked a different ticket stops the pass", session({ run: finished({ ticket: 41 }), pushed: pr("OPEN") }),
    { kind: "park", why: "the session worked #41, not #42", pr: 7 }],
  ["a handoff the supervisor makes for a cut-off session says why",
    session({ run: silent({ result: { ...ok, subtype: "error_max_turns" } }) }), { kind: "handoff", phase: "C", why: "the session ran out of turns" }],
  ["runOnce: cut off by the dollar cap resumes too",
    session({ run: silent({ stderr: "Budget limit reached ($15.08 of $15); stopping background agents.", phase: "B" }), after: { ...derived, phase: "B" } }),
    { kind: "handoff", phase: "B", why: "the session spent its budget mid-phase" }],
  ["runOnce: cut off in a phase it cannot resume parks", session({ run: silent({ phase: "E", result: { ...ok, subtype: "error_max_turns" } }) }), { kind: "park", phase: "E", why: "the session ran out of turns" }],
  ["runOnce: cut off with its worktree gone parks", session({ run: silent({ result: { ...ok, subtype: "error_max_turns" } }), after: null }),
    { kind: "park", phase: "?", why: "the session ran out of turns" }],
  ["a session stalled mid-retry is overloaded", session({ run: silent({ status: "stalled", lastFact: "api_retry", result: null }) }),
    { kind: "hold", wait: "api", n: 42, why: "the API could not be reached", hold: WAIT.FLOOR, loop: { ...fresh, overloads: 1, pinned: 42 } }],
  ["runOnce: the stall watchdog's kill with nothing pushed parks on its silence",
    session({ run: silent({ status: "stalled", lastFact: "assistant", result: null, phase: "D" }) }), { kind: "park", phase: "D", why: "no output for 30m in phase D" }],
  ["runOnce: the stall watchdog's kill with a pull request open lands it",
    session({ run: silent({ status: "stalled", lastFact: "assistant", result: null }), pushed: pr("OPEN") }), { kind: "pushed", n: 42, pr: 7, head: "h1" }],
  ["runOnce: the stall watchdog's kill after a declared handoff hands off", session({ run: run({ status: "stalled", lastFact: "assistant" }) }), { kind: "handoff", phase: "D" }],
  ["the 529 #1156 parked on is overloaded", session({ run: api(529) }), { kind: "hold", wait: "api", why: "the API answered 529", hold: WAIT.FLOOR }],
  ["a 429 is overloaded", session({ run: api(429) }), { kind: "hold", wait: "api", why: "the API answered 429" }],
  ["runOnce: a dropped connection with no status is overloaded", session({ run: api(null, { apiErrorCode: "server_error" }) }), { kind: "hold", wait: "api", why: "the API could not be reached" }],
  ["an error naming no status is parked", session({ run: api(null) }), { kind: "park", why: "the session exited 1 in phase C" }],
  ["a non-zero exit with no result line is parked", session({ run: silent({ status: 1, result: null }) }), { kind: "park", why: "the session exited 1 in phase C" }],
  ["an API 5xx holds the ticket rather than parking it", session({ run: api(503) }), { kind: "hold", wait: "api" }],
  ["in phase E, with a pull request open, E is spawned again rather than the head landed",
    session({ run: api(529, { phase: "E" }), after: { ...derived, phase: "E" }, pushed: pr("OPEN") }), { kind: "hold", wait: "api", n: 42, loop: { ...fresh, overloads: 1, pinned: 42 } }],
  ["a refused session is neither landed nor parked", session({ run: silent({ status: 1, result: null, blocked: true, blockedUntil: NOW + 3_600_000 }) }),
    { kind: "hold", wait: "usage", n: 42, why: "the usage window is spent", hold: 3_600_000 + WAIT.MARGIN, loop: { ...fresh, waits: 1 } }],
  ["a 429 from a spent usage window (#1074's) is a refusal, waited out to its reset",
    session({ run: api(429, { blocked: true, blockedUntil: NOW + 7_200_000 }) }), { kind: "hold", wait: "usage", hold: 7_200_000 + WAIT.MARGIN }],
  ["runOnce: a usage reset already past is still held the floor", session({ run: silent({ result: null, blocked: true, blockedUntil: NOW - 1000 }) }), { kind: "hold", hold: WAIT.FLOOR }],
  ["runOnce: a usage reset days away is held at most the cap", session({ run: silent({ result: null, blocked: true, blockedUntil: NOW + 7 * 86_400_000 }) }), { kind: "hold", hold: WAIT.CAP }],
  ["runOnce: a usage refusal naming no reset is held the floor", session({ run: silent({ result: null, blocked: true, blockedUntil: 0 }) }), { kind: "hold", hold: WAIT.FLOOR }],
  ["a refused session that recovered and pushed is settled, not refused", session({ run: silent({ blocked: true, blockedUntil: NOW + 1000 }), pushed: pr("OPEN") }),
    { kind: "pushed", pr: 7 }],
  ["is recorded closed, with no park",
    session({ run: finished(), after: { ...derived, commits: 0 }, issue: { state: "CLOSED", stateReason: "COMPLETED" } }),
    { kind: "closed", n: 42, why: "the session closed the issue as done, with no diff to land", loop: fresh }],
  ["with commits of its own it still parks", session({ run: finished(), issue: { state: "CLOSED", stateReason: "COMPLETED" } }),
    { kind: "park", why: "the session pushed no pull request" }],
  ["closed as not planned still parks", session({ run: finished(), after: { ...derived, commits: 0 }, issue: { state: "CLOSED", stateReason: "NOT_PLANNED" } }),
    { kind: "park" }],
  ["a pull request already merged is a landing, and the claim comes off", session({ run: finished(), pushed: pr("MERGED") }),
    { kind: "landed", n: 42, pr: 7, why: "pull request #7 was already merged" }],
  ["a torn-down worktree with a pull request open is settled, not parked", session({ run: finished(), after: null, pushed: pr("OPEN") }), { kind: "pushed", pr: 7, head: "h1" }],
  ["a torn-down worktree with no pull request anywhere still parks", session({ run: finished(), after: null }),
    { kind: "park", why: "the session pushed no pull request" }],
  ["a pull request closed without merging is the owner's", session({ run: finished(), pushed: pr("CLOSED") }),
    { kind: "park", why: "pull request #7 is closed", pr: 7 }],
  ["a session that pushed nothing parks the ticket", session({ run: finished() }), { kind: "park", why: "the session pushed no pull request", phase: "F" }],
  ["a session that exits without a LOOP-RESULT parks with that reason", session({ run: silent() }),
    { kind: "park", n: 42, why: "the session exited without a LOOP-RESULT", phase: "C" }],
  ["a G route lands without spawning", g(pr("OPEN")), { kind: "pushed", pr: 7 }],
  ["runOnce: phase G whose pull request merged meanwhile lands", g(pr("MERGED")), { kind: "landed", pr: 7 }],
  ["a G pass with no open pull request says so", g(null), { kind: "park", phase: "G", why: "phase G found no open pull request for the pushed head" }],

  // landOne, one visit to a pull request in flight: an act on GitHub, or what the read costs the ticket
  ["landing: a red with its log is rerun once, on its first attempt", red({ ci: ci({ attempt: 1 }) }),
    { kind: "act", act: "rerun", why: "CI is red at Typecheck and tests — rerunning 99 once", loop: fresh }],
  ["landing: an armed red is rerun with the arm on, so a green rerun merges", red({ armed: true, ci: ci({ attempt: 1 }) }, armedAt()), { kind: "act", act: "rerun" }],
  ["landing: a head the ledger noted a rerun for is handed back", red({ ci: ci({ attempt: 1 }) }, armedAt("h1", { armedFlake: { runId: 99, head: "h2abcdef9" } })),
    { kind: "retry", why: "CI failed at Typecheck and tests" }],
  ["landing: a red on its second attempt is handed back", red(), { kind: "retry" }],
  ["landing: a red with no run to rerun is handed back", red({ ci: ci({ attempt: 1, runId: null }) }), { kind: "retry" }],
  ["landing: an armed red is disarmed before it is handed back", red({ armed: true }, armedAt()), { kind: "act", act: "disarm", why: "CI failed at Typecheck and tests", loop: fresh }],
  ["landing: a red whose log is unread is held", red({ ci: ci({ logUnread: true }) }),
    { kind: "hold", wait: "landing", why: "CI is red and its log could not be read — CI failed at Typecheck and tests", loop: { ...fresh, held: { 42: 1 } } }],
  ["landing: main moved, so the branch is updated", land({ action: "update-branch", reason: "main moved" }),
    { kind: "act", act: "update-branch", why: "main moved — updating the branch" }],
  ["landing: an armed branch is disarmed before main is merged into it", land({ action: "update-branch", reason: "main moved", armed: true }, armedAt()), { kind: "act", act: "disarm" }],
  ["landing: an unarmed head asks whether review cleared it", land({ cleared: undefined }), { kind: "ask", fact: "cleared" }],
  ["landing: a cleared head is armed while its run is still going", land({ ci: ci({ waiting: true }) }), { kind: "act", act: "arm" }],
  ["landing: a cleared green head is armed", green(), { kind: "act", act: "arm" }],
  ["landing: a head no review clears goes to the owner", green({ cleared: { ok: false, why: "no VERDICT: LAND names h2abcde" } }),
    { kind: "park", phase: "E", why: "no VERDICT: LAND names h2abcde — h2abcde was pushed for review, not cleared", loop: { ...fresh, failures: 1 } }],
  ["landing: an armed head still running is waited on, and clearance is not asked again", land({ armed: true, cleared: undefined, ci: ci({ waiting: true }) }, armedAt()),
    { kind: "act", act: "wait", why: "the run has not finished" }],
  ["landing: an armed green head is waited on for GitHub's merge", green({ armed: true, ci: ci({ pass: true }) }, armedAt()), { kind: "act", act: "wait" }],
  ["landing: an armed head whose run said nothing is held", land({ armed: true, reason: "no check has reported on this head", ci: ci({ infrastructure: true, appearing: true }) }, armedAt()),
    { kind: "hold", why: "no check has reported on this head" }],
  ["landing: a head that moved under the arm is disarmed first", land({ armed: true }, armedAt("h1abcdef9")), { kind: "act", act: "disarm", why: "the head moved to h2abcde under the arm" }],
  ["landing: an arm the ledger has no note of is disarmed too", green({ armed: true, ci: ci({ pass: true }) }), { kind: "act", act: "disarm" }],
  ["landing: what only a person can move goes to the owner", owner(), { kind: "park", phase: "E", why: "the branch conflicts with main" }],
  ["landing: an armed one is disarmed before it goes to the owner", owner({ armed: true }, armedAt()), { kind: "act", act: "disarm", why: "the branch conflicts with main" }],
  ["landing: a read that failed is held, never parked", land({ error: "could not read #7 — HTTP 403" }), { kind: "hold", wait: "landing", why: "could not read #7 — HTTP 403" }],
  ["landing: a merge on the head a rerun won names the flake", merged(armedAt("h2abcdef9", { armedFlake: { runId: 99, head: "h2abcdef9" } })), { kind: "landed", flake: { runId: 99 } }],
  ["landing: a flake noted for another head is not this merge's", merged(armedAt("h1", { armedFlake: { runId: 99, head: "h1" } })), { kind: "landed", flake: null }],
  ["landing: a red round still owed, with no process run since, is a fix", red({}, { tally: { ...empty, retries: 1, lastRedHead: "h2abcdef9", sinceRed: 0 } }),
    { kind: "fix", n: 42, head: "h2abcdef9" }],

  // runOnce and main, what a visit costs the ticket
  ["a ticket that pushes and merges is landed, in one pass", merged(), { kind: "landed", n: 42, head: "h2abcdef9", loop: fresh }],
  ["a red verdict hands the ticket back, and still writes its row", red(), { kind: "retry", n: 42, head: "h2abcdef9", why: "CI failed at Typecheck and tests", loop: fresh }],
  ["a CI fix round keeps the worktree, and hands it back", red(), { kind: "retry" }],
  ["a red landing leaves the worktree standing and the next pass spawns C with the fix", red(), { kind: "retry" }],
  ["the retry row carries the head CI judged, not the one before update-branch", red({ head: "h9" }), { kind: "retry", head: "h9" }],
  ["#1100's report-upload red, back from its one rerun, is a fix round", red({ reason: "CI failed at Browser test report", head: "2f2a885" }), { kind: "retry", head: "2f2a885" }],
  [`runOnce: red round ${CI_ROUNDS} parks`, red({}, { tally: { ...empty, retries: CI_ROUNDS - 1 } }),
    { kind: "park", phase: "E", ciRed: true, why: `${CI_ROUNDS} CI rounds on the same branch did not go green — last: CI failed at Typecheck and tests` }],
  ["a restart mid fix round keeps the round count: the third red run parks", red({}, { tally: { ...empty, retries: CI_ROUNDS - 1 } }), { kind: "park" }],
  ["runOnce: the tracker's CI-RED count stands in for rounds the ledger missed", red({}, { tally: { ...empty, ciRounds: CI_ROUNDS - 1 } }), { kind: "park", ciRed: true }],
  ["a red whose CI-RED could not be posted is held in flight: no park, the claim kept, and no round spent until it is posted",
    land({ error: "CI-RED for abc could not be posted", head: "abc" }),
    { kind: "hold", wait: "landing", n: 42, why: "CI-RED for abc could not be posted", head: "abc", hold: undefined, loop: { ...fresh, held: { 42: 1 } } }],
  ["a post that still fails holds, and spawns nothing", heldRed(), { kind: "hold", wait: "landing", n: 42, why: "CI-RED for h1abcde could not be posted" }],
  ["a landing only a person can move parks the ticket rather than dropping it", owner(), { kind: "park", phase: "E", why: "the branch conflicts with main" }],
  ["a landing that is the owner's parks with its own reason", owner(), { kind: "park", why: "the branch conflicts with main" }],
  ["a merge is the landing, and costs the run nothing", merged({ loop: { ...fresh, failures: 2 } }), { kind: "landed", halt: undefined, loop: fresh }],
  ["a hand-back writes a row of its own, and does not count as a failure", red({}, { loop: { ...fresh, failures: 1 } }), { kind: "retry", loop: { ...fresh, failures: 1 } }],
  ["an owner decision is parked, and goes through park rather than a bare teardown", owner({ reason: "r" }), { kind: "park", loop: { ...fresh, failures: 1 } }],
  ["a hold spends no red round and parks nothing: the next pass visits the red again", land({ error: "r", head: "abc" }),
    { kind: "hold", head: "abc", loop: { ...fresh, held: { 42: 1 } } }],
  ["landing: a landing unpins its ticket, and leaves another's pin", merged({ loop: { ...fresh, pinned: 42 } }), { kind: "landed", loop: { pinned: null } }],
  ["landing: another ticket's landing leaves the pin", merged({ loop: { ...fresh, pinned: 9 } }), { kind: "landed", loop: { pinned: 9 } }],
  ["an empty queue holds while pull requests are landing, rather than ending the night", pick({ skill: "handoff", title: "queue empty" }, { landing: 1 }),
    { kind: "hold", wait: "preflight", why: "queue empty; 1 pull request(s) landing", hold: WAIT.FLOOR, loop: { ...fresh, holds: 1 } }],

  // main, over a handoff or a fix round
  ["runOnce: a handoff that takes the ticket over its dollar ceiling parks",
    session({ tally: { ...empty, spend: USD_BY_SIZE["size:S"] - 1, sessions: 4 } }),
    { kind: "park", phase: "D", why: `$${(USD_BY_SIZE["size:S"] + 1).toFixed(2)} across 5 processes — over this ticket's ceiling`, instead: { kind: "handoff", publish: true } }],
  ["main: a ticket with no size is held to the default ceiling", session({ route: { ...route, size: null }, tally: { ...empty, spend: USD_DEFAULT - 2 } }),
    { kind: "park", why: /over this ticket's ceiling$/ }],
  ["the retry session's cost counts toward the spend ceiling", red({}, { tally: { ...empty, spend: 31, sessions: 5 } }),
    { kind: "park", phase: "E", why: "$31.00 across 6 processes — over this ticket's ceiling", instead: { kind: "retry", head: "h2abcdef9" } }],
  ["a ticket's ceiling is its size's, and an unlabelled one gets the default", session({ tally: { ...empty, spend: 3 } }), { kind: "handoff" }],
  ["main: a spend exactly at the size's ceiling parks", session({ tally: { ...empty, spend: USD_BY_SIZE["size:S"] - 2 } }),
    { kind: "park", why: /over this ticket's ceiling$/ }],
  ["main: the default ceiling is the same bound for a ticket with no size", session({ route: { ...route, size: null }, tally: { ...empty, spend: USD_DEFAULT - 3 } }), { kind: "handoff" }],
  ["a handoff cannot run for ever", session({ tally: { ...empty, handoffsThisRound: MAX_HANDOFFS - 2 } }), { kind: "handoff" }],
  [`main: handoff ${MAX_HANDOFFS} on one ticket parks`, session({ tally: { ...empty, handoffsThisRound: MAX_HANDOFFS - 1 } }),
    { kind: "park", why: `${MAX_HANDOFFS} phase handoffs on one ticket`, instead: { kind: "handoff", publish: true } }],
  ["main: an owner's park of a D handoff still publishes the branch first", session({ asked: true }), { kind: "park", why: "parked by owner", instead: { publish: true } }],
  ["main: a park over the ceiling publishes only what a D handoff would have", session({ run: run({ declared: said({ handoff: "C" }) }), tally: { ...empty, spend: 40 } }),
    { kind: "park", instead: { publish: false } }],
  ["does not spend the next one, because CI would answer the same", red({}, { tally: { ...empty, retries: 1, lastRedHead: "h2abcdef9", sinceRed: 2 } }),
    { kind: "park", phase: "E", why: "the fix round pushed no commit — CI would answer CI failed at Typecheck and tests again" }],
  ["a fix round whose head equals lastRedHead parks even after a restart", red({}, { tally: { ...empty, retries: 1, lastRedHead: "h2abcdef9", sinceRed: 1 } }), { kind: "park" }],
  ["parks the ticket once its session exits, and forgets the request", session({ asked: true }),
    { kind: "park", phase: "D", why: "parked by owner", halt: null, loop: fresh }],
  ["a red CI round parks in the phase git reports, with its worktree", red({}, { asked: true, own: { ...own, phase: "E" } }),
    { kind: "park", phase: "E", why: "parked by owner", halt: null, loop: fresh }],
  ["a ticket that lands before the park can act says the request was dropped", session({ asked: true, run: finished(), pushed: pr("MERGED") }), { kind: "landed" }],
  ["a request naming another ticket parks nothing", session({ asked: false }), { kind: "handoff" }],
  ["main: a park asked from the board takes a usage hold", session({ asked: true, run: silent({ result: null, blocked: true, blockedUntil: 0 }) }), { kind: "park", phase: "C", why: "parked by owner" }],
  ["main: a park asked from the board takes an API hold", session({ asked: true, run: api(529) }), { kind: "park", why: "parked by owner" }],
  ["main: a park asked from the board takes a held red round", heldRed({ asked: true }), { kind: "park", why: "parked by owner", instead: { kind: "hold" } }],
  ["main: a pre-flight hold has no ticket for the owner to park", pre({ housekeeping: { verdict: "hold", why: "busy" } }, { asked: true }), { kind: "hold" }],
  ["main: the owner's park neither counts toward the breaker nor resets a counter",
    session({ asked: true, loop: { failures: BREAKER - 1, holds: 2, waits: 3, overloads: 4, pinned: 42 } }),
    { kind: "park", halt: null, loop: { failures: BREAKER - 1, holds: 2, waits: 3, overloads: 4, pinned: null } }],

  // main, the run's own counters
  ["three tickets in a row that do not land stop the night", session({ run: finished({ stoodDown: true, why: "w" }), loop: { ...fresh, failures: BREAKER - 1 } }),
    { kind: "park", halt: `${BREAKER} tickets in a row did not land`, loop: { ...fresh, failures: BREAKER } }],
  ["main: a park short of the breaker does not halt", session({ run: finished({ stoodDown: true, why: "w" }) }), { kind: "park", halt: null }],
  ["one bad ticket is a ticket; three in a row is the loop or the machine", session({ run: finished({ stoodDown: true, why: "w" }), loop: { ...fresh, failures: BREAKER - 2 } }),
    { kind: "park", halt: null, loop: { ...fresh, failures: BREAKER - 1 } }],
  ["a landing clears the breaker, so a bad ticket between good ones is not fatal",
    session({ run: finished(), pushed: pr("MERGED"), loop: { failures: 2, holds: 1, waits: 5, overloads: 3, pinned: 42, held: {} } }), { kind: "landed", loop: fresh }],
  ["a ticket closed as done clears the breaker as a landing does",
    session({ run: finished(), after: { ...derived, commits: 0 }, issue: { state: "CLOSED", stateReason: "COMPLETED" }, loop: { ...fresh, failures: 2, waits: 4 } }),
    { kind: "closed", loop: fresh }],
  ["main: a handoff resets the pre-flight and API counts, and neither the breaker nor the usage count",
    session({ loop: { failures: 2, holds: 3, waits: 4, overloads: 5, pinned: null } }), { kind: "handoff", loop: { failures: 2, holds: 0, waits: 4, overloads: 0, pinned: 42 } }],
  ["main: a park resets the pre-flight and API counts, and keeps the usage count", session({ run: finished({ stoodDown: true, why: "w" }), loop: { failures: 0, holds: 3, waits: 4, overloads: 5, pinned: 42 } }),
    { kind: "park", loop: { failures: 1, holds: 0, waits: 4, overloads: 0, pinned: null } }],
  [`${WAIT.TRIES} in a row end the run and say why; a served session in between resets the count`,
    session({ run: api(529), loop: { ...fresh, overloads: WAIT.TRIES - 1, pinned: 42 } }),
    { kind: "stop", why: `the API answered 529, ${WAIT.TRIES} sessions in a row`, halt: `the API answered 529, ${WAIT.TRIES} sessions in a row`, instead: { kind: "hold", wait: "api" } }],
  [`main: API hold ${WAIT.TRIES - 1} still holds`, session({ run: api(529), loop: { ...fresh, overloads: WAIT.TRIES - 2 } }), { kind: "hold", loop: { ...fresh, overloads: WAIT.TRIES - 1, pinned: 42 } }],
  ["main: an API hold leaves the pre-flight count", session({ run: api(529), loop: { ...fresh, holds: 2 } }), { kind: "hold", loop: { ...fresh, overloads: 1, pinned: 42 } }],
  [`main: pre-flight hold ${WAIT.TRIES + 1} stops the run`, pre({ housekeeping: { verdict: "hold", why: "busy" } }, { loop: { ...fresh, holds: WAIT.TRIES } }),
    { kind: "stop", why: `busy, ${WAIT.TRIES + 1} times running`, halt: `busy, ${WAIT.TRIES + 1} times running` }],
  [`main: pre-flight hold ${WAIT.TRIES} still holds`, pre({ housekeeping: { verdict: "hold", why: "busy" } }, { loop: { ...fresh, holds: WAIT.TRIES - 1, pinned: 42 } }),
    { kind: "hold", loop: { ...fresh, holds: WAIT.TRIES, pinned: 42 } }],
  ["pre-flight holds spend nothing of a ticket's hold bound", pre({ housekeeping: { verdict: "hold", why: "drift" } }, { loop: { ...fresh, held: { 42: 3 } } }),
    { kind: "hold", loop: { ...fresh, holds: 1, held: { 42: 3 } } }],
  ["a ticket parks at its own bound of holds, not before", heldRed({ loop: { ...fresh, held: { 42: TICKET_HOLDS - 1 } } }),
    { kind: "hold", loop: { ...fresh, held: { 42: TICKET_HOLDS } } }],
  ["landing: each ticket counts its own holds", heldRed({ loop: { ...fresh, held: { 9: TICKET_HOLDS } } }), { kind: "hold", loop: { held: { 9: TICKET_HOLDS, 42: 1 } } }],
  ["a ticket held past its bound is parked for the owner, and the loop carries on",
    heldRed({ loop: { ...fresh, holds: 2, held: { 42: TICKET_HOLDS } } }),
    { kind: "park", n: 42, phase: "E", why: `CI-RED for h1abcde could not be posted, ${TICKET_HOLDS + 1} times running`, halt: null,
      instead: { kind: "hold" }, loop: { ...fresh, failures: 1, holds: 2, held: { 42: undefined } } }],
  ["main: a ticket parked at its hold bound counts toward the breaker", heldRed({ loop: { ...fresh, failures: BREAKER - 1, held: { 42: TICKET_HOLDS } } }),
    { kind: "park", halt: `${BREAKER} tickets in a row did not land` }],
  ["landing: any visit but a hold forgets the ticket's holds", red({}, { loop: { ...fresh, held: { 42: 4, 9: 2 } } }), { kind: "retry", loop: { held: { 42: undefined, 9: 2 } } }],
  ["main: a held red round is the ticket's hold, not the run's, and keeps the pin", land({ error: "r", head: "abc" }, { loop: { ...fresh, holds: 2, overloads: 2, pinned: 9 } }),
    { kind: "hold", loop: { ...fresh, holds: 2, overloads: 2, pinned: 9, held: { 42: 1 } } }],
  [`main: usage refusal ${WAIT.TRIES + 1} stops the run`, session({ run: silent({ result: null, blocked: true, blockedUntil: 0 }), loop: { ...fresh, waits: WAIT.TRIES } }),
    { kind: "stop", why: `refused ${WAIT.TRIES} times running, each after waiting out the window it named`, halt: `refused ${WAIT.TRIES} times running, each after waiting out the window it named`, instead: { kind: "hold", wait: "usage" } }],
  ["main: a usage refusal neither pins nor touches the API count", session({ run: silent({ result: null, blocked: true, blockedUntil: 0 }), loop: { ...fresh, holds: 2, overloads: 3 } }),
    { kind: "hold", loop: { ...fresh, waits: 1, overloads: 3 } }],
  ["releases the claim on the ticket it was holding", { ...base, step: "threw", error: "boom", own: { ...own, phase: "D" }, loop: { ...fresh, holds: 2, pinned: 42 } },
    { kind: "park", n: 42, phase: "D", why: "the loop threw: boom", loop: { ...fresh, failures: 1, holds: 2, pinned: 42 } }],
  ["main: a throw with no worktree to read parks in phase ?", { ...base, step: "threw", error: "boom", own: null }, { kind: "park", phase: "?" }],
  ["a throw before anything is claimed parks nothing", { ...base, step: "threw", route: null, error: "boom" },
    { kind: "fail", why: "the loop threw: boom", loop: { ...fresh, failures: 1 } }],
  [`main: throw ${BREAKER} in a row trips the breaker`, { ...base, step: "threw", route: null, error: "boom", loop: { ...fresh, failures: BREAKER - 1, pinned: 9 } },
    { kind: "fail", halt: `${BREAKER} tickets in a row did not land`, loop: { ...fresh, failures: BREAKER, pinned: 9 } }],
];

/** Every key `want` names, matched as given; a nested object is matched the same way. */
const matches = (got: Record<string, unknown>, want: Record<string, unknown>, at = "") => {
  for (const [key, value] of Object.entries(want)) {
    if (value instanceof RegExp) assert.match(String(got?.[key]), value, at + key);
    else if (value && typeof value === "object" && !Array.isArray(value)) matches(got?.[key] as Record<string, unknown>, value as Record<string, unknown>, `${at}${key}.`);
    else assert.deepEqual(got?.[key], value, at + key);
  }
};

for (const [name, input, want] of ROWS) test(name, () => matches(decide(input), want));

test("every row's name is its own", () => {
  const names = ROWS.map(([name]) => name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

/**
 * queueLoopMain's tests that check something other than the routing decision: the I/O around it,
 * the picker, the ledger's tally, the recap, or a helper tested where it lives. Each names the test
 * file that holds a test of that name, and what it checks instead.
 */
const ELSEWHERE: Record<string, [file: string, why: string]> = {
  "the pushed head is visited before the pass returns": ["queueLoopMain.test.ts", "io"],
  "every teardown is told which ticket's claim it is releasing": ["queueLoopMain.test.ts", "io"],
  "no terminal outcome leaves the worktree standing": ["queueLoopMain.test.ts", "io"],
  "housekeeping is asked about the pinned ticket, and waited for": ["queueLoopMain.test.ts", "io"],
  "a pinned ticket is what the picker is asked for": ["queueLoopMain.test.ts", "picker"],
  "a park rings once and a landing does not": ["queueLoopMain.test.ts", "io"],
  "a G route announces itself before it lands": ["queueLoopMain.test.ts", "io"],
  "loopMoved answers a diff, not an error": ["queueLoopMain.test.ts", "io"],
  "a refused session's dirty worktree is left standing as it is, with no copy taken": ["queueLoopMain.test.ts", "io"],
  "the sweep in housekeeping runs before the pick": ["queueLoopMain.test.ts", "io"],
  "nextRoute replays 2026-09-21/22: every session starts where the ledger before it pointed": ["queueLoopMain.test.ts", "picker"],
  "nextRoute: a pinned ticket with no worktree rebuilds at A": ["queueLoopMain.test.ts", "picker"],
  "nextRoute: a pinned ticket the tracker no longer shows as ours goes back to the picker": ["queueLoopMain.test.ts", "picker"],
  "nextRoute: a LAND on the head outranks a handoff to review, and nothing else does": ["queueLoopMain.test.ts", "picker"],
  "nextRoute: a pushed head settles ahead of a handoff the ledger holds from before the push": ["queueLoopMain.test.ts", "picker"],
  "refreshWorktree fetches the branch and fast-forwards onto it": ["queueLoopMain.test.ts", "io"],
  "publishForReview pushes, then opens it ready only when no pull request is open": ["queueLoopMain.test.ts", "io"],
  "a landed or parked ticket removes the worktree from the main checkout": ["queueLoopMain.test.ts", "io"],
  "an unreadable CI read on a head not known pushed is not a no-spawn G": ["queueLoopMain.test.ts", "picker"],
  "a handed phase wins over a derived fix; only a pushed G outranks it": ["queueLoopMain.test.ts", "picker"],
  "a fix round's spawn carries the rounds already spent": ["queueLoopMain.test.ts", "io"],
  "landing deletes the branch after the worktree, from the shared checkout": ["queueLoopMain.test.ts", "io"],
  "a branch -d refuses is said, and the land still returns": ["queueLoopMain.test.ts", "io"],
  "a worktree kept for its unwritten leftovers keeps its branch too": ["queueLoopMain.test.ts", "io"],
  "a landed worktree with leftovers is saved as a binary patch, then force-removed": ["queueLoopMain.test.ts", "io"],
  "a leftover patch that cannot be written keeps the worktree": ["queueLoopMain.test.ts", "io"],
  "a clean landed worktree is removed without --force": ["queueLoopMain.test.ts", "io"],
  "a dirtied shared checkout is named, not fatal": ["queueLoopMain.test.ts", "io"],
  "nothing said and nothing derived is nothing": ["queueLoopMain.test.ts", "helper: afterSession"],
  "the declaration alone is enough once the worktree is gone": ["queueLoopMain.test.ts", "helper: afterSession"],
  "derive alone still answers, for a session that declared nothing": ["queueLoopMain.test.ts", "helper: afterSession"],
  "the phase is the session's own, not the one derive computed": ["queueLoopMain.test.ts", "helper: afterSession"],
  "the worktree's own readings are never taken from the declaration": ["queueLoopMain.test.ts", "helper: afterSession"],
  "boot names the session the last supervisor died with": ["queueLoopMain.test.ts", "io"],
  "the run file says why the run stopped, not only its total": ["queueLoopMain.test.ts", "io"],
  "a restart's run file says restarting, not stopped": ["queueLoopMain.test.ts", "io"],
  "a standing() that throws still releases the claim": ["queueLoopMain.test.ts", "io"],
  "a park that itself throws is reported, not raised": ["queueLoopMain.test.ts", "io"],
  "counts a wait still running as waiting, not working": ["queueLoopMain.test.ts", "recap"],
  "books a standby as asleep, not working": ["queueLoopMain.test.ts", "recap"],
  "says so when the picker read no open Launch tickets": ["queueLoopMain.test.ts", "recap"],
  "names a size this run's busiest process left short of turn headroom": ["queueLoopMain.test.ts", "recap"],
  "names a red nightly parity run, read once per pass": ["queueLoopMain.test.ts", "recap"],
  "a supervisor that dies in the CI wait still counts the session, and the restarted G pass adds nothing": ["queueLoopMain.test.ts", "tally"],
  "merged: the session is counted once, and the tally reads as before": ["queueLoopMain.test.ts", "tally"],
  "red: the session is counted once, and the tally reads as before": ["queueLoopMain.test.ts", "tally"],
  "owner: the session is counted once, and the tally reads as before": ["queueLoopMain.test.ts", "tally"],
  "a row names the route's title and size and the review rounds read after the session, with no tracker read of its own": ["queueLoopMain.test.ts", "io"],
  "a derive off the ticket, or with no count, is not the ticket's review rounds; the tracker's are": ["queueLoopMain.test.ts", "io"],
  "a row main writes names its ticket as the tracker does: a repark, and the park after a throw": ["queueLoopMain.test.ts", "io"],
  "nextRoute: a resumed ticket carries its issue's title and review rounds, not its branch name": ["queueLoopMain.test.ts", "picker"],
  "a retry resets handoffsThisRound and the handed phase": ["queueLoopMain.test.ts", "tally"],
  "overSpend, overHandoffs, the no-commit park and a thrown iteration each write exactly one parked row": ["queueLoopMain.test.ts", "io"],
  "a throw during a resumed run parks with standing().cwd": ["queueLoopMain.test.ts", "io"],
  "a hold is not a handoff: the ticket's handoff count stays where it was": ["queueLoopMain.test.ts", "tally"],
  "is recorded with the steps that failed": ["queueLoopMain.test.ts", "repark"],
  "is applied again at the start of the next pass, once, and a restart does not repeat it": ["queueLoopMain.test.ts", "repark"],
  "a landing a rerun won writes the flake on its row": ["queueLoopMain.test.ts", "io"],
  "a red whose CI-RED a visit could not post reaches its fix round with exactly one posted": ["queueLoopMain.test.ts", "io: three passes, one CI-RED"],
  "is G, so landOne posts its CI-RED, whether the supervisor held it or stopped mid-visit": ["queueLoopMain.test.ts", "picker"],
  "a visit's note is an armed row naming its head and any flake": ["queueLoopMain.test.ts", "io"],
  "a red on an armed pull request is disarmed before any fix round is spawned": ["queueLoopMain.test.ts", "io: landOne's call order"],
  "one that merged is recorded and released before the pick, and a live worktree's is not visited": ["queueLoopMain.test.ts", "io: the sweep"],
  "a red is rebuilt from its branch and pinned when no worktree stands, so the pick is its fix round": ["queueLoopMain.test.ts", "io: the sweep"],
  "a red waits for the slot while another ticket's worktree stands": ["queueLoopMain.test.ts", "io: the sweep"],
  "one only a person can move is parked from the ledger, with no worktree to carry": ["queueLoopMain.test.ts", "io: the sweep"],
  "a head armed at its push comes down to its branch with the claim kept, and the slot is the next pick's": ["queueLoopMain.test.ts", "io: the teardown"],
};

// The two parameterised tables in queueLoopMain, spelled out: a name the regex below cannot expand
// fails the guard rather than passing it unread.
const EXPANDED: Record<string, string[]> = {
  "`${name}: the session is counted once, and the tally reads as before`": ["merged", "red", "owner"].map((n) => `${n}: the session is counted once, and the tally reads as before`),
  "`${name} is ${outcome}`": ["the 529 #1156 parked on is overloaded", "a 429 is overloaded", "an error naming no status is parked", "a non-zero exit with no result line is parked"],
};

const testNames = (file: string) =>
  [...readFileSync(new URL(`./${file}`, import.meta.url), "utf8").matchAll(/\btest\(\s*("(?:[^"\\]|\\.)*"|`[^`]*`)/g)].flatMap(([, quoted]) => {
    if (quoted.startsWith('"')) return [JSON.parse(quoted)];
    if (EXPANDED[quoted]) return EXPANDED[quoted];
    const plain = quoted.slice(1, -1).replaceAll("${WAIT.TRIES}", String(WAIT.TRIES));
    assert.doesNotMatch(plain, /\$\{/, `${quoted} is a template this guard cannot expand: add it to EXPANDED`);
    return [plain];
  });

test("every routing test in queueLoopMain has a row of the same name", () => {
  const names = testNames("queueLoopMain.test.ts");
  assert.ok(names.length >= 120, `read ${names.length} test names; the regex has stopped matching`);
  for (const [name, [file]] of Object.entries(ELSEWHERE)) assert.ok(testNames(file).includes(name), `ELSEWHERE says ${file} has a test named "${name}", and it has none`);
  const rows = new Set(ROWS.map(([name]) => name));
  const missing = names.filter((n) => !(n in ELSEWHERE) && !rows.has(n));
  assert.deepEqual(missing, []);
});
