// tests/tooling/proc.test.ts — `scripts/lib/proc.mjs` ends the whole tree, and nothing else spawns a
// shell or a kill.
//
// Windows' TerminateProcess takes one pid and leaves npm and everything below it running, and a race
// between a fork and a kill cannot be staged on demand; both run against modelled process tables
// (tests/helpers/processWorlds.ts). What a real POSIX process can show runs for real.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cmdArg, killTree, sleepSync, spawnBin } from "../../scripts/lib/proc.mjs";
import { blankComments, blankCommentsAndStrings } from "../helpers/sourceScan.ts";
import { trackedFiles } from "../helpers/trackedFiles.ts";
import { posixWorld, windowsWorld } from "../helpers/processWorlds.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

describe("on win32", () => {
  test("the model is honest: TerminateProcess of the root leaves its descendants running", () => {
    const world = windowsWorld();
    const child = world.proc.startBin("node", ["a.js"], {});
    child.kill();
    assert.equal(world.alive().length, 3);
  });

  test("the model is honest: a .cmd shim will not start without a shell", () => {
    const world = windowsWorld();
    assert.throws(() => world.spawn("npm", ["test"], {}), { code: "EINVAL" });
  });

  test("a timeout leaves no descendant of the step alive", async () => {
    const world = windowsWorld();
    const run = await world.proc.spawnBin("npm", ["run", "test"], { timeoutMs: 10 });
    assert.equal(run.timedOut, true);
    assert.equal(run.status, null);
    assert.deepEqual(world.alive(), []);
  });

  test("killTree takes the tree and no other, and a tree already gone is not an error", () => {
    const world = windowsWorld();
    const child = world.proc.startBin("npx", ["tsx", "index.ts"], {});
    world.proc.startBin("node", ["other.js"], {});
    world.proc.killTree(child.pid);
    assert.equal(world.alive().length, 4, "only the other tree survives");
    world.proc.killTree(child.pid);
  });

  test("stopTree asks the whole tree first, and forces it once the console refuses", async () => {
    const world = windowsWorld();
    const child = world.proc.startBin("node", ["claude.js"], {});
    await world.proc.stopTree(child.pid, { graceMs: 20 });
    assert.deepEqual(world.alive(), []);
    const asked = world.calls.filter((c) => c.args.includes("/T")).map((c) => c.args.includes("/F"));
    assert.deepEqual(asked, [false, true]);
  });
});

/** What cmd.exe and then the shim's `%*` do to a line: each strips one level of carets. */
const caretPass = (line: string) => line.replace(/\^(.)/g, "$1");

/** CommandLineToArgvW: backslashes are literal except before a quote, where they pair off. */
function argv(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      let n = 0;
      while (line[i] === "\\") {
        n++;
        i++;
      }
      if (line[i] === '"') {
        cur += "\\".repeat(Math.floor(n / 2));
        if (n % 2) cur += '"';
        else quoted = !quoted;
      } else {
        cur += "\\".repeat(n);
        i--;
      }
      started = true;
    } else if (c === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(c) && !quoted) {
      if (started) out.push(cur);
      cur = "";
      started = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

describe("a shim's command line", () => {
  const ARGS = ["assets\\R&D", 'say "hi"', "a b", "100%", "trailing\\", "^(x)|y<z>", "plain"];

  test("each argument reaches the bin as written, through cmd and the shim's %*", () => {
    const world = windowsWorld();
    world.proc.startBin("npx", ARGS, {});
    const line = String(world.calls[0].file);
    assert.deepEqual(argv(caretPass(caretPass(line))).slice(1), ARGS);
  });

  test("no metacharacter reaches cmd unescaped", () => {
    for (const arg of ARGS) assert.doesNotMatch(caretPass(cmdArg(arg)).replace(/\^./g, ""), /[&|<>()%"]/, arg);
  });
});

describe("on POSIX, modelled", () => {
  test("a tree forking while it is read is stopped, re-read and killed whole", () => {
    const world = posixWorld({ forks: 2 });
    const child = world.proc.startBin("node", ["a.js"], {});
    const before = world.below(child.pid!).length;
    world.proc.killTree(child.pid);
    assert.deepEqual(world.alive(), []);
    const killed = world.signals.filter(([, s]) => s === "SIGKILL").length;
    assert.ok(killed > before, `the forks after the first read were killed too (${killed} of ${before} at first)`);
  });

  test("an unreadable process table is an error, not an empty tree", () => {
    const world = posixWorld();
    const child = world.proc.startBin("node", ["a.js"], {});
    world.failPs();
    assert.throws(() => world.proc.killTree(child.pid), /process table/);
    assert.equal(world.alive().length, 3);
  });

  test("it refuses a tree that holds this process", () => {
    const world = posixWorld();
    assert.throws(() => world.proc.killTree(1), /inside its tree/);
    assert.deepEqual(world.stopped(), []);
  });

  test("stopTree sends SIGTERM first, and still ends the orphans of a root that obeyed", async () => {
    const world = posixWorld();
    const child = world.proc.startBin("node", ["a.js"], {});
    await world.proc.stopTree(child.pid, { graceMs: 20 });
    assert.deepEqual(world.signals[0], [child.pid, "SIGTERM"]);
    assert.deepEqual(world.alive(), []);
  });

  test("a stranger that took a pid between the read and the stop is resumed, not killed", () => {
    const world = posixWorld();
    const child = world.proc.startBin("node", ["a.js"], {});
    const grandchild = world.below(child.pid!)[2]!;
    world.afterRead(
      () => undefined,
      () => world.reuse(grandchild),
    );
    world.proc.killTree(child.pid);
    assert.deepEqual(world.alive(), [grandchild]);
    assert.deepEqual(world.stopped(), []);
  });

  test("a pid reused by a stranger during the grace is let go", async () => {
    const world = posixWorld({ ignoresTerm: true });
    const child = world.proc.startBin("node", ["a.js"], {});
    const grandchild = world.below(child.pid!)[2]!;
    const stopping = world.proc.stopTree(child.pid, { graceMs: 20 });
    world.reuse(grandchild);
    await stopping;
    assert.deepEqual(world.alive(), [grandchild]);
    assert.deepEqual(world.stopped(), []);
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

function settles(pid: number): boolean {
  for (let i = 0; i < 50 && running(pid); i++) sleepSync(20);
  return !running(pid);
}

const GRANDCHILD = `((c) => (c.unref(), c.pid))(require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: ["ignore", "inherit", "ignore"] }))`;

describe("on this platform, for real", () => {
  // The step's grandchild is what a child-only kill leaves behind.
  test("a timeout kills the grandchild too", async () => {
    const run = await spawnBin(process.execPath, ["-e", `console.log(${GRANDCHILD}); setTimeout(() => {}, 60000);`], { timeoutMs: 1500 });
    assert.equal(run.timedOut, true);
    const pid = Number(run.stdout.trim());
    assert.ok(pid > 0, `the grandchild reported its pid: ${run.stdout}`);
    const dead = settles(pid);
    if (!dead) killTree(pid);
    assert.ok(dead, "the grandchild outlived the timeout");
  });

  test("a step that exits in time is not timed out, though a grandchild still holds its pipe", async () => {
    const run = await spawnBin(process.execPath, ["-e", `console.log(${GRANDCHILD})`], { timeoutMs: 1500 });
    const pid = Number(run.stdout.trim());
    const left = running(pid);
    killTree(pid);
    assert.deepEqual([run.status, run.timedOut], [0, false]);
    assert.ok(left, "a finished step's leftovers are not the timeout's to kill");
  });

  test("a step that finishes reports its status and output", async () => {
    const run = await spawnBin(process.execPath, ["-e", "console.log('hi'); process.exit(3)"], {});
    assert.deepEqual(run, { status: 3, signal: null, timedOut: false, stdout: "hi\n", stderr: "" });
  });

  test("a step killed by a signal names it", { skip: process.platform === "win32" && "no POSIX signals" }, async () => {
    const run = await spawnBin(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], {});
    assert.deepEqual([run.status, run.signal], [null, "SIGTERM"]);
  });

  test("output past the bound fails the step and ends it", async () => {
    const run = await spawnBin(process.execPath, ["-e", "process.stdout.write('x'.repeat(5000)); setTimeout(() => {}, 60000)"], {
      maxOutput: 1000,
      timeoutMs: 20_000,
    });
    assert.deepEqual([run.status, run.timedOut], [null, false]);
    assert.ok(run.stdout.length <= 1000);
    assert.match(run.stderr, /output passed 1000 bytes/);
  });
});

describe("scripts/nodeTest.mjs relays on proc.mjs", { skip: process.platform === "win32" && "no POSIX signals" }, () => {
  const LAUNCHER = path.join(ROOT, "scripts", "nodeTest.mjs");

  test("a run that dies by SIGTERM exits non-zero", () => {
    const run = spawnSync(process.execPath, [LAUNCHER, "-e", "process.kill(process.pid, 'SIGTERM')"], { encoding: "utf8" });
    assert.equal(run.status, 143);
  });

  test("SIGTERM to the launcher reaches the run, and the launcher exits non-zero", async () => {
    const launcher = spawn(process.execPath, [LAUNCHER, "-e", "console.log('ready'); setTimeout(() => {}, 60000)"], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise((r) => launcher.stdout.once("data", r));
    launcher.kill("SIGTERM");
    const code = await new Promise((r) => launcher.on("exit", (c) => r(c)));
    assert.equal(code, 143);
  });
});

describe("proc.mjs is the only owner", () => {
  const OWNER = "scripts/lib/proc.mjs";
  // Each one runs a shell: `exec`/`execSync` always do; a `shell` option set to anything but false
  // (a style key holding an object is not one); a string that starts with taskkill. The code forms
  // are read with strings blanked, since other scans' fixtures quote them.
  const IN_CODE = [
    /\bexecSync\s*\(/,
    /\b(?:child_?[pP]rocess|cp)\.exec(?:Sync)?\s*\(/,
    /[{,]\s*shell\s*:(?!\s*(?:false\b|\{))/,
    /\{\s*(?:[\w$]+\s*,\s*)*shell\s*[,}]/,
  ];
  const WITH_STRINGS = [
    /\{[^}]*\bexec(?:Sync)?\b[^}]*\}\s*(?:from\s*|=\s*require\(\s*)["'](?:node:)?child_process["']/,
    /["'`]\s*taskkill\b/i,
  ];
  const offends = (source: string) => {
    const code = blankCommentsAndStrings(source);
    const withStrings = blankComments(source);
    return IN_CODE.some((re) => re.test(code)) || WITH_STRINGS.some((re) => re.test(withStrings));
  };
  const tracked = trackedFiles(ROOT, "*.js", "*.mjs", "*.cjs", "*.ts", "*.tsx");

  test("no other file runs a shell or taskkill", () => {
    assert.ok(tracked.includes(OWNER), "the scan reads the owner's own path");
    const offenders = tracked.filter((file) => file !== OWNER && offends(readFileSync(path.join(ROOT, file), "utf8")));
    assert.deepEqual(offenders, []);
  });

  // Assembled at run time, or this file would hold every plant and be its own offender.
  const plant = (s: string) => s.replaceAll("#", "");
  test("each form is caught where it is planted", () => {
    const plants = [
      'import { ex#ecSync } from "node:child_process"; ex#ecSync("git ls-files");',
      'import { ex#ec } from "child_process"; ex#ec("ls", cb);',
      'childProcess.ex#ec("ls");',
      'spawnSync("taskk#ill /PID 4 /T /F", { stdio: "ignore" });',
      'spawnSync("cmd", ["/c", "taskk#ill /PID 4"]);',
      'spawn("npx", [], { she#ll: "cmd.exe" });',
      "spawn(file, args, { she#ll });",
      'spawn(file, args, { cwd, she#ll: win && shim });',
      'execFileSync("taskk#ill", ["/PID", pid]);',
      "spawn(cmd, args, { she#ll: true });",
    ].map(plant);
    for (const source of plants) assert.ok(offends(source), source);
  });

  test("and what runs no shell is not caught", () => {
    const clean = [
      'const shell = { she#ll: { borderRadius: 4 } };',
      "spawn(file, args, { she#ll: false });",
      "// she#ll: true is what this line once said; a comment runs nothing",
      "const m = RE.ex#ec(line);",
      "assert.ok(args, `hook without args runs through a she#ll: ${command}`);",
    ].map(plant);
    for (const source of clean) assert.ok(!offends(source), source);
  });

  test("the owner holds what the scan looks for", () => {
    assert.ok(offends(readFileSync(path.join(ROOT, OWNER), "utf8")));
  });

  test("tools/loop/cli.mjs does not import it", () => {
    assert.doesNotMatch(readFileSync(path.join(ROOT, "tools", "loop", "cli.mjs"), "utf8"), /proc\.mjs/);
  });
});
