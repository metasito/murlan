import { STALL_MS } from "./limits.mjs";

export const sha7 = (head) => String(head ?? "an unread head").slice(0, 7);

/** @param {{declared: {handoff?: string|null, stoodDown?: boolean}|null}} run */
export const handoffOf = (run) => (run.declared?.stoodDown ? null : (run.declared?.handoff ?? null));

/** Cut off by the turn cap or the dollar cap. */
export const exhausted = (run) =>
  run.result?.subtype === "error_max_turns" || /Budget limit reached/.test(run.stderr ?? "");

/** The phases a synthesised handoff may name. E and G are the pushed head's, which the supervisor lands. */
export const RESUMABLE = new Set(["B", "C", "D"]);

/**
 * What the supervisor knows about the session that just exited.
 *
 * The session's own `LOOP-RESULT` first, `derive()` second, which is all there is when the
 * declaration is missing.
 *
 * @param {{declared: object|null, phase: string|null}} run
 * @param {object|null} derived
 */
export function afterSession(run, derived) {
  const said = run.declared;
  if (!said && !derived) return null;
  return {
    ticket: said?.ticket ?? derived?.ticket ?? null,
    branch: said?.branch ?? derived?.branch ?? null,
    cwd: derived?.cwd ?? null,
    head: derived?.head ?? null,
    dirty: derived?.dirty ?? false,
    changed: derived?.changed ?? [],
    commits: derived?.commits ?? null,
    // The session's own marker, not derive()'s: derive computes a phase from commit count and
    // verdict, so it can only ever answer C, D, E or ?.
    phase: said?.phase ?? run.phase ?? derived?.phase ?? "?",
  };
}

/**
 * Where a cut-off session's successor resumes, or null. `declared` is the whole test of being cut
 * off: a session that said anything — a handoff, a stand-down, a finished `LOOP-RESULT` — chose its
 * ending, and the dollar cap stops subagents while letting such a session run on to declare one.
 * `after.ticket` is checked because `reasonFor`'s hard guards are downstream of this.
 */
export function resumePhase(run, after, ticket) {
  if (run.declared || !exhausted(run)) return null;
  if (!after?.cwd || after.ticket !== ticket) return null;
  return RESUMABLE.has(after.phase) ? after.phase : null;
}

/**
 * The API status a session died on, when it is one that passes on its own — an overload, an outage,
 * a 429, or no answer at all (a dropped connection carries no status) — or null. Not a verdict on
 * the ticket, so it is held and respawned, never parked.
 * A session that declared its ending chose it, whatever its last turn met. A spent usage window
 * ends on a 429 too, and is `blocked`'s to wait out until its reset, not a minute at a time.
 * A session the watchdog killed mid-retry never wrote a result, and is the same outage.
 */
export function apiFailure(run) {
  if (run.declared || run.blocked || run.accountError) return null;
  if (run.status === "stalled" && run.lastFact === "api_retry") return "unreachable";
  if (!run.result?.isError) return null;
  const s = run.result.apiStatus;
  if (s >= 500 || s === 429) return s;
  return s == null && run.apiErrorCode === "server_error" ? "unreachable" : null;
}

/**
 * How long to wait out a spent usage window.
 *
 * The loop must not exit on a refusal: the owner is away, and an exit that nothing recovers costs
 * every remaining ticket of the night. `CAP` bounds one hold against a wrong clock, not the total
 * — a gap longer than it is held in pieces and asked again, so a seven-day window resumes within
 * `CAP` of its reset rather than never. `TRIES` is the floor under all of it: that many refusals
 * in a row, each after a full wait, is an account that is not coming back on its own.
 */
export const WAIT = {
  CAP: 12 * 60 * 60_000,
  FLOOR: 60_000,
  MARGIN: 30_000,
  TRIES: 20,
};

/** @param {{blocked?: boolean, blockedUntil?: number, done?: boolean}} run */
export function waitFor({ blocked, blockedUntil, done }, now = Date.now()) {
  if (!blocked || done) return 0;
  if (!blockedUntil) return WAIT.FLOOR;
  const gap = blockedUntil - now;
  if (gap <= 0) return 0;
  return Math.min(gap + WAIT.MARGIN, WAIT.CAP);
}

/**
 * What a refused session costs the run: a wait, and nothing else.
 *
 * A usage refusal is a property of the *account*, so the counter is the run's, not the ticket's.
 * Keyed per ticket it would be inert — twenty tickets refused once each never reach the ceiling —
 * and cruel when it did fire, parking one ticket for a limit it had no part in.
 *
 * @param {{waits: number, blocked?: boolean, blockedUntil?: number, done?: boolean}} run
 * @returns {{action: "proceed"|"wait"|"give-up", hold: number, waits: number, why?: string}}
 */
export function afterRefusal({ waits, blocked, blockedUntil, done }, now = Date.now()) {
  if (!blocked || done) return { action: "proceed", hold: 0, waits: 0 };
  if (waits >= WAIT.TRIES) {
    return {
      action: "give-up",
      hold: 0,
      waits,
      why: `refused ${waits} times running, each after waiting out the window it named`,
    };
  }
  // Floored, always: a reset timestamp already in the past — clock skew, a stale window, a
  // seven-day limit reported with an expired short-window reset — makes `waitFor` answer 0, and a
  // hold of 0 is a knob with no floor, spawning back to back until the ceiling stops it.
  const hold = Math.max(waitFor({ blocked, blockedUntil, done }, now), WAIT.FLOOR);
  return { action: "wait", hold, waits: waits + 1 };
}

/**
 * What the session's exit leaves the supervisor to do.
 *
 * **The pull request outranks every reason the session's exit gives, bar two.** A branch that was
 * pushed is a fact, and how the session ended is not a fact about it: a session that ran out of
 * turns after pushing has done its half, and from there CI and the merge are the supervisor's.
 * Reading the exit first parks tickets whose pull requests then merge anyway, throwing away the work
 * and the claim together.
 *
 * The two exceptions are the two things only the session can know: it stood the ticket down, or it
 * worked a different one. Both make its branch not this ticket's answer, so neither yields.
 *
 * @param {{pr: {number: number, state: string}|null,
 *   reason: {why: string|null, hard: boolean},
 *   issue?: {state: string|null, stateReason: string|null}|null, commits?: number|null}} run
 * @returns {{action: "pushed"|"landed"|"closed"|"park", pr?: number, why?: string}}
 */
export function outcomeOf({ pr, reason, issue = null, commits = null }) {
  if (reason.hard && reason.why) return { action: "park", why: reason.why, pr: pr?.number };
  if (!pr && commits === 0 && issue?.state === "CLOSED" && issue?.stateReason === "COMPLETED")
    return { action: "closed", why: "the session closed the issue as done, with no diff to land" };
  if (pr?.state === "MERGED")
    return { action: "landed", pr: pr.number, why: `pull request #${pr.number} was already merged` };
  if (pr?.state === "OPEN") return { action: "pushed", pr: pr.number };
  if (pr)
    return { action: "park", pr: pr.number, why: `pull request #${pr.number} is ${String(pr.state).toLowerCase()}` };
  return { action: "park", why: reason.why ?? "the session pushed no pull request" };
}

/**
 * Why this session did not finish its ticket, and whether that reason outranks a pushed branch.
 *
 * `hard` is the short list of things that make the session's own work not this ticket's answer.
 * Everything else is a reason the *session* ended, which says nothing about whether the branch it
 * left behind is good — that is CI's question, and `outcomeOf` lets the pull request answer first.
 *
 * @param {{status: number|string, phase?: string|null, stderr?: string, result?: object|null,
 *   declared?: {pr: number|null, stoodDown: boolean, why: string|null}|null}} run
 * @returns {{why: string|null, hard: boolean}}
 */
export function reasonFor(run, after, ticket) {
  const said = run.declared;
  const hard = (why) => ({ why, hard: true });
  const soft = (why) => ({ why, hard: false });

  if (said?.stoodDown) return hard(said.why ?? "the session stood down");
  if (after?.ticket && after.ticket !== ticket) return hard(`the session worked #${after.ticket}, not #${ticket}`);
  // The only place "Budget limit reached ($15.08 of $15); stopping background agents." is ever
  // said — the result event for that session still reads subtype "success".
  if (/Budget limit reached/.test(run.stderr ?? "")) return soft("the session spent its budget mid-phase");
  if (run.result?.subtype === "error_max_turns") return soft("the session ran out of turns");
  if (run.status === "stalled")
    return soft(`no output for ${Math.round(STALL_MS / 60_000)}m in phase ${run.phase ?? "?"}`);
  if (run.status !== 0) return soft(`the session exited ${run.status} in phase ${run.phase ?? "?"}`);
  // Phase F's LOOP-RESULT is not optional, and this is where its absence becomes visible rather than
  // absorbed. A session that exits clean without declaring has left every fact about itself to be
  // inferred.
  if (!said) return soft("the session exited without a LOOP-RESULT");
  return soft(null);
}

/** A red round, counted from the rounds already spent: the last one parks rather than retries. */
function redRound({ n, pr, why, head }, { tally, limits }) {
  const rounds = Math.max(tally.retries, tally.ciRounds ?? 0) + 1;
  if (rounds >= limits.CI_ROUNDS) {
    return { kind: "park", n, pr, phase: "E", why: `${rounds} CI rounds on the same branch did not go green — last: ${why}`, head, ciRed: true };
  }
  return { kind: "retry", n, pr, why, head };
}

/** A fact the step needs and the caller has not read: read it, then decide again. */
const ask = (fact) => ({ kind: "ask", fact });

const STEPS = {
  pre({ pre }) {
    if (pre.stop) return { kind: "stop", why: ".loop-stop" };
    if (pre.unusable) return { kind: "stop", why: "the shared checkout is not usable" };
    if (pre.moved) return { kind: "restart", why: `tools/loop moved on main (now ${pre.moved})` };
    const { verdict, why } = pre.housekeeping;
    if (verdict === "hold") return { kind: "hold", wait: "preflight", why };
    if (verdict !== "ok") return { kind: "stop", why: `a pre-flight check refused: ${why}` };
    return { kind: "go" };
  },

  pick({ route, repicked, tally, limits, landing = 0 }) {
    const { n } = route;
    if (route.skill === "closed") {
      return repicked
        ? { kind: "stop", why: `#${n} is closed and its worktree still stands` }
        : { kind: "repick", n, why: `#${n} is closed` };
    }
    // A pull request still landing can come back red, and only a pass that visits it starts the fix.
    if (route.skill === "handoff" && landing > 0) return { kind: "hold", wait: "preflight", why: `${route.title}; ${landing} pull request(s) landing` };
    if (route.skill === "handoff" || route.skill === "ambiguous") return { kind: "stop", why: route.title };
    const redWhileDown = Boolean(route.fix && route.head && route.head !== tally.lastRedHead);
    if (redWhileDown) {
      const rounds = Math.max(tally.retries + 1, tally.ciRounds ?? 0);
      if (rounds >= limits.CI_ROUNDS) {
        return { kind: "park", n, phase: "C", why: `${rounds} CI rounds on the same branch did not go green — the last one while the loop was down` };
      }
    }
    return { kind: "go", redWhileDown };
  },

  refresh({ route, error }) {
    return error ? { kind: "park", n: route.n, phase: "C", why: `could not fast-forward the worktree before the fix round — ${error}` } : { kind: "go" };
  },

  session(input) {
    const { route, run, after, built, pushed, issue } = input;
    const { n } = route;
    const settling = run === null;
    const ran = run ?? { status: 0, phase: "G", declared: null, result: null };
    const at = afterSession(ran, after);
    // Not the ticket's fault, so neither a park nor a failure: every next ticket would meet it too.
    if (ran.accountError) {
      return { kind: "stop", why: `the account cannot run sessions (${ran.accountError}) — log in, then npm run queue:loop; #${n} resumes from its worktree` };
    }
    if (ran.wrongModel) return { kind: "park", n, phase: at?.phase ?? route.phase ?? "A", why: ran.wrongModel };
    const declared = handoffOf(ran);
    let handoff = declared ?? resumePhase(ran, at, n);
    let because = handoff && !declared ? reasonFor(ran, at, n).why : null;
    let publish = false;
    if (handoff === "D" && built === undefined) return ask("built");
    if (handoff === "D" && !built) {
      handoff = "C";
      because = "the D handoff had no local pass or no full DOD-CHECK on HEAD: commit, agent:check, post DOD-CHECK, then loop-gate --build";
    } else if (handoff === "D" && at?.branch) {
      publish = true;
    } else if (handoff === "C" && at?.phase === "E") {
      because = "phase E's agent:check was red: fix what it names, then go through D again";
    }
    if (handoff) return { kind: "handoff", n, phase: handoff, why: because, said: ran.declared?.why ?? null, publish };

    // Before the pull request: in phase E one is already open, and arming it would land a head
    // whose check never ran.
    const status = apiFailure(ran);
    if (status) return { kind: "hold", wait: "api", n, why: status === "unreachable" ? "the API could not be reached" : `the API answered ${status}` };
    // `blocked` is advisory and read after the PR lookup: a session refused mid-run that had
    // already pushed has done its half, and lands.
    if (pushed === undefined) return ask("pushed");
    if (!pushed && ran.blocked) return { kind: "hold", wait: "usage", n, why: "the usage window is spent", until: ran.blockedUntil ?? 0 };

    const reason = settling && !pushed ? { why: "phase G found no open pull request for the pushed head", hard: false } : reasonFor(ran, at, n);
    const done = !pushed && ran.declared?.phase === "F" && !ran.declared?.stoodDown;
    if (done && issue === undefined) return ask("issue");
    const decided = outcomeOf({ pr: pushed, reason, issue: done ? issue : null, commits: at?.commits ?? null });
    const head = pushed?.sha ?? null;
    if (decided.action === "pushed") return { kind: "pushed", n, pr: decided.pr, head, why: "CI next" };
    if (decided.action === "landed") return { kind: "landed", n, pr: decided.pr, head, why: decided.why };
    if (decided.action === "closed") return { kind: "closed", n, why: decided.why };
    return { kind: "park", n, phase: at?.phase ?? "?", why: decided.why, pr: decided.pr };
  },

  /**
   * One read of a pull request in flight, once a pass: an act on GitHub (`act`), or what the read
   * costs the ticket. `action` and `reason` are `land.ts`'s `landing()`. Nothing waits: a read that
   * moved nothing is a `hold`, which the ticket's own bound turns into a park.
   *
   * The arm is GitHub's, and outlives the head it was cleared on, so the ledger's `armedHead` is
   * the head the supervisor armed. The rerun is once per head, the same note's `armedFlake`. Every
   * way off the arm but the merge is a `disarm` first, then the same read decided again unarmed.
   */
  landing(input) {
    const { landing, tally } = input;
    const { n, pr, action, reason, head, armed, ci = {}, error, cleared } = landing;
    const act = (act, why) => ({ kind: "act", act, n, pr, head, why });
    const hold = (why) => ({ kind: "hold", wait: "landing", n, pr, head, why });
    const park = (why) => ({ kind: "park", n, pr, head, phase: "E", why });
    const leave = (out) => (armed ? act("disarm", out.why) : out);

    if (error) return hold(error);
    if (action === "already-merged") {
      return { kind: "landed", n, pr, head, why: reason, flake: tally.armedFlake?.head === head ? tally.armedFlake : null };
    }
    if (armed && tally.armedHead !== head) return act("disarm", `the head moved to ${sha7(head)} under the arm`);
    if (action === "owner") return leave(park(reason));
    // The merge of main is a new head nobody cleared, and an arm would carry over to it.
    if (action === "update-branch") return leave(act("update-branch", "main moved — updating the branch"));
    if (action === "hand-back") {
      if (!ci.output || ci.logUnread) return hold(`CI is red and its log could not be read — ${reason}`);
      // `attempt` rather than the note alone: the owner's own rerun is counted too.
      if (ci.runId && ci.attempt === 1 && tally.armedFlake?.head !== head) {
        return act("rerun", `CI is red at ${ci.failedStep ?? "an unnamed step"} — rerunning ${ci.runId} once`);
      }
      if (head !== tally.lastRedHead) return leave(redRound({ n, pr, why: reason, head }, input));
      // Already a round: owed while no process has run since, and a round that changed nothing otherwise.
      return leave(tally.sinceRed ? park(`the fix round pushed no commit — CI would answer ${reason} again`) : { kind: "fix", n, pr, head, why: reason });
    }
    if (!armed) {
      if (cleared === undefined) return ask("cleared");
      if (!cleared.ok) return park(`${cleared.why} — ${sha7(head)} was pushed for review, not cleared`);
      return act("arm", reason);
    }
    return ci.waiting || ci.pass ? act("wait", reason) : hold(reason);
  },

  threw({ route, error, own }) {
    const why = `the loop threw: ${error}`;
    return route ? { kind: "park", n: route.n, phase: own?.phase ?? "?", why } : { kind: "fail", why };
  },
};

/**
 * The caps over a pass that hands the ticket on, and the owner's park. A capped action's own row is
 * still written: `instead` is what it would have been, and a D handoff is still published first.
 * The tally is the ticket's before this action's row, which adds one session and, from a session,
 * that session's cost.
 */
function capped(action, input) {
  const { asked, step, run, route, own, tally, limits } = input;
  const { kind } = action;
  const park = (why, phase) => ({ kind: "park", n: action.n, phase, why, head: action.head, instead: action });

  if (asked && action.n != null && (kind === "handoff" || kind === "retry" || kind === "hold")) {
    return { ...park("parked by owner", action.phase ?? own?.phase ?? "?"), byOwner: true };
  }
  if (kind !== "handoff" && kind !== "retry") return action;
  const spend = tally.spend + (step === "session" ? (run?.result?.cost ?? 0) : 0);
  const sessions = tally.sessions + 1;
  if (spend >= (limits.USD_BY_SIZE[route.size ?? ""] ?? limits.USD_DEFAULT)) {
    return park(`$${spend.toFixed(2)} across ${sessions} processes — over this ticket's ceiling`, action.phase ?? "E");
  }
  const handoffs = tally.handoffsThisRound + 1;
  if (kind === "handoff" && handoffs >= limits.MAX_HANDOFFS) return park(`${handoffs} phase handoffs on one ticket`, action.phase);
  return action;
}

/**
 * A landing read touches the run's counters only through its ticket: the breaker, the pin when it is
 * that ticket's, and the ticket's own count of reads in a row that moved nothing.
 */
function onLanding(action, { loop, limits }, breaker) {
  const { n } = action;
  if (action.kind === "ask" || action.act === "disarm") return { ...action, loop };
  const { [n]: ticketHolds = 0, ...held } = loop.held ?? {};
  const pinned = loop.pinned === n ? null : loop.pinned;
  if (action.kind === "hold") {
    const t = ticketHolds + 1;
    if (t <= limits.TICKET_HOLDS) return { ...action, loop: { ...loop, held: { ...held, [n]: t } } };
    action = { kind: "park", n, pr: action.pr, head: action.head, phase: "E", why: `${action.why}, ${t} times running`, instead: action };
  }
  if (action.kind === "landed") return { ...action, loop: { ...loop, failures: 0, pinned, held } };
  // The owner's own park is not a ticket failing.
  if (action.byOwner) return { ...action, halt: null, loop: { ...loop, pinned, held } };
  if (action.kind === "park") {
    const f = loop.failures + 1;
    return { ...action, halt: breaker(f), loop: { ...loop, failures: f, pinned, held } };
  }
  return { ...action, loop: { ...loop, held } };
}

function tallied(action, input) {
  const { loop, limits, step, now } = input;
  const { failures, holds, waits, overloads, pinned } = loop;
  const { WAIT: wait, BREAKER } = limits;
  const breaker = (f) => (f >= BREAKER ? `${f} tickets in a row did not land` : null);
  if (step === "landing") return onLanding(action, input, breaker);
  // The hold's own row is still written: a refused or an API-failed session spent real money.
  const stop = (why, next) => ({ kind: "stop", why, halt: why, loop: next, instead: action });
  // Every pass but a hold ends a run of holds. `waits` is not reset here: only a finished ticket
  // clears it, or refusals interleaved with parks would never reach their ceiling.
  const unheld = { ...loop, holds: 0 };
  switch (action.kind) {
    case "landed":
    case "closed":
      return { ...action, loop: { failures: 0, holds: 0, waits: 0, overloads: 0, pinned: null, held: loop.held ?? {} } };
    case "park": {
      // The owner's own park is not a ticket failing, and resets nothing.
      if (action.byOwner) return { ...action, halt: null, loop: { ...loop, pinned: null } };
      const f = failures + 1;
      // A throw's park leaves the pin to `nextRoute`, which passes over a pinned ticket whose labels
      // say it was released.
      const next = step === "threw" ? { ...loop, failures: f } : { ...unheld, failures: f, overloads: 0, pinned: null };
      return { ...action, halt: breaker(f), loop: next };
    }
    case "fail":
      return { ...action, halt: breaker(failures + 1), loop: { ...loop, failures: failures + 1 } };
    case "hold": {
      if (action.wait === "preflight") {
        const h = holds + 1;
        if (h > wait.TRIES) return stop(`${action.why}, ${h} times running`, { ...loop, holds: h });
        return { ...action, hold: wait.FLOOR, loop: { ...loop, holds: h } };
      }
      if (action.wait === "usage") {
        const refused = afterRefusal({ waits, blocked: true, blockedUntil: action.until }, now);
        if (refused.action === "give-up") return stop(refused.why, unheld);
        return { ...action, hold: refused.hold, loop: { ...unheld, waits: refused.waits } };
      }
      // Counted in a row: any session the API served ends the outage.
      const o = overloads + 1;
      if (o >= wait.TRIES) return stop(`${action.why}, ${o} sessions in a row`, { ...unheld, overloads: o });
      return { ...action, hold: wait.FLOOR, loop: { ...unheld, overloads: o, pinned: action.n } };
    }
    case "handoff":
      return { ...action, loop: { ...unheld, overloads: 0, pinned: action.n } };
    case "repick":
      return { ...action, loop: { ...loop, pinned: pinned === action.n ? null : pinned } };
    default:
      return { ...action, loop };
  }
}

/**
 * The supervisor's every routing outcome, from facts already read. `step` names the point in the
 * pass: `pre` (before the pick), `pick`, `refresh` (a fix route's fast-forward), `session` (a
 * process exited, or `run` is null for a G route), `landing` (one read of a pull request in flight,
 * with the rounds spent so far), `threw`. `tally` is the ticket's
 * `ticketTally` without what is being decided; `loop` is the run's counters, returned updated.
 * `{kind: "ask", fact}` names a fact to read before deciding again.
 *
 * @param {Record<string, any>} input
 */
export function decide(input) {
  return tallied(capped(STEPS[input.step](input), input), input);
}
