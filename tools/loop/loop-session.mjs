/**
 * The one place a `claude` session is spawned: its stream goes to the log sink and through
 * `reduceSession`, and the watchdog kills one that goes silent. What the state means is the
 * caller's, through `onState`.
 */
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { STALL_MS, sleepClock } from "./limits.mjs";
import { closePhase, reduceSession, sessionStart } from "./loop-stream.mjs";

/**
 * @param {string[]} argv
 * @param {{spawnFn?: Function, env?: object, log: string, at?: string|null, planned: string,
 *   onState?: (state: object, effects: object[]) => void, onStderr?: (chunk: string) => void,
 *   stallMs?: number, tick?: number, killGraceMs?: number}} opts
 */
export function runSession(
  argv,
  {
    spawnFn = spawn,
    env = process.env,
    log,
    at = null,
    planned,
    onState = () => {},
    onStderr = () => {},
    stallMs = STALL_MS,
    tick = 30_000,
    killGraceMs = 10_000,
  },
) {
  mkdirSync(path.dirname(log), { recursive: true });
  const sink = createWriteStream(log, { flags: "a" });
  const startedAt = Date.now();
  let state = sessionStart(at, startedAt);
  let heardAt = startedAt;
  let asleepMs = 0;
  let stalled = false;
  let stderr = "";

  const child = spawnFn("claude", argv, { stdio: ["ignore", "pipe", "pipe"], env });

  // Mirrored, not swallowed: a crash must still print itself.
  child.stderr?.on("data", (chunk) => {
    stderr += chunk;
    onStderr(String(chunk));
  });

  createInterface({ input: child.stdout }).on("line", (line) => {
    sink.write(`${line}\n`);
    heardAt = Date.now();
    const next = reduceSession(state, line, { now: heardAt, at, planned });
    state = next.state;
    if (next.effects.some((e) => e.kind === "kill")) {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), killGraceMs).unref();
    }
    onState(state, next.effects);
  });

  return new Promise((resolve) => {
    // SIGTERM, not SIGINT: the docs give SIGTERM as the one that terminates the process tree of a
    // still-running Bash command and then runs SessionEnd, which is what a wedged session needs.
    // SIGINT only ends the turn, and a session with nothing to end ignores it.
    const clock = sleepClock(tick);
    const watchdog = setInterval(() => {
      const slept = clock.lap();
      const now = Date.now();
      asleepMs += slept;
      heardAt = Math.min(now, heardAt + slept);
      if (now - heardAt <= stallMs) return;
      stalled = true;
      clearInterval(watchdog);
      // Windows' SIGTERM takes `claude.exe` alone, and a grandchild left holding its stdout keeps
      // `close` from ever firing. So the tree, then a deadline.
      if (process.platform === "win32" && child.pid) {
        try {
          execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {
          /* already gone */
        }
      } else child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null);
      }, killGraceMs).unref();
    }, tick);
    watchdog.unref();

    let finished = false;
    child.on("close", (status) => finish(status));
    function finish(status) {
      if (finished) return;
      finished = true;
      clearInterval(watchdog);
      // The session emits no marker for a phase it did not finish.
      state = closePhase(state, Date.now());
      // Resolved on the sink's own finish, not on the child's close: `end()` only asks, and a
      // caller reading the log it was just handed would otherwise find it short.
      sink.end(() =>
        resolve({
          status: stalled ? "stalled" : (status ?? 1),
          state,
          stderr,
          started: new Date(startedAt).toISOString(),
          ms: Date.now() - startedAt,
          asleepMs,
        }),
      );
    }
  });
}
