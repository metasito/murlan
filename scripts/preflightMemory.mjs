/**
 * Refuses to start a suite that the machine does not have the memory to run.
 *
 * Starvation and a regression have the same symptoms. The same tree at the same commit gave two
 * failed jest suites under default workers and 723 passing tests under three, and an exhausted box
 * gave 37 browser specs failing at 0ms with ERR_CONNECTION_REFUSED. Someone reads that as a defect
 * and goes looking for one that is not there, so the run has to name exhaustion itself.
 *
 * Wired in as the `globalSetup` of both jest and Playwright, which is every entry point that can
 * exhaust the box.
 */
import os from "node:os";

const GB = 1024 ** 3;
const WANTED = 1.5 * GB;

/**
 * A fixed floor is a trigger with no floor of its own: on a small machine every run sits under it
 * and the check becomes the thing everyone switches off. A tenth of the box is the ceiling on how
 * demanding this is allowed to be.
 */
export function memoryFloor(totalBytes) {
  return Math.min(WANTED, totalBytes * 0.1);
}

export function memoryVerdict({ freeBytes, totalBytes }) {
  const floor = memoryFloor(totalBytes);
  if (freeBytes >= floor) return { ok: true, message: "" };
  const gb = (bytes) => (bytes / GB).toFixed(2);
  return {
    ok: false,
    message:
      `Not enough free memory to run this suite: ${gb(freeBytes)} GB free of ${gb(totalBytes)} GB, ` +
      `and it needs ${gb(floor)} GB.\n\n` +
      `This is exhaustion, not a regression. Left to run, it surfaces as failing suites or as specs ` +
      `failing at 0ms with ERR_CONNECTION_REFUSED, and reads exactly like a defect.\n\n` +
      `Close the other suite, or run \`npm run reap\` to clear processes that outlived their session.`,
  };
}

export default async function preflightMemory() {
  // CI runners are sized for one job and start near their floor by design; the collision this
  // guards against is two local sessions sharing one developer machine.
  if (process.env.CI) return;
  const verdict = memoryVerdict({ freeBytes: os.freemem(), totalBytes: os.totalmem() });
  if (!verdict.ok) throw new Error(verdict.message);
}
