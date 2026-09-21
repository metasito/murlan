// tools/loop/tests/loopGate.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_REVIEW_ROUNDS, roundVerdict, pushVerdict, buildPassed, mergeCleared } from "../loop-gate.mjs";

/**
 * Phase E branches on this command's exit code, so the exit code is what is asserted — never a
 * function's return value.
 *
 * Each case is a real branch in a real worktree. `gh` cannot resolve a scratch ticket number, and
 * that is itself the "cannot read the review" path, so the review-dependent cases assert a
 * refusal: the gate fails closed, which is the property worth pinning.
 *
 * `LOOP` and `root` are deliberately two different notions of "where this suite runs":
 * `LOOP` is this file's own directory, so `GATE`/`PRUNE` are always the copy of the code under
 * test — the edited worktree's, when this suite runs the way phase C always runs it, from inside
 * `.worktrees/agent-<n>`. `root` is the shared checkout, via `--git-common-dir` rather than
 * `--show-toplevel` (RULES.md rule 10: the latter returns the worktree's own path from inside
 * one). Several fixtures need `root` to be off any ticket branch, which only the shared checkout
 * — never a ticket's own worktree — is guaranteed to be (rule 8).
 */
const LOOP = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(LOOP, "loop-gate.mjs");
const PRUNE = join(LOOP, "prune-worktrees.mjs");
const root = dirname(
  execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8",
  }).trim()
);

let dir: string;
const madeDirs: string[] = [];

/** Based on `HEAD`, not `origin/main`, which is not a ref on CI's shallow checkout of this job. */
function worktree(branch: string): string {
  const wt = join(dir, branch.replace(/[^\w-]/g, "_"));
  execFileSync("git", ["worktree", "add", "-q", "-b", branch, wt, "HEAD"], { cwd: root });
  madeDirs.push(wt);
  return wt;
}

const BASE = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

function worktreeDirs(): string[] {
  return execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice("worktree ".length));
}

function commit(wt: string, file: string, body = "\n// probe\n") {
  const target = join(wt, file);
  mkdirSync(dirname(target), { recursive: true });
  appendFileSync(target, body);
  execFileSync("git", ["add", "--", file], { cwd: wt });
  execFileSync(
    "git",
    ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", `probe ${file}`],
    { cwd: wt }
  );
}

/**
 * A stub tracker, so the verdict branches run through the real binary. `LOOP_GH_SCRIPT` is the
 * seam: a `gh.cmd` on PATH cannot work, because node will not resolve a `.cmd` from
 * `execFileSync` since the fix for CVE-2024-27980.
 */
function stubGh(comments: { body: string }[]): string {
  const js = join(dir, `fake-gh-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(js, `console.log(JSON.stringify(${JSON.stringify({ comments })}));`);
  return js;
}

/**
 * `LOOP_BASE` rather than `origin/main`, because CI checks this job out shallow and `origin/main`
 * is not a ref there — the suite went red on the runner while passing locally, for a reason that
 * had nothing to do with the code under test. Pass `base: undefined` to exercise the real default.
 */
function gate(
  cwd: string,
  comments?: { body: string }[],
  base: string | undefined = BASE,
  worktree?: string,
  args: string[] = []
): { code: number; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (comments) env.LOOP_GH_SCRIPT = stubGh(comments);
  if (base) env.LOOP_BASE = base;
  else delete env.LOOP_BASE;
  // Points the gate at exactly one worktree, so a real agent/* run left live elsewhere on the
  // machine (this suite's own, or a peer's) cannot be mistaken for the one under test here.
  if (worktree) env.LOOP_WORKTREE = worktree;
  else delete env.LOOP_WORKTREE;
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd, encoding: "utf8", env });
  return { code: r.status ?? -1, out: `${r.stderr}${r.stdout}` };
}

function sweep() {
  // A probe worktree left inside `.worktrees/` by a run that died mid-suite is a run as far as the
  // gate is concerned, so the very first case here would find one and every later case would fail
  // on "branch already exists". Clear both before deciding anything.
  for (const w of worktreeDirs()) {
    if (!/[\\/]\.worktrees[\\/]agent-99\d+$/.test(w)) continue;
    try {
      execFileSync(process.execPath, [PRUNE, "--remove", w, "--force"], { cwd: root });
    } catch {
      /* already detached; the prune below finishes it */
    }
    rmSync(w, { recursive: true, force: true });
  }
  execFileSync("git", ["worktree", "prune"], { cwd: root });
  const branches = execFileSync(
    "git",
    ["branch", "--list", "agent/99*", "--format=%(refname:short)"],
    { cwd: root, encoding: "utf8" }
  )
    .split(/\r?\n/)
    .filter(Boolean);
  for (const b of branches) {
    try {
      execFileSync("git", ["branch", "-qD", b], { cwd: root });
    } catch {
      /* still checked out somewhere; the worktree removal below will free it */
    }
  }
}

// Swept before as well as after: a run that died mid-suite used to leave its probe branches
// behind, and every later run then failed on "branch already exists" rather than on the thing
// under test.
before(() => {
  dir = mkdtempSync(join(tmpdir(), "loop-gate-"));
  sweep();
});
after(() => {
  // RULES.md rule 39: never `git worktree remove` — a recursive delete follows the node_modules
  // junction and empties the shared install. These probes have none, but the habit is the hazard.
  for (const wt of madeDirs) {
    try {
      execFileSync(process.execPath, [PRUNE, "--remove", wt, "--force"], { cwd: root });
    } catch {
      /* already gone */
    }
  }
  sweep();
  rmSync(dir, { recursive: true, force: true });
});

describe("the gate's exit code, which is what phase E reads", () => {
  // Two ways to be off a ticket: on another branch, or on none at all. `actions/checkout` checks a
  // PR out at a detached HEAD, so CI only ever sees the second — this asserted the first alone and
  // went red on the runner while passing locally.
  test("off a ticket branch it declines to judge, and that is never 0", () => {
    // Points the gate at `root` itself rather than letting it scan `.worktrees/`, which may hold
    // a real ticket's live worktree (this suite's own run, if any) that is not the case here.
    const { code, out } = gate(root, undefined, BASE, root);
    assert.equal(code, 2);
    assert.match(out, /not on an agent branch|HEAD is detached/);
    assert.match(out, /nothing to judge/);
  });

  test("a ticket branch with nothing committed is refused", () => {
    const { code, out } = gate(worktree("agent/9900001-empty"));
    assert.equal(code, 1);
    assert.match(out, /nothing was built/);
  });

  // The failure the gate exists to prevent. No review of this commit exists anywhere, and there is
  // no state file that could claim otherwise on a previous ticket's behalf.
  test("committed but unreviewed is refused", () => {
    const wt = worktree("agent/9900002-unreviewed");
    commit(wt, "docs/probe.md");
    const { code, out } = gate(wt);
    assert.notEqual(code, 0, "unreviewed work was allowed to push");
    assert.match(out, /no review of|cannot reach the tracker/);
  });
});

// The gate no longer rules on which paths a diff touches; every file is the loop's to change, and
// the review is what decides whether the change is right. Pinned so a path list cannot creep back
// in unnoticed: what used to be refused by name must now reach the review check like anything else.
describe("no path is refused for being what it is", () => {
  for (const [i, p] of [
    "shared/schema.ts",
    "server/socket.ts",
    ".replit",
    ".github/workflows/probe.yml",
  ].entries()) {
    test(`${p} is judged on its review, not its name`, () => {
      const wt = worktree(`agent/990100${i}-anypath`);
      commit(wt, p);
      const { out } = gate(wt);
      assert.match(out, /no review of|cannot reach the tracker/);
      assert.doesNotMatch(out, /may not change on its own/);
    });
  }
});

// Driven through the real binary with a stubbed tracker, because these are the two answers that
// decide whether unreviewed code can reach main.
describe("the review decides the exit code", () => {
  function head(wt: string): string {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: wt, encoding: "utf8" }).trim();
  }

  const reviewBody = (sha: string) =>
    `REVIEW ${sha}\n\n## Standards\n\nNothing that affects correctness.\n\n## Spec\n\nEvery box closed.`;

  test("a LAND naming this commit allows the push", () => {
    const wt = worktree("agent/9900010-land");
    commit(wt, "docs/probe.md");
    const sha = head(wt).slice(0, 7);
    const { code, out } = gate(wt, [{ body: reviewBody(sha) }, { body: `VERDICT: LAND ${sha}` }]);
    assert.equal(code, 0, out);
    assert.match(out, /reviewed at/);
  });

  test("a LAND with no report behind it is refused by the real binary", () => {
    const wt = worktree("agent/9900016-unbacked");
    commit(wt, "docs/probe.md");
    const { code, out } = gate(wt, [{ body: `VERDICT: LAND ${head(wt).slice(0, 7)}` }]);
    assert.equal(code, 1, out);
    assert.match(out, /no review report/);
  });

  test("a HOLD refuses it", () => {
    const wt = worktree("agent/9900011-hold");
    commit(wt, "docs/probe.md");
    const { code, out } = gate(wt, [{ body: `VERDICT: HOLD ${head(wt).slice(0, 7)} — it is wrong` }]);
    assert.equal(code, 1);
    assert.match(out, /reviewer held/);
  });

  // Commit again after a review and the head moves, so that review no longer covers the diff.
  // Order used to decide, so a later LAND on the same sha erased a hold nobody had addressed.
  test("a LAND cannot overturn a HOLD on the same commit", () => {
    const wt = worktree("agent/9900013-sticky");
    commit(wt, "docs/probe.md");
    const sha = head(wt).slice(0, 7);
    const { code, out } = gate(wt, [
      { body: `VERDICT: HOLD ${sha} — this is unsafe` },
      { body: `VERDICT: LAND ${sha}` },
    ]);
    assert.equal(code, 1, "a LAND overturned a HOLD");
    assert.match(out, /reviewer held/);
  });

  test("a quoted or fenced verdict is not a review", () => {
    const wt = worktree("agent/9900014-quoted");
    commit(wt, "docs/probe.md");
    const sha = head(wt).slice(0, 7);
    const fence = "```";
    for (const body of [
      `The reviewer must end with:
${fence}
VERDICT: LAND ${sha}
${fence}
I have not run it.`,
      `verdict: land ${sha}`,
    ]) {
      const { code } = gate(wt, [{ body }]);
      assert.equal(code, 1, `accepted as a review: ${body.slice(0, 40)}`);
    }
  });

  test("a LAND of an earlier commit does not cover a later one", () => {
    const wt = worktree("agent/9900012-stale");
    commit(wt, "docs/probe.md");
    const reviewed = head(wt);
    commit(wt, "docs/probe2.md");
    const { code, out } = gate(wt, [{ body: `VERDICT: LAND ${reviewed.slice(0, 7)}` }]);
    assert.equal(code, 1);
    assert.match(out, /no review of/);
  });
});

/**
 * A worktree of its own — a `.worktrees/` scoped to a checkout nobody else on the machine can be
 * standing in, this ticket's own `.worktrees/agent-911` included. The two tests below need that:
 * unlike the `LOOP_WORKTREE`-pointed cases above, these exist to prove the scan itself still
 * finds the right answer, so they cannot route around it.
 */

/**
 * The defect this pins was the loop being unable to see its own run. Work happens in
 * `.worktrees/agent-<n>` and rule 40 keeps the shell in the shared checkout, so reading `HEAD`
 * where the process stands answered for the wrong branch.
 *
 * A repository of its own, never a worktree of this one: `git worktree list` answers for a whole
 * repository, so fixtures registered against the real checkout see whichever ticket the loop has
 * live on this machine right now — a suite that reds for what is running beside it.
 */
describe("the run is found by scanning .worktrees/, not from where the process stands", () => {
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
      { cwd, encoding: "utf8" },
    ).trim();

  let repo = "";
  let base = "";

  before(() => {
    repo = mkdtempSync(join(tmpdir(), "loop-gate-scan-"));
    madeDirs.push(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "commit", "-q", "--allow-empty", "-m", "root");
    base = git(repo, "rev-parse", "HEAD");
  });

  const live = (ticket: number) => {
    const home = join(repo, ".worktrees", `agent-${ticket}`);
    git(repo, "worktree", "add", "-q", "-b", `agent/${ticket}-live`, home, "HEAD");
    return home;
  };

  test("a run in .worktrees/ is judged from that checkout", () => {
    commit(live(9900099), ".github/workflows/probe.yml", "\non: push\n");

    // The gate runs at the checkout, which is off any ticket — the situation that used to exit 2
    // for not being on a ticket at all. Naming the ticket is what proves the scan found the run.
    const { code, out } = gate(repo, undefined, base);
    assert.notEqual(code, 0, `the gate cleared a push it never reviewed: ${out}`);
    assert.match(out, /#9900099/);
    assert.doesNotMatch(out, /nothing to judge/);
  });

  // Two live ticket worktrees is not a real loop state (one ticket at a time), but a leftover
  // from a crashed run sitting next to the one in progress is exactly how it happens. Picking one
  // arbitrarily would judge a review that was never for this ticket at all.
  test("two live ticket worktrees refuse rather than guess which one", () => {
    live(9900097);
    live(9900098);

    const { code, out } = gate(repo, undefined, base);
    assert.equal(code, 2, out);
    assert.match(out, /cannot tell which one/);
  });
});

// The other, narrower seam: pointing straight at one worktree rather than asking the scan to
// find it. Exercised from `root`, which is off any ticket itself — the override is what answers.
test("LOOP_WORKTREE names the ticket directly, without a scan", () => {
  const wt = worktree("agent/9900015-pointed");
  commit(wt, "docs/probe.md");
  const { code, out } = gate(root, undefined, BASE, wt);
  assert.notEqual(code, 0, out);
  assert.match(out, /#9900015/);
});

describe("a LAND is only as good as the report behind it", () => {
  const state = (extra: Record<string, unknown>) => ({
    onTicket: true, ticket: 1, branch: "agent/1-x", phase: "E" as const, commits: 1,
    changed: ["a.ts"], head: "abc1234def", base: "origin/main", cwd: ".", dirty: false,
    trackerReadable: true, reviewRounds: 1, why: "reviewed and cleared",
    verdict: { decision: "LAND", line: "VERDICT: LAND abc1234" }, review: null,
    ci: null, fix: false, ciRounds: 0, ...extra,
  });

  test("a LAND with no review report on the issue is refused", () => {
    const v = pushVerdict(state({}));
    assert.equal(v.ok, false);
    assert.match(String(v.why), /no review report/);
  });

  test("a LAND backed by a report for the same head passes", () => {
    assert.equal(pushVerdict(state({ review: { line: "REVIEW abc1234" } })).ok, true);
  });

  test("an unreadable tracker carries no lines, which is what makes it exit 2", () => {
    const v = pushVerdict(state({ trackerReadable: false }));
    assert.equal(v.ok, false);
    assert.equal(v.lines, undefined);
  });
});

/**
 * Phase D's ceiling. It is the largest cost lever in the loop, and it was a sentence in `queue.md`
 * that no test could fail until this branch moved it here — so the point of these is that editing
 * `MAX_REVIEW_ROUNDS`, or relaxing either comparison, goes red.
 */
describe("the review-round cap", () => {
  test("allows a round below the cap, and names which one it is", () => {
    for (let rounds = 0; rounds < MAX_REVIEW_ROUNDS; rounds++) {
      const v = roundVerdict({ reviewRounds: rounds });
      assert.equal(v.ok, true, `round ${rounds + 1} was refused below the cap`);
      assert.match(v.why, new RegExp(`round ${rounds + 1} of at most ${MAX_REVIEW_ROUNDS}`));
    }
  });

  test("refuses at the cap, not one past it", () => {
    const v = roundVerdict({ reviewRounds: MAX_REVIEW_ROUNDS });
    assert.equal(v.ok, false, `a ${MAX_REVIEW_ROUNDS + 1}th round was allowed`);
    assert.match(v.why, /the cap is/);
  });

  /**
   * The whole reason `derive()` returns null rather than 0 here. Read as zero, an unreachable
   * tracker buys an unbounded review — the failure mode is silent and costs opus pairs per round.
   */
  test("refuses when the tracker cannot be counted, rather than reading it as zero", () => {
    for (const reviewRounds of [null, undefined]) {
      const v = roundVerdict({ reviewRounds });
      assert.equal(v.ok, false, `reviewRounds ${String(reviewRounds)} allowed a round`);
      assert.match(v.why, /cannot reach the tracker/);
    }
  });

  // The exit code is what phase D branches on, so it is asserted through the real CLI too.
  test("the exit code phase D reads", () => {
    const wt = worktree("agent/9900021-rounds");
    commit(wt, "docs/probe.md");
    // A round is a comment carrying a real verdict — the same shape `verdictFor` reads, since both
    // go through one regex.
    const verdict = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ body: `VERDICT: HOLD deadbee${i} — round ${i + 1}` }));

    const under = gate(root, verdict(1), BASE, wt, ["--review-round"]);
    assert.equal(under.code, 0, under.out);
    assert.match(under.out, /round 2 of at most/);

    const at = gate(root, verdict(MAX_REVIEW_ROUNDS), BASE, wt, ["--review-round"]);
    assert.equal(at.code, 1, at.out);
    assert.match(at.out, /the cap is/);
  });
});

describe("--build gates review on a cached local pass", () => {
  function head(wt: string): string {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: wt, encoding: "utf8" }).trim();
  }
  function cachePath(wt: string): string {
    const gitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: wt, encoding: "utf8" }).trim();
    return join(gitDir, "agent-check-cache.json");
  }
  function writeCache(wt: string, entry: Record<string, unknown>) {
    writeFileSync(cachePath(wt), JSON.stringify({ k: entry }));
  }

  test("no cache at all refuses", () => {
    const wt = worktree("agent/9900040-build-nocache");
    commit(wt, "docs/probe.md");
    assert.equal(buildPassed(wt), false);
    const { code, out } = gate(wt, [], BASE, wt, ["--build"]);
    assert.equal(code, 1, out);
    assert.match(out, /no cached LOCAL PASS/);
  });

  test("a cache entry for a different head refuses", () => {
    const wt = worktree("agent/9900041-build-otherhead");
    commit(wt, "docs/probe.md");
    writeCache(wt, { pass: true, head: "0".repeat(40), clean: true });
    assert.equal(buildPassed(wt), false);
  });

  test("a passing cache entry for HEAD, on a clean tree, with a full DOD-CHECK, is accepted", () => {
    const wt = worktree("agent/9900042-build-pass");
    commit(wt, "docs/probe.md");
    writeCache(wt, { pass: true, head: head(wt), clean: true });
    assert.equal(buildPassed(wt), true);
    const check = (boxes: string, sha = head(wt)) => [{ body: `DOD-CHECK ${sha.slice(0, 7)}\n\n${boxes}` }];
    const cases: [ReturnType<typeof check>, number, RegExp][] = [
      [[], 1, /no DOD-CHECK/],
      [check("- [x] chip enters — lib/a.ts:12 · tests/a.test.ts:4", "0".repeat(40)), 1, /no DOD-CHECK/],
      [check("- [x] chip enters — lib/a.ts:12\n- [ ] sheen"), 1, /leaves open: - \[ \] sheen/],
      [check("- [x] chip enters, done"), 1, /leaves open/],
      [check("no boxes at all"), 1, /ticks no box/],
      [check("- [x] chip enters — lib/a.ts:12 · tests/a.test.ts:4\n- [X] sheen — lib/b.tsx:3"), 0, /2 box\(es\) ticked/],
    ];
    for (const [comments, want, says] of cases) {
      const { code, out } = gate(wt, comments, BASE, wt, ["--build"]);
      assert.equal(code, want, out);
      assert.match(out, says);
    }
  });

  test("a dirty tree refuses even with a passing cache entry for HEAD", () => {
    const wt = worktree("agent/9900043-build-dirty");
    commit(wt, "docs/probe.md");
    writeCache(wt, { pass: true, head: head(wt), clean: true });
    appendFileSync(join(wt, "docs", "probe.md"), "uncommitted\n");
    assert.equal(buildPassed(wt), false);
    const { code } = gate(wt, [], BASE, wt, ["--build"]);
    assert.equal(code, 1);
  });
});

describe("mergeCleared", () => {
  let repo: string;
  const git = (args: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo, encoding: "utf8" }).trim();
  const edit = (file: string, body: string) => {
    writeFileSync(join(repo, file), body);
    git(["add", file]);
    git(["commit", "-q", "-m", file]);
    return git(["rev-parse", "HEAD"]);
  };
  const said = (...lines: string[]) => lines.map((body) => ({ body }));
  const cleared = (sha: string) => [
    `REVIEW ${sha.slice(0, 7)}\n\n## Standards\n\n## Spec\n`,
    `VERDICT: LAND ${sha.slice(0, 7)}`,
  ];
  let landed: string;
  let merged: string;

  before(() => {
    repo = mkdtempSync(join(tmpdir(), "merge-cleared-"));
    git(["init", "-q", "-b", "main"]);
    edit("base.txt", "base\n");
    git(["switch", "-q", "-c", "agent/1-x"]);
    landed = edit("mine.txt", "mine\n");
    git(["switch", "-q", "main"]);
    edit("theirs.txt", "theirs\n");
    git(["switch", "-q", "agent/1-x"]);
    git(["merge", "-q", "--no-edit", "main"]);
    merged = git(["rev-parse", "HEAD"]);
  });
  after(() => rmSync(repo, { recursive: true, force: true }));

  const check = (comments: { body: string }[], sha: string) => mergeCleared(comments, sha, git, "main");

  test("a head its LAND and report cover is cleared; a LAND alone, a HOLD or silence is not", () => {
    assert.equal(check(said(...cleared(landed)), landed), true);
    assert.equal(check(said(`VERDICT: LAND ${landed.slice(0, 7)}`), landed), false);
    assert.equal(check(said(...cleared(landed), `VERDICT: HOLD ${landed.slice(0, 7)} — no`), landed), false);
    assert.equal(check([], landed), false);
  });

  test("a clean merge of main into a cleared head is cleared", () => {
    assert.equal(check(said(...cleared(landed)), merged), true);
  });

  test("a merge carrying an edit of its own, or of a commit off main, is not", () => {
    git(["switch", "-q", "-c", "agent/1-evil", merged]);
    writeFileSync(join(repo, "mine.txt"), "changed in the merge\n");
    git(["commit", "-q", "--amend", "-a", "--no-edit"]);
    assert.equal(check(said(...cleared(landed)), git(["rev-parse", "HEAD"])), false);

    git(["switch", "-q", "-c", "side", landed]);
    const side = edit("side.txt", "side\n");
    git(["switch", "-q", "-c", "agent/1-side", landed]);
    git(["merge", "-q", "--no-edit", side]);
    assert.equal(check(said(...cleared(landed)), git(["rev-parse", "HEAD"])), false);
  });

  test("an unreviewed commit on a cleared head is not cleared", () => {
    git(["switch", "-q", "-c", "agent/1-more", landed]);
    assert.equal(check(said(...cleared(landed)), edit("more.txt", "more\n")), false);
  });
});

test("--fix-delta prints the size of a fix round's own diff", () => {
  const wt = worktree("agent/9900044-fixdelta");
  const land = execFileSync("git", ["rev-parse", "HEAD"], { cwd: wt, encoding: "utf8" }).trim();
  commit(wt, "docs/probe.md");
  const { code, out } = gate(wt, [], BASE, wt, ["--fix-delta", land]);
  assert.equal(code, 0, out);
  assert.deepEqual(JSON.parse(out.trim()), { files: 1, lines: 2 });
});
