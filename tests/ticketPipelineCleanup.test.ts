// tests/ticketPipelineCleanup.test.ts
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { connect, createServer, type AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCleanupCommands } from "../lib/ticketPipeline/cleanup.ts";

// A run whose implement agent died leaves the tree it built uncommitted, and `--force` throws it
// away without a word. #278's died after thirty-one file edits and no `git add`; the teardown
// removed the worktree and the work was unrecoverable, because nothing was ever staged.
//
// The branch arm has refused to delete work since it was written. This is the same guard for the
// other arm, and it fails closed: a `status` that cannot run keeps the worktree.
test("a worktree holding uncommitted work is kept, not forced away", () => {
  const [remove] = buildCleanupCommands({
    worktreePath: "C:/w/agent-278",
    dockerStarted: false,
    localBranch: null,
    merged: false,
  });
  assert.match(remove, /status --porcelain/, "removal does not look for uncommitted work first");
  assert.match(remove, /git worktree remove/);
  assert.ok(
    remove.indexOf("status --porcelain") < remove.indexOf("git worktree remove"),
    "the check has to run before the removal, not after it"
  );
});

// The floor: a clean worktree must still be removed, or every run leaks one.
test("a clean worktree is still removed", () => {
  const [remove] = buildCleanupCommands({
    worktreePath: "C:/w/agent-1",
    dockerStarted: false,
    localBranch: null,
    merged: true,
  });
  assert.match(remove, /git worktree remove [^;]*--force/);
});

describe("building the cleanup command list", () => {
  test("a merged run with no worktree and no docker needs no teardown beyond the status check", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/1-x", merged: true });
    assert.deepEqual(cmds, ["git status --short"]);
  });

  test("a run that started docker gets it removed by fixed name", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: true, localBranch: null, merged: true });
    assert.ok(cmds.includes("docker rm -f murlan-verify-pg"));
  });

  test("a run in a worktree gets it removed, once it is known to be clean", () => {
    const cmds = buildCleanupCommands({ worktreePath: ".worktrees/agent-1", dockerStarted: false, localBranch: null, merged: true });
    assert.ok(cmds.some((c) => c.includes("git worktree remove '.worktrees/agent-1' --force")));
    assert.ok(cmds.some((c) => c.includes("git -C '.worktrees/agent-1' status --porcelain")));
  });

  test("a Windows worktree path is converted and quoted before it reaches a command", () => {
    const cmds = buildCleanupCommands({
      worktreePath: "C:\\Users\\dev\\murlan-wt-42",
      dockerStarted: false,
      localBranch: null,
      merged: true,
      platform: "win32",
    });
    assert.ok(cmds.some((c) => c.includes("git worktree remove '/c/Users/dev/murlan-wt-42' --force")));
    assert.ok(
      !cmds.some((c) => c.includes("C:\\")),
      "a backslash path reaching a bash command is what created the murlan-wt-294;C directory"
    );
  });

  test("the administrative registration is pruned after the removal", () => {
    const cmds = buildCleanupCommands({ worktreePath: "../murlan-wt-42", dockerStarted: false, localBranch: null, merged: true });
    const remove = cmds.findIndex((c) => c.startsWith("git worktree remove"));
    const prune = cmds.indexOf("git worktree prune");
    assert.ok(prune !== -1, "expected git worktree prune");
    assert.ok(remove < prune, "prune has to follow the removal it is cleaning up after");
  });

  test("no worktree means no teardown commands for one", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: null, merged: true });
    assert.ok(!cmds.some((c) => c.includes("node_modules") || c.includes("git worktree")));
  });

  test("an abandoned (not merged) run guards the branch delete instead of issuing it bare", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/2-y", merged: false });
    const guard = cmds.find((c) => c.includes("git branch -D"));
    assert.ok(guard, "expected a branch-delete command");
    assert.ok(!cmds.includes("git branch -D agent/2-y"), "the delete must not be issued unconditionally");
    assert.match(guard, /rev-list --count origin\/main\.\.'agent\/2-y'/);
  });

  test("a merged run does not delete the local branch (gh pr merge --delete-branch already handled it)", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/3-z", merged: true });
    assert.ok(!cmds.some((c) => c.includes("git branch -D")));
  });

  test("a branch name is shell-quoted, so a metacharacter cannot reshape the command", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: "agent/7; rm -rf .", merged: false });
    const guard = cmds.find((c) => c.includes("git branch -D"))!;
    assert.match(guard, /'agent\/7; rm -rf \.'/);
  });

  test("git status --short is always last", () => {
    const cmds = buildCleanupCommands({ worktreePath: ".worktrees/a", dockerStarted: true, localBranch: "agent/4-w", merged: false });
    assert.equal(cmds[cmds.length - 1], "git status --short");
  });

  test("a run that started docker also removes the boot container, which --rm leaves behind on a run that died mid-poll", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: true, localBranch: null, merged: true });
    assert.ok(cmds.includes("docker rm -f murlan-verify-boot"));
  });

  // The floor: with nothing to free, the list must contain no kill at all. A port-freeing step
  // that emits a command unconditionally would pass every assertion below and still be wrong.
  test("no ports means no port-freeing command", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: null, merged: true });
    assert.deepEqual(cmds, ["git status --short"]);
    const withEmpty = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: null, merged: true, ports: [] });
    assert.deepEqual(withEmpty, ["git status --short"]);
  });

  test("each port gets a POSIX freeing command that tolerates the port being unbound", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: null, merged: true, ports: [5199, 5050], platform: "linux" });
    assert.ok(cmds.includes("lsof -ti tcp:5199 | xargs -r kill -9"));
    assert.ok(cmds.includes("lsof -ti tcp:5050 | xargs -r kill -9"));
  });

  test("on Windows the same ports get taskkill, since the distro's lsof is not on Git Bash's PATH", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: null, merged: true, ports: [5199], platform: "win32" });
    const kill = cmds.find((c) => c.includes("taskkill"))!;
    assert.ok(kill, "expected a taskkill command");
    assert.match(kill, /netstat -ano/);
    // Without this the MSYS layer rewrites /PID into a path and taskkill never sees the flag.
    assert.match(kill, /env MSYS_NO_PATHCONV=1 taskkill/);
    assert.ok(!cmds.some((c) => c.includes("lsof")));
  });

  test("anything that is not a TCP port number is dropped rather than escaped into the command", () => {
    const cmds = buildCleanupCommands({
      worktreePath: null,
      dockerStarted: false,
      localBranch: null,
      merged: true,
      ports: [0, 70000, 5199.5, "5199; rm -rf ~" as unknown as number, 5199],
      platform: "linux",
    });
    const kills = cmds.filter((c) => c.includes("kill"));
    assert.deepEqual(kills, ["lsof -ti tcp:5199 | xargs -r kill -9"]);
  });
});

// The guard is a shell string, so asserting its text proves nothing about what it does. These run
// it against a real repository — including the null case where the comparison cannot run at all,
// which is the direction a check like this fails silently in.
describe("running the branch-delete guard", () => {
  let repo: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cleanup-guard-"));
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    git("commit", "-q", "--allow-empty", "-m", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("branch", "no-work");
    git("branch", "holds-work");
    git("commit", "-q", "--allow-empty", "-m", "extra");
    git("branch", "-f", "holds-work", "HEAD");
    git("reset", "-q", "--hard", "HEAD~1");
  });

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  function git(...args: string[]) {
    return execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  }

  function runGuard(branch: string): string {
    const guard = buildCleanupCommands({
      worktreePath: null,
      dockerStarted: false,
      localBranch: branch,
      merged: false,
    }).find((c) => c.includes("git branch -D"))!;
    execFileSync("sh", ["-c", guard], { cwd: repo, encoding: "utf8" });
    return git("branch", "--list");
  }

  test("a branch holding commits origin/main does not have is kept", () => {
    const branches = runGuard("holds-work");
    assert.match(branches, /holds-work/);
  });

  test("a branch with nothing origin/main lacks is deleted", () => {
    const branches = runGuard("no-work");
    assert.ok(!/no-work/.test(branches), `expected no-work to be gone, got: ${branches}`);
  });

  test("a branch is kept when origin/main is missing, so a check that cannot run never deletes", () => {
    git("update-ref", "-d", "refs/remotes/origin/main");
    const branches = runGuard("no-work");
    assert.match(branches, /no-work/);
  });
});

// Asserting the text of a kill command proves nothing about whether it kills. These bind a real
// port in a real second process and check both directions: a bound port ends up free, and an
// unbound one is a no-op that still exits 0 — the case almost every run actually hits.
describe("running the POSIX port-freeing command", { skip: process.platform === "win32" }, () => {
  function commandFor(port: number): string {
    return buildCleanupCommands({
      worktreePath: null,
      dockerStarted: false,
      localBranch: null,
      merged: true,
      ports: [port],
      platform: "linux",
    }).find((c) => c.includes("lsof"))!;
  }

  function unusedPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as AddressInfo;
        server.close(() => resolve(port));
      });
    });
  }

  function isBound(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
  }

  async function waitUntil(condition: () => Promise<boolean>, what: string) {
    for (let i = 0; i < 50; i++) {
      if (await condition()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.fail(`timed out waiting for ${what}`);
  }

  test("an unbound port is a no-op that still exits 0", async () => {
    const port = await unusedPort();
    execFileSync("sh", ["-c", commandFor(port)], { encoding: "utf8" });
  });

  test("a bound port is freed and the process holding it is gone", async () => {
    const port = await unusedPort();
    const holder = spawn(
      process.execPath,
      ["-e", `require("net").createServer().listen(${port}, "127.0.0.1")`],
      { stdio: "ignore" },
    );
    try {
      await waitUntil(() => isBound(port), `the holder to bind ${port}`);
      execFileSync("sh", ["-c", commandFor(port)], { encoding: "utf8" });
      await waitUntil(async () => !(await isBound(port)), `${port} to be freed`);
    } finally {
      holder.kill("SIGKILL");
    }
  });
});
