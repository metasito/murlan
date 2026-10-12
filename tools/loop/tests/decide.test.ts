// tools/loop/tests/decide.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../decide.mjs";
import { BREAKER, CI_ROUNDS, MAX_HANDOFFS, SETTLE, SETTLE_ROUNDS, USD_BY_SIZE, USD_DEFAULT, WAIT } from "../queue-loop.mjs";

const LIMITS = { BREAKER, CI_ROUNDS, MAX_HANDOFFS, USD_BY_SIZE, USD_DEFAULT, WAIT, UPDATES: SETTLE_ROUNDS.update, SETTLE_MS: SETTLE.DEADLINE_MS };
const NOW = Date.parse("2026-10-12T20:00:00Z");
const PARK = { remove: ["in-progress", "ready-for-agent"], add: ["ready-for-human"] };
const RELEASE = { remove: ["in-progress"], add: [] };

const route = { n: 42, skill: "implement", title: "the ticket", phase: "C", size: "size:S", fix: false };
const empty = { spend: 0, ms: 0, turns: 0, processes: 0, handoffs: 0, lastHandoff: null, retries: 0, lastRedHead: null, reruns: [] as string[], holds: 0, fixSpend: 0 };
const fresh = { failures: 0, transients: 0, pinned: null };
const base = { route, tally: empty, loop: fresh, limits: LIMITS, now: NOW, asked: false };

const pre = (over: object) => ({ ...base, step: "pre", pre: { stop: false, unusable: false, moved: null, housekeeping: { verdict: "ok", why: null }, ...over } });
const pick = (over: object, repicked = false) => ({ ...base, step: "pick", route: { ...route, ...over }, repicked });

const said = (over: object = {}) => ({ ticket: 42, branch: "agent/42-x", pr: null, phase: "C", handoff: null, stoodDown: false, why: null, ...over });
const ok = { subtype: "success", isError: false, apiStatus: null, cost: 2, turns: 30 };
const run = (over: object = {}) => ({ status: 0, phase: "C", declared: said({ handoff: "D" }), result: ok, stderr: "", blocked: false, blockedUntil: 0, accountError: null, apiErrorCode: null, lastFact: "result", ...over });
const derived = { ticket: 42, branch: "agent/42-x", cwd: "/w/agent-42", head: "h1", dirty: false, commits: 3, phase: "C" };
const session = (over: object = {}) => ({ ...base, step: "session", run: run(), after: derived, built: true, pushed: null, issue: null, ...over });
const silent = (over: object = {}) => run({ declared: null, ...over });
const pr = (state: string) => ({ number: 7, state, sha: "h1" });
const g = (pushed: object | null) => ({ ...base, step: "session", route: { ...route, phase: "G" }, run: null, after: derived, pushed });

const ci = (over: object = {}) => ({ testIds: ["tests/a.test.ts › adds"], output: "✖ adds", logUnread: false, runId: 99, ...over });
const land = (over: object = {}, top: object = {}) => ({
  ...base,
  step: "landing",
  landing: { action: "recheck", reason: "the run has not finished", pr: 7, head: "h2", armed: false, overdue: false, updates: 0, cleared: { ok: true, why: null }, reviewed: true, ci: ci(), error: null, ...over },
  ...top,
});
const red = (over: object = {}, top: object = {}) => land({ action: "hand-back", reason: "CI failed at Typecheck and tests", ...over }, top);
const green = (over: object = {}, top: object = {}) => land({ action: "arm", reason: "mergeStateStatus is CLEAN", ...over }, top);

type Row = [name: string, input: object, want: Record<string, unknown>];

const ROWS: Row[] = [
  // runOnce, before the pick
  ["pre: the stop file stops before anything is picked", pre({ stop: true }), { kind: "stop", why: ".loop-stop" }],
  ["pre: an unusable shared checkout stops", pre({ unusable: true }), { kind: "stop", why: "the shared checkout is not usable" }],
  ["pre: a moved tools/loop restarts the supervisor", pre({ moved: "abc1234" }), { kind: "restart", why: "tools/loop moved on main (now abc1234)" }],
  ["pre: a housekeeping hold waits the floor, counted as a transient", pre({ housekeeping: { verdict: "hold", why: "the shared checkout is dirty" } }),
    { kind: "hold", why: "the shared checkout is dirty", hold: WAIT.FLOOR, loop: { failures: 0, transients: 1, pinned: null } }],
  ["pre: a housekeeping refusal stops", pre({ housekeeping: { verdict: "stop", why: "lock drift" } }), { kind: "stop", why: "a pre-flight check refused: lock drift" }],
  ["pre: a clear pre-flight goes on to the pick", pre({}), { kind: "go" }],

  // runOnce, the pick
  ["pick: a picker handing to the owner stops", pick({ skill: "handoff", title: "queue empty" }), { kind: "stop", why: "queue empty" }],
  ["pick: an ambiguous pick stops rather than taking a third ticket", pick({ skill: "ambiguous", title: "two live worktrees" }), { kind: "stop", why: "two live worktrees" }],
  ["pick: a closed ticket's worktree is torn down, its claim released, and the queue picked again", pick({ skill: "closed" }), { kind: "repick", n: 42, label: RELEASE }],
  ["pick: a closed ticket on the re-pick too stops", pick({ skill: "closed" }, true), { kind: "stop", why: "#42 is closed and its worktree still stands" }],
  ["pick: an implement route goes on to the spawn", pick({}), { kind: "go" }],

  // runOnce, after the session
  ["session: an account error stops the run and parks nothing",
    session({ run: run({ declared: null, accountError: "billing_error: x", status: 1 }) }),
    { kind: "stop", why: /^the account cannot run sessions \(billing_error: x\) — log in.*#42 resumes from its worktree$/, loop: fresh }],
  ["session: a declared handoff starts the next process there, published, with the ticket pinned",
    session(), { kind: "handoff", n: 42, phase: "D", why: null, publish: true, loop: { failures: 0, transients: 0, pinned: 42 } }],
  ["session: the session's own why rides with its handoff", session({ run: run({ declared: said({ handoff: "D", why: "review abc" }) }) }), { kind: "handoff", said: "review abc" }],
  ["session: a D handoff with no local pass goes back to C", session({ built: false }),
    { kind: "handoff", phase: "C", publish: false, why: "the D handoff had no local pass or no full DOD-CHECK on HEAD: commit, agent:check, post DOD-CHECK, then loop-gate --build" }],
  ["session: a D handoff with no branch to push is not published",
    session({ run: run({ declared: said({ handoff: "D", branch: null }) }), after: { ...derived, branch: null } }), { kind: "handoff", phase: "D", publish: false }],
  ["session: a C handoff out of a red phase E carries agent:check's reason",
    session({ run: run({ phase: "E", declared: said({ phase: "E", handoff: "C" }) }) }),
    { kind: "handoff", phase: "C", why: "phase E's agent:check was red: fix what it names, then go through D again" }],
  ["session: a stand-down outranks its own handoff and parks on its reason",
    session({ run: run({ declared: said({ handoff: "D", stoodDown: true, why: "premise false" }) }) }),
    { kind: "park", n: 42, phase: "C", why: "premise false", label: PARK, loop: { failures: 1, transients: 0, pinned: null } }],
  ["session: cut off by the turn cap in B, C or D resumes where it was",
    session({ run: silent({ result: { ...ok, subtype: "error_max_turns" } }) }), { kind: "handoff", phase: "C", why: "the session ran out of turns" }],
  ["session: cut off by the dollar cap resumes too",
    session({ run: silent({ stderr: "Budget limit reached ($15.08 of $15); stopping background agents.", phase: "B" }), after: { ...derived, phase: "B" } }),
    { kind: "handoff", phase: "B", why: "the session spent its budget mid-phase" }],
  ["session: cut off in a phase it cannot resume, with nothing pushed, parks",
    session({ run: silent({ phase: "E", result: { ...ok, subtype: "error_max_turns" } }) }), { kind: "park", phase: "E", why: "the session ran out of turns" }],
  ["session: cut off with its worktree gone parks", session({ run: silent({ result: { ...ok, subtype: "error_max_turns" } }), after: null }),
    { kind: "park", why: "the session ran out of turns" }],
  ["session: the stall watchdog's kill mid api_retry is an API hold, pinned",
    session({ run: silent({ status: "stalled", lastFact: "api_retry", result: null }) }),
    { kind: "hold", n: 42, why: "the API could not be reached", hold: WAIT.FLOOR, loop: { failures: 0, transients: 1, pinned: 42 } }],
  ["session: the stall watchdog's kill with nothing pushed parks on the silence",
    session({ run: silent({ status: "stalled", lastFact: "assistant", result: null, phase: "D" }) }), { kind: "park", phase: "D", why: "no output for 30m in phase D" }],
  ["session: the stall watchdog's kill with a pull request open settles it",
    session({ run: silent({ status: "stalled", lastFact: "assistant", result: null }), pushed: pr("OPEN") }), { kind: "settle", n: 42, pr: 7, head: "h1" }],
  ["session: the stall watchdog's kill after a declared handoff hands off",
    session({ run: run({ status: "stalled", lastFact: "assistant" }) }), { kind: "handoff", phase: "D" }],
  ["session: an API 5xx is held the floor", session({ run: silent({ status: 1, result: { ...ok, isError: true, apiStatus: 529 } }) }),
    { kind: "hold", why: "the API answered 529", hold: WAIT.FLOOR }],
  ["session: a 429 outside a usage refusal is held", session({ run: silent({ status: 1, result: { ...ok, isError: true, apiStatus: 429 } }) }),
    { kind: "hold", why: "the API answered 429" }],
  ["session: a dropped connection with no status is held", session({ run: silent({ status: 1, result: { ...ok, isError: true, apiStatus: null }, apiErrorCode: "server_error" }) }),
    { kind: "hold", why: "the API could not be reached" }],
  ["session: a 4xx that is not a 429 is the ticket's, and parks", session({ run: silent({ status: 1, result: { ...ok, isError: true, apiStatus: 400 } }) }),
    { kind: "park", why: "the session exited 1 in phase C" }],
  ["session: a usage refusal with nothing pushed holds until the window resets",
    session({ run: silent({ status: 1, result: null, blocked: true, blockedUntil: NOW + 3_600_000 }) }),
    { kind: "hold", n: 42, why: "the usage window is spent", hold: 3_600_000 + WAIT.MARGIN, loop: { failures: 0, transients: 1, pinned: 42 } }],
  ["session: a usage reset already past is still held the floor", session({ run: silent({ result: null, blocked: true, blockedUntil: NOW - 1000 }) }),
    { kind: "hold", hold: WAIT.FLOOR }],
  ["session: a usage reset days away is held at most the cap", session({ run: silent({ result: null, blocked: true, blockedUntil: NOW + 7 * 86_400_000 }) }),
    { kind: "hold", hold: WAIT.CAP }],
  ["session: a usage refusal naming no reset is held the floor", session({ run: silent({ result: null, blocked: true, blockedUntil: 0 }) }),
    { kind: "hold", hold: WAIT.FLOOR }],
  ["session: a refused session that recovered and pushed settles", session({ run: silent({ blocked: true, blockedUntil: NOW + 1000 }), pushed: pr("OPEN") }),
    { kind: "settle", pr: 7 }],
  ["session: a session that worked another ticket parks", session({ run: run({ declared: said({ ticket: 41, phase: "F" }) }), pushed: pr("OPEN") }),
    { kind: "park", why: "the session worked #41, not #42", pr: 7 }],
  ["session: closed as done with no diff is closed, and the claim comes off",
    session({ run: run({ declared: said({ phase: "F" }) }), after: { ...derived, commits: 0 }, issue: { state: "CLOSED", stateReason: "COMPLETED" } }),
    { kind: "closed", n: 42, why: "the session closed the issue as done, with no diff to land", label: RELEASE, loop: fresh }],
  ["session: closed as done with commits of its own parks",
    session({ run: run({ declared: said({ phase: "F" }) }), issue: { state: "CLOSED", stateReason: "COMPLETED" } }),
    { kind: "park", why: "the session pushed no pull request" }],
  ["session: closed as not planned parks",
    session({ run: run({ declared: said({ phase: "F" }) }), after: { ...derived, commits: 0 }, issue: { state: "CLOSED", stateReason: "NOT_PLANNED" } }),
    { kind: "park" }],
  ["session: a pull request already merged is a landing", session({ run: run({ declared: said({ phase: "F" }) }), pushed: pr("MERGED") }),
    { kind: "landed", n: 42, pr: 7, why: "pull request #7 was already merged", label: RELEASE }],
  ["session: an open pull request settles", session({ run: run({ declared: said({ phase: "F" }) }), pushed: pr("OPEN") }), { kind: "settle", pr: 7, head: "h1" }],
  ["session: a pull request closed unmerged parks", session({ run: run({ declared: said({ phase: "F" }) }), pushed: pr("CLOSED") }),
    { kind: "park", pr: 7, why: "pull request #7 is closed" }],
  ["session: a non-zero exit with nothing pushed parks on the exit", session({ run: silent({ status: 1 }) }), { kind: "park", why: "the session exited 1 in phase C" }],
  ["session: a clean exit with no LOOP-RESULT parks saying so", session({ run: silent() }), { kind: "park", why: "the session exited without a LOOP-RESULT" }],
  ["session: phase G with no open pull request parks", g(null), { kind: "park", phase: "G", why: "phase G found no open pull request for the pushed head" }],
  ["session: phase G with an open pull request settles", g(pr("OPEN")), { kind: "settle", pr: 7 }],
  ["session: phase G whose pull request merged meanwhile lands", g(pr("MERGED")), { kind: "landed", pr: 7 }],

  // main, over a handoff or a fix round
  ["main: a handoff that takes the ticket over its dollar ceiling parks",
    session({ tally: { ...empty, spend: USD_BY_SIZE["size:S"] - 1, processes: 4 } }),
    { kind: "park", phase: "D", why: `$${(USD_BY_SIZE["size:S"] + 1).toFixed(2)} across 5 processes — over this ticket's ceiling`, publish: undefined }],
  ["main: a ticket with no size is held to the default ceiling",
    session({ route: { ...route, size: null }, tally: { ...empty, spend: USD_DEFAULT - 2 } }), { kind: "park", why: /over this ticket's ceiling$/ }],
  [`main: handoff ${MAX_HANDOFFS} on one ticket parks`, session({ tally: { ...empty, handoffs: MAX_HANDOFFS - 1 } }),
    { kind: "park", why: `${MAX_HANDOFFS} phase handoffs on one ticket` }],
  ["main: a park asked from the board takes a handoff, and is not a failure", session({ asked: true }),
    { kind: "park", phase: "D", why: "parked by owner", label: PARK, halt: null, loop: fresh }],
  ["main: a park asked from the board takes a hold", session({ asked: true, run: silent({ status: 1, result: { ...ok, isError: true, apiStatus: 529 } }) }),
    { kind: "park", phase: "C", why: "parked by owner" }],
  ["main: a park asked from the board takes a fix round", red({}, { asked: true }), { kind: "park", why: "parked by owner" }],
  ["main: a park asked from the board leaves a landing alone", session({ asked: true, run: run({ declared: said({ phase: "F" }) }), pushed: pr("MERGED") }),
    { kind: "landed" }],

  // poll, one read of the landing
  ["poll: a pull request merged is landed", land({ action: "already-merged", reason: "the pull request is already merged" }),
    { kind: "landed", pr: 7, head: "h2", label: RELEASE }],
  ["poll: a red naming its tests is a fix round, pinned, with its CI-RED",
    red(), { kind: "retry", n: 42, head: "h2", why: "CI failed at Typecheck and tests", ciRed: true, disarm: false, loop: { failures: 0, transients: 0, pinned: 42 } }],
  ["poll: a red on an armed pull request disarms before the fix round", red({ armed: true }), { kind: "retry", disarm: true }],
  ["poll: a red naming no test is rerun once on that head",
    red({ ci: ci({ testIds: [], output: "Process completed with exit code 1." }) }), { kind: "settle", act: "rerun", runId: 99, head: "h2", ciRed: undefined }],
  ["poll: a second unnamed red on the same head is a fix round",
    red({ ci: ci({ testIds: [], output: "Process completed with exit code 1." }) }, { tally: { ...empty, reruns: ["h2"] } }), { kind: "retry", ciRed: true }],
  ["poll: a compile error with a place in a file is named without a test id",
    red({ ci: ci({ testIds: [], output: "app/a.ts:3:5 - error TS2322: no" }) }), { kind: "retry" }],
  ["poll: an unnamed red with no run to rerun is a fix round", red({ ci: ci({ testIds: [], output: "exit 1", runId: null }) }), { kind: "retry" }],
  ["poll: a red whose log could not be read is asked again", red({ ci: ci({ logUnread: true }) }), { kind: "settle", act: "wait" }],
  ["poll: a red whose log never comes parks once the head is overdue", red({ ci: ci({ output: "" }), overdue: true }),
    { kind: "park", phase: "E", why: "CI is red and its log could not be read — CI failed at Typecheck and tests" }],
  [`runOnce: red round ${CI_ROUNDS} parks, with its CI-RED`, red({}, { tally: { ...empty, retries: CI_ROUNDS - 1 } }),
    { kind: "park", phase: "E", ciRed: true, why: `${CI_ROUNDS} CI rounds on the same branch did not go green — last: CI failed at Typecheck and tests` }],
  ["main: a fix round that pushed no commit parks", red({}, { tally: { ...empty, retries: 1, lastRedHead: "h2" } }),
    { kind: "park", phase: "E", why: "the fix round pushed no commit — CI would answer CI failed at Typecheck and tests again" }],
  ["main: a fix round over the dollar ceiling parks", red({}, { tally: { ...empty, spend: 31, processes: 6 } }),
    { kind: "park", phase: "E", why: "$31.00 across 6 processes — over this ticket's ceiling" }],
  ["poll: main moved, so the branch is updated", land({ action: "update-branch", reason: "main moved" }), { kind: "settle", act: "update-branch", disarm: false }],
  ["poll: an armed branch is disarmed before it is updated", land({ action: "update-branch", reason: "main moved", armed: true }), { kind: "settle", act: "update-branch", disarm: true }],
  [`poll: update-branch past ${SETTLE_ROUNDS.update} rounds parks`, land({ action: "update-branch", reason: "main moved", updates: SETTLE_ROUNDS.update }),
    { kind: "park", why: `update-branch did not settle in ${SETTLE_ROUNDS.update} rounds — last: main moved` }],
  ["poll: a run still going is waited on", land(), { kind: "settle", act: "wait", why: "the run has not finished" }],
  ["poll: a head still unsettled at its deadline parks", land({ overdue: true }),
    { kind: "park", phase: "E", why: `h2 did not settle in ${SETTLE.DEADLINE_MS / 60_000}m — last: the run has not finished` }],
  ["poll: a cleared, reviewed green head is armed on that head", green(), { kind: "settle", act: "arm", head: "h2", ready: false }],
  ["poll: a cleared green draft is marked ready, then armed", green({ action: "ready" }), { kind: "settle", act: "arm", ready: true }],
  ["poll: a green head no review clears parks", green({ cleared: { ok: false, why: "no VERDICT: LAND names h2" } }),
    { kind: "park", why: "h2 was pushed for review, not cleared — no VERDICT: LAND names h2" }],
  ["poll: arming waits for the D round's reviewer", green({ reviewed: false }), { kind: "settle", act: "wait" }],
  ["poll: a head no reviewer ran on parks at its deadline", green({ reviewed: false, overdue: true }), { kind: "park", why: /^h2 did not settle in \d+m — last: no reviewer has run on h2/ }],
  ["poll: a head already armed is waited on, not armed again", green({ armed: true }), { kind: "settle", act: "wait" }],
  ["poll: what only a person can move parks, disarmed", land({ action: "owner", reason: "the branch conflicts with main", armed: true }),
    { kind: "park", why: "the branch conflicts with main", disarm: true, label: PARK }],
  ["poll: CI unreadable since the machine woke is asked again", land({ error: { why: "ENOTFOUND api.github.com", offline: true, woke: true } }), { kind: "settle", act: "wait" }],
  ["poll: CI unreadable for any other reason parks", land({ error: { why: "HTTP 403", offline: false, woke: false } }), { kind: "park", why: "could not read CI — HTTP 403" }],
  ["poll: a landing action nothing names parks", land({ action: "merge", reason: "x" }), { kind: "park", why: /^landing\(\) answered merge/ }],

  // main, the run's own counters
  [`main: park ${BREAKER} in a row trips the breaker`, session({ run: silent(), loop: { failures: BREAKER - 1, transients: 0, pinned: null } }),
    { kind: "park", halt: `${BREAKER} tickets in a row did not land`, loop: { failures: BREAKER, transients: 0, pinned: null } }],
  ["main: a park short of the breaker does not halt", session({ run: silent() }), { kind: "park", halt: null }],
  ["main: a landing clears the breaker and the transient count", land({ action: "already-merged", reason: "merged" }, { loop: { failures: 2, transients: 5, pinned: 42 } }),
    { kind: "landed", loop: fresh }],
  ["main: a handoff neither clears the breaker nor counts toward it", session({ loop: { failures: 2, transients: 3, pinned: null } }),
    { kind: "handoff", loop: { failures: 2, transients: 3, pinned: 42 } }],
  [`main: transient ${WAIT.TRIES + 1} since the last landing stops the run`,
    session({ run: silent({ status: 1, result: { ...ok, isError: true, apiStatus: 529 } }), loop: { failures: 0, transients: WAIT.TRIES, pinned: 42 } }),
    { kind: "stop", why: `the API answered 529, ${WAIT.TRIES} holds since the last landing` }],
  [`main: transient ${WAIT.TRIES} still holds`,
    { ...pre({ housekeeping: { verdict: "hold", why: "busy" } }), loop: { failures: 0, transients: WAIT.TRIES - 1, pinned: null } },
    { kind: "hold", loop: { failures: 0, transients: WAIT.TRIES, pinned: null } }],
  ["main: a park leaves the transient count to the next landing", session({ run: silent(), loop: { failures: 0, transients: 4, pinned: 42 } }),
    { kind: "park", loop: { failures: 1, transients: 4, pinned: null } }],
  ["main: a pre-flight hold keeps the pin it found", { ...pre({ housekeeping: { verdict: "hold", why: "busy" } }), loop: { failures: 0, transients: 0, pinned: 42 } },
    { kind: "hold", loop: { failures: 0, transients: 1, pinned: 42 } }],
  ["main: a usage refusal at the ceiling stops too", session({ run: silent({ result: null, blocked: true, blockedUntil: 0 }), loop: { failures: 0, transients: WAIT.TRIES, pinned: null } }),
    { kind: "stop" }],
  ["main: a throw while a ticket is claimed parks it", { ...base, step: "threw", error: "boom", after: { ...derived, phase: "D" } },
    { kind: "park", n: 42, phase: "D", why: "the loop threw: boom", label: PARK, loop: { failures: 1, transients: 0, pinned: null } }],
  ["main: a throw before any claim parks nothing, and still counts", { ...base, step: "threw", route: null, error: "boom" },
    { kind: "fail", why: "the loop threw: boom", loop: { failures: 1, transients: 0, pinned: null } }],
  [`main: throw ${BREAKER} in a row trips the breaker`, { ...base, step: "threw", route: null, error: "boom", loop: { failures: BREAKER - 1, transients: 0, pinned: 9 } },
    { kind: "fail", halt: `${BREAKER} tickets in a row did not land`, loop: { failures: BREAKER, transients: 0, pinned: 9 } }],
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
