// tests/loopGate.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Phase E branches on this command's exit code, so the exit code is what is asserted — never a
 * function's return value.
 *
 * Each case is a real branch in a real worktree. `gh` cannot resolve a scratch ticket number, and
 * that is itself the "cannot read the review" path, so the review-dependent cases assert a
 * refusal: the gate fails closed, which is the property worth pinning.
 *
 * `SCRIPTS` and `root` are deliberately two different notions of "where this suite runs":
 * `SCRIPTS` is this file's own directory, so `GATE`/`PRUNE` are always the copy of the code under
 * test — the edited worktree's, when this suite runs the way phase C always runs it, from inside
 * `.worktrees/agent-<n>`. `root` is the shared checkout, via `--git-common-dir` rather than
 * `--show-toplevel` (RULES.md rule 10: the latter returns the worktree's own path from inside
 * one). Several fixtures need `root` to be off any ticket branch, which only the shared checkout
 * — never a ticket's own worktree — is guaranteed to be (rule 8).
 */
const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const GATE = join(SCRIPTS, "loop-gate.mjs");
const PRUNE = join(SCRIPTS, "prune-worktrees.mjs");
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
  worktree?: string
): { code: number; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (comments) env.LOOP_GH_SCRIPT = stubGh(comments);
  if (base) env.LOOP_BASE = base;
  else delete env.LOOP_BASE;
  // Points the gate at exactly one worktree, so a real agent/* run left live elsewhere on the
  // machine (this suite's own, or a peer's) cannot be mistaken for the one under test here.
  if (worktree) env.LOOP_WORKTREE = worktree;
  else delete env.LOOP_WORKTREE;
  const r = spawnSync(process.execPath, [GATE], { cwd, encoding: "utf8", env });
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

  test("a LAND naming this commit allows the push", () => {
    const wt = worktree("agent/9900010-land");
    commit(wt, "docs/probe.md");
    const { code, out } = gate(wt, [{ body: `VERDICT: LAND ${head(wt).slice(0, 7)}` }]);
    assert.equal(code, 0, out);
    assert.match(out, /reviewed at/);
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
function scratchCheckout(): string {
  const wt = join(dir, `checkout-${Math.random().toString(36).slice(2)}`);
  execFileSync("git", ["worktree", "add", "-q", "--detach", wt, "HEAD"], { cwd: root });
  return wt;
}

function removeWorktree(wt: string) {
  try {
    execFileSync(process.execPath, [PRUNE, "--remove", wt, "--force"], { cwd: root });
  } catch {
    /* never created, or already gone */
  }
}

/**
 * The defect this pins was the loop being unable to see its own run. Work happens in
 * `.worktrees/agent-<n>` and rule 40 keeps the shell in the shared checkout, so reading `HEAD`
 * where the process stands answered for the wrong branch: on a live ticket the compaction brief
 * printed nothing and phase E's gate exited 2 every time.
 */
describe("the run is found by scanning .worktrees/, not from where the process stands", () => {
  test("a run in .worktrees/ is judged from that checkout", () => {
    const checkout = scratchCheckout();
    const home = join(checkout, ".worktrees", "agent-9900099");
    try {
      execFileSync("git", ["worktree", "add", "-q", "-b", "agent/9900099-live", home, "HEAD"], {
        cwd: root,
      });
      commit(home, ".github/workflows/probe.yml", "\non: push\n");

      // The gate runs at `checkout`, which is off any ticket — the situation that used to exit 2
      // for not being on a ticket at all. Naming the ticket is what proves the scan found the run.
      const { code, out } = gate(checkout);
      assert.notEqual(code, 0, `the gate cleared a push it never reviewed: ${out}`);
      assert.match(out, /#9900099/);
      assert.doesNotMatch(out, /nothing to judge/);
    } finally {
      removeWorktree(home);
      removeWorktree(checkout);
      execFileSync("git", ["worktree", "prune"], { cwd: root });
      rmSync(checkout, { recursive: true, force: true });
    }
  });

  // Two live ticket worktrees is not a real loop state (one ticket at a time), but a leftover
  // from a crashed run sitting next to the one in progress is exactly how it happens. Picking one
  // arbitrarily would judge a review that was never for this ticket at all.
  test("two live ticket worktrees refuse rather than guess which one", () => {
    const checkout = scratchCheckout();
    const a = join(checkout, ".worktrees", "agent-9900097");
    const b = join(checkout, ".worktrees", "agent-9900098");
    try {
      execFileSync("git", ["worktree", "add", "-q", "-b", "agent/9900097-a", a, "HEAD"], { cwd: root });
      execFileSync("git", ["worktree", "add", "-q", "-b", "agent/9900098-b", b, "HEAD"], { cwd: root });

      const { code, out } = gate(checkout);
      assert.equal(code, 2, out);
      assert.match(out, /cannot tell which one/);
    } finally {
      removeWorktree(a);
      removeWorktree(b);
      removeWorktree(checkout);
      execFileSync("git", ["worktree", "prune"], { cwd: root });
      rmSync(checkout, { recursive: true, force: true });
    }
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
