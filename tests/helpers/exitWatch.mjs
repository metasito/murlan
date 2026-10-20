// The exit guard's own thread: a kill reads the process table, which can stall, and the idle
// watchdog in tests/helpers/runWatch.mjs must never wait on that.
import { writeSync } from "node:fs";
import { workerData } from "node:worker_threads";
import { alive, endTreeIf, identityOf } from "../../scripts/lib/proc.mjs";
import { EXIT_TICK_MS, exitGuard } from "./exitGuard.mjs";

const { stop, ...exits } = workerData;
const stopped = () => Atomics.load(stop, 0) === 1;
const write = (line) => {
  if (!stopped()) writeSync(2, `\n${line}\n`);
};
const tick = exitGuard({ ...exits, platform: process.platform, proc: { identityOf, endTreeIf, alive }, write });
setInterval(() => {
  if (!stopped()) tick();
}, EXIT_TICK_MS);
