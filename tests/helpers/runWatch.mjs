// The run-level half of tests/helpers/filesRunReporter.mjs's stall guard, on its own thread: the
// reporter stamps a heartbeat on every event, and a runner whose loop is blocked stamps nothing.
import { readdirSync, readFileSync, rmSync, writeSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { endTreeIfSame, processStarts } from "../../scripts/lib/proc.mjs";
import { exitGuard } from "./exitGuard.mjs";

const { heartbeat, idleMs, exits } = workerData;
let inFlight = [];
parentPort.on("message", (files) => (inFlight = files));

/** Linux only: on win32 libuv's kill-on-close job reaps the children; macOS has neither. */
function killChildren() {
  try {
    for (const tid of readdirSync("/proc/self/task")) {
      for (const pid of readFileSync(`/proc/self/task/${tid}/children`, "utf8").split(" ").filter(Boolean)) {
        process.kill(Number(pid), "SIGKILL");
      }
    }
  } catch {
    // No /proc: nothing more this process can reach.
  }
}

setInterval(() => {
  if (Date.now() - Number(Atomics.load(heartbeat, 0)) <= idleMs) return;
  writeSync(2, `\nnpm test: nothing reported for ${idleMs / 1000}s; still running: ${inFlight.join(", ") || "no file; the runner itself"}\n`);
  killChildren();
  rmSync(exits.markers, { recursive: true, force: true });
  process.kill(process.pid, "SIGKILL");
}, Math.min(1000, idleMs / 4));

if (exits.graceMs !== undefined) {
  const tick = exitGuard({ ...exits, proc: { processStarts, endTreeIfSame }, write: (line) => writeSync(2, `\n${line}\n`) });
  setInterval(tick, Math.min(250, exits.graceMs / 4));
}
