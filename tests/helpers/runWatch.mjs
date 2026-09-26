// The run-level half of tests/helpers/filesRunReporter.mjs's stall guard, on its own thread: the
// reporter stamps a heartbeat on every event, and a runner whose loop is blocked stamps nothing.
import { readdirSync, readFileSync, writeSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";

const { heartbeat, idleMs } = workerData;
let inFlight = [];
parentPort.on("message", (files) => (inFlight = files));

/** Linux only: elsewhere the runner's own cleanup reaps what this leaves. */
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
  process.kill(process.pid, "SIGKILL");
}, Math.min(1000, idleMs / 4));
