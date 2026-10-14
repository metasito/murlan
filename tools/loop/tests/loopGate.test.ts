// tools/loop/tests/loopGate.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_FIX_HOLDS, MAX_REVIEW_ROUNDS, roundVerdict, buildPassed, dodVerdict, landable, reviewerRan } from "../loop-gate.mjs";
import { readLine } from "../loop-stream.mjs";
import { offTicketBranch, probeBranch, probeTicket, removeWorktree, sweep } from "./helpers/probeFixtures.mjs";

/**
 * Phase E branches on this command's exit code, so the exit code is what is asserted — never a
 * function's return value.
 *
 * Each case is a real branch in a real worktree. `gh` cannot resolve a scratch ticket number, and
 * that is itself the "cannot read the review" path, so the review-dependent cases assert a
 * refusal: the gate fails closed, which is the property worth pinning.
 *
 * `LOOP` and `root` are deliberately two different notions of "where this suite runs":
 * `LOOP` is this file's own directory, so `GATE`/`RACE` are always the copy of the code under
 * test — the edited worktree's, when this suite runs the way phase C always runs it, from inside
 * `.worktrees/agent-<n>`. `root` is the shared checkout, via `--git-common-dir` rather than
 * `--show-toplevel` (RULES.md rule 10: the latter returns the worktree's own path from inside
 * one). Several fixtures need `root` to be off any ticket branch, which only the shared checkout
 * — never a ticket's own worktree — is guaranteed to be (rule 8).
 */
const LOOP = join(dirname(fileURLToPath(import.meta.url)), "..");
const GATE = join(LOOP, "loop-gate.mjs");
const RACE = join(LOOP, "tests", "helpers", "probeFixtureRace.mjs");
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
  const owned = comments.map((c) => ({ authorAssociation: "OWNER", ...c }));
  writeFileSync(js, `console.log(JSON.stringify(${JSON.stringify({ comments: owned })}));`);
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

// Swept before as well as after: a run that died mid-suite leaves its probe branches behind.
before(() => {
  dir = mkdtempSync(join(tmpdir(), "loop-gate-"));
  sweep(root);
});
after(() => {
  for (const wt of madeDirs) removeWorktree(root, wt);
  sweep(root);
  rmSync(dir, { recursive: true, force: true });
});

describe("two runs of this suite on one clone", () => {
  test("neither collides with the other's fixtures nor sweeps them away", async () => {
    const race = mkdtempSync(join(tmpdir(), "loop-gate-race-"));
    madeDirs.push(race);
    const side = (me: string, peer: string) =>
      new Promise<{ code: number | null; err: string }>((done) => {
        const child = spawn(process.execPath, [RACE, root, race, me, peer], { cwd: root });
        let err = "";
        child.stderr.on("data", (d) => (err += d));
        child.on("close", (code) => done({ code, err }));
      });
    const [a, b] = await Promise.all([side("a", "b"), side("b", "a")]);
    assert.deepEqual([a.code, b.code], [0, 0], a.err + b.err);
  });

  test("the sweep clears a dead run's leftovers and keeps a live run's", () => {
    const dead = spawnSync(process.execPath, ["-e", ""]).pid!;
    const peer = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60_000)"]);
    const live = peer.pid!;
    const left = [probeBranch(1, "dead", dead), offTicketBranch("dead", dead)];
    const kept = [probeBranch(1, "live", live), offTicketBranch("live", live)];
    const has = (b: string) =>
      execFileSync("git", ["branch", "--list", b], { cwd: root, encoding: "utf8" }).trim() !== "";
    for (const b of [...left, ...kept]) execFileSync("git", ["branch", b, "HEAD"], { cwd: root });
    try {
      assert.ok([...left, ...kept].every(has));
      sweep(root);
      for (const b of left) assert.ok(!has(b), `${b} outlived its dead run`);
      for (const b of kept) assert.ok(has(b), `${b} was swept from under a live run`);
    } finally {
      peer.kill();
      for (const b of kept) spawnSync("git", ["branch", "-qD", b], { cwd: root });
    }
  });
});

describe("the gate's exit code, which is what phase E reads", () => {
  test("on another branch it declines to judge, and that is never 0", () => {
    const wt = worktree(offTicketBranch("off-ticket"));
    const { code, out } = gate(wt, undefined, BASE, wt);
    assert.equal(code, 2);
    assert.match(out, /not on an agent branch/);
    assert.match(out, /nothing to judge/);
  });

  test("on no branch at all it declines to judge, and that is never 0", () => {
    const wt = join(dir, "detached");
    execFileSync("git", ["worktree", "add", "-q", "--detach", wt, "HEAD"], { cwd: root });
    madeDirs.push(wt);
    const { code, out } = gate(wt, undefined, BASE, wt);
    assert.equal(code, 2);
    assert.match(out, /HEAD is detached/);
    assert.match(out, /nothing to judge/);
  });

  test("a ticket branch with nothing committed is refused", () => {
    const { code, out } = gate(worktree(probeBranch(1, "empty")));
    assert.equal(code, 1);
    assert.match(out, /nothing was built/);
  });

  // The failure the gate exists to prevent. No review of this commit exists anywhere, and there is
  // no state file that could claim otherwise on a previous ticket's behalf.
  test("committed but unreviewed is refused", () => {
    const wt = worktree(probeBranch(2, "unreviewed"));
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
    "server/socket/socket.ts",
    ".replit",
    ".github/workflows/probe.yml",
  ].entries()) {
    test(`${p} is judged on its review, not its name`, () => {
      const wt = worktree(probeBranch(50 + i, "anypath"));
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
    const wt = worktree(probeBranch(10, "land"));
    commit(wt, "docs/probe.md");
    const sha = head(wt).slice(0, 7);
    const { code, out } = gate(wt, [{ body: reviewBody(sha) }, { body: `VERDICT: LAND ${sha}` }]);
    assert.equal(code, 0, out);
    assert.match(out, /reviewed at/);
  });

  test("a LAND with no report behind it is refused by the real binary", () => {
    const wt = worktree(probeBranch(16, "unbacked"));
    commit(wt, "docs/probe.md");
    const { code, out } = gate(wt, [{ body: `VERDICT: LAND ${head(wt).slice(0, 7)}` }]);
    assert.equal(code, 1, out);
    assert.match(out, /no review report/);
  });

  test("a HOLD refuses it", () => {
    const wt = worktree(probeBranch(11, "hold"));
    commit(wt, "docs/probe.md");
    const { code, out } = gate(wt, [{ body: `VERDICT: HOLD ${head(wt).slice(0, 7)} — it is wrong` }]);
    assert.equal(code, 1);
    assert.match(out, /reviewer held/);
  });

  // Commit again after a review and the head moves, so that review no longer covers the diff.
  // Order used to decide, so a later LAND on the same sha erased a hold nobody had addressed.
  test("a LAND cannot overturn a HOLD on the same commit", () => {
    const wt = worktree(probeBranch(13, "sticky"));
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
    const wt = worktree(probeBranch(14, "quoted"));
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
    const wt = worktree(probeBranch(12, "stale"));
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
  const wt = worktree(probeBranch(15, "pointed"));
  commit(wt, "docs/probe.md");
  const { code, out } = gate(root, undefined, BASE, wt);
  assert.notEqual(code, 0, out);
  assert.match(out, new RegExp(`#${probeTicket(15)}\\b`));
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

  test("CI fix rounds that hold have a cap of their own", () => {
    assert.equal(roundVerdict({ reviewRounds: 1, fixHolds: MAX_FIX_HOLDS - 1 }).ok, true);
    const v = roundVerdict({ reviewRounds: 1, fixHolds: MAX_FIX_HOLDS });
    assert.equal(v.ok, false, `a fix round after ${MAX_FIX_HOLDS} fix HOLDs was allowed`);
    assert.match(v.why, /fix/);
  });

  test("a third fix HOLD is refused through the real CLI; one is not", () => {
    const wt = worktree(probeBranch(22, "fixholds"));
    commit(wt, "docs/probe.md");
    const red = [{ body: "REVIEW abc1234\n\n## Blocking\n" }, { body: "VERDICT: LAND abc1234" }, { body: "CI-RED abc1234" }];
    const fixHold = (sha: string) => [{ body: `REVIEW ${sha} fix\n\n## Blocking\n` }, { body: `VERDICT: HOLD ${sha} — still red` }];

    const one = gate(root, [...red, ...fixHold("def5678")], BASE, wt, ["--review-round"]);
    assert.equal(one.code, 0, one.out);

    const two = gate(root, [...red, ...fixHold("def5678"), ...fixHold("eee6789")], BASE, wt, ["--review-round"]);
    assert.equal(two.code, 1, two.out);
    assert.match(two.out, /"stoodDown":true/);
  });

  // The exit code is what phase D branches on, so it is asserted through the real CLI too.
  test("the exit code phase D reads", () => {
    const wt = worktree(probeBranch(21, "rounds"));
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
    assert.match(at.out, /do not land/);
    assert.match(at.out, /"stoodDown":true/);
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
    const wt = worktree(probeBranch(40, "build-nocache"));
    commit(wt, "docs/probe.md");
    assert.equal(buildPassed(wt), false);
    const { code, out } = gate(wt, [], BASE, wt, ["--build"]);
    assert.equal(code, 1, out);
    assert.match(out, /no cached LOCAL PASS/);
  });

  test("a cache entry for a different head refuses", () => {
    const wt = worktree(probeBranch(41, "build-otherhead"));
    commit(wt, "docs/probe.md");
    writeCache(wt, { pass: true, head: "0".repeat(40), clean: true });
    assert.equal(buildPassed(wt), false);
  });

  test("a passing cache entry for HEAD, on a clean tree, with a full DOD-CHECK, is accepted", () => {
    const wt = worktree(probeBranch(42, "build-pass"));
    commit(wt, "docs/probe.md");
    writeCache(wt, { pass: true, head: head(wt), clean: true });
    assert.equal(buildPassed(wt), true);
    const check = (boxes: string, sha = head(wt)) => [{ body: `DOD-CHECK ${sha.slice(0, 7)}\n\n${boxes}` }];
    const cases: [ReturnType<typeof check>, number, RegExp][] = [
      [[], 1, /no DOD-CHECK/],
      [check("- [x] chip enters — package.json:2", "0".repeat(40)), 1, /no DOD-CHECK/],
      [check("- [x] chip enters — package.json:2\n- [ ] sheen"), 1, /leaves open: - \[ \] sheen/],
      [check("- [x] chip enters, done"), 1, /leaves open/],
      [check("- [x] timeout bumped from 1.5:30 to 2.0:60"), 1, /leaves open/],
      [check("- [x] chip enters — lib/nowhere.ts:12"), 1, /leaves open/],
      [check("- [x] chip enters — package.json:99999"), 1, /leaves open/],
      [check("no boxes at all"), 1, /ticks no box/],
      [check("- [x] chip enters — package.json:2 · docs/probe.md:1\n- [X] sheen — package.json:3"), 0, /2 box\(es\) ticked/],
      [check("- [x] chip enters — package.json:2 · docs/probe.md:1 · red: AssertionError: expected 1 got 0"), 0, /1 box\(es\) ticked/],
      [check("- [x] chip enters — package.json:2\n- [x] `npm run agent:check` green"), 0, /2 box\(es\) ticked/],
      [check("- [x] chip enters — package.json:2\n- [x] the owner signs the copy off — n/a: no code site, a decision"), 0, /2 box\(es\) ticked/],
      [check("- [x] the owner signs the copy off — n/a:"), 1, /leaves open/],
      [check("- [ ] the owner signs the copy off — n/a: not mine"), 1, /leaves open/],
      [check("- [x] the new e2e check fails before and passes after; npm run agent:check is green"), 1, /leaves open/],
    ];
    for (const [comments, want, says] of cases) {
      const { code, out } = gate(wt, comments, BASE, wt, ["--build"]);
      assert.equal(code, want, out);
      assert.match(out, says);
    }
  });

  test("the agent:check box is closed by the cached pass, never by its own word", () => {
    const comments = [{ body: "DOD-CHECK abc1234\n\n- [x] `npm run agent:check` green" }];
    assert.equal(dodVerdict(comments, "abc1234def", () => false, true).ok, true);
    const unbuilt = dodVerdict(comments, "abc1234def", () => false, false);
    assert.equal(unbuilt.ok, false);
    assert.match(unbuilt.why, /leaves open: - \[x\] `npm run agent:check` green/);
  });

  const closes = (box: string) => dodVerdict([{ body: `DOD-CHECK abc1234\n\n${box}` }], "abc1234def", () => false, true).ok;

  test("only a box claiming the agent:check pass alone closes on it", () => {
    for (const box of ["- [x] `npm run agent:check` green", "- [x] agent:check passes on this head", "- [x] npm run agent:check: clean."]) {
      assert.equal(closes(box), true, box);
    }
    for (const box of [
      "- [x] the new e2e check fails before and passes after; npm run agent:check is green",
      "- [x] the fan is centred and `npm run agent:check` is green",
    ]) {
      assert.equal(closes(box), false, box);
    }
  });

  test("an n/a box may not name code or a test; those still cite a path:line", () => {
    assert.equal(closes("- [x] the owner signs the copy off — n/a: no test applies, it is a decision"), true);
    for (const box of [
      "- [x] `tests/e2e/flip.spec.ts` covers the flip — n/a: covered elsewhere",
      "- [x] a regression test pins the clamp — n/a: too small",
      "- [x] the e2e flow lands the card — n/a: CI runs it",
      "- [x] the fan is centred in `tools/loop/brief.mjs` — n/a: obvious",
      "- [x] flip.spec.ts is green — n/a: CI",
      "- [x] tools/loop/brief.test.ts covers it — n/a: done",
    ]) {
      assert.equal(closes(box), false, box);
    }
  });

  test("a dirty tree refuses even with a passing cache entry for HEAD", () => {
    const wt = worktree(probeBranch(43, "build-dirty"));
    commit(wt, "docs/probe.md");
    writeCache(wt, { pass: true, head: head(wt), clean: true });
    appendFileSync(join(wt, "docs", "probe.md"), "uncommitted\n");
    assert.equal(buildPassed(wt), false);
    const { code } = gate(wt, [], BASE, wt, ["--build"]);
    assert.equal(code, 1);
  });
});

describe("landable", () => {
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

  const check = (comments: { body: string }[], sha: string) => landable(comments, sha, git, "main").ok;

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

  const holds = (n: number) => Array.from({ length: n }, (_, i) => `VERDICT: HOLD ${"abcdef0".slice(0, 6)}${i} — round ${i + 1}`);

  test("a LAND past the review cap is not cleared, though its report covers it", () => {
    assert.equal(check(said(...holds(MAX_REVIEW_ROUNDS - 1), ...cleared(landed)), landed), true);
    assert.equal(check(said(...holds(MAX_REVIEW_ROUNDS), ...cleared(landed)), landed), false);
    assert.equal(check(said(...holds(MAX_REVIEW_ROUNDS), ...cleared(landed)), merged), false);
  });

  test("a CI fix round's LAND after the cap's last round is cleared", () => {
    const fixed = (sha: string) => [`REVIEW ${sha.slice(0, 7)} fix\n\n## Blocking\n`, `VERDICT: LAND ${sha.slice(0, 7)}`];
    const capped = [...holds(MAX_REVIEW_ROUNDS - 1), "REVIEW 1234567\n\n## Blocking\n", "VERDICT: LAND 1234567"];
    assert.equal(check(said(...capped, "CI-RED 1234567", ...fixed(landed)), landed), true);
  });

  test("an unreviewed commit on a cleared head is not cleared", () => {
    git(["switch", "-q", "-c", "agent/1-more", landed]);
    assert.equal(check(said(...cleared(landed)), edit("more.txt", "more\n")), false);
  });

  const land = (comments: { body: string }[] | null, sha: string) => landable(comments, sha, git, "main");

  test("landable names what a cleared head has, and what an uncleared one lacks", () => {
    const at = landed.slice(0, 7);
    const ok = land(said(...cleared(landed)), landed);
    assert.equal(ok.ok, true);
    assert.match(ok.why, new RegExp(`reviewed at ${at}: VERDICT: LAND ${at}`));
    assert.match(land([], landed).why, /no review of/);
    assert.match(land(said(`VERDICT: LAND ${at}`), landed).why, /no review report/);
    assert.match(land(said(`VERDICT: HOLD ${at} — it is wrong`), landed).why, /reviewer held/);
    assert.match(land(said(...cleared(landed)), git(["rev-parse", "main"])).why, /nothing was built/);
  });

  test("an unreadable tracker carries no lines, which is what makes the CLI exit 2", () => {
    const v = land(null, landed);
    assert.equal(v.ok, false);
    assert.equal(v.lines, undefined);
  });

  test("a LAND cannot overturn a HOLD on the same commit, and a quoted verdict is no review", () => {
    const at = landed.slice(0, 7);
    assert.match(land(said(`VERDICT: HOLD ${at} — unsafe`, ...cleared(landed)), landed).why, /reviewer held/);
    for (const body of [`The reviewer must end with:\n\`\`\`\nVERDICT: LAND ${at}\n\`\`\``, `verdict: land ${at}`]) {
      assert.equal(land(said(cleared(landed)[0], body), landed).ok, false, body);
    }
  });

  test("past the review cap it is refused, at the cap it is not", () => {
    assert.equal(land(said(...holds(MAX_REVIEW_ROUNDS - 1), ...cleared(landed)), landed).ok, true);
    assert.match(land(said(...holds(MAX_REVIEW_ROUNDS), ...cleared(landed)), landed).why, /past the cap/);
  });

  test("an unreadable tracker carries no lines, which is what makes the CLI exit 2", () => {
    const v = land(null, landed);
    assert.equal(v.ok, false);
    assert.match(v.why, /cannot reach the tracker/);
    assert.equal(v.lines, undefined);
    assert.ok(land([], landed).lines?.length);
  });

  test("a head git cannot read is refused, never cleared", () => {
    const v = land(said(...cleared(landed)), "f".repeat(40));
    assert.equal(v.ok, false);
  });
});

describe("reviewerRan: this D round's own reviewer completed, before anything arms", () => {
  const N = 42;
  const say = (text: string) => readLine(JSON.stringify({ type: "assistant", message: { id: text, content: [{ type: "text", text }] } }));
  const init = () => readLine(JSON.stringify({ type: "system", subtype: "init", session_id: "s" }));
  let tasks = 0;
  const dispatch = (agent: string, n = N, kind = "review") => {
    const id = `t${++tasks}`;
    const prompt = `BRIEF ${kind} #${n} .worktrees/agent-${n} origin/main\n\nRead the change.`;
    return {
      id,
      started: readLine(JSON.stringify({ type: "system", subtype: "task_started", task_id: id, tool_use_id: `u${id}`, subagent_type: agent, description: `Review #${n}`, prompt })),
      done: readLine(JSON.stringify({ type: "system", subtype: "task_updated", task_id: id, patch: { status: "completed", end_time: 1 } })),
    };
  };

  test("a reviewer that completed in this D process", () => {
    const r = dispatch("loop-review");
    assert.equal(reviewerRan([say("PHASE C"), init(), say("PHASE D"), r.started, r.done], N), true);
  });

  test("a reviewer that completed in the D process before a handoff", () => {
    const r = dispatch("loop-review");
    assert.equal(reviewerRan([say("PHASE C"), init(), say("PHASE D"), r.started, r.done, init(), say("PHASE D")], N), true);
  });

  test("a fix round's reviewer counts", () => {
    const r = dispatch("loop-fix", N, "fix");
    assert.equal(reviewerRan([say("PHASE C"), say("PHASE D"), r.started, r.done], N), true);
  });

  test("no reviewer is no clearance", () => {
    assert.equal(reviewerRan([say("PHASE C"), init(), say("PHASE D")], N), false);
    assert.equal(reviewerRan([], N), false);
  });

  test("a reviewer of another issue, or of another kind, is not this one's", () => {
    const other = dispatch("loop-review", 43);
    const scope = dispatch("loop-scope", N, "scope");
    assert.equal(reviewerRan([say("PHASE C"), say("PHASE D"), other.started, other.done, scope.started, scope.done], N), false);
  });

  test("a reviewer from before the last build does not cover what was built after it", () => {
    const r = dispatch("loop-review");
    assert.equal(reviewerRan([say("PHASE D"), r.started, r.done, say("PHASE C"), init(), say("PHASE D")], N), false);
  });

  test("a reviewer started and never completed is not one that ran", () => {
    const r = dispatch("loop-review");
    const failed = readLine(JSON.stringify({ type: "system", subtype: "task_updated", task_id: r.id, patch: { status: "failed" } }));
    assert.equal(reviewerRan([say("PHASE C"), say("PHASE D"), r.started], N), false);
    assert.equal(reviewerRan([say("PHASE C"), say("PHASE D"), r.started, failed], N), false);
  });
});
