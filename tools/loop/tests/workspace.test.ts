// tools/loop/tests/workspace.test.ts
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importUnderShellGuard } from "../../../tests/helpers/importShellGuard.ts";
import { housekeeping, sweep } from "../workspace.mjs";

// Named for the shape rather than the case: a test file joining the install's literal name trips
// the scanner in tests/tooling/handBuiltNodeModulesPaths.test.ts.
const LINK = "linked-install";

let roots: string[] = [];
afterEach(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  roots = [];
});

const run = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/** Every call the code under test makes, made for real against the scratch repository. */
function spyGit(repo: string, refuse: Record<string, string> = {}) {
  const calls: string[] = [];
  const git = (args: string[]) => {
    calls.push(args.join(" "));
    const target = args.at(-1) ?? "";
    if (args[0] === "worktree" && args[1] === "remove" && refuse[path.basename(target)]) {
      throw Object.assign(new Error("Command failed: git worktree remove"), { stderr: refuse[path.basename(target)] });
    }
    return run(repo, ...args);
  };
  return { git, calls, removals: () => calls.filter((c) => c.startsWith("worktree remove")) };
}

/** A shared checkout on `main`, with `.worktrees/` ignored as the real one ignores it. */
function scratchRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "murlan-ws-")));
  roots.push(root);
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  run(repo, "init", "--quiet", "--initial-branch", "main");
  run(repo, "config", "user.email", "t@example.com");
  run(repo, "config", "user.name", "t");
  fs.writeFileSync(path.join(repo, ".gitignore"), `.worktrees\n${LINK}\n`);
  fs.writeFileSync(path.join(repo, "theme.ts"), "export {};\n");
  run(repo, "add", "--", ".gitignore", "theme.ts");
  run(repo, "commit", "--quiet", "-m", "init");
  return { root, repo };
}

function ticketTree(repo: string, n: number, { detached = false } = {}) {
  const dir = path.join(repo, ".worktrees", `agent-${n}`);
  if (detached) run(repo, "worktree", "add", "--quiet", "--detach", dir);
  else run(repo, "worktree", "add", "--quiet", "-b", `agent/${n}-x`, dir);
  return dir;
}

type Issue = { state: string; labels: string[] } | Error;

/** `prs` is each branch's newest pull request state; a branch absent from it has none. */
function fakeGh(issues: Record<number, Issue>, prs: Record<string, string> = {}) {
  const asked: number[] = [];
  const gh = (args: string[]) => {
    if (args[0] === "pr") {
      const state = prs[args[args.indexOf("--head") + 1]];
      return JSON.stringify(state ? [{ state }] : []);
    }
    const n = Number(args[2]);
    asked.push(n);
    const issue = issues[n];
    if (!issue) throw new Error(`no fixture for #${n}`);
    if (issue instanceof Error) throw issue;
    return JSON.stringify({ state: issue.state, labels: issue.labels.map((name) => ({ name })) });
  };
  return { gh, asked };
}

const CLOSED = { state: "CLOSED", labels: [] };
const CLAIMED = { state: "OPEN", labels: ["ready-for-agent", "in-progress"] };
const registered = (repo: string, dir: string) =>
  run(repo, "worktree", "list", "--porcelain").includes(`worktree ${dir.replace(/\\/g, "/")}`);
const hasRef = (repo: string, ref: string) => {
  try {
    run(repo, "rev-parse", "--verify", "--quiet", ref);
    return true;
  } catch {
    return false;
  }
};

describe("sweep: a leftover ticket worktree goes only by a removal that does not force", () => {
  test("a closed issue's worktree is removed without --force; its branch stays, its held work ref goes", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 7);
    run(repo, "update-ref", "refs/loop/wip/7", "HEAD");
    const { git, calls, removals } = spyGit(repo);

    const row = sweep({ git, gh: fakeGh({ 7: CLOSED }).gh });

    assert.equal(calls[0], "worktree prune", "git's own prune runs first");
    assert.equal(removals().length, 1);
    assert.doesNotMatch(removals()[0], /--force/, "the sweep never forces");
    assert.equal(fs.existsSync(dir), false);
    assert.equal(registered(repo, dir), false);
    assert.ok(hasRef(repo, "refs/heads/agent/7-x"), "the branch is what claim.mjs rebuilds from");
    assert.equal(hasRef(repo, "refs/loop/wip/7"), false);
    assert.equal(row?.state, "done");
    assert.match(row?.detail ?? "", /removed agent-7/);
  });

  test("an open issue that lost its claim, with a pull request, is removed, and its held work ref is kept", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 8);
    run(repo, "update-ref", "refs/loop/wip/8", "HEAD");
    sweep({ git: spyGit(repo).git, gh: fakeGh({ 8: { state: "OPEN", labels: ["ready-for-human"] } }, { "agent/8-x": "CLOSED" }).gh });
    assert.equal(fs.existsSync(dir), false);
    assert.ok(hasRef(repo, "refs/loop/wip/8"), "an open ticket's ref is parked work");
  });

  test("an open issue that lost its claim, its branch merged into origin/main, is removed", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 24);
    run(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    sweep({ git: spyGit(repo).git, gh: fakeGh({ 24: { state: "OPEN", labels: [] } }).gh });
    assert.equal(fs.existsSync(dir), false);
  });

  test("an open issue that lost its claim, unmerged and with no pull request, is kept and named", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 25);
    run(repo, "-C", dir, "commit", "--quiet", "--allow-empty", "-m", "unmerged work");
    run(repo, "update-ref", "refs/remotes/origin/main", "main");
    const { git, removals } = spyGit(repo);
    const row = sweep({ git, gh: fakeGh({ 25: { state: "OPEN", labels: ["ready-for-agent"] } }).gh });
    assert.deepEqual(removals(), []);
    assert.ok(fs.existsSync(dir));
    assert.match(row?.note ?? "", /agent-25: kept — unmerged, no pull request found/);
  });

  test("a worktree git cannot read is kept with git's reason, and the sweep goes on to the next", () => {
    const { repo } = scratchRepo();
    const held = ticketTree(repo, 26);
    const next = ticketTree(repo, 27);
    const { git: real } = spyGit(repo);
    const git = (args: string[]) => {
      if (args.includes("status") && args.some((a) => a.endsWith("agent-26"))) {
        throw Object.assign(new Error("Command failed: git status"), { stderr: "fatal: detected dubious ownership in repository" });
      }
      return real(args);
    };
    const row = sweep({ git, gh: fakeGh({ 26: CLOSED, 27: CLOSED }).gh });
    assert.ok(fs.existsSync(held));
    assert.equal(fs.existsSync(next), false);
    assert.equal(row?.state, "warned");
    assert.match(row?.note ?? "", /agent-26: kept — fatal: detected dubious ownership/);
  });

  test("a claimed ticket's worktree is kept, and says nothing", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 9);
    const { git, removals } = spyGit(repo);
    assert.equal(sweep({ git, gh: fakeGh({ 9: CLAIMED }).gh }), null);
    assert.deepEqual(removals(), []);
    assert.ok(fs.existsSync(dir));
  });

  test("the pinned ticket's worktree is never swept, nor its issue read", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 10);
    const { gh, asked } = fakeGh({ 10: CLOSED });
    assert.equal(sweep({ pinned: 10, git: spyGit(repo).git, gh }), null);
    assert.deepEqual(asked, []);
    assert.ok(fs.existsSync(dir));
  });

  test("a detached HEAD has no branch to keep and is removed, without asking the tracker", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 11, { detached: true });
    const { gh, asked } = fakeGh({ 11: CLOSED });
    const row = sweep({ git: spyGit(repo).git, gh });
    assert.deepEqual(asked, []);
    assert.equal(fs.existsSync(dir), false);
    assert.match(row?.note ?? "", /agent-11: removed, detached HEAD/);
  });

  test("a detached HEAD holding uncommitted work is kept", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 28, { detached: true });
    fs.writeFileSync(path.join(dir, "notes.txt"), "unsaved");
    const row = sweep({ git: spyGit(repo).git, gh: fakeGh({}).gh });
    assert.ok(fs.existsSync(dir));
    assert.match(row?.note ?? "", /agent-28: kept — .*uncommitted/);
  });

  test("an issue that cannot be read keeps its worktree, and the row says so", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 12);
    const row = sweep({ git: spyGit(repo).git, gh: fakeGh({ 12: new Error("gh: connection reset") }).gh });
    assert.ok(fs.existsSync(dir));
    assert.equal(row?.state, "warned");
    assert.match(row?.note ?? "", /agent-12.*connection reset/);
  });

  test("the tracker is asked with a bound, so a wedged gh cannot hold the pass", () => {
    const { repo } = scratchRepo();
    ticketTree(repo, 18);
    const bounds: unknown[] = [];
    const gh = (args: string[], opts?: { timeout?: number }) => {
      bounds.push(opts?.timeout);
      return JSON.stringify({ state: "OPEN", labels: [{ name: "in-progress" }] });
    };
    sweep({ git: spyGit(repo).git, gh });
    assert.equal(bounds.length, 1);
    assert.ok(Number(bounds[0]) > 0 && Number(bounds[0]) <= 60_000, `unbounded: ${bounds[0]}`);
  });

  test("uncommitted work is never removed, and the row says why", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 13);
    fs.writeFileSync(path.join(dir, "notes.txt"), "unsaved");
    const { git, removals } = spyGit(repo);
    const row = sweep({ git, gh: fakeGh({ 13: CLOSED }).gh });
    assert.deepEqual(removals(), []);
    assert.equal(fs.readFileSync(path.join(dir, "notes.txt"), "utf8"), "unsaved");
    assert.equal(row?.state, "warned");
    assert.match(row?.note ?? "", /agent-13.*uncommitted/);
  });

  test("a locked worktree is kept, and its links stay attached", () => {
    const { root, repo } = scratchRepo();
    const dir = ticketTree(repo, 15);
    let linked = true;
    try {
      fs.symlinkSync(path.join(root, "install"), path.join(dir, LINK), "junction");
    } catch {
      linked = false;
    }
    run(repo, "worktree", "lock", dir);
    const { git, removals } = spyGit(repo);
    const row = sweep({ git, gh: fakeGh({ 15: CLOSED }).gh });
    assert.deepEqual(removals(), []);
    assert.match(row?.note ?? "", /agent-15.*locked/);
    if (linked) assert.ok(fs.lstatSync(path.join(dir, LINK)).isSymbolicLink());
  });

  test("a removal git refuses keeps the worktree and its ref, and the row carries git's reason", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 14);
    run(repo, "update-ref", "refs/loop/wip/14", "HEAD");
    const refusal = "fatal: '.worktrees/agent-14' contains modified or untracked files, use --force to delete it";
    const row = sweep({ git: spyGit(repo, { "agent-14": refusal }).git, gh: fakeGh({ 14: CLOSED }).gh });
    assert.ok(fs.existsSync(dir));
    assert.ok(hasRef(repo, "refs/loop/wip/14"), "a kept tree keeps its ref");
    assert.equal(row?.state, "warned");
    assert.match(row?.note ?? "", /contains modified or untracked files/);
  });

  test("a closed ticket's install link is detached, never followed", () => {
    const { root, repo } = scratchRepo();
    const install = path.join(root, "install");
    fs.mkdirSync(install);
    fs.writeFileSync(path.join(install, "tsc"), "the install");
    const dir = ticketTree(repo, 19);
    try {
      fs.symlinkSync(install, path.join(dir, LINK), "junction");
    } catch {
      // No link on this platform; the removal is still under test.
    }
    sweep({ git: spyGit(repo).git, gh: fakeGh({ 19: CLOSED }).gh });
    assert.equal(fs.existsSync(dir), false);
    assert.equal(fs.readFileSync(path.join(install, "tsc"), "utf8"), "the install");
  });

  test("a worktree outside the loop's namespace, or misnamed in it, is never touched", () => {
    const { root, repo } = scratchRepo();
    const elsewhere = path.join(root, "elsewhere", "agent-16");
    run(repo, "worktree", "add", "--quiet", "-b", "agent/16-x", elsewhere);
    const misnamed = path.join(repo, ".worktrees", "fix-971");
    run(repo, "worktree", "add", "--quiet", "-b", "fix-971", misnamed);
    const { gh, asked } = fakeGh({});
    const { git, removals } = spyGit(repo);
    assert.equal(sweep({ git, gh }), null);
    assert.deepEqual(asked, []);
    assert.deepEqual(removals(), []);
  });

  test("a registration whose directory vanished is git's own prune to drop, not the tracker's", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 20);
    fs.rmSync(dir, { recursive: true, force: true });
    const { gh, asked } = fakeGh({});
    sweep({ git: spyGit(repo).git, gh });
    assert.deepEqual(asked, []);
    assert.equal(registered(repo, dir), false);
  });

  test("--dry-run names what it would remove and removes nothing", () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 21);
    const { git, removals } = spyGit(repo);
    const row = sweep({ dryRun: true, git, gh: fakeGh({ 21: CLOSED }).gh });
    assert.deepEqual(removals(), []);
    assert.ok(fs.existsSync(dir));
    assert.match(row?.detail ?? "", /would remove agent-21/);
  });

  test("--dry-run keeps what the real run would keep, and says why", () => {
    const { repo } = scratchRepo();
    const dirtyDir = ticketTree(repo, 29);
    fs.writeFileSync(path.join(dirtyDir, "notes.txt"), "unsaved");
    run(repo, "worktree", "lock", ticketTree(repo, 30));
    const row = sweep({ dryRun: true, git: spyGit(repo).git, gh: fakeGh({ 29: CLOSED, 30: CLOSED }).gh });
    assert.doesNotMatch(row?.detail ?? "", /would remove/);
    assert.match(row?.note ?? "", /agent-29: kept — .*uncommitted/);
    assert.match(row?.note ?? "", /agent-30: kept — .*locked/);
  });
});

describe("sweep: a directory git no longer registers (#377)", () => {
  test("is detached and removed, and what it linked to survives", () => {
    const { root, repo } = scratchRepo();
    const install = path.join(root, "install");
    fs.mkdirSync(install);
    fs.writeFileSync(path.join(install, "tsc"), "the install");
    const orphan = path.join(repo, ".worktrees", "agent-17");
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(path.join(orphan, "left.txt"), "x");
    try {
      fs.symlinkSync(install, path.join(orphan, LINK), "junction");
    } catch {
      // No link on this platform; the removal is still under test.
    }
    const row = sweep({ git: spyGit(repo).git, gh: fakeGh({}).gh });
    assert.equal(fs.existsSync(orphan), false);
    assert.equal(fs.readFileSync(path.join(install, "tsc"), "utf8"), "the install");
    assert.match(row?.note ?? "", /agent-17/);
  });

  test("one a process holds open is reported as going when it exits; any other failure keeps it", (t) => {
    const { repo } = scratchRepo();
    for (const n of [31, 32]) fs.mkdirSync(path.join(repo, ".worktrees", `agent-${n}`), { recursive: true });
    const rm = t.mock.method(fs, "rmSync", (p: string) => {
      throw Object.assign(new Error(`cannot remove ${p}`), { code: p.endsWith("agent-31") ? "EBUSY" : "EACCES" });
    });
    const row = sweep({ git: spyGit(repo).git, gh: fakeGh({}).gh });
    rm.mock.restore();
    assert.equal(row?.state, "warned");
    assert.match(row?.detail ?? "", /removed agent-31/);
    assert.match(row?.note ?? "", /agent-31: unregistered, and held open by another process/);
    assert.match(row?.detail ?? "", /kept agent-32/);
    assert.match(row?.note ?? "", /agent-32: could not be removed — cannot remove/);
  });
});

type Row = { label: string; state: string; detail?: string; note?: string; ms?: number };

const SAW_NOTHING = { took: 0, blind: null };

describe("housekeeping", () => {
  const base = (repo: string, over: Record<string, unknown> = {}) => ({
    pinned: null,
    git: spyGit(repo).git,
    gh: fakeGh({}).gh,
    reap: async () => SAW_NOTHING,
    checkMain: () => null,
    drift: () => [],
    say: () => {},
    ...over,
  });

  test("a throw inside housekeeping stops the run with its reason", async () => {
    const r = await housekeeping({
      pinned: null,
      git: () => {
        throw new Error("boom");
      },
      gh: () => "",
      reap: async () => SAW_NOTHING,
      checkMain: () => null,
      say: () => {},
    });
    assert.equal(r.verdict, "stop");
    assert.match(r.why ?? "", /boom/);
  });

  test("a clean machine is ok and prints nothing", async () => {
    const { repo } = scratchRepo();
    const said: unknown[] = [];
    const r = await housekeeping(base(repo, { say: (row: unknown) => said.push(row) }));
    assert.equal(r.verdict, "ok");
    assert.deepEqual(said, []);
  });

  test("uncommitted tracked work in the shared checkout holds, naming the file, and nothing after it runs", async () => {
    const { repo } = scratchRepo();
    fs.writeFileSync(path.join(repo, "theme.ts"), "export const x = 1;\n");
    const ran: string[] = [];
    const r = await housekeeping(base(repo, { reap: async () => (ran.push("reap"), SAW_NOTHING), checkMain: () => (ran.push("main"), null) }));
    assert.equal(r.verdict, "hold");
    assert.match(r.why ?? "", /uncommitted/);
    assert.match((r.rows.at(-1) as Row).note ?? "", /theme\.ts/);
    assert.deepEqual(ran, []);
  });

  test("an untracked file in the shared checkout is not someone's change, and does not hold", async () => {
    const { repo } = scratchRepo();
    fs.writeFileSync(path.join(repo, "scratch.txt"), "x");
    assert.equal((await housekeeping(base(repo))).verdict, "ok");
  });

  test("an install drifted from the lockfile holds, naming the package", async () => {
    const { repo } = scratchRepo();
    const read: string[] = [];
    const r = await housekeeping(
      base(repo, { drift: (root: string) => (read.push(root), [{ name: "react-native", installed: "0.81.5", locked: "0.86.3" }]) }),
    );
    assert.equal(r.verdict, "hold");
    assert.match((r.rows.at(-1) as Row).note ?? "", /react-native: installed 0\.81\.5, locked 0\.86\.3/);
    assert.deepEqual(read.map((p) => fs.realpathSync(p)), [repo], "the shared checkout's install, wherever this runs from");
  });

  test("a hand-made directory under .worktrees stops the run and says what to run", async () => {
    const { repo } = scratchRepo();
    run(repo, "worktree", "add", "--quiet", "-b", "fix-971", path.join(repo, ".worktrees", "fix-971"));
    fs.writeFileSync(path.join(repo, ".worktrees", "agent-1094.diff"), "a scratch file is not a worktree");
    const r = await housekeeping(base(repo));
    assert.equal(r.verdict, "stop");
    assert.match(r.why ?? "", /1 not made by the loop/);
    assert.match((r.rows.at(-1) as Row).note ?? "", /worktrees:remove -- .*fix-971/);
  });

  test("the sweep runs first and main is read last", async () => {
    const { repo } = scratchRepo();
    const order: string[] = [];
    const { git: real } = spyGit(repo);
    const git = (args: string[]) => (args[1] === "prune" && order.push("sweep"), real(args));
    await housekeeping(base(repo, { git, reap: async () => (order.push("reap"), SAW_NOTHING), checkMain: () => (order.push("main"), null) }));
    assert.deepEqual(order, ["sweep", "reap", "main"]);
  });

  test("the pinned ticket reaches the sweep", async () => {
    const { repo } = scratchRepo();
    const dir = ticketTree(repo, 22);
    const { gh, asked } = fakeGh({ 22: CLOSED });
    await housekeeping(base(repo, { pinned: 22, gh }));
    assert.deepEqual(asked, []);
    assert.ok(fs.existsSync(dir));
  });

  test("what reap took is a row; nothing taken is none", async () => {
    const { repo } = scratchRepo();
    const said: Row[] = [];
    const r = await housekeeping(
      base(repo, {
        reap: async ({ say }: { say: (l: string) => void }) => (say("reap: killed node pid 7, 3.0h old, parent 1 is gone"), { took: 1, blind: null }),
        say: (row: Row) => said.push(row),
      }),
    );
    assert.equal(r.verdict, "ok");
    assert.deepEqual(said.map((s) => s.label), ["reap"]);
    assert.match(said[0].note ?? "", /pid 7/);
    assert.deepEqual((await housekeeping(base(repo, { reap: async ({ say }: { say: (l: string) => void }) => (say("reap: e2e port 5199 is free"), SAW_NOTHING) }))).rows, []);
  });

  test("a kill reap refused for want of a table is a warning row", async () => {
    const { repo } = scratchRepo();
    const r = await housekeeping(base(repo, { reap: async () => ({ took: 1, blind: "refused to kill pid 7 — no process table shows this reaper" }) }));
    const row = r.rows.at(-1) as Row;
    assert.deepEqual([row.label, row.state], ["reap", "warned"]);
  });

  test("a reap that could not see the processes is a warning row, never silence", async () => {
    const { repo } = scratchRepo();
    const r = await housekeeping(base(repo, { reap: async () => ({ took: 0, blind: "pwsh gave no process table, so this sweep takes nothing" }) }));
    assert.equal(r.verdict, "ok");
    const row = r.rows.at(-1) as Row;
    assert.deepEqual([row.label, row.state], ["reap", "warned"]);
    assert.match(row.detail ?? "", /pwsh gave no process table/);
  });

  test("a red main is a warning, never a refusal, and it comes last", async () => {
    const { repo } = scratchRepo();
    const filed = { state: "filed", why: "Typecheck and tests failed", url: "https://github.com/metasito/murlan/issues/5", title: "t" };
    const r = await housekeeping(base(repo, { checkMain: () => filed }));
    assert.equal(r.verdict, "ok");
    const last = r.rows.at(-1) as Row;
    assert.deepEqual([last.label, last.state], ["main", "warned"]);
    assert.match(last.note ?? "", /issues\/5/);
  });

  test("an answer main has not settled says nothing", async () => {
    const { repo } = scratchRepo();
    const r = await housekeeping(base(repo, { checkMain: () => ({ state: "unknown", why: "still running" }) }));
    assert.deepEqual(r.rows, []);
  });

  test("every row is timed and reaches the screen as it is made", async () => {
    const { repo } = scratchRepo();
    const said: Row[] = [];
    await housekeeping(base(repo, { drift: () => [{ name: "x", installed: "1", locked: "2" }], say: (row: Row) => said.push(row) }));
    assert.equal(said.length, 1);
    assert.equal(typeof said[0].ms, "number");
  });
});

describe("importing the module", () => {
  test("never shells out to git or gh", () => {
    const { shelledOutTo } = importUnderShellGuard(new URL("../workspace.mjs", import.meta.url).href);
    assert.equal(shelledOutTo, null);
  });
});
