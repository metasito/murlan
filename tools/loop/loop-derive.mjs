/**
 * Where the loop's run stands, derived from git and the tracker rather than remembered.
 *
 * There used to be a state file. Every serious defect two audits found was in it and not in the
 * loop: it was tracked, so a run made the tree dirty and the next run deadlocked on preflight; it
 * was never cleared between tickets, so ticket two inherited ticket one's `VERDICT: LAND` and would
 * have pushed unreviewed work; it was read by two parsers that disagreed; its own template hints
 * were read as evidence. All of them were the same bug — a third copy of the truth, disagreeing
 * with the two systems that already held it.
 *
 * Git knows the branch, the commits and the diff. The tracker knows the ticket and the review. So
 * nothing here is stored, and nothing can go stale: every answer is computed from those two, every
 * time it is asked.
 *
 * The branch name is the binding. `agent/<n>-<slug>` says which ticket this work belongs to, and
 * git will not let you be on two at once.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname } from "node:path";

export const BRANCH = /^agent\/(\d+)-/;

/** The repository every `gh` call in the loop names, so no two of them can name different ones. */
export const REPO = "metasito/murlan";

/** The worktree root `/queue` phase A creates ticket worktrees under. */
export const WORKTREE_DIR = ".worktrees";

/** A ticket worktree's own directory name, under `WORKTREE_DIR` — never its branch. */
export const AGENT_DIR = /^agent-\d+$/;

const run = (file, args, cwd) => execFileSync(file, args, { encoding: "utf8", cwd }).trim();

/** The one shape `verdictFor` and `reviewRounds` both look for, so they cannot drift apart. */
const VERDICT_RE = /^VERDICT:\s*(LAND|HOLD)\b[^\n]*?\b([0-9a-f]{7,40})\b/m;

/** The review's own comment, naming the head it read. The same sha binding the verdict carries. */
const REVIEW_RE = /^REVIEW\s+([0-9a-f]{7,40})\b/m;

/** A fix round's own `REVIEW` marks itself, so `reviewRounds` can size the cap to full rounds. */
const REVIEW_FIX_RE = /^REVIEW\s+([0-9a-f]{7,40})\s+fix\b/m;

/** What "this head" means, for the verdict and the report both, so the two cannot disagree. */
const covers = (head, sha) => head.startsWith(sha) || sha.startsWith(head.slice(0, 7));

const fenceStripped = (body) => (body ?? "").replace(/```[\s\S]*?```/g, "");

/** The claim comment `claim.mjs` posts — its literal text is the only marker there is. */
const CLAIM_RE = /^Claimed by `/m;

const CI_RED_RE = /^CI-RED\s+([0-9a-f]{7,40})\b/;

/**
 * How many CI rounds have gone red since the ticket was last claimed — the newest claim, not the
 * first, so a ticket reclaimed after a restart starts the count over rather than inheriting a run
 * that already ended.
 *
 * @param {{body: string}[]} comments
 */
export function ciRedRounds(comments) {
  const shas = new Set();
  for (const c of sinceClaim(comments)) {
    const m = CI_RED_RE.exec(fenceStripped(c.body).trimStart());
    if (m) shas.add(m[1].slice(0, 7));
  }
  return shas.size;
}

/** The comments after the newest claim. */
function sinceClaim(comments) {
  let since = 0;
  comments.forEach((c, i) => {
    if (CLAIM_RE.test(fenceStripped(c.body))) since = i + 1;
  });
  return comments.slice(since);
}

/** The step the supervisor's `CI-RED` for this head names since the newest claim; undefined when none is posted. */
function ciRedStep(comments, sha) {
  for (const c of sinceClaim(comments)) {
    const body = fenceStripped(c.body).trimStart();
    if (CI_RED_RE.exec(body)?.[1].slice(0, 7) === sha.slice(0, 7)) return /· step: (.+)$/m.exec(body)?.[1] ?? null;
  }
  return undefined;
}

/**
 * Whether a `CI-RED <sha>` comment for this exact head is already on the thread — the dedup the
 * supervisor checks before posting another one for the same red head.
 *
 * @param {{body: string}[]} comments @param {string} sha
 */
export function ciRedPosted(comments, sha) {
  return comments.some((c) => CI_RED_RE.exec(fenceStripped(c.body).trimStart())?.[1].slice(0, 7) === sha.slice(0, 7));
}

/** @returns {string|null} */
export function currentBranch(cwd) {
  try {
    return run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  } catch {
    return null;
  }
}

export function ticketOf(branch) {
  const m = BRANCH.exec(branch ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * Every worktree git knows about, as `{ dir, branch, detached }`.
 *
 * @param {string} [cwd]
 */
export function worktrees(cwd) {
  const out = run("git", ["worktree", "list", "--porcelain"], cwd);
  return out.split(/\n\s*\n/).filter(Boolean).map((block) => {
    const dir = /^worktree (.+)$/m.exec(block)?.[1] ?? null;
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
    return { dir, branch, detached: /^detached$/m.test(block) };
  });
}

/**
 * Which worktree the run is in — which is almost never the one the session is sitting in.
 *
 * The loop works in `.worktrees/agent-<n>` and RULES.md rule 40 forbids parking a shell there, so
 * reading `HEAD` at the process's own cwd answers for the shared checkout and reports "no run"
 * during every run. An audit caught exactly that: compaction recovery printed nothing and the
 * phase-E gate exited 2, on a live ticket. Git already lists every worktree and its branch, so ask
 * it rather than asking where we happen to be standing.
 *
 * A detached worktree (a conflicted rebase, an interrupted checkout) has no branch to read, so its
 * directory name carries the ticket and the caller is told the head is loose rather than told
 * nothing is happening.
 *
 * `worktree` says outright which path to read, for asking "is *this* one on a ticket" without
 * going through the scan at all — a test seam, since a real invocation is never asking about
 * anywhere but its own `.worktrees/`.
 *
 * @param {string} [cwd]
 * @param {string} [worktree]
 * @returns {{cwd: string, branch: string|null, ticket: number|null, detached: boolean,
 *   ambiguous?: number, worktrees?: string[], phase?: string, why?: string}}
 */
export function locateRun(cwd, worktree) {
  // Resolved, not passed through: git reads the process's own directory when given none, so a
  // caller omitting both arguments is answered *about* that directory, and must be told which.
  const at = worktree || cwd || process.cwd();
  const here = currentBranch(at);

  // Every "nothing is running here" answer, in one place: the tree it names cannot then be right
  // in three branches and wrong in the fourth.
  const idle = (extra) => ({
    cwd: at,
    branch: here,
    ticket: null,
    detached: here === "HEAD",
    ...extra,
  });

  if (ticketOf(here)) return { cwd: at, branch: here, ticket: ticketOf(here), detached: false };
  if (worktree) return idle();

  // `git worktree list` already answers for this repository alone, so sitting in a `.worktrees/`
  // is the whole test — and asking the directory rather than a path derived from here is what lets
  // it be found from a worktree that is not the one the `.worktrees/` hangs off.
  let list = [];
  try {
    list = worktrees(at).filter((w) => w.dir && basename(dirname(w.dir)) === WORKTREE_DIR);
  } catch (err) {
    return idle({ phase: "?", why: `cannot list worktrees (${String(err?.message ?? err).split("\n")[0]})` });
  }

  const onBranch = list.filter((w) => ticketOf(w.branch));
  if (onBranch.length === 1) {
    const w = onBranch[0];
    return { cwd: w.dir, branch: w.branch, ticket: ticketOf(w.branch), detached: false };
  }
  // More than one live ticket worktree and nothing here says which one this run is for — a
  // leftover from a crashed run, sitting next to the one actually in progress. Refuse rather
  // than guess.
  if (onBranch.length > 1) {
    return idle({ ambiguous: onBranch.length, worktrees: onBranch.map((w) => w.branch) });
  }

  const loose = list.find((w) => w.detached && AGENT_DIR.test(basename(w.dir ?? "")));
  if (loose) {
    return {
      cwd: loose.dir,
      branch: null,
      ticket: Number(basename(loose.dir).slice("agent-".length)),
      detached: true,
    };
  }
  return idle();
}

/**
 * The review is a comment on the issue, and it names the commit it read. That binding is what
 * makes it impossible to land a diff nobody reviewed: commit again after the review and the head
 * moves, so the verdict no longer matches and the gate asks for another one.
 *
 * A HOLD on a head is final for that head. Order used to decide, so a later `LAND <same sha>` —
 * from a confused reviewer, or from the reviewer quoting its own instructions — erased a hold
 * nobody had addressed. The only way past a hold is a commit, which moves the head and asks for a
 * fresh review of the new code.
 *
 * `VERDICT:` is matched literally and fenced code is stripped first, so quoting the review prompt
 * or pasting a draft in a ``` block is not a review.
 *
 * @param {{body: string}[]} comments
 * @param {string} head
 */
export function verdictFor(comments, head) {
  let land = null;
  for (let i = comments.length - 1; i >= 0; i--) {
    const body = fenceStripped(comments[i].body);
    const m = VERDICT_RE.exec(body);
    if (!m || !covers(head, m[2])) continue;
    if (m[1] === "HOLD") return { decision: "HOLD", line: m[0].trim() };
    land ??= { decision: "LAND", line: m[0].trim() };
  }
  return land;
}

/**
 * The review reports for this head, which is what makes a `LAND` mean anything. #1043 posted one
 * comment — `VERDICT: LAND` — over four rounds and went out red: the reports existed, and reached
 * nothing that could refuse the push.
 *
 * **Its ceiling, stated:** a `## Blocking` heading carrying no findings satisfies this, as do the
 * `## Standards` and `## Spec` pair a ticket reviewed before the single reviewer still carries. It is a check against
 * omission, which is the measured failure, not against a forged report.
 *
 * @param {{body: string}[]} comments @param {string} head
 */
export function reviewFor(comments, head) {
  for (let i = comments.length - 1; i >= 0; i--) {
    const body = fenceStripped(comments[i].body);
    const m = REVIEW_RE.exec(body);
    if (!m || !covers(head, m[1])) continue;
    const legacy = /^##\s+Standards\s*$/m.test(body) && /^##\s+Spec\s*$/m.test(body);
    if (!/^##\s+Blocking\s*$/m.test(body) && !legacy) continue;
    return { line: m[0].trim() };
  }
  return null;
}

const DOD_CHECK_RE = /^DOD-CHECK\s+([0-9a-f]{7,40})\b/m;
/** @param {{body: string}[]} comments @param {string} head */
export function handoffFor(comments, head) {
  for (let i = comments.length - 1; i >= 0; i--) {
    const [first, ...rest] = fenceStripped(comments[i].body).trimStart().split("\n");
    if (!/^HANDOFF\b/.test(first)) continue;
    if ((first.match(/\b[0-9a-f]{7,40}\b/g) ?? []).some((sha) => covers(head, sha))) {
      return { line: first.trim(), notes: rest.map((l) => l.trim()).filter(Boolean) };
    }
  }
  return null;
}

const BOX_RE = /^\s*[-*]\s+\[([ xX])\](.*)$/gm;
const EVIDENCE_RE = /([\w./-]+\.\w+):(\d+)/g;
const NA_RE = /(?:^|\s)n\/a:/;
const NAMES_CODE_RE = /`[^`\s]*[/.][^`\s]*`|[\w-]+\/[\w./-]+|\.(?:test|spec)\.|\be2e\b|\btests?\b|\bspecs?\b/i;
const AGENT_CHECK_WORDS_RE = /\bnpm run\b|\bagent:check\b|\b(?:is|was|green|pass(?:es|ed|ing)?|clean|ok|on|this|the|head)\b|[\W_]/gi;

/** A box whose whole claim is the agent:check pass, so the cached pass is its evidence. */
const agentCheckAlone = (text) => /\bagent:check\b/.test(text) && text.replace(AGENT_CHECK_WORDS_RE, "") === "";

/** An `n/a: <reason>` box, never one naming code or a test: those cite a `path:line`. */
const notApplicable = (text) => {
  const [claim, ...reason] = text.split(NA_RE);
  return reason.join("").trim() !== "" && !NAMES_CODE_RE.test(claim);
};

/**
 * The builder's own tick of the Definition of done for this head. A ticked box counts as open
 * unless one `path:line` in it resolves in the worktree: a bare tick, or `1.5:30`, is the omission
 * this exists to catch. A box with no code site closes another way: the agent:check box on the
 * cached pass (`built`), any other on an `n/a: <reason>`, which `na` hands to the reviewer.
 *
 * @param {{body: string}[]} comments @param {string} head
 * @param {(path: string, line: number) => boolean} resolves
 * @param {boolean} [built]
 * @returns {{line: string, ticked: number, open: string[], na: string[]} | null}
 */
export function dodCheckFor(comments, head, resolves, built = false) {
  for (let i = comments.length - 1; i >= 0; i--) {
    const body = fenceStripped(comments[i].body);
    const m = DOD_CHECK_RE.exec(body);
    if (!m || !covers(head, m[1])) continue;
    const boxes = [...body.matchAll(BOX_RE)];
    const na = (b) => b[1] !== " " && notApplicable(b[2]);
    const cited = (b) => [...b[2].matchAll(EVIDENCE_RE)].some(([, p, l]) => resolves(p, Number(l)));
    const done = (b) => b[1] !== " " && (na(b) || (built && agentCheckAlone(b[2])) || cited(b));
    return {
      line: m[0].trim(),
      ticked: boxes.filter(done).length,
      open: boxes.filter((b) => !done(b)).map((b) => b[0].trim()),
      na: boxes.filter(na).map((b) => b[0].trim()),
    };
  }
  return null;
}

/** `park()`'s comment, whatever its reason: only the owner returns a parked ticket to the queue. */
const PARK_RE = /^Parked by the queue loop\b/m;

/**
 * The cap's count starts at the first claim after a park, which is the owner sending the ticket
 * back; a stranded re-claim, with no park before it, inherits the rounds.
 */
function countedVerdicts(comments) {
  const bodies = comments.map((c) => fenceStripped(c.body));
  let since = 0;
  let parked = false;
  bodies.forEach((b, i) => {
    if (PARK_RE.test(b)) parked = true;
    else if (parked && CLAIM_RE.test(b)) [since, parked] = [i, false];
  });
  const firstRed = bodies.findIndex((b, i) => i >= since && CI_RED_RE.test(b.trimStart()));
  return bodies.slice(since).flatMap((body) => {
    const v = VERDICT_RE.exec(body);
    if (!v) return [];
    const fix = bodies.some((b, i) => {
      const m = REVIEW_FIX_RE.exec(b);
      return m && firstRed >= 0 && i > firstRed && covers(v[2], m[1]);
    });
    return [{ decision: v[1], fix }];
  });
}

/**
 * One review round per comment carrying a real verdict — not scoped to a head, since a round
 * spent on an earlier commit was still spent. `derive()` returns this alongside `verdictFor`'s
 * answer so `loop-gate.mjs` need not read the tracker twice.
 */
export function reviewRounds(comments) {
  return countedVerdicts(comments).filter((v) => !v.fix).length;
}

/** The HOLDs on CI fix rounds, which `reviewRounds` leaves out: `loop-gate.mjs` caps them apart. */
export function fixHolds(comments) {
  return countedVerdicts(comments).filter((v) => v.fix && v.decision === "HOLD").length;
}

/** Every HOLD on the thread, across claims and fix rounds: the ledger's measure, never the cap's. */
export function totalHolds(comments) {
  return comments.filter((c) => VERDICT_RE.exec(fenceStripped(c.body))?.[1] === "HOLD").length;
}

/**
 * The issue's comments, as `gh` returns them.
 *
 * `LOOP_GH_SCRIPT` names a node script to run instead, and exists only so the tests can drive the
 * verdict branches through the real binary. It cannot be a `gh` shim on PATH: since the 2024
 * fix for CVE-2024-27980, node will not resolve a `.cmd` from `execFileSync`, so on Windows a
 * stub is unreachable and the only testable review state is "tracker unreadable" — which is how
 * a mutant that lands a HOLD passed every test in the previous suite.
 */
function gh(args, cwd, timeout) {
  const file = process.env.LOOP_GH_SCRIPT;
  // stderr captured, never printed: an unreachable tracker is reported as "cannot read the review",
  // and `gh`'s own GraphQL complaint printed mid-brief reads as the brief having failed.
  return execFileSync(file ? process.execPath : "gh", file ? [file, ...args] : args, {
    encoding: "utf8",
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  }).trim();
}

export const TRUSTED_AUTHORS = ["OWNER", "MEMBER", "COLLABORATOR"];

/** The repo is public: every marker parser reads only what this keeps. */
export function trustedComments(comments) {
  return comments.filter((c) => TRUSTED_AUTHORS.includes(c.authorAssociation));
}

/**
 * The open issue `parity-nightly.yml` files on a red, as `{number, since}`; null when there is none
 * or the tracker cannot say. The owner's to read, never the picker's to route.
 */
export function parityRed(read = (args) => gh(args, undefined, CI_BUDGET_MS)) {
  try {
    const open = JSON.parse(read(["issue", "list", "--repo", REPO, "--label", "parity", "--state", "open", "--json", "number,createdAt"]));
    const [oldest] = open.sort((a, b) => a.number - b.number);
    return oldest ? { number: oldest.number, since: oldest.createdAt } : null;
  } catch {
    return null;
  }
}

function readComments(ticket, cwd, exec) {
  return trustedComments(JSON.parse(exec(["issue", "view", String(ticket), "--json", "comments"], cwd, CI_BUDGET_MS)).comments);
}

/** @returns {{body: string}[] | null} null when the tracker cannot be read */
export function ticketComments(ticket, cwd) {
  try {
    return readComments(ticket, cwd, gh);
  } catch {
    return null;
  }
}

const SETTLE = "G";

/** The SessionStart hook runs this, so a wedged `gh` must not hold the session. */
export const CI_BUDGET_MS = 10_000;

const HANDED = /^[A-G]$/;

function ciGh(cwd, until, failed, exec) {
  return (args, deadline) => {
    try {
      const left = Math.min(until, deadline) - Date.now();
      if (left <= 0) throw new Error("CI read budget spent");
      return exec(args, cwd, left);
    } catch (err) {
      const absent = args[0] === "api" && /HTTP 404/.test(String(err?.stderr ?? ""));
      if (!absent) failed.push(args[0]);
      throw err;
    }
  };
}

function under(cwd, head, remote, branch, until, failed) {
  if (remote === head) return true;
  const git = (args) =>
    spawnSync("git", args, { cwd, stdio: "ignore", timeout: Math.max(1, until - Date.now()) }).status;
  const ancestor = () => git(["merge-base", "--is-ancestor", head, remote]);
  const first = ancestor();
  if (first === 0 || first === 1) return first === 0;
  if (Date.now() >= until) {
    failed.push("git");
    return false;
  }
  git(["fetch", "--quiet", "origin", branch]);
  return ancestor() === 0;
}

/**
 * The pushed head and its pull request, from one listing. A red is the supervisor's `CI-RED` for
 * that head: it reads the gate, and a session needs only to know a fix round is owed.
 */
function readCi(cwd, branch, head, comments, exec) {
  const until = Date.now() + CI_BUDGET_MS;
  const failed = [];
  let open;
  try {
    [open] = JSON.parse(
      exec(["pr", "list", "--repo", REPO, "--head", branch, "--state", "open", "--json", "number,headRefOid"], cwd, CI_BUDGET_MS),
    );
  } catch {
    return { pushed: false, pr: null, sha: null, state: "unreadable", step: null };
  }
  if (!open) return { pushed: false, pr: null, sha: null, state: "none", step: null };
  const pushed = under(cwd, head, open.headRefOid, branch, until, failed);
  const step = ciRedStep(comments, open.headRefOid);
  const state = failed.length ? "unreadable" : step === undefined ? "settling" : "red";
  return { pushed, pr: open.number, sha: open.headRefOid, state, step: step ?? null };
}

/**
 * Everything the loop needs to know about where it is. No arguments, no memory.
 *
 * `LOOP_BASE` overrides what the diff is measured against, and is a test seam only: the tests run
 * against scratch worktrees that have no `origin/main`. It is deliberately not a command-line
 * flag — an audit passed `--base HEAD~1` and walked a `.github/workflows/` change straight through
 * the gate, because a documented flag is a mistake the loop can make by reading its own usage text.
 *
 * `LOOP_WORKTREE` is the same kind of seam, and the same kind of hazard if it ever became a real
 * flag: pointed at a worktree other than the one about to be pushed, it clears a review that never
 * looked at this branch's head. Like `LOOP_BASE`, nothing in the loop itself may ever set it.
 *
 * `ci` is opt-in because it costs `gh` calls on every read; the gate never needs it.
 *
 * `handed` is the phase `queue-loop.mjs` spawned this session at, through `LOOP_PHASE`; a test
 * passes it, because a test run inside a loop session inherits that session's.
 *
 * @param {{ cwd?: string, base?: string, worktree?: string, ci?: boolean, exec?: typeof gh, handed?: string }} [options]
 */
export function derive({
  cwd = undefined,
  base = process.env.LOOP_BASE || "origin/main",
  worktree = process.env.LOOP_WORKTREE,
  ci = false,
  exec = gh,
  handed = process.env.LOOP_PHASE ?? "",
} = {}) {
  const at = locateRun(cwd, worktree);
  if (at.detached && at.ticket) {
    return {
      onTicket: true,
      ticket: at.ticket,
      branch: null,
      cwd: at.cwd,
      phase: "?",
      why: `#${at.ticket}'s worktree is on a detached HEAD — a rebase or checkout left it without a branch`,
    };
  }
  if (at.phase === "?") {
    return { onTicket: false, branch: at.branch, phase: "?", why: at.why, ambiguous: true };
  }
  if (!at.ticket) {
    const why = at.ambiguous
      ? `${at.ambiguous} live agent/* worktrees under .worktrees/ (${at.worktrees.join(", ")}) — cannot tell which one this run is`
      : at.detached
        ? "HEAD is detached, so there is no branch to read a ticket from"
        : "not on an agent branch";
    return { onTicket: false, branch: at.branch, phase: "A", why, ambiguous: Boolean(at.ambiguous) };
  }
  const { ticket, branch } = at;
  cwd = at.cwd;

  let head = null;
  let commits = 0;
  let changed = [];
  let dirty = false;
  let headSubject = "";
  try {
    head = run("git", ["rev-parse", "HEAD"], cwd);
    headSubject = run("git", ["log", "-1", "--format=%s"], cwd);
    commits = Number(run("git", ["rev-list", "--count", `${base}..HEAD`], cwd));
    changed = run("git", ["diff", "--name-only", `${base}...HEAD`], cwd).split("\n").filter(Boolean);
    dirty = run("git", ["status", "--porcelain"], cwd).length > 0;
  } catch {
    return { onTicket: true, ticket, branch, cwd, phase: "?", why: `cannot read history against ${base}` };
  }

  let comments = [];
  let trackerReadable = true;
  try {
    comments = readComments(ticket, cwd, exec);
  } catch {
    trackerReadable = false;
  }

  const verdict = trackerReadable ? verdictFor(comments, head) : null;
  const land = commits > 0 && verdict?.decision === "LAND";
  const ciRead = ci && land ? readCi(cwd, branch, head, comments, exec) : null;
  const fix = Boolean(ciRead?.pushed && ciRead.pr !== null && ciRead.state === "red");
  // A claimed worktree that is clean and has no commits has not been worked yet, so it owes its
  // scope pass. Deriving C there made every session declare `PHASE C` and then, on reading
  // queue.md, `PHASE B` — which transposed every step row the board printed and billed the build
  // to B in `loop-cost`. Dirty is the discriminator: an edit in the tree means C has begun.
  const scoping = commits === 0 && !dirty;
  const wipHead =
    commits > 0 && !verdict && /^wip\(#\d+\):/.test(headSubject) && !dodCheckFor(comments, head, () => false);
  let phase = scoping ? "B" : commits === 0 || wipHead ? "C" : !verdict ? "D" : land ? "E" : "C";
  let why =
    commits === 0
      ? scoping
        ? "claimed, with nothing committed and nothing in the tree yet"
        : "nothing committed yet"
      : wipHead
        ? "the head is a wip commit, so the build is unfinished"
        : !trackerReadable
        ? "cannot reach the tracker to read the review"
        : !verdict
          ? `no review of ${head?.slice(0, 7)} on the issue`
          : land
            ? "reviewed and cleared"
            : "the reviewer held it";
  if (ciRead?.state === "unreadable") {
    phase = SETTLE;
    why = "reviewed and cleared, but its pull request could not be read in time — the supervisor settles it";
  } else if (ciRead && !ciRead.pushed) {
    why = "reviewed and cleared, and no open pull request carries this head yet";
  } else if (ciRead && ciRead.pr === null) {
    why = "pushed, but no pull request is open for it";
  } else if (fix) {
    phase = "C";
    why = `CI failed at ${ciRead.step ?? "an unnamed step"} on the pushed head`;
  } else if (ciRead) {
    phase = SETTLE;
    why = "pushed, and CI is the supervisor's to settle";
  }
  if (HANDED.test(handed)) {
    phase = handed;
    why = `${why}; the supervisor handed this session phase ${handed}`;
  }

  return {
    onTicket: true,
    ticket,
    branch,
    cwd,
    base,
    head,
    commits,
    changed,
    dirty,
    // Null, not 0, when the tracker can't be read: a count nobody could take is not a count of
    // zero rounds, and `loop-gate.mjs` fails closed on the same distinction `verdict` already does.
    reviewRounds: trackerReadable ? reviewRounds(comments) : null,
    fixHolds: trackerReadable ? fixHolds(comments) : null,
    trackerReadable,
    verdict,
    handoff: trackerReadable ? handoffFor(comments, head) : null,
    review: trackerReadable ? reviewFor(comments, head) : null,
    ci: ciRead,
    fix,
    ciRounds: trackerReadable ? ciRedRounds(comments) : null,
    phase,
    why,
  };
}
