// tests/tooling/proc.test.ts — `scripts/lib/proc.mjs` kills the whole tree, and nothing else kills one.
//
// Windows' `child.kill()` takes the shell alone and leaves npm and everything below it running. The
// win32 path is driven through injected primitives over a modelled process table, since this suite
// runs on Linux; the POSIX path runs for real.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { killTree, sleepSync, spawnBin } from "../../scripts/lib/proc.mjs";
import { trackedFiles } from "../helpers/trackedFiles.ts";
import { windowsWorld } from "../helpers/windowsProcessWorld.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

describe("on win32", () => {
  test("a timeout leaves no descendant of the step alive", async () => {
    const world = windowsWorld();
    const run = await world.proc.spawnBin("npm", ["run", "test"], { timeoutMs: 10 });
    assert.equal(run.timedOut, true);
    assert.equal(run.status, null);
    assert.deepEqual(world.alive(), []);
  });

  test("killTree takes the tree, and a tree already gone is not an error", () => {
    const world = windowsWorld();
    const child = world.proc.startBin("npx", ["tsx", "index.ts"], {});
    world.proc.startBin("node", ["other.js"], {});
    assert.equal(world.alive().length, 8);
    world.proc.killTree(child.pid);
    assert.equal(world.alive().length, 4, "only the other tree survives");
    world.proc.killTree(child.pid);
  });

  test("npm and npx run as one quoted command line under a shell; anything else as file and args", () => {
    const world = windowsWorld();
    world.proc.startBin("npx", ["expo", "export", "--output-dir", "a b"], {});
    world.proc.startBin("node", ["a b"], {});
    const [shim, plain] = world.calls.map((c) => [c.file, c.args, c.opts.shell]);
    assert.deepEqual(shim, ['npx expo export --output-dir "a b"', [], true]);
    assert.deepEqual(plain, ["node", ["a b"], undefined]);
  });
});

// A killed process nobody reaped is a zombie, which `kill(pid, 0)` still finds; a container's PID 1
// may reap nothing.
function running(pid: number): boolean {
  if (process.platform === "win32") {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  try {
    return !execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" }).trim().startsWith("Z");
  } catch {
    return false;
  }
}

describe("on this platform, for real", () => {
  // The step's grandchild is what a child-only kill leaves behind.
  test("a timeout kills the grandchild too", async () => {
    const grandchild = `require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" }).pid`;
    const script = `console.log(${grandchild}); setTimeout(() => {}, 60000);`;
    const run = await spawnBin(process.execPath, ["-e", script], { timeoutMs: 1500 });
    assert.equal(run.timedOut, true);
    const pid = Number(run.stdout.trim());
    assert.ok(pid > 0, `the grandchild reported its pid: ${run.stdout}`);
    let alive = running(pid);
    for (let i = 0; i < 50 && alive; i++) {
      sleepSync(20);
      alive = running(pid);
    }
    if (alive) killTree(pid);
    assert.equal(alive, false, "the grandchild outlived the timeout");
  });

  test("a step that finishes reports its status and output", async () => {
    const run = await spawnBin(process.execPath, ["-e", "console.log('hi'); process.exit(3)"], {});
    assert.deepEqual(run, { status: 3, timedOut: false, stdout: "hi\n", stderr: "" });
  });
});

describe("proc.mjs is the only owner", () => {
  // A shell option is `true`, the platform test, or a variable; a style key named `shell` is none. A
  // command line naming taskkill needs that shell, so the bare binary name is the other half.
  const SHELL = /\bshell\s*:\s*(?:true\b|process\.platform\b|[A-Za-z_$][\w$]*\s*[,}])/;
  const TASKKILL = /["'`]taskkill(?:\.exe)?["'`]/i;
  const OWNER = "scripts/lib/proc.mjs";
  const tracked = trackedFiles(ROOT, "*.js", "*.mjs", "*.cjs", "*.ts", "*.tsx");

  test("no other file spawns taskkill or passes a shell", () => {
    assert.ok(tracked.includes(OWNER), "the scan reads the owner's own path");
    const offenders = tracked.filter((file) => {
      if (file === OWNER) return false;
      const source = readFileSync(path.join(ROOT, file), "utf8");
      return TASKKILL.test(source) || SHELL.test(source);
    });
    assert.deepEqual(offenders, []);
  });

  test("the scan sees what it scans for", () => {
    const owner = readFileSync(path.join(ROOT, OWNER), "utf8");
    assert.match(owner, TASKKILL);
    assert.match(owner, SHELL);
  });

  test("tools/loop/cli.mjs does not import it", () => {
    assert.doesNotMatch(readFileSync(path.join(ROOT, "tools", "loop", "cli.mjs"), "utf8"), /proc\.mjs/);
  });
});
