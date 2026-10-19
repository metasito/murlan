/**
 * Spawning a bin and killing its tree: the only file that passes `shell` or runs `taskkill`
 * (`tests/tooling/proc.test.ts` scans for both). Only `node:` imports; `tools/loop/cli.mjs` stays
 * independent of it.
 */
import * as childProcess from "node:child_process";

// `npm` and `npx` are `.cmd` shims on Windows, and since the fix for CVE-2024-27980 node will not run
// one without a shell. Reached only with argument lists this repo writes, never with tracker text.
const SHIMMED = new Set(["npm", "npx"]);
const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

/** The helpers over injected platform and process primitives; the module's exports are its defaults. */
export function procFor({
  platform = process.platform,
  spawn = childProcess.spawn,
  execFileSync = childProcess.execFileSync,
  kill = (pid, signal) => process.kill(pid, signal),
} = {}) {
  const win = platform === "win32";

  // A command line under `shell`, not a file plus arguments: node joins them anyway, and passing
  // both is DEP0190.
  const invocation = (file, args) =>
    win && SHIMMED.has(file) ? [[file, ...args.map(quote)].join(" "), [], { shell: true }] : [file, args, {}];

  function runBin(file, args, opts = {}) {
    const [f, a, extra] = invocation(file, args);
    return execFileSync(f, a, { ...opts, ...extra });
  }

  /** Long-running, as `spawn` returns it; the caller ends it with `killTree(child.pid)`. */
  function startBin(file, args, opts = {}) {
    const [f, a, extra] = invocation(file, args);
    return spawn(f, a, { ...opts, ...extra });
  }

  function descendants(pid) {
    let table;
    try {
      table = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return [];
    }
    const children = new Map();
    for (const line of String(table).split("\n")) {
      const [p, pp] = line.trim().split(/\s+/).map(Number);
      if (!p) continue;
      if (!children.has(pp)) children.set(pp, []);
      children.get(pp).push(p);
    }
    const seen = [pid];
    for (const cur of seen) for (const kid of children.get(cur) ?? []) if (!seen.includes(kid)) seen.push(kid);
    return seen.slice(1);
  }

  /** Never throws; "already gone" is success. */
  function killTree(pid) {
    if (!pid) return;
    if (win) {
      try {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        /* already gone */
      }
      return;
    }
    // Not a process-group kill: that needs `detached`, which takes the child out of the terminal's
    // group, so Ctrl-C and Playwright's own group kill would no longer reach it. The table is read
    // before the first kill because an orphan is re-parented and no longer findable under `pid`.
    for (const p of [pid, ...descendants(pid)]) {
      try {
        kill(p, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }

  /** On `timeoutMs` it kills the tree, then resolves `{ status: null, timedOut: true }`. */
  function spawnBin(file, args, { timeoutMs, ...opts } = {}) {
    return new Promise((resolve) => {
      const child = startBin(file, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let done = false;
      child.stdout?.setEncoding("utf8").on("data", (d) => (stdout += d));
      child.stderr?.setEncoding("utf8").on("data", (d) => (stderr += d));
      const timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              killTree(child.pid);
              // A survivor holding a pipe would otherwise keep `close` from ever firing.
              child.stdout?.destroy();
              child.stderr?.destroy();
            }, timeoutMs);
      const finish = (status) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ status: timedOut ? null : status, timedOut, stdout, stderr });
      };
      child.on("error", (err) => {
        stderr += `${err.message}\n`;
        finish(null);
      });
      child.on("close", (code) => finish(code));
    });
  }

  return { runBin, startBin, spawnBin, killTree };
}

export const { runBin, startBin, spawnBin, killTree } = procFor();

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
