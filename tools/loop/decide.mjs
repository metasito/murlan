import { STALL_MS } from "./limits.mjs";

const PARK = { remove: ["in-progress", "ready-for-agent"], add: ["ready-for-human"] };
const RELEASE = { remove: ["in-progress"], add: [] };
const RESUMABLE = new Set(["B", "C", "D"]);
const LOCATED = /error TS\d+|:\d+:\d+:? +error\b|^\s+\d+:\d+ +error /m;
const sha7 = (head) => String(head ?? "an unread head").slice(0, 7);

const exhausted = (run) => run.result?.subtype === "error_max_turns" || /Budget limit reached/.test(run.stderr ?? "");

const handoffOf = (run) => (run.declared?.stoodDown ? null : (run.declared?.handoff ?? null));

function afterSession(run, derived) {
  const said = run.declared;
  if (!said && !derived) return null;
  return {
    ticket: said?.ticket ?? derived?.ticket ?? null,
    branch: said?.branch ?? derived?.branch ?? null,
    cwd: derived?.cwd ?? null,
    commits: derived?.commits ?? null,
    phase: said?.phase ?? run.phase ?? derived?.phase ?? "?",
  };
}

function resumePhase(run, at, n) {
  if (run.declared || !exhausted(run)) return null;
  if (!at?.cwd || at.ticket !== n) return null;
  return RESUMABLE.has(at.phase) ? at.phase : null;
}

function apiFailure(run) {
  if (run.declared || run.blocked || run.accountError) return null;
  if (run.status === "stalled" && run.lastFact === "api_retry") return "unreachable";
  if (!run.result?.isError) return null;
  const s = run.result.apiStatus;
  if (s >= 500 || s === 429) return s;
  return s == null && run.apiErrorCode === "server_error" ? "unreachable" : null;
}

function reasonFor(run, at, n) {
  const said = run.declared;
  const hard = (why) => ({ why, hard: true });
  const soft = (why) => ({ why, hard: false });
  if (said?.stoodDown) return hard(said.why ?? "the session stood down");
  if (at?.ticket && at.ticket !== n) return hard(`the session worked #${at.ticket}, not #${n}`);
  // The result event of a session the dollar cap stopped still reads subtype "success".
  if (/Budget limit reached/.test(run.stderr ?? "")) return soft("the session spent its budget mid-phase");
  if (run.result?.subtype === "error_max_turns") return soft("the session ran out of turns");
  if (run.status === "stalled") return soft(`no output for ${Math.round(STALL_MS / 60_000)}m in phase ${run.phase ?? "?"}`);
  if (run.status !== 0) return soft(`the session exited ${run.status} in phase ${run.phase ?? "?"}`);
  if (!said) return soft("the session exited without a LOOP-RESULT");
  return soft(null);
}

// A pushed pull request outranks every reason the exit gives bar the two only the session can know:
// it stood the ticket down, or it worked another. How a session ended says nothing about its branch.
function outcomeOf({ pr, reason, issue, commits }) {
  if (reason.hard && reason.why) return { kind: "park", why: reason.why, pr: pr?.number };
  if (!pr && commits === 0 && issue?.state === "CLOSED" && issue?.stateReason === "COMPLETED")
    return { kind: "closed", why: "the session closed the issue as done, with no diff to land" };
  if (pr?.state === "MERGED") return { kind: "landed", pr: pr.number, why: `pull request #${pr.number} was already merged` };
  if (pr?.state === "OPEN") return { kind: "settle", pr: pr.number, head: pr.sha ?? null, why: "CI next" };
  if (pr) return { kind: "park", pr: pr.number, why: `pull request #${pr.number} is ${String(pr.state).toLowerCase()}` };
  return { kind: "park", why: reason.why ?? "the session pushed no pull request" };
}

// Floored: a reset already past answers 0, and a hold of 0 respawns back to back until the ceiling.
function usageHold({ blockedUntil }, { WAIT }, now) {
  const gap = blockedUntil ? blockedUntil - now : 0;
  const wait = !blockedUntil ? WAIT.FLOOR : gap <= 0 ? 0 : Math.min(gap + WAIT.MARGIN, WAIT.CAP);
  return Math.max(wait, WAIT.FLOOR);
}

const STEPS = {
  pre({ pre, limits }) {
    if (pre.stop) return { kind: "stop", why: ".loop-stop" };
    if (pre.unusable) return { kind: "stop", why: "the shared checkout is not usable" };
    if (pre.moved) return { kind: "restart", why: `tools/loop moved on main (now ${pre.moved})` };
    const { verdict, why } = pre.housekeeping;
    if (verdict === "hold") return { kind: "hold", why, hold: limits.WAIT.FLOOR };
    if (verdict !== "ok") return { kind: "stop", why: `a pre-flight check refused: ${why}` };
    return { kind: "go" };
  },

  pick({ route, repicked }) {
    if (route.skill === "closed") {
      return repicked
        ? { kind: "stop", why: `#${route.n} is closed and its worktree still stands` }
        : { kind: "repick", n: route.n, why: `#${route.n} is closed`, label: RELEASE };
    }
    if (route.skill === "handoff" || route.skill === "ambiguous") return { kind: "stop", why: route.title };
    return { kind: "go" };
  },

  session({ route, run, after, built, pushed, issue, limits, now }) {
    const { n } = route;
    const settling = run === null;
    const ran = run ?? { status: 0, phase: "G", declared: null, result: null };
    const at = afterSession(ran, after);
    if (ran.accountError) {
      return { kind: "stop", why: `the account cannot run sessions (${ran.accountError}) — log in, then npm run queue:loop; #${n} resumes from its worktree` };
    }
    const declared = handoffOf(ran);
    let handoff = declared ?? resumePhase(ran, at, n);
    let because = handoff && !declared ? reasonFor(ran, at, n).why : null;
    let publish = false;
    if (handoff === "D" && !built) {
      handoff = "C";
      because = "the D handoff had no local pass or no full DOD-CHECK on HEAD: commit, agent:check, post DOD-CHECK, then loop-gate --build";
    } else if (handoff === "D" && at?.branch) {
      publish = true;
    } else if (handoff === "C" && at?.phase === "E") {
      because = "phase E's agent:check was red: fix what it names, then go through D again";
    }
    if (handoff) return { kind: "handoff", n, phase: handoff, why: because, said: ran.declared?.why ?? null, publish };

    // Before the pull request: in phase E one is already open, and settling it would land a head
    // whose check never ran.
    const status = apiFailure(ran);
    if (status) return { kind: "hold", n, why: status === "unreachable" ? "the API could not be reached" : `the API answered ${status}`, hold: limits.WAIT.FLOOR };
    if (!pushed && ran.blocked) return { kind: "hold", n, why: "the usage window is spent", hold: usageHold(ran, limits, now) };

    const reason = settling && !pushed ? { why: "phase G found no open pull request for the pushed head", hard: false } : reasonFor(ran, at, n);
    const done = !pushed && ran.declared?.phase === "F" && !ran.declared?.stoodDown;
    const decided = outcomeOf({ pr: pushed, reason, issue: done ? issue : null, commits: at?.commits ?? null });
    return { ...decided, n, ...(decided.kind === "park" ? { phase: at?.phase ?? ran.phase ?? "?" } : {}) };
  },

  landing({ route, landing, tally, limits }) {
    const { n } = route;
    const { action, reason, pr, head, armed, overdue, ci } = landing;
    const park = (why, more = {}) => ({ kind: "park", n, phase: "E", why, pr, head, ...more });
    const wait = (why, late = `${sha7(head)} did not settle in ${Math.round(limits.SETTLE_MS / 60_000)}m — last: ${why}`) =>
      overdue ? park(late, { disarm: armed }) : { kind: "settle", n, act: "wait", why, pr, head };

    if (landing.error) {
      const { why, offline, woke } = landing.error;
      return offline && woke ? wait(`could not read CI since the machine woke — ${why}`) : park(`could not read CI — ${why}`, { disarm: armed });
    }
    switch (action) {
      case "already-merged":
        return { kind: "landed", n, why: reason, pr, head };
      case "hand-back": {
        if (!ci.output || ci.logUnread) return wait(reason, `CI is red and its log could not be read — ${reason}`);
        const unnamed = !ci.testIds?.length && !LOCATED.test(ci.output);
        if (unnamed && ci.runId != null && !tally.reruns.includes(head)) {
          return { kind: "settle", n, act: "rerun", runId: ci.runId, why: reason, pr, head, disarm: armed };
        }
        const rounds = tally.retries + 1;
        if (rounds >= limits.CI_ROUNDS) {
          return park(`${rounds} CI rounds on the same branch did not go green — last: ${reason}`, { ciRed: true, disarm: armed });
        }
        return { kind: "retry", n, why: reason, pr, head, ciRed: true, disarm: armed };
      }
      case "update-branch":
        if (landing.updates >= limits.UPDATES) return park(`update-branch did not settle in ${limits.UPDATES} rounds — last: ${reason}`, { disarm: armed });
        return { kind: "settle", n, act: "update-branch", why: reason, pr, head, disarm: armed };
      case "recheck":
        return wait(reason);
      case "arm":
      case "ready":
        if (!landing.cleared.ok) return park(`${sha7(head)} was pushed for review, not cleared — ${landing.cleared.why}`, { disarm: armed });
        if (!landing.reviewed) return wait(`no reviewer has run on ${sha7(head)}`);
        if (armed) return wait(reason);
        return { kind: "settle", n, act: "arm", why: reason, pr, head, ready: action === "ready" };
      case "owner":
        return park(reason, { disarm: armed });
      default:
        return park(`landing() answered ${action} — ${reason}`, { disarm: armed });
    }
  },

  threw({ route, error, after }) {
    const why = `the loop threw: ${error}`;
    return route ? { kind: "park", n: route.n, phase: after?.phase ?? "?", why } : { kind: "fail", why };
  },
};

function capped(action, { asked, route, run, after, tally, limits, step }) {
  const { kind } = action;
  const carried = { disarm: action.disarm, ciRed: action.ciRed, pr: action.pr, head: action.head };
  const park = (why, phase) => ({ kind: "park", n: action.n, phase, why, ...carried });

  if (asked && action.n != null && (kind === "handoff" || kind === "retry" || kind === "hold")) {
    return { ...park("parked by owner", action.phase ?? after?.phase ?? "?"), byOwner: true };
  }
  if (kind !== "handoff" && kind !== "retry") return action;
  if (kind === "retry" && action.head && action.head === tally.lastRedHead) {
    return park(`the fix round pushed no commit — CI would answer ${action.why} again`, "E");
  }
  const own = step === "session" && run;
  const spend = tally.spend + (own ? (run.result?.cost ?? 0) : 0);
  const processes = tally.processes + (own ? 1 : 0);
  if (spend >= (limits.USD_BY_SIZE[route.size ?? ""] ?? limits.USD_DEFAULT)) {
    return park(`$${spend.toFixed(2)} across ${processes} processes — over this ticket's ceiling`, action.phase ?? "E");
  }
  if (kind === "handoff" && tally.handoffs + 1 >= limits.MAX_HANDOFFS) {
    return park(`${tally.handoffs + 1} phase handoffs on one ticket`, action.phase);
  }
  return action;
}

function tallied(action, { loop, limits }) {
  const { failures, transients, pinned } = loop;
  const breaker = (f) => (f >= limits.BREAKER ? `${f} tickets in a row did not land` : null);
  switch (action.kind) {
    case "landed":
    case "closed":
      return { ...action, label: RELEASE, loop: { failures: 0, transients: 0, pinned: null } };
    case "park": {
      // The owner's own park is not a ticket failing.
      const f = failures + (action.byOwner ? 0 : 1);
      return { ...action, label: PARK, halt: action.byOwner ? null : breaker(f), loop: { failures: f, transients, pinned: null } };
    }
    case "fail":
      return { ...action, halt: breaker(failures + 1), loop: { failures: failures + 1, transients, pinned } };
    case "hold":
      // One count for every kind of wait, cleared only by a landing: a counter any other outcome
      // clears lets holds interleaved with parks run forever.
      if (transients >= limits.WAIT.TRIES) {
        const why = `${action.why}, ${transients} holds since the last landing`;
        return { kind: "stop", why, halt: why, loop };
      }
      return { ...action, loop: { failures, transients: transients + 1, pinned: action.n ?? pinned } };
    case "handoff":
    case "retry":
      return { ...action, loop: { failures, transients, pinned: action.n } };
    default:
      return { ...action, loop };
  }
}

/**
 * The supervisor's every routing outcome, from facts already read. `step` names the point in the
 * pass: `pre` (before the pick), `pick`, `session` (a process exited, or `run` is null for a G
 * route), `landing` (one read of the pull request), `threw`. `tally` is `ticketWindow` without the
 * process being decided; `loop` is the run's counters, returned updated.
 *
 * @param {Record<string, any>} input
 */
export function decide(input) {
  return tallied(capped(STEPS[input.step](input), input), input);
}
