/**
 * Spawning a bin, relaying signals to it, and ending its tree: the only file that runs a shell or
 * `taskkill` (`tests/tooling/proc.test.ts` scans for both). Only `node:` imports;
 * `tools/loop/cli.mjs` stays independent of it.
 */
import * as childProcess from "node:child_process";
import os from "node:os";

// `npm` and `npx` are `.cmd` shims on Windows, and since the fix for CVE-2024-27980 node will not run
// one without a shell. Reached only with argument lists this repo writes, never with tracker text.
const SHIMMED = new Set(["npm", "npx"]);
const CMD_META = /[()\][%!^"`<>&|;, *?]/g;

/** The old `maxBuffer`: past it the step fails, not the process holding its output. */
export const MAX_OUTPUT = 256 * 1024 * 1024;

/**
 * One argument as cmd.exe must see it. CommandLineToArgvW's quoting inside, then cmd's metacharacters
 * caret-escaped twice: once for node's `cmd /d /s /c`, once more because the shim re-reads `%*`.
 */
export function cmdArg(arg) {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return quoted.replace(CMD_META, "^$&").replace(CMD_META, "^$&");
}

const gone = (err) => err?.code === "ESRCH";

/** The helpers over injected platform and process primitives; the module's exports are its defaults. */
export function procFor({
  platform = process.platform,
  spawn = childProcess.spawn,
  execFileSync = childProcess.execFileSync,
  kill = (pid, signal) => process.kill(pid, signal),
  selfPid = process.pid,
} = {}) {
  const win = platform === "win32";

  // A command line under `shell`, not a file plus arguments: node joins them anyway, and passing
  // both is DEP0190.
  const invocation = (file, args) =>
    win && SHIMMED.has(file) ? [[file, ...args.map(cmdArg)].join(" "), [], { shell: true }] : [file, args, {}];

  function runBin(file, args, opts = {}) {
    const [f, a, extra] = invocation(file, args);
    return execFileSync(f, a, { ...opts, ...extra });
  }

  /** Long-running, as `spawn` returns it; the caller ends it with `stopTree` or `killTree`. */
  function startBin(file, args, opts = {}) {
    const [f, a, extra] = invocation(file, args);
    return spawn(f, a, { ...opts, ...extra });
  }

  function signal(pid, sig) {
    try {
      kill(pid, sig);
      return true;
    } catch (err) {
      if (gone(err)) return false;
      throw err;
    }
  }

  /** pid → { ppid, started }. A table that cannot be read throws: an empty one would kill nothing and report success. */
  function readTable() {
    let out;
    try {
      out = execFileSync("ps", ["-A", "-o", "pid=,ppid=,lstart="], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      throw new Error(`cannot read the process table, so no tree can be ended: ${err.message}`);
    }
    const rows = new Map();
    for (const line of String(out).split("\n")) {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (m) rows.set(Number(m[1]), { ppid: Number(m[2]), started: m[3] });
    }
    if (!rows.has(selfPid)) throw new Error("the process table does not list this process, so it describes no tree");
    return rows;
  }

  /** Every live process below `roots`, each a pid with the start time that proves it is still the same one. */
  function treeOf(rows, roots) {
    const tree = new Map([...roots].filter(([pid, started]) => rows.get(pid)?.started === started));
    for (const cur of tree.keys()) {
      for (const [pid, row] of rows) if (row.ppid === cur && !tree.has(pid)) tree.set(pid, row.started);
    }
    return tree;
  }

  /**
   * Stop first, then kill: a running tree forks between one read of the table and the kills, and a
   * stopped one cannot. A pid whose start time changed was reused by a stranger and is let go.
   */
  function freezeAndKill(roots) {
    const stopped = new Map();
    for (;;) {
      const rows = readTable();
      for (const [pid, started] of stopped) {
        if (rows.has(pid) && rows.get(pid).started !== started) {
          signal(pid, "SIGCONT");
          stopped.delete(pid);
        }
      }
      const tree = treeOf(rows, new Map([...roots, ...stopped]));
      if (tree.has(selfPid)) throw new Error(`refusing to end pid ${[...roots.keys()][0]}: this process is inside its tree`);
      const fresh = [...tree].filter(([pid]) => !stopped.has(pid));
      if (!fresh.length) break;
      for (const [pid, started] of fresh) if (signal(pid, "SIGSTOP")) stopped.set(pid, started);
    }
    for (const pid of stopped.keys()) signal(pid, "SIGKILL");
  }

  function taskkill(pid, force) {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])], { stdio: "pipe" });
    } catch (err) {
      // 128: no such process. A polite close is refused by every console process, which is expected.
      if (err.status === 128 || !force) return;
      throw new Error(`taskkill /T /F of pid ${pid} failed: ${String(err.stderr ?? err.message).trim()}`);
    }
  }

  /** "Already gone" is success; anything that leaves the tree in doubt throws. */
  function killTree(pid) {
    if (!pid) return;
    if (win) return taskkill(pid, true);
    const started = readTable().get(pid)?.started;
    if (started !== undefined) freezeAndKill(new Map([[pid, started]]));
  }

  const alive = (pid) => {
    try {
      kill(pid, 0);
      return true;
    } catch (err) {
      return !gone(err);
    }
  };

  /**
   * Waits up to `ms` for `pid` to end; past that, calls `overdue` and kills `pid` alone, since a
   * watcher it started is inside its tree. True when it had to.
   */
  async function killOverdue(pid, ms, overdue) {
    const deadline = Date.now() + ms;
    while (alive(pid)) {
      if (Date.now() >= deadline) {
        overdue();
        if (win) taskkill(pid, true);
        else signal(pid, "SIGKILL");
        return true;
      }
      await new Promise((r) => setTimeout(r, Math.min(100, ms)));
    }
    return false;
  }

  /**
   * Asks the root to end (SIGTERM; on Windows a close to the whole tree, which keeps the root alive
   * for the forced `/T` when it is refused), waits up to `graceMs` for it, then kills whatever is
   * left of the tree it had. POSIX re-parents an exited root's children, so the tree is read first.
   */
  async function stopTree(pid, { graceMs }) {
    if (!pid) return;
    let tree;
    if (win) taskkill(pid, false);
    else {
      const rows = readTable();
      tree = treeOf(rows, new Map([[pid, rows.get(pid)?.started]]));
      if (tree.has(selfPid)) throw new Error(`refusing to end pid ${pid}: this process is inside its tree`);
      if (!tree.size || !signal(pid, "SIGTERM")) return;
    }
    const deadline = Date.now() + graceMs;
    while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, Math.min(50, graceMs)));
    if (win) killTree(pid);
    else freezeAndKill(tree);
  }

  /**
   * On `timeoutMs` it kills the tree; past `maxOutput` bytes it kills the tree and fails the step.
   * @param {string} file
   * @param {string[]} args
   * @param {import("node:child_process").SpawnOptions & { timeoutMs?: number, maxOutput?: number }} [opts]
   * @returns {Promise<{ status: number | null, signal: string | null, timedOut: boolean, stdout: string, stderr: string }>}
   */
  function spawnBin(file, args, { timeoutMs, maxOutput = MAX_OUTPUT, ...opts } = {}) {
    return new Promise((resolve) => {
      let child;
      try {
        child = startBin(file, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
      } catch (err) {
        resolve({ status: null, signal: null, timedOut: false, stdout: "", stderr: `${err.message}\n` });
        return;
      }
      const out = { stdout: "", stderr: "" };
      let bytes = 0;
      let timedOut = false;
      let overflowed = false;
      let exited = false;
      let done = false;
      const startedAt = Date.now();
      const cut = () => {
        child.stdout?.destroy();
        child.stderr?.destroy();
      };
      const end = () => {
        if (exited) return;
        try {
          killTree(child.pid);
        } catch (err) {
          out.stderr += `${err.message}\n`;
        }
      };
      const take = (key) => (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes <= maxOutput) out[key] += chunk;
        else if (!overflowed) {
          overflowed = true;
          end();
          cut();
        }
      };
      child.stdout?.setEncoding("utf8").on("data", take("stdout"));
      child.stderr?.setEncoding("utf8").on("data", take("stderr"));
      let timer =
        timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              timedOut = true;
              end();
              cut();
            }, timeoutMs);
      child.on("exit", () => {
        exited = true;
        clearTimeout(timer);
        // A survivor still holding a pipe would keep `close` from ever firing; its pid is not ours to kill.
        if (timeoutMs !== undefined) timer = setTimeout(cut, Math.max(0, startedAt + timeoutMs - Date.now()));
      });
      const finish = (status, sig) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const stderr = overflowed ? `${out.stderr}output passed ${maxOutput} bytes; the step was ended\n` : out.stderr;
        resolve({ status: timedOut || overflowed ? null : status, signal: sig ?? null, timedOut, stdout: out.stdout, stderr });
      };
      child.on("error", (err) => {
        out.stderr += `${err.message}\n`;
        finish(null, null);
      });
      child.on("close", (status, sig) => finish(status, sig));
    });
  }

  /**
   * Runs a bin in this process's place: its exit is this process's exit, 128 + the signal's number
   * for a death by signal. SIGTERM and SIGHUP are passed on; SIGINT is not, since Ctrl-C already
   * reached the whole foreground group and a second one would be read as a second press.
   */
  function relay(file, args, { exit = (code) => process.exit(code), on = process } = {}) {
    const child = startBin(file, args, { stdio: "inherit" });
    const listeners = ["SIGINT", "SIGTERM", "SIGHUP"].map((sig) => {
      const pass = () => {
        if (sig === "SIGINT") return;
        if (win) killTree(child.pid);
        else child.kill(sig);
      };
      on.on(sig, pass);
      return [sig, pass];
    });
    const leave = (code) => {
      for (const [sig, pass] of listeners) on.off(sig, pass);
      exit(code);
    };
    child.on("error", (err) => {
      process.stderr.write(`${err.message}\n`);
      leave(1);
    });
    child.on("exit", (code, sig) => leave(sig ? 128 + (os.constants.signals[sig] ?? 0) : (code ?? 1)));
    return child;
  }

  return { runBin, startBin, spawnBin, killTree, killOverdue, stopTree, relay };
}

export const { runBin, startBin, spawnBin, killTree, killOverdue, stopTree, relay } = procFor();

export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
