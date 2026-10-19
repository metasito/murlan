// tools/loop/tests/decide.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decide } from "../decide.mjs";
import { ticketTally } from "../loop-logs.mjs";
import { choose as drive } from "../queue-loop.mjs";
import { LIMITS } from "../limits.mjs";
import { ledgerFixture } from "./helpers/ledgerFixture.ts";

const { BREAKER, CI_ROUNDS, MAX_HANDOFFS, READ_RETRIES, SETTLE, TICKET_HOLDS, UPDATES, USD_BY_SIZE, USD_DEFAULT, WAIT } = LIMITS;
const NOW = Date.parse("2026-10-12T20:00:00Z");

const route = { n: 42, skill: "implement", title: "the ticket", phase: "C", size: "size:S", fix: false, head: null };
const empty = ticketTally(42, []);
const fresh = { failures: 0, holds: 0, waits: 0, overloads: 0, pinned: null, heldTicket: null, ticketHolds: 0 };
const own = { cwd: "/w/agent-42", branch: "agent/42-x", dirty: false, phase: "C" };
const base = { route, tally: empty, loop: fresh, limits: LIMITS, now: NOW, asked: false, own };

const pre = (over: object, top: object = {}) => ({ ...base, step: "pre", pre: { stop: false, unusable: false, moved: null, housekeeping: { verdict: "ok", why: null }, ...over }, ...top });
/** What a pick reads, by the fact it asks for: the standing run, its issue, the ledger, a pinned issue, the picker. */
type World = { standing: object; known: object; rows: object[]; pinnedFacts: object; picked: object };
const OFF = { onTicket: false, phase: "A", why: "not on an agent branch", ambiguous: false };
const issue = (over: object = {}) => ({ title: "the ticket", url: "", size: "size:S", labels: ["in-progress"], reviewRounds: 1, ciRounds: 0, state: "OPEN", ...over });
const live = (over: object = {}) => ({ onTicket: true, ticket: 42, branch: "agent/42-x", cwd: "w", phase: "C", fix: false, head: "h1", dirty: false, reviewRounds: 1, ci: null, ...over });
const PICKED = { skill: "implement", number: 42, title: "the ticket", size: "size:S", queue: null };
const { route: _route, tally: _tally, ...unpicked } = base;
const pick = (world: Partial<World> = {}, top: object = {}) => ({
  ...unpicked,
  step: "pick",
  pinned: null,
  at: null,
  repicked: false,
  world: { standing: OFF, known: issue(), rows: [], pinnedFacts: issue(), picked: PICKED, ...world },
  ...top,
});
const picked = (over: object, top: object = {}) => pick({ picked: { ...PICKED, ...over } }, top);
const redRow = (head: string) => ({ n: 42, outcome: "retry", cost: 1, park_reason: null, head });
const fixRoute = (rows: object[] = [], known: object = {}) =>
  pick({ standing: live({ fix: true, ci: { pushed: true, state: "red", sha: "h3" } }), rows, known: issue(known) });

/** The pick step driven by `runOnce`'s own driver, its facts read from `world`. `asked` is every read, in order. */
const FACTS = ["standing", "known", "tally", "pinnedFacts", "picked"] as const;
const choose = ({ world, ...input }: { world: World; pinned: number | null; at: string | null; repicked: boolean }) => {
  const asked: string[] = [];
  const reads = Object.fromEntries(
    FACTS.map((fact) => [fact, ({ n }: { n?: number }) => (asked.push(fact), fact === "tally" ? ticketTally(n!, world.rows as never) : world[fact])]),
  );
  return { ...drive({ ...input }, reads, decide), asked };
};

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
const unstructured = () => silent({ status: 1, result: { ...ok, isError: true, subtype: "error_max_structured_output_retries" } });

const ci = (over: object = {}) => ({ testIds: ["tests/a.test.ts › adds"], output: "✖ adds", logUnread: false, waiting: false, infrastructure: false, appearing: false, runId: 99, attempt: 2, failedStep: "Typecheck and tests", ...over });
const land = (over: object = {}) => ({
  ...base,
  step: "landing",
  landing: { action: "recheck", reason: "the run has not finished", head: "h2abcdef9", armed: false, overdue: false, deadline: SETTLE.DEADLINE_MS, updates: 0, last: null, stuck: false, cleared: { ok: true, why: null }, ci: ci(), error: null, reran: null, ...over },
});
const red = (over: object = {}) => land({ action: "hand-back", reason: "CI failed at Typecheck and tests", ...over });
const green = (over: object = {}) => land({ action: "arm", reason: "mergeStateStatus is CLEAN", ...over });
const settled = (over: object = {}, top: object = {}) => ({ ...base, step: "settled", settled: { action: "hand-back", reason: "CI failed at Typecheck and tests", head: "h2", ...over }, ...top });
const heldRed = (top: object = {}) => settled({ action: "hold", reason: "CI-RED for h1abcde could not be posted", head: "h1abcdef9" }, top);

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
  ["a handoff route stops", picked({ skill: "handoff", number: 0, title: "queue empty" }), { kind: "stop", why: "queue empty", asked: ["standing", "picked"] }],
  ["an ambiguous pick stops rather than taking a third ticket", pick({ standing: { onTicket: false, phase: "A", ambiguous: true, why: "two live worktrees" } }),
    { kind: "stop", why: "two live worktrees", asked: ["standing"] }],
  ["a closed ticket whose worktree still stands is torn down and the queue picked again, with no spawn on it", pick({ standing: live({ cwd: "w7" }), known: issue({ state: "CLOSED" }) }, { pinned: 42, loop: { ...fresh, pinned: 42 } }),
    { kind: "repick", n: 42, cwd: "w7", loop: fresh, asked: ["standing", "known"] }],
  ["a closed ticket with no labels left is closed all the same", pick({ standing: live(), known: issue({ state: "CLOSED", labels: [] }) }), { kind: "repick", n: 42 }],
  ["an open live ticket is not closed", pick({ standing: live() }), { kind: "go", route: { skill: "implement", number: 42 } }],
  ["a closed ticket unrelated to the pinned one keeps the pin, and its phase, on re-pick", pick({ standing: live({ ticket: 9, branch: "agent/9-x" }), known: issue({ state: "CLOSED" }) }, { pinned: 42, loop: { ...fresh, pinned: 42 } }),
    { kind: "repick", n: 9, loop: { ...fresh, pinned: 42 } }],
  ["runOnce: a closed ticket on the re-pick too stops", pick({ standing: live(), known: issue({ state: "CLOSED" }) }, { repicked: true }), { kind: "stop", why: "#42 is closed and its worktree still stands" }],
  ["runOnce: an implement route goes on to the spawn", pick(), { kind: "go", redWhileDown: false, route: { number: 42, resuming: false }, asked: ["standing", "picked"] }],
  ["a fresh pick reads no tally and carries none", pick({ rows: [redRow("h1")] }), { kind: "go", n: 42, tally: undefined, asked: ["standing", "picked"] }],
  ["a resumed ticket goes on with its tally", pick({ standing: live(), rows: [redRow("h1")] }), { kind: "go", tally: { retries: 1, lastRedHead: "h1" }, asked: ["standing", "known", "tally"] }],
  ["stops on handoff", picked({ skill: "handoff", number: 0, title: "nothing to do" }), { kind: "stop" }],
  ...["implement", "triage", "wayfinder"].map((skill): Row => [`keeps going on ${skill}`, picked({ skill }), { kind: "go", route: { skill } }]),
  ["a red round nobody recorded is written down before the fix round; a recorded one is not", fixRoute(), { kind: "go", redWhileDown: true, route: { phase: "C", fix: true, head: "h3" } }],
  ["runOnce: a fix route whose red head is already recorded writes nothing", fixRoute([redRow("h3")]), { kind: "go", redWhileDown: false }],
  ["a red round nobody recorded counts toward the cap, and the last one parks before the refresh", fixRoute([...Array.from({ length: CI_ROUNDS - 2 }, () => redRow("h1")), redRow("h2")]),
    { kind: "park", phase: "C", why: `${CI_ROUNDS} CI rounds on the same branch did not go green — the last one while the loop was down` }],
  ["a CI-RED already posted for the unrecorded head counts that round once, not twice", fixRoute([redRow("h2")], { ciRounds: 2 }), { kind: "go", redWhileDown: true }],
  ["runOnce: a tracker's CI-RED count past the ledger's reaches the cap", fixRoute([], { ciRounds: CI_ROUNDS }), { kind: "park", phase: "C" }],

  // the pick: whether the standing run is resumed
  ["no route when no ticket is live — the picker should run", pick({ standing: { onTicket: false } }), { kind: "go", route: { number: 42, resuming: false }, asked: ["standing", "picked"] }],
  ["a clean derive off a ticket is still no route", pick(), { kind: "go", route: { resuming: false }, asked: ["standing", "picked"] }],
  ["an ambiguous derive is a route, not an absence", pick({ standing: { onTicket: false, ambiguous: true, why: "2 live agent/* worktrees" } }), { kind: "stop", why: /2 live/ }],
  ["resumes the live ticket instead of asking the picker for a new one", pick({ standing: live({ ticket: 911, branch: "agent/911-x", phase: "D" }), known: issue({ title: "Ticket 911" }) }),
    { kind: "go", route: { skill: "implement", number: 911, title: "Ticket 911", phase: "D", resuming: true }, asked: ["standing", "known", "tally"] }],
  ["skips a ticket not labelled in-progress", pick({ standing: live({ ticket: 911, phase: "D" }), known: issue({ labels: ["ready-for-human"] }) }),
    { kind: "go", route: { number: 42, resuming: false }, asked: ["standing", "known", "picked"] }],
  ["a live ticket whose labels cannot be read is still live", pick({ standing: live({ ticket: 911, phase: "D" }), known: issue({ labels: null }) }), { kind: "go", route: { number: 911, resuming: true } }],
  ["falls back to a bare ticket label when derive() found no branch (the stuck/'?' case)", pick({ standing: live({ ticket: 911, branch: null, phase: "?" }), known: issue({ title: undefined }) }),
    { kind: "go", route: { number: 911, title: "ticket #911", phase: "C", resuming: true } }],

  // the pick: the resumed run's phase, and the pin
  ["a resumed ticket carries its issue's title and review rounds, not its branch name", pick({ standing: live({ branch: "agent/42-fix-the-card-fan", phase: "D", reviewRounds: 3 }), known: issue({ title: "Fix the card fan!" }) }),
    { kind: "go", route: { title: "Fix the card fan!", reviewRounds: 3 } }],
  ["a pinned ticket with no worktree rebuilds at A", pick({ pinnedFacts: issue({ title: "Fix the card fan!", size: null, branch: "agent/42-fix-the-card-fan" }), rows: [{ n: 42, outcome: "handoff", cost: 0, handoff: { phase: "E" }, head: null }] }, { pinned: 42 }),
    { kind: "go", route: { number: 42, phase: "A", resuming: true, branch: "agent/42-fix-the-card-fan" }, asked: ["standing", "pinnedFacts", "tally"] }],
  ...[["in-progress", "ready-for-human"], ["size:S"], ["in-progress", "deferred"]].map((labels): Row => [
    `a pinned ticket the tracker no longer shows as ours goes back to the picker: ${labels.join(",")}`,
    pick({ pinnedFacts: issue({ labels }), picked: { ...PICKED, number: 77, title: "other" } }, { pinned: 42 }),
    { kind: "go", route: { skill: "implement", number: 77, resuming: false }, asked: ["standing", "pinnedFacts", "picked"] },
  ]),
  ["a pinned ticket whose labels cannot be read keeps resuming", pick({ pinnedFacts: issue({ labels: null }) }, { pinned: 42 }), { kind: "go", route: { number: 42, resuming: true, phase: "A" }, asked: ["standing", "pinnedFacts", "tally"] }],
  ["a pinned ticket held before its claim keeps resuming", pick({ pinnedFacts: issue({ labels: ["ready-for-agent", "size:S"] }) }, { pinned: 42 }), { kind: "go", route: { number: 42, resuming: true, phase: "A" } }],
  ...([["E", null, "E"], ["E", "D", "E"], ["D", null, "D"], ["C", null, "D"]] as const).map(([phase, at, want]): Row => [
    `a LAND on the head outranks a handoff to review, and nothing else does: ${phase} at ${at}`,
    pick({ standing: live({ phase }), rows: [{ n: 42, outcome: "handoff", cost: 0, handoff: { phase: "D" }, head: null }] }, { pinned: 42, at }),
    { kind: "go", route: { phase: want } },
  ]),
  ["an unreadable CI read on a head not known pushed is not a no-spawn G", pick({ standing: live({ phase: "G", ci: { state: "unreadable", pushed: false, pr: 5 } }) }), { kind: "go", route: { phase: "E" } }],
  ["a handed phase wins over a derived fix", pick({ standing: live({ fix: true, ci: { pushed: true, state: "red" } }) }, { pinned: 42, at: "D" }), { kind: "go", route: { phase: "D", fix: true } }],
  ["only a pushed G outranks a handed phase", pick({ standing: live({ phase: "G", ci: { pushed: true } }) }, { pinned: 42, at: "D" }), { kind: "go", route: { phase: "G", fix: false } }],
  ["a pushed head settles ahead of a handoff the ledger holds from before the push", pick({ standing: live({ phase: "G", ci: { pushed: true } }), rows: [{ n: 42, outcome: "handoff", cost: 0, handoff: { phase: "C", why: "a declared one" }, head: "a" }] }, { pinned: 42, at: "C" }),
    { kind: "go", route: { phase: "G" } }],
  ...([["held", [{ n: 42, outcome: "hold", head: "abc", cost: 0 }]], ["unrecorded", []], ["after an earlier red", [{ n: 42, outcome: "retry", head: "old", cost: 0 }]]] as const).map(([how, rows]): Row => [
    `a red no CI-RED names is G, so poll posts its CI-RED: ${how}`,
    pick({ standing: live({ phase: "G", ci: { pushed: true, state: "settling", sha: "abc" } }), rows: [...rows] }),
    { kind: "go", route: { phase: "G", fix: false } },
  ]),
  ["a fix route carries the pushed head, the worktree and the issue's size and CI rounds", pick({ standing: live({ fix: true, dirty: true, ci: { pushed: true, state: "red", sha: "h3" } }), known: issue({ size: "size:M", ciRounds: 1 }) }),
    { kind: "go", route: { head: "h3", cwd: "w", branch: "agent/42-x", dirty: true, size: "size:M", ciRounds: 1, queue: null } }],
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
  ["runOnce: the stall watchdog's kill with a pull request open settles it",
    session({ run: silent({ status: "stalled", lastFact: "assistant", result: null }), pushed: pr("OPEN") }), { kind: "settle", n: 42, pr: 7, head: "h1" }],
  ["runOnce: the stall watchdog's kill after a declared handoff hands off", session({ run: run({ status: "stalled", lastFact: "assistant" }) }), { kind: "handoff", phase: "D" }],
  ["the 529 #1156 parked on is overloaded", session({ run: api(529) }), { kind: "hold", wait: "api", why: "the API answered 529", hold: WAIT.FLOOR }],
  ["a 429 is overloaded", session({ run: api(429) }), { kind: "hold", wait: "api", why: "the API answered 429" }],
  ["runOnce: a dropped connection with no status is overloaded", session({ run: api(null, { apiErrorCode: "server_error" }) }), { kind: "hold", wait: "api", why: "the API could not be reached" }],
  ["an error naming no status is parked", session({ run: api(null) }), { kind: "park", why: "the session exited 1 in phase C" }],
  ["a non-zero exit with no result line is parked", session({ run: silent({ status: 1, result: null }) }), { kind: "park", why: "the session exited 1 in phase C" }],
  ["an API 5xx holds the ticket rather than parking it", session({ run: api(503) }), { kind: "hold", wait: "api" }],
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
  ["is recorded closed, with no park",
    session({ run: finished(), after: { ...derived, commits: 0 }, issue: { state: "CLOSED", stateReason: "COMPLETED" } }),
    { kind: "closed", n: 42, why: "the session closed the issue as done, with no diff to land", loop: fresh }],
  ["with commits of its own it still parks", session({ run: finished(), issue: { state: "CLOSED", stateReason: "COMPLETED" } }),
    { kind: "park", why: "the session pushed no pull request" }],
  ["closed as not planned still parks", session({ run: finished(), after: { ...derived, commits: 0 }, issue: { state: "CLOSED", stateReason: "NOT_PLANNED" } }),
    { kind: "park" }],
  ["a pull request already merged is a landing, and the claim comes off", session({ run: finished(), pushed: pr("MERGED") }),
    { kind: "landed", n: 42, pr: 7, why: "pull request #7 was already merged" }],
  ["a torn-down worktree with a pull request open is settled, not parked", session({ run: finished(), after: null, pushed: pr("OPEN") }), { kind: "settle", pr: 7, head: "h1" }],
  ["a torn-down worktree with no pull request anywhere still parks", session({ run: finished(), after: null }),
    { kind: "park", why: "the session pushed no pull request" }],
  ["a pull request closed without merging is the owner's", session({ run: finished(), pushed: pr("CLOSED") }),
    { kind: "park", why: "pull request #7 is closed", pr: 7 }],
  ["a session that pushed nothing parks the ticket", session({ run: finished() }), { kind: "park", why: "the session pushed no pull request", phase: "F" }],
  ["a session that exits without a declaration parks with that reason", session({ run: silent() }),
    { kind: "park", n: 42, why: "the session exited without a declaration", phase: "C" }],
  ["a session whose structured output never validated is spawned once more", session({ run: unstructured() }),
    { kind: "hold", wait: "undeclared", n: 42, loop: { ...fresh, pinned: 42 } }],
  ["a second session whose structured output never validated parks", session({ run: unstructured(), tally: { ...empty, undeclared: 1 } }),
    { kind: "park", n: 42, phase: "C", why: /structured output/, loop: { ...fresh, failures: 1 } }],
  ["a session whose structured output never validated is not spawned again past the ticket's dollar ceiling",
    session({ run: unstructured(), tally: { ...empty, spend: USD_BY_SIZE["size:S"] } }),
    { kind: "park", n: 42, why: /over this ticket's ceiling/, instead: { kind: "hold", wait: "undeclared" } }],
  ["runOnce: a session whose structured output never validated after it pushed settles", session({ run: unstructured(), pushed: pr("OPEN") }), { kind: "settle", pr: 7 }],
  ["a G route settles without spawning", g(pr("OPEN")), { kind: "settle", pr: 7 }],
  ["runOnce: phase G whose pull request merged meanwhile lands", g(pr("MERGED")), { kind: "landed", pr: 7 }],
  ["a G pass with no open pull request says so", g(null), { kind: "park", phase: "G", why: "phase G found no open pull request for the pushed head" }],

  // poll, one read of the pull request: a step, or the verdict `settled` reads
  ["poll: a red with its log is rerun once, on its first attempt", red({ ci: ci({ attempt: 1 }) }),
    { kind: "settle", act: "rerun", why: "CI is red at Typecheck and tests — rerunning 99 once", loop: fresh }],
  ["poll: a head this process already reran is handed back", red({ ci: ci({ attempt: 1 }), reran: "h2abcdef9" }), { kind: "settled", action: "hand-back", why: "CI failed at Typecheck and tests" }],
  ["poll: a red on its second attempt is handed back", red(), { kind: "settled", action: "hand-back" }],
  ["poll: a red with no run to rerun is handed back", red({ ci: ci({ attempt: 1, runId: null }) }), { kind: "settled", action: "hand-back" }],
  ["poll: a red whose log is unread is asked again", red({ ci: ci({ logUnread: true }) }),
    { kind: "settle", act: "wait", why: "CI is red but named no log — asking again" }],
  ["poll: main moved, so the branch is updated", land({ action: "update-branch", reason: "main moved" }),
    { kind: "settle", act: "update-branch", why: "main moved — updating the branch and reading CI again" }],
  [`poll: update-branch past ${UPDATES} rounds goes to the owner`, land({ action: "update-branch", reason: "main moved", updates: UPDATES }),
    { kind: "settled", action: "owner", why: `update-branch did not settle in ${UPDATES} rounds — last: main moved` }],
  ["poll: a run still going is waited on", land({ ci: ci({ waiting: true, reason: "3 of 9 jobs done" }) }), { kind: "settle", act: "wait", why: "3 of 9 jobs done" }],
  ["poll: a recheck is asked again", land(), { kind: "settle", act: "wait", why: "the run has not finished — asking again" }],
  ["poll: a run not yet appearing, or a runner that said nothing, is asked again", land({ ci: ci({ infrastructure: true, appearing: true }) }), { kind: "settle", act: "wait" }],
  ["poll: a head past its deadline goes to the owner", land({ overdue: true }), { kind: "settled", action: "owner", why: `CI did not settle in ${SETTLE.DEADLINE_MS / 60_000}m` }],
  ["poll: the deadline's verdict names what it last waited on", land({ overdue: true, last: "CI is red but named no log — asking again" }),
    { kind: "settled", action: "owner", why: `CI did not settle in ${SETTLE.DEADLINE_MS / 60_000}m — last: CI is red but named no log — asking again` }],
  ["poll: a run that never registers is the owner's once nothing has changed for the stuck bound", land({ ci: ci({ infrastructure: true, appearing: true }), reason: "no check has reported on this head", stuck: true }),
    { kind: "settled", action: "owner", why: "recheck did not settle — last: no check has reported on this head" }],
  ["poll: a red whose log stays unreadable is the owner's at the stuck bound", red({ ci: ci({ logUnread: true }), stuck: true }),
    { kind: "settled", action: "owner", why: "CI is red and its log could not be read — CI failed at Typecheck and tests" }],
  ["poll: a cancelled or infrastructure run that stays so is the owner's at the stuck bound", land({ ci: ci({ infrastructure: true }), reason: "the run was cancelled", stuck: true }),
    { kind: "settled", action: "owner", why: "recheck did not settle — last: the run was cancelled" }],
  ["poll: mergeability stuck at UNKNOWN is the owner's at the stuck bound", land({ ci: ci({ pass: true }), reason: "GitHub is still computing mergeability", stuck: true }),
    { kind: "settled", action: "owner", why: "recheck did not settle — last: GitHub is still computing mergeability" }],
  ["poll: an armed head GitHub holds at BLOCKED gets the whole deadline", land({ armed: true, reason: "auto-merge is armed and the required check has not passed yet", stuck: true }),
    { kind: "settle", act: "wait", why: "auto-merge is armed and the required check has not passed yet — asking again" }],
  ["poll: a run still going gets the whole deadline, however long one job takes", land({ ci: ci({ waiting: true, reason: "3 of 9 jobs done" }), stuck: true }),
    { kind: "settle", act: "wait", why: "3 of 9 jobs done" }],
  ["poll: a green head asks whether review cleared it", green({ cleared: undefined }), { kind: "ask", fact: "cleared" }],
  ["poll: a cleared green head is armed", green(), { kind: "settle", act: "arm" }],
  ["poll: a green head no review clears goes to the owner", green({ cleared: { ok: false, why: "no VERDICT: LAND names h2abcde" } }),
    { kind: "settled", action: "owner", why: "no VERDICT: LAND names h2abcde — h2abcde was pushed for review, not cleared" }],
  ["poll: a head already armed is waited on, and clearance is not asked again", green({ armed: true, cleared: undefined }),
    { kind: "settle", act: "wait", why: "auto-merge is armed — waiting for GitHub to merge" }],
  ["poll: what only a person can move goes to the owner", land({ action: "owner", reason: "the pull request was closed without merging" }), { kind: "settled", action: "owner", why: "the pull request was closed without merging" }],
  ["poll: a conflict with main is the verdict, for a rebase round", land({ action: "rebase", reason: "the branch conflicts with main" }), { kind: "settled", action: "rebase", why: "the branch conflicts with main" }],
  ["poll: a merged pull request is the verdict", land({ action: "already-merged", reason: "the pull request is already merged" }), { kind: "settled", action: "already-merged" }],
  ["poll: CI unreadable since the machine woke is asked again", land({ error: { why: "ENOTFOUND api.github.com", offline: true, woke: true } }),
    { kind: "settle", act: "wait", why: "could not read CI since the machine woke — ENOTFOUND api.github.com; asking again" }],
  ["poll: CI unreadable for any other reason goes to the owner", land({ error: { why: "HTTP 403", offline: false, transient: false, woke: false, tries: 1 } }), { kind: "settled", action: "owner", why: "could not read CI — HTTP 403" }],
  ["poll: a transient read error is asked again", land({ error: { why: "HTTP 502: Bad Gateway", offline: false, transient: true, woke: false, tries: 1 } }),
    { kind: "settle", act: "wait", why: `could not read CI — HTTP 502: Bad Gateway; asking again (1 of ${READ_RETRIES})` }],
  ["poll: a transient read error past its retries goes to the owner", land({ error: { why: "ECONNRESET", offline: true, transient: true, woke: false, tries: READ_RETRIES + 1 } }),
    { kind: "settled", action: "owner", why: "could not read CI — ECONNRESET" }],

  // runOnce, what poll's verdict costs the ticket
  ["a ticket that pushes and merges is landed, in one pass", settled({ action: "already-merged", reason: "the pull request is already merged" }),
    { kind: "landed", n: 42, head: "h2", loop: fresh }],
  ["a red verdict hands the ticket back, and still writes its row", settled(), { kind: "retry", n: 42, head: "h2", why: "CI failed at Typecheck and tests", loop: { ...fresh, pinned: 42 } }],
  ["a CI fix round keeps the worktree, and hands it back", settled(), { kind: "retry" }],
  ["a red settle leaves the worktree standing and the next pass spawns C with the fix", settled(), { kind: "retry", loop: { ...fresh, pinned: 42 } }],
  ["the retry row carries the head CI judged, not the one before update-branch", settled({ head: "h9" }), { kind: "retry", head: "h9" }],
  ["#1100's report-upload red, back from its one rerun, is a fix round", settled({ reason: "CI failed at Browser test report", head: "2f2a885" }), { kind: "retry", head: "2f2a885" }],
  [`runOnce: red round ${CI_ROUNDS} parks`, settled({}, { tally: { ...empty, retries: CI_ROUNDS - 1 } }),
    { kind: "park", phase: "E", ciRed: true, why: `${CI_ROUNDS} CI rounds on the same branch did not go green — last: CI failed at Typecheck and tests` }],
  ["a restart mid fix round keeps the round count: the third red run parks", settled({}, { tally: { ...empty, retries: CI_ROUNDS - 1 } }), { kind: "park" }],
  ["runOnce: the tracker's CI-RED count stands in for rounds the ledger missed", settled({}, { route: { ...route, ciRounds: CI_ROUNDS - 1 } }), { kind: "park", ciRed: true }],
  ["a tally's own CI-RED count is not the tracker's: the route's count is", settled({}, { tally: { ...empty, ciRounds: CI_ROUNDS - 1 } }), { kind: "retry" }],
  ["a red whose CI-RED could not be posted is held: no park, the worktree kept, and no round spent until it is posted",
    settled({ action: "hold", reason: "CI-RED for abc could not be posted", head: "abc" }),
    { kind: "hold", wait: "preflight", n: 42, why: "CI-RED for abc could not be posted", head: "abc", record: undefined, hold: WAIT.FLOOR, loop: { ...fresh, heldTicket: 42, ticketHolds: 1 } }],
  ["a post that still fails holds, and spawns nothing", heldRed(),
    { kind: "hold", wait: "preflight", n: 42, why: "CI-RED for h1abcde could not be posted", hold: WAIT.FLOOR, loop: { ...fresh, heldTicket: 42, ticketHolds: 1 } }],
  ["runOnce: an unposted CI-RED on the last round parks", settled({ action: "hold", reason: "CI-RED for abc could not be posted", head: "abc" }, { tally: { ...empty, retries: CI_ROUNDS - 1 } }),
    { kind: "park", why: `${CI_ROUNDS} CI rounds on the same branch did not go green — last: CI-RED for abc could not be posted` }],
  ["a settle only a person can move parks the ticket rather than dropping it", settled({ action: "owner", reason: "update-branch did not settle in 3 rounds" }),
    { kind: "park", phase: "E", why: "update-branch did not settle in 3 rounds" }],
  ["a settle that is the owner's parks with its own reason", settled({ action: "owner", reason: "the pull request was closed without merging" }), { kind: "park", why: "the pull request was closed without merging" }],
  ["a conflict asks whether its CONFLICT comment was posted before it hands anything back", settled({ action: "rebase", reason: "the branch conflicts with main" }),
    { kind: "ask", fact: "posted" }],
  ["#1602: a conflict posts CONFLICT on the head and hands the ticket back once; the second conflict parks", settled({ action: "rebase", reason: "the branch conflicts with main" }, { posted: true }),
    { kind: "rebase", n: 42, head: "h2", why: "the branch conflicts with main", loop: { ...fresh, pinned: 42 } }],
  ["a branch that conflicts again after its rebase round parks: never a second rebase, nor a second CONFLICT", settled({ action: "rebase", reason: "the branch conflicts with main" }, { tally: { ...empty, rebases: 1 } }),
    { kind: "park", phase: "E", head: "h2", why: "the branch conflicts with main again after its one rebase round" }],
  ["a CONFLICT the tracker would not take parks rather than spawning a round nothing names", settled({ action: "rebase", reason: "the branch conflicts with main" }, { posted: false }),
    { kind: "park", phase: "E", why: "the branch conflicts with main, and its CONFLICT comment could not be posted" }],
  ["the owner's park takes a rebase round over", settled({ action: "rebase", reason: "the branch conflicts with main" }, { posted: true, asked: true }),
    { kind: "park", byOwner: true, why: "parked by owner" }],
  ["an unrecognised settle action parks too, rather than returning silently", settled({ action: "something-new", reason: "?" }), { kind: "park", why: "?" }],
  ["a merge is the landing, and costs the run nothing", settled({ action: "already-merged", reason: "merged" }, { loop: { ...fresh, failures: 2 } }),
    { kind: "landed", halt: undefined, loop: fresh }],
  ["a hand-back writes a row of its own, and does not count as a failure", settled({}, { loop: { ...fresh, failures: 1 } }),
    { kind: "retry", loop: { ...fresh, failures: 1, pinned: 42 } }],
  ["an owner decision is parked, and goes through park rather than a bare teardown", settled({ action: "owner", reason: "r" }),
    { kind: "park", loop: { ...fresh, failures: 1 } }],
  ["a hold spends no red round and parks nothing: the next pass settles the red again", settled({ action: "hold", reason: "r", head: "abc" }),
    { kind: "hold", record: undefined, head: "abc", loop: { ...fresh, heldTicket: 42, ticketHolds: 1 } }],
  ["an unrecognised action parks rather than passing as a landing", settled({ action: "something-new", reason: "?" }),
    { kind: "park", loop: { ...fresh, failures: 1 } }],

  // main, over a handoff or a fix round
  ["runOnce: a handoff that takes the ticket over its dollar ceiling parks",
    session({ tally: { ...empty, spend: USD_BY_SIZE["size:S"] - 1, sessions: 4 } }),
    { kind: "park", phase: "D", why: `$${(USD_BY_SIZE["size:S"] + 1).toFixed(2)} across 5 processes — over this ticket's ceiling`, instead: { kind: "handoff", publish: true } }],
  ["main: a ticket with no size is held to the default ceiling", session({ route: { ...route, size: null }, tally: { ...empty, spend: USD_DEFAULT - 2 } }),
    { kind: "park", why: /over this ticket's ceiling$/ }],
  ["the retry session's cost counts toward the spend ceiling", settled({}, { tally: { ...empty, spend: 31, sessions: 5 } }),
    { kind: "park", phase: "E", why: "$31.00 across 6 processes — over this ticket's ceiling", instead: { kind: "retry", head: "h2" } }],
  ["a killed session's estimated spend counts toward the ceiling, as its result's would",
    session({ tally: { ...empty, spend: USD_BY_SIZE["size:S"] - 1, sessions: 4 }, run: run({ result: null, estimatedCost: 2 }) }),
    { kind: "park", why: /over this ticket's ceiling$/ }],
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
  ["does not spend the next one, because CI would answer the same", settled({}, { tally: { ...empty, retries: 1, lastRedHead: "h2" } }),
    { kind: "park", phase: "E", why: "the fix round pushed no commit — CI would answer CI failed at Typecheck and tests again" }],
  ["a fix round whose head equals lastRedHead parks even after a restart", settled({}, { tally: { ...empty, retries: 1, lastRedHead: "h2" } }), { kind: "park" }],
  ["parks the ticket once its session exits, and forgets the request", session({ asked: true }),
    { kind: "park", phase: "D", why: "parked by owner", halt: null, loop: fresh }],
  ["a red CI round parks in the phase git reports, with its worktree", settled({}, { asked: true, own: { ...own, phase: "E" } }), { kind: "park", phase: "E", why: "parked by owner" }],
  ["a ticket that lands before the park can act says the request was dropped", session({ asked: true, run: finished(), pushed: pr("MERGED") }), { kind: "landed" }],
  ["a request naming another ticket parks nothing", session({ asked: false }), { kind: "handoff" }],
  ["main: a park asked from the board takes a usage hold", session({ asked: true, run: silent({ result: null, blocked: true, blockedUntil: 0 }) }), { kind: "park", phase: "C", why: "parked by owner" }],
  ["main: a park asked from the board takes an API hold", session({ asked: true, run: api(529) }), { kind: "park", why: "parked by owner" }],
  ["main: a park asked from the board takes a held red round", settled({ action: "hold", reason: "CI-RED for abc could not be posted", head: "abc" }, { asked: true }),
    { kind: "park", why: "parked by owner", instead: { kind: "hold" } }],
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
    settled({ action: "already-merged", reason: "merged" }, { loop: { failures: 2, holds: 1, waits: 5, overloads: 3, pinned: 42 } }), { kind: "landed", loop: fresh }],
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
  ["pre-flight holds spend nothing of a ticket's hold bound", pre({ housekeeping: { verdict: "hold", why: "drift" } }, { loop: { ...fresh, heldTicket: 42, ticketHolds: 3 } }),
    { kind: "hold", loop: { ...fresh, holds: 1, heldTicket: 42, ticketHolds: 3 } }],
  ["a ticket parks at its own bound of holds, not before", heldRed({loop: { ...fresh, heldTicket: 42, ticketHolds: TICKET_HOLDS - 1 } }),
    { kind: "hold", loop: { ...fresh, heldTicket: 42, ticketHolds: TICKET_HOLDS } }],
  ["main: a ticket's holds count afresh when another ticket held last", heldRed({loop: { ...fresh, heldTicket: 9, ticketHolds: TICKET_HOLDS } }),
    { kind: "hold", loop: { heldTicket: 42, ticketHolds: 1 } }],
  ["a ticket held past its bound is parked for the owner, and the loop carries on",
    heldRed({loop: { ...fresh, holds: 2, heldTicket: 42, ticketHolds: TICKET_HOLDS } }),
    { kind: "park", n: 42, phase: "C", why: `CI-RED for h1abcde could not be posted, ${TICKET_HOLDS + 1} times running`, halt: null,
      instead: { kind: "hold" }, loop: { ...fresh, failures: 1, holds: 2, heldTicket: null } }],
  ["main: a ticket parked at its hold bound counts toward the breaker", heldRed({loop: { ...fresh, failures: BREAKER - 1, heldTicket: 42, ticketHolds: TICKET_HOLDS } }),
    { kind: "park", halt: `${BREAKER} tickets in a row did not land` }],
  ["main: any pass but a hold forgets the held ticket", session({ loop: { ...fresh, heldTicket: 42, ticketHolds: 4 } }), { kind: "handoff", loop: { heldTicket: null } }],
  ["main: a held red round is the ticket's hold, not the run's, and keeps the pin", settled({ action: "hold", reason: "r", head: "abc" }, { loop: { ...fresh, holds: 2, overloads: 2, pinned: 9 } }),
    { kind: "hold", loop: { ...fresh, holds: 2, overloads: 2, pinned: 9, heldTicket: 42, ticketHolds: 1 } }],
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

for (const [name, input, want] of ROWS) test(name, () => matches("world" in input ? choose(input as never) : decide(input), want));

test("a usage window is held to the injected WAIT, not the module's", () => {
  const small = { ...LIMITS, WAIT: { CAP: 5_000, FLOOR: 1_000, MARGIN: 10, TRIES: 2 } };
  const refused = (blockedUntil: number, loop = fresh) =>
    decide({ ...session({ run: silent({ result: null, blocked: true, blockedUntil }) }), limits: small, loop });
  assert.equal(refused(NOW + 3_600_000).hold, 5_000, "the cap");
  assert.equal(refused(NOW + 100).hold, 1_000, "the floor");
  assert.equal(refused(NOW + 2_000).hold, 2_010, "the margin");
  assert.equal(refused(NOW + 2_000, { ...fresh, waits: 2 }).kind, "stop", "the tries");
});

test("replays 2026-09-21/22: every session starts where the ledger before it pointed", () => {
  const rows = ledgerFixture("ledger-2026-09-21.jsonl");
  const settle = { phase: "G", ci: { pushed: true } };
  const status = { handoff: { phase: "C" }, pushed: settle, retry: { phase: "C", fix: true } };
  let replayed = 0;
  rows.forEach((row, i) => {
    const next = rows.slice(i + 1).find((r) => r.n === row.n);
    if (!next || !(row.outcome in status)) return;
    // A next row with no phases is a settle: derive() read a pushed head, which outranks a handoff.
    const derived = Object.keys(next.phases).length ? status[row.outcome as keyof typeof status] : settle;
    const standing = { onTicket: true, ticket: row.n, branch: "b", cwd: "w", fix: false, ...derived };
    const got = choose(pick({ standing, rows: rows.slice(0, i + 1) }) as never);
    assert.equal(got.route.phase, Object.keys(next.phases)[0] ?? "G", `#${row.n} after its ${row.outcome} row at ${row.started}`);
    replayed += 1;
  });
  assert.equal(replayed, 86);
});

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
  "settle runs before the pass returns": ["queueLoopMain.test.ts", "io"],
  "each fake carries exactly the members its real port does": ["queueLoopMain.test.ts", "io"],
  "every teardown is told which ticket's claim it is releasing": ["queueLoopMain.test.ts", "io"],
  "no terminal outcome leaves the worktree standing": ["queueLoopMain.test.ts", "io"],
  "housekeeping is asked about the pinned ticket, and waited for": ["queueLoopMain.test.ts", "io"],
  "a pinned ticket is what the picker is asked for": ["queueLoopMain.test.ts", "picker"],
  "a re-pick that picks no ticket leaves none claimed, not the closed one it tore down": ["queueLoopMain.test.ts", "io: the ticket a throw would release"],
  "a pick reads the standing run once, then only the issue or picker its answer needs": ["queueLoopMain.test.ts", "io: the reads a pick costs"],
  "a park rings once and a landing does not": ["queueLoopMain.test.ts", "io"],
  "each with its timestamp and, once a ticket is picked, its number": ["queueLoopMain.test.ts", "io"],
  "a journal that throws costs the line, never the loop": ["queueLoopMain.test.ts", "io"],
  "a G route announces itself before it settles": ["queueLoopMain.test.ts", "io"],
  "loopMoved answers a diff, not an error": ["queueLoopMain.test.ts", "io"],
  "a refused session's dirty worktree is left standing as it is, with no copy taken": ["queueLoopMain.test.ts", "io"],
  "the sweep in housekeeping runs before the pick": ["queueLoopMain.test.ts", "io"],
  "refreshWorktree fetches the branch and fast-forwards onto it": ["queueLoopMain.test.ts", "io"],
  "publishForReview pushes, then opens it ready only when no pull request is open": ["queueLoopMain.test.ts", "io"],
  "a parked ticket's worktree is removed in-process, by the shared checkout's git": ["queueLoopMain.test.ts", "io"],
  "prints the pick through the real ports and writes nothing to the tracker": ["queueLoopMain.test.ts", "io"],
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
  "the recorded time carries the land, not just the session": ["queueLoopMain.test.ts", "io"],
  "a row names the route's title and size and the review rounds read after the session, with no tracker read of its own": ["queueLoopMain.test.ts", "io"],
  "a derive off the ticket, or with no count, is not the ticket's review rounds; the tracker's are": ["queueLoopMain.test.ts", "io"],
  "a row main writes names its ticket as the tracker does: a repark, and the park after a throw": ["queueLoopMain.test.ts", "io"],
  "a retry resets handoffsThisRound and the handed phase": ["queueLoopMain.test.ts", "tally"],
  "overSpend, overHandoffs, the no-commit park and a thrown iteration each write exactly one parked row": ["queueLoopMain.test.ts", "io"],
  "a throw during a resumed run parks with standing().cwd": ["queueLoopMain.test.ts", "io"],
  "a hold is not a handoff: the ticket's handoff count stays where it was": ["queueLoopMain.test.ts", "tally"],
  "is recorded with the steps that failed": ["queueLoopMain.test.ts", "repark"],
  "is applied again at the start of the next pass, once, and a restart does not repeat it": ["queueLoopMain.test.ts", "repark"],
  "a landing a rerun won writes the flake on its row": ["queueLoopMain.test.ts", "io"],
  "a rerun's green whose merge then failed still writes the flake, on the park row": ["queueLoopMain.test.ts", "io"],
  "a red whose CI-RED a settle could not post reaches its fix round with exactly one posted": ["queueLoopMain.test.ts", "io: three passes, one CI-RED"],
  "a ticket's hold says which ticket and why, not a pre-flight's words": ["queueLoopMain.test.ts", "io: main's notice"],
  "the settle is handed the flake the ledger armed with, and writes an armed row when it arms": ["queueLoopMain.test.ts", "io"],
  "a red on an armed pull request is disarmed before any fix round is spawned": ["queueLoopMain.test.ts", "io: poll's call order"],
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
