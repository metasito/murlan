// tests/loopGate.test.ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { PROTECTED } from "../scripts/loop-gate.mjs";

/**
 * Phase E branches on this command's exit code, so the exit code is what is asserted — never a
 * function's return value. An audit proved the previous suite stayed green with protected-path
 * enforcement removed from `main()` entirely, because it only ever called the function.
 *
 * Each case is a real branch in a real worktree. `gh` cannot resolve a scratch ticket number, and
 * that is itself the "cannot read the review" path, so the review-dependent cases assert a
 * refusal: the gate fails closed, which is the property worth pinning.
 */
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const GATE = join(root, "scripts", "loop-gate.mjs");
const PRUNE = join(root, "scripts", "prune-worktrees.mjs");

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
  base: string | undefined = BASE
): { code: number; out: string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (comments) env.LOOP_GH_SCRIPT = stubGh(comments);
  if (base) env.LOOP_BASE = base;
  else delete env.LOOP_BASE;
  const r = spawnSync(process.execPath, [GATE], { cwd, encoding: "utf8", env });
  return { code: r.status ?? -1, out: `${r.stderr}${r.stdout}` };
}

function sweep() {
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
  test("off a ticket branch it declines to judge, and that is never 0", () => {
    const { code, out } = gate(root);
    assert.equal(code, 2);
    assert.match(out, /not on an agent branch/);
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

// Every path, not one of them: an audit found the previous fixtures aimed only at
// shared/schema.ts, so the list could lose .github/workflows/ and .replit with the suite green.
describe("every protected path is refused, through the exit code", () => {
  for (const [i, p] of PROTECTED.entries()) {
    test(`${p} is caught`, () => {
      const wt = worktree(`agent/990100${i}-protected`);
      commit(wt, p.endsWith("/") ? `${p}probe.yml` : p);
      const { code, out } = gate(wt);
      assert.equal(code, 1, `${p} did not refuse`);
      assert.match(out, /may not change on its own/);
      assert.ok(out.includes(p.replace(/\/$/, "")), `${p} was not named in the refusal`);
    });
  }

  // This used to take a `--base` flag, and an audit walked a `.github/workflows/` change straight
  // through with `--base HEAD~1`. With no override the gate must still refuse: blocked locally, and
  // unable to judge on a shallow CI checkout where origin/main is not a ref. Never 0.
  test("with no base override a protected path is still never allowed", () => {
    const wt = worktree("agent/9900005-nobase");
    commit(wt, ".github/workflows/probe.yml");
    const { code } = gate(wt, undefined, undefined);
    assert.notEqual(code, 0, "a protected path passed at the default base");
  });

  test("the server/ auth rule is decided on the changed lines", () => {
    const wt = worktree("agent/9900003-auth");
    commit(wt, "server/probeThing.ts", "\nconst sessionSecret = 1;\n");
    const { code, out } = gate(wt);
    assert.equal(code, 1);
    assert.match(out, /auth or the session table/);
  });

  test("an ordinary server/ change is not caught by it", () => {
    const wt = worktree("agent/9900004-plain");
    commit(wt, "server/probePlain.ts", "\nconst columns = 3;\n");
    const { code, out } = gate(wt);
    assert.notEqual(code, 0);
    assert.doesNotMatch(out, /may not change on its own/);
  });
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
 * The defect this pins was the loop being unable to see its own run. Work happens in
 * `.worktrees/agent-<n>` and rule 40 keeps the shell in the shared checkout, so reading `HEAD`
 * where the process stands answered for the wrong branch: on a live ticket the compaction brief
 * printed nothing and phase E's gate exited 2 every time.
 */
describe("the run is found from the shared checkout, not from where the process stands", () => {
  const HOME = join(root, ".worktrees", "agent-9900099");

  const teardown = () => {
    try {
      execFileSync(process.execPath, [PRUNE, "--remove", HOME, "--force"], { cwd: root });
    } catch {
      /* never created, or already gone */
    }
    execFileSync("git", ["worktree", "prune"], { cwd: root });
    rmSync(HOME, { recursive: true, force: true });
  };
  after(teardown);

  test("a run in .worktrees/ is judged from the main checkout", () => {
    teardown();
    execFileSync("git", ["worktree", "add", "-q", "-b", "agent/9900099-live", HOME, "HEAD"], {
      cwd: root,
    });
    commit(HOME, ".github/workflows/probe.yml", "\non: push\n");

    // The gate runs at `root`, which is on chore/... — the situation that used to exit 2.
    const { code, out } = gate(root);
    assert.equal(code, 1, `the gate did not see the run: ${out}`);
    assert.match(out, /#9900099/);
    assert.match(out, /may not change on its own/);
  });
});
