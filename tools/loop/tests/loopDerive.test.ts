// tools/loop/tests/loopDerive.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ticketOf, verdictFor, reviewRounds, derive, locateRun, BRANCH } from "../loop-derive.mjs";
import { report } from "../loop-status.mjs";

/**
 * The state file these replace failed in one way over and over: it said something that was no
 * longer true. Ticket two inherited ticket one's `VERDICT: LAND` because nothing cleared it, and
 * the gate believed it. Nothing is stored now, so the equivalent question is whether the review
 * found is a review *of this code* — which is what the sha binding decides.
 */
describe("which ticket the work belongs to", () => {
  test("comes from the branch, so it cannot disagree with where you are", () => {
    assert.equal(ticketOf("agent/824-music-delay"), 824);
    assert.equal(ticketOf("agent/55-maestro"), 55);
  });

  test("no ticket off a ticket branch", () => {
    for (const b of ["main", "chore/loop-rebuild", "agent/no-number", "", null]) {
      assert.equal(ticketOf(b as string), null, `${b} should not read as a ticket`);
    }
  });

  test("the pattern is anchored, so `feature/agent/9-x` is not ticket 9", () => {
    assert.equal(BRANCH.test("feature/agent/9-x"), false);
  });
});

describe("whether a review covers the code being pushed", () => {
  const head = "abc1234def5678901234567890123456789012ab";
  const other = "9999999999999999999999999999999999999999";

  test("a LAND naming this head clears it", () => {
    const v = verdictFor([{ body: "VERDICT: LAND abc1234" }], head);
    assert.equal(v?.decision, "LAND");
  });

  // The whole point of the binding: commit again after a review and it stops counting, so there is
  // no way to land a diff the reviewer never saw.
  test("a LAND naming an older head does not", () => {
    assert.equal(verdictFor([{ body: "VERDICT: LAND 9999999" }], head), null);
  });

  test("a HOLD is found, and is not permission", () => {
    const v = verdictFor([{ body: "VERDICT: HOLD abc1234 — the guard exempts its own case" }], head);
    assert.equal(v?.decision, "HOLD");
  });

  // Not "the latest wins". A hold on a head is final for that head: the only way past it is a
  // commit, which moves the head and asks for a review of the new code.
  test("a later LAND does not overturn a HOLD on the same head", () => {
    const v = verdictFor(
      [{ body: "VERDICT: HOLD abc1234 — wrong" }, { body: "VERDICT: LAND abc1234" }],
      head
    );
    assert.equal(v?.decision, "HOLD");
  });

  test("a comment merely discussing a verdict is not one", () => {
    for (const body of [
      "I think this should be VERDICT: LAND abc1234 personally",
      "LAND abc1234",
      "VERDICT: LAND",
      "VERDICT: MAYBE abc1234",
      "",
    ]) {
      assert.equal(verdictFor([{ body }], head), null, `should not count: ${JSON.stringify(body)}`);
    }
  });

  test("no comments at all is no verdict, not a pass", () => {
    assert.equal(verdictFor([], head), null);
    assert.equal(verdictFor([{ body: "nice work" }], other), null);
  });
});

/**
 * A HOLD is final for the commit it names. Order used to decide, so a later `LAND <same sha>` —
 * a confused reviewer, or one quoting its own instructions back — erased a hold nobody had
 * addressed, and the gate exited 0. The only way past a hold is a commit.
 */
describe("a hold cannot be talked out of", () => {
  const sha = "abcdef1234567";
  const short = sha.slice(0, 7);

  test("a HOLD on an older commit does not hold the current one", () => {
    assert.equal(verdictFor([{ body: "VERDICT: HOLD 9999999 — unsafe" }], sha), null);
  });

  test("a verdict inside a fenced block is not a review", () => {
    const fence = "```";
    assert.equal(
      verdictFor([{ body: `must end with:
${fence}
VERDICT: LAND ${short}
${fence}` }], sha),
      null
    );
  });

  test("lowercase prose is not a review", () => {
    assert.equal(verdictFor([{ body: `verdict: land ${short}` }], sha), null);
  });
});

describe("counting review rounds", () => {
  test("one VERDICT comment is one round", () => {
    assert.equal(reviewRounds([{ body: "VERDICT: LAND abc1234" }]), 1);
  });

  test("a HOLD counts as a round the same as a LAND", () => {
    assert.equal(
      reviewRounds([{ body: "VERDICT: HOLD abc1234 — no" }, { body: "VERDICT: LAND def5678" }]),
      2
    );
  });

  test("a verdict quoted inside a fence does not count", () => {
    const fence = "```";
    assert.equal(reviewRounds([{ body: `see:\n${fence}\nVERDICT: LAND abc1234\n${fence}` }]), 0);
  });

  test("a VERDICT: line with no sha does not count", () => {
    assert.equal(reviewRounds([{ body: "VERDICT: LAND" }]), 0);
  });

  test("no comments is zero rounds", () => {
    assert.equal(reviewRounds([]), 0);
  });
});

/**
 * `derive()` distils `reviewRounds` from the same comment list it already reads for `verdictFor`,
 * so `loop-gate.mjs` gets both without a second call to the tracker.
 */
describe("derive()'s review-round count", () => {
  let dir: string;
  const priorScript = process.env.LOOP_GH_SCRIPT;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), "loop-derive-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    writeFileSync(join(dir, "a.txt"), "1");
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "agent/1234-x");
    writeFileSync(join(dir, "b.txt"), "2");
    git("add", "-A");
    git("commit", "-qm", "work");
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
    if (priorScript === undefined) delete process.env.LOOP_GH_SCRIPT;
    else process.env.LOOP_GH_SCRIPT = priorScript;
  });

  function stubGh(comments: { body: string }[]): string {
    const js = join(dir, `fake-gh-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(js, `console.log(JSON.stringify(${JSON.stringify({ comments })}));`);
    return js;
  }

  test("counts one round per VERDICT comment on a normal read", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
    process.env.LOOP_GH_SCRIPT = stubGh([
      { body: "looks ok" },
      { body: `VERDICT: HOLD ${head} — one more pass` },
      { body: `VERDICT: LAND ${head}` },
    ]);
    const result = derive({ cwd: dir, base: "main" });
    assert.equal(result.trackerReadable, true);
    assert.equal(result.reviewRounds, 2);
  });

  test("null, not zero, when the tracker cannot be read", () => {
    process.env.LOOP_GH_SCRIPT = join(dir, "does-not-exist.mjs");
    const result = derive({ cwd: dir, base: "main" });
    assert.equal(result.trackerReadable, false);
    assert.equal(result.reviewRounds, null);
  });
});

/**
 * The compaction brief was guarded by nothing: an audit replaced `report` with a function
 * returning "" and the whole suite stayed green, while the one requirement it exists for — telling
 * a session that has just lost its memory that a run is live — silently stopped working.
 */
describe("the compaction brief", () => {
  test("says nothing when no run is live", () => {
    assert.equal(report({ onTicket: false, phase: "A", why: "not on an agent branch" }), "");
  });

  test("names the ticket, the worktree and the phase to resume at", () => {
    const out = report({
      onTicket: true,
      ticket: 621,
      branch: "agent/621-fix",
      cwd: "/repo/.worktrees/agent-621",
      base: "origin/main",
      head: "abcdef1234",
      commits: 2,
      changed: ["a.ts"],
      dirty: false,
      verdict: null,
      phase: "D",
      why: "no review of abcdef1 on the issue",
    });
    assert.match(out, /#621/);
    assert.match(out, /agent-621/);
    assert.match(out, /D — Review/);
    assert.doesNotMatch(out, /uncommitted/i, "claimed an in-progress slice on a clean tree");
  });

  test("mentions the in-progress slice only when the worktree is dirty", () => {
    const out = report({
      onTicket: true,
      ticket: 7,
      branch: "agent/7-x",
      cwd: "/wt",
      base: "origin/main",
      head: "abcdef1",
      commits: 0,
      changed: [],
      dirty: true,
      verdict: null,
      phase: "C",
      why: "nothing committed yet",
    });
    assert.match(out, /uncommitted changes/i);
  });

  // A detached worktree used to read as "no run at all", so a conflicted rebase looked like an idle
  // session and the ticket would have been started over.
  test("a stuck run is reported as stuck, not as no run", () => {
    const out = report({ onTicket: true, ticket: 9, phase: "?", why: "detached HEAD" });
    assert.match(out, /#9/);
    assert.match(out, /stuck/i);
  });

  // Two live agent/* worktrees is `onTicket: false` (derive can't say which is the run), but it is
  // not the same as no run being live — the "says nothing" case above must stay narrower than this.
  test("an ambiguous scan is reported, not silenced as no run", () => {
    const out = report({
      onTicket: false,
      phase: "A",
      why: "2 live agent/* worktrees under .worktrees/ (agent/1-a, agent/2-b) — cannot tell which one this run is",
      ambiguous: true,
    });
    assert.notEqual(out, "");
    assert.match(out, /agent\/1-a/);
  });
});

/**
 * `locateRun` is what `loop-status.mjs` and the `SessionStart` hook print, and what decides
 * whether a run is live at all. Both of its failure modes are silent: an answer that names the
 * wrong tree, and an answer that names none.
 */
describe("locateRun", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
      { cwd, encoding: "utf8" },
    ).trim();

  const made: string[] = [];
  const newRepo = (tag: string) => {
    const dir = mkdtempSync(join(tmpdir(), `locate-run-${tag}-`));
    made.push(dir);
    git(dir, "init", "-q", "-b", "main");
    git(dir, "commit", "-q", "--allow-empty", "-m", "root");
    return dir;
  };

  /**
   * A ticket worktree under `.worktrees/`, and a second worktree that is neither on a ticket
   * branch nor under `.worktrees/` — a conflicted rebase, a probe tree, a worktree on main. That
   * second tree is the case: derived from it with `--show-toplevel`, the home to scan is its own
   * `.worktrees/`, which does not exist.
   */
  let repo = "";
  let probe = "";
  let ticketTree = "";

  before(() => {
    repo = newRepo("repo");
    ticketTree = join(repo, ".worktrees", "agent-42");
    probe = join(repo, "probe");
    git(repo, "worktree", "add", "-q", "-b", "agent/42-a-thing", ticketTree, "HEAD");
    git(repo, "worktree", "add", "-q", "-b", "probe", probe, "HEAD");
  });

  after(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });

  test("the fixture's two trees disagree, or the case below tests nothing", () => {
    assert.notEqual(
      resolve(git(probe, "rev-parse", "--show-toplevel")),
      resolve(git(repo, "rev-parse", "--show-toplevel")),
    );
  });

  test("finds the live run from a worktree that is not on a ticket branch", () => {
    const at = locateRun(probe);
    assert.equal(at.ticket, 42, "the scan must reach the checkout's .worktrees, not the probe's");
    assert.equal(at.branch, "agent/42-a-thing");
    assert.equal(resolve(at.cwd), resolve(ticketTree));
  });

  /** `git worktree list` answers for the repository, so a stray tree would otherwise be adopted. */
  test("an agent branch outside .worktrees/ is not this session's run", () => {
    const stray = join(repo, "stray");
    git(repo, "worktree", "add", "-q", "-b", "agent/9999-elsewhere", stray, "HEAD");
    try {
      assert.equal(locateRun(probe).ticket, 42, "the stray is not under a .worktrees/, so it is not a run");
    } finally {
      git(repo, "worktree", "remove", "--force", stray);
      git(repo, "branch", "-qD", "agent/9999-elsewhere");
    }
  });

  test("standing on the ticket branch needs no scan at all", () => {
    const at = locateRun(ticketTree);
    assert.equal(at.ticket, 42);
    assert.equal(at.cwd, ticketTree);
  });

  test("a worktree given explicitly is answered about itself, and named", () => {
    const at = locateRun(undefined, probe);
    assert.equal(at.ticket, null);
    assert.equal(at.cwd, probe);
  });

  test("a checkout with no ticket worktree reports itself, not nothing", () => {
    const at = locateRun(newRepo("bare"));
    assert.equal(at.ticket, null);
    assert.ok(existsSync(at.cwd));
  });

  test("outside a repository, answers rather than throwing", () => {
    const nowhere = mkdtempSync(join(tmpdir(), "locate-run-nogit-"));
    made.push(nowhere);
    const at = locateRun(nowhere);
    assert.equal(at.ticket, null);
    assert.equal(at.cwd, nowhere);
  });

  /**
   * In a child process, and in a repository with nothing live in it: the only way to ask
   * `locateRun()` about a directory is to stand in it, and asked from this suite's own checkout
   * the answer comes from whichever ticket worktree happens to exist today.
   */
  test("asked about nothing in particular, still names a real directory", () => {
    const bare = newRepo("cwd");
    const module = pathToFileURL(join(import.meta.dirname, "..", "loop-derive.mjs")).href;
    const out = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { locateRun } from ${JSON.stringify(module)};
         process.stdout.write(JSON.stringify(locateRun()));`,
      ],
      { cwd: bare, encoding: "utf8" },
    );
    const at = JSON.parse(out);
    assert.equal(at.ticket, null, "the fixture has no live run, so this is the no-run answer");
    assert.equal(typeof at.cwd, "string", "an answer naming no tree is the defect");
    assert.equal(resolve(at.cwd), resolve(bare));
  });
});
