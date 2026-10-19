// The run-level half of tests/helpers/filesRunReporter.mjs's stall guard, on its own thread: the
// reporter stamps a heartbeat on every event, and a runner whose loop is blocked stamps nothing.
import { readdirSync, readFileSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { hold } from "../../scripts/lib/proc.mjs";

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

/** pid → its file, when its exit began, and the process held by its start time. */
const exiting = new Map();

setInterval(() => {
  let names;
  try {
    names = readdirSync(exits.markers);
  } catch {
    return;
  }
  for (const name of names) {
    const marker = path.join(exits.markers, name);
    let seen;
    try {
      seen = JSON.parse(readFileSync(marker, "utf8"));
    } catch {
      continue;
    }
    rmSync(marker, { force: true });
    exiting.set(Number(name), { ...seen, proc: hold(Number(name)) });
  }
  for (const [pid, { file, at, proc }] of exiting) {
    if (!proc.running()) exiting.delete(pid);
    else if (Date.now() - at > exits.graceMs) {
      writeSync(2, `\n${file}: hung after its tests finished, killed ${exits.graceMs / 1000}s into its exit by tests/helpers/runWatch.mjs\n`);
      proc.endTree();
      exiting.delete(pid);
    }
  }
}, Math.min(250, exits.graceMs / 4));
