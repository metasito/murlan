/**
 * Every cap the loop runs under, defined once. Plain constants with no imports: Playwright's config
 * loads this from CommonJS, and cannot load queue-loop.mjs.
 */

/**
 * A session's own longest silence. Phase D's review subagent emits nothing into the parent
 * stream while it reads, and a large diff keeps it there past twenty minutes. Any ceiling at or
 * under that reads a working run as a stalled one.
 */
export const STALL_MS = 30 * 60_000;

/** The session's Bash ceiling, which `agent:check` needs and a stall must outlast. */
export const CHECK_BASH_TIMEOUT_MS = STALL_MS - 5 * 60_000;

/**
 * Every other call's: a command waiting on a stdin nothing will write is killed at this, not at the
 * ceiling. `await-run` waits a minute less, and each re-issue of it is a turn at full context, so
 * this stays well past the CI run's target.
 */
export const BASH_DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** Bounds each `gh` call settling and a re-park make, so a wedged one cannot stall the supervisor. */
export const CI_RED_TIMEOUT_MS = 30_000;

/** Bounds a `git fetch` or merge of one branch from origin. */
export const REFRESH_TIMEOUT_MS = 2 * 60_000;

/**
 * How often a long hold says it is still there. The hold is the one stretch of the run that
 * prints nothing, and a silent terminal reads exactly like a dead one.
 */
export const HEARTBEAT_MS = 15 * 60_000;

/** `run-loop.mjs` starts the supervisor again on this exit, and on no other. */
export const RESTART = 75;

export const LIMITS = {
  /** One bad ticket is a ticket. Three in a row is the loop or the machine, and a night proving it. */
  BREAKER: 3,
  /** Consecutive red CI rounds on one ticket before it stops being the loop's to fix. */
  CI_ROUNDS: 3,
  /**
   * Processes one ticket may be spawned as. A+B+C is one, each review round is one and the last also
   * lands — five for a ticket that uses every round, and the slack is for a resume that re-enters a
   * phase. A ceiling, not a budget: what stops a runaway ticket is `USD_BY_SIZE`.
   */
  MAX_HANDOFFS: 8,
  /** Passes one ticket may hold in a row before it is parked: `WAIT.FLOOR` apart, they outlast a short GitHub outage. */
  TICKET_HOLDS: 10,
  /** Each update-branch is a new head, which restarts the deadline: without a cap, a busy main never lets it run out. */
  UPDATES: 3,
  /** How many reads in a row may fail on the network or GitHub's side before settling stops asking. */
  READ_RETRIES: 3,
  /** How many times a hand-back reads the tracker and posts a CI-RED before it holds the red. */
  CI_RED_TRIES: 3,
  /**
   * How long to wait out a spent usage window. `CAP` bounds one hold against a wrong clock, not the
   * total — a gap longer than it is held in pieces and asked again, so a seven-day window resumes
   * within `CAP` of its reset rather than never. `TRIES` is the floor under all of it: that many
   * refusals in a row, each after a full wait, is an account that is not coming back on its own.
   */
  WAIT: { CAP: 12 * 60 * 60_000, FLOOR: 60_000, MARGIN: 30_000, TRIES: 20 },
  /**
   * `runSettle` as a whole is bounded here: `runSession`'s watchdog is cleared when the child
   * closes, and a branch that keeps asking for one more round must not hold the night open. Each
   * `gh` call carries its own ceiling in `ciVerdict.ts`'s `ghExecOptions`.
   */
  SETTLE: { DEADLINE_MS: 90 * 60_000, STUCK_MS: 3 * 60_000 },
  /**
   * Phase D's ceiling, here rather than in `queue.md`'s prose: a bound a test can fail, not a sentence.
   * The full review, then at most two reviews of a fix. A third review that still blocks means each
   * fix is making the next defect, which a reviewer owes the owner, not another round.
   */
  MAX_REVIEW_ROUNDS: 3,
  /** CI fix rounds the reviewer held, which `MAX_REVIEW_ROUNDS` does not count. */
  MAX_FIX_HOLDS: 2,
  /**
   * What one ticket may cost across every process it is spawned as. `TICKET_BUDGET_USD` bounds one
   * session; this is the supervisor's, the only figure that survives them all. Set above the fleet
   * median for the size, so it catches a runaway and never a healthy run.
   */
  USD_BY_SIZE: { "size:XS": 20, "size:S": 30, "size:M": 45, "size:L": 70, "size:XL": 90 },
  USD_DEFAULT: 40,
};

export const SESSION_POLICY = {
  /**
   * The model a process is spawned on, keyed by the phase it starts at — not every phase it runs:
   * after a LAND, E and F continue inside D's process on D's model.
   */
  MODEL_BY_PHASE: { A: "opus", B: "opus", C: "opus", D: "opus", E: "sonnet", F: "sonnet" },
  /**
   * A fresh ticket is built at medium; a process that starts at C or D is a fix round or a review,
   * and runs at high. Anthropic's measured trade on Opus 5.5: medium first, failures re-run at high.
   */
  EFFORT_BY_PHASE: { A: "medium", B: "medium", C: "high", D: "high", E: "medium", F: "medium" },
  /**
   * Each size's `CLAUDE_CODE_AUTO_COMPACT_WINDOW`; a compaction fires about 33k below it. A handoff
   * costs the next process 5-14 min re-reading what this one knew; a larger ceiling costs every later
   * turn its extra context. Sized from each size's measured need.
   */
  CONTEXT_BY_SIZE: { "size:M": 300_000, "size:L": 330_000, "size:XL": 330_000 },
  CONTEXT_DEFAULT: 200_000,
  /**
   * Each cap stays above twice the busiest healthy process of its size; `loop-cost` and the run recap
   * print any size where it does not. A raised context ceiling raises its cap with it, so that one is met first.
   */
  TURNS_BY_SIZE: { "size:XS": 60, "size:S": 320, "size:M": 505, "size:L": 560, "size:XL": 600 },
  TURNS_DEFAULT: 150,
  /**
   * The real bound is turns. A dollar cap is checked only after a turn settles, so where it stops
   * moves with the model and the context — measured 8x to 42x over a small cap — and with subagents
   * in flight it stops the *subagents* and lets the session carry on. The dollar figure stays as a
   * backstop against one pathological turn, well above what a healthy ticket reaches.
   */
  TICKET_BUDGET_USD: "40",
};

/** How late a tick must arrive to read as the machine having slept, not as a busy event loop. */
const suspendGapMs = (tick) => Math.max(4 * tick, 2 * 60_000);

/**
 * A clock for something that wakes every `tick`: each `lap()` answers how much of the time since
 * the last lap the machine spent suspended, or 0. A late lap keeps one tick of its own, so a clock
 * whose every tick arrives late still advances, and a watchdog built on it still fires.
 */
export function sleepClock(tick) {
  let at = Date.now();
  return {
    lap() {
      const now = Date.now();
      const gap = now - at;
      at = now;
      return gap > suspendGapMs(tick) ? gap - tick : 0;
    },
  };
}
