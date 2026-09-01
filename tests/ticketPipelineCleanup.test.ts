// tests/ticketPipelineCleanup.test.ts
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { connect, createServer, type AddressInfo } from "node:net";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { buildCleanupCommands } from "../lib/ticketPipeline/cleanup.ts";

/**
 * The shell the cleanup commands are written in.
 *
 * Found through git rather than through PATH. PATH carries `sh` under Git Bash
 * and on CI, and not in a PowerShell session — which is where every agent on
 * this project actually runs `agent:check`, so the six cases that exercise a
 * real command spent their lives erroring with `spawnSync sh ENOENT` on the one
 * machine that runs them outside CI. A checkout cannot exist without git, and
 * Git for Windows ships the shell beside it, so finding nothing is a broken
 * install rather than a platform these cases do not apply to.
 */
function posixShell(): string {
  if (process.platform !== "win32") return "sh";
  const gitCore = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
  let dir = gitCore;
  for (let up = 0; up < 5 && dir !== dirname(dir); up++, dir = dirname(dir)) {
    const shell = join(dir, "bin", "sh.exe");
    if (existsSync(shell)) return shell;
  }
  throw new Error(
    `no sh.exe beside git (searched up from ${gitCore}); the cleanup commands are POSIX shell ` +
      `and cannot run without one`
  );
}

const SHELL = posixShell();

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

  test("each port is freed through the one tool that knows what holds a port", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: null, merged: true, ports: [5199, 5050] });
    assert.ok(cmds.includes("E2E_PORT=5199 node scripts/reap.mjs --port"));
    assert.ok(cmds.includes("E2E_PORT=5050 node scripts/reap.mjs --port"));
  });

  /**
   * `lsof -ti tcp:PORT` and a netstat line grep both match a client *connected to* the port as
   * readily as the server listening on it, so either kills whoever was talking to the server.
   * Neither may come back, on either platform.
   */
  test("no command matches a port by anything but what is listening on it", () => {
    const cmds = buildCleanupCommands({ worktreePath: null, dockerStarted: false, localBranch: null, merged: true, ports: [5199] });
    for (const pattern of [/lsof -ti/, /netstat -ano \| grep/, /taskkill/]) {
      assert.ok(
        !cmds.some((c) => pattern.test(c)),
        `${pattern} decides what to kill without asking whether it is listening`
      );
    }
  });

  test("anything that is not a TCP port number is dropped rather than escaped into the command", () => {
    const cmds = buildCleanupCommands({
      worktreePath: null,
      dockerStarted: false,
      localBranch: null,
      merged: true,
      ports: [0, 70000, 5199.5, "5199; rm -rf ~" as unknown as number, 5199],
    });
    const frees = cmds.filter((c) => c.includes("reap.mjs"));
    assert.deepEqual(frees, ["E2E_PORT=5199 node scripts/reap.mjs --port"]);
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
    execFileSync(SHELL, ["-c", guard], { cwd: repo, encoding: "utf8" });
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
describe("running the port-freeing command", () => {
  const repoRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

  function commandFor(port: number): string {
    return buildCleanupCommands({
      worktreePath: null,
      dockerStarted: false,
      localBranch: null,
      merged: true,
      ports: [port],
    }).find((c) => c.includes("reap.mjs"))!;
  }

  function runCommandFor(port: number): void {
    execFileSync(SHELL, ["-c", commandFor(port)], { encoding: "utf8", cwd: repoRoot });
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
    runCommandFor(port);
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
      runCommandFor(port);
      await waitUntil(async () => !(await isBound(port)), `${port} to be freed`);
    } finally {
      holder.kill("SIGKILL");
    }
  });

  /**
   * The port names two processes: the one listening on it and everyone talking to it. A client's
   * socket carries the port just as visibly, so a command that matches the number rather than the
   * listening state takes the wrong one — and on the e2e port that is the suite itself.
   */
  test("a process merely connected to the port is left alone", async () => {
    const port = await unusedPort();
    const holder = spawn(
      process.execPath,
      ["-e", `require("net").createServer().listen(${port}, "127.0.0.1")`],
      { stdio: "ignore" },
    );
    const client = spawn(
      process.execPath,
      [
        "-e",
        // Outlives the server on purpose: the socket dying is what the server being reaped
          // looks like from here, and exiting on it would read as this process having been killed.
          `setInterval(() => {}, 1000);` +
          `const s = require("net").connect(${port}, "127.0.0.1");` +
          `s.on("error", () => {});`,
      ],
      { stdio: "ignore" },
    );
    try {
      await waitUntil(() => isBound(port), `the holder to bind ${port}`);
      await new Promise((r) => setTimeout(r, 500));
      runCommandFor(port);
      await waitUntil(async () => !(await isBound(port)), `${port} to be freed`);
      assert.equal(
        client.exitCode,
        null,
        "the client connected to the port was killed along with the server on it"
      );
    } finally {
      holder.kill("SIGKILL");
      client.kill("SIGKILL");
    }
  });
});

// Spawning a shell by bare name resolves against PATH, which carries `sh` under
// bash and on CI and not under PowerShell — so the case runs everywhere it is
// watched and nowhere it is read.
test("no test spawns a shell by bare name", () => {
  const dir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  const bare = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .flatMap((f) => {
      const source = readFileSync(join(dir, f), "utf8");
      return [
        ...source.matchAll(/(?:execFileSync|execFile|spawnSync|spawn)\(\s*"(sh|bash|cmd|powershell)"/g),
      ].map((m) => `${f.split(sep).join("/")} — ${m[1]}`);
    });
  assert.deepEqual(
    bare,
    [],
    "resolve the shell instead (posixShell() here), so the case fails on a missing shell rather " +
      "than on the platform it is being read on"
  );
});
