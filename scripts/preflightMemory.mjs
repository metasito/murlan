/**
 * Refuses to start a suite that the machine does not have the memory to run.
 *
 * Starvation and a regression are indistinguishable by their symptoms — an exhausted box gives
 * failing suites and specs failing at 0ms with ERR_CONNECTION_REFUSED, and a reader goes looking
 * for a defect that is not there. So the run names exhaustion itself rather than letting it
 * arrive disguised. `docs/agents/loops.md` carries the recognition table.
 *
 * The `globalSetup` of both jest and Playwright, which is every entry point that can exhaust the
 * box. Jest reads this from the root config rather than per-project: `runGlobalHook` adds
 * `globalConfig.globalSetup` to the per-project ones, so `projects` does not shadow it.
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

const gb = (bytes) => (bytes / GB).toFixed(2);

export function memoryVerdict({ freeBytes, totalBytes }) {
  const floor = memoryFloor(totalBytes);
  if (freeBytes >= floor) return { ok: true, message: "" };
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

/**
 * How long to let the box settle before ruling against it. A suite tearing down releases its
 * workers in one burst — the other session's hold about 2.6 GB — and a reading landing inside
 * that burst refused a run that the identical command completed a second later.
 */
const SETTLE_MS = 1000;

export default async function preflightMemory({
  sample = os.freemem,
  totalBytes = os.totalmem(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  env = process.env,
} = {}) {
  // CI runners are sized for one job and start near their floor by design; the collision this
  // guards against is two local sessions sharing one developer machine. Injectable because the
  // suite that covers this function runs *on* CI, where reading process.env directly makes every
  // case below return before it samples anything and pass for the wrong reason.
  if (env.CI) return;

  const readings = [sample()];
  if (memoryVerdict({ freeBytes: readings[0], totalBytes }).ok) return;

  await wait(SETTLE_MS);
  readings.push(sample());

  // The later reading, never the better of the two: taking the best would rule on the stale
  // number in the one case that matters, a box that got worse while we waited.
  const verdict = memoryVerdict({ freeBytes: readings[readings.length - 1], totalBytes });
  if (verdict.ok) return;
  // A refusal that leaves nothing behind cannot be told from a transient dip afterwards, and
  // the readings are what a reader would otherwise reconstruct from a second clock.
  throw new Error(
    `${verdict.message}\n\nRead ${readings.map(gb).join(" GB, then ")} GB, ${SETTLE_MS} ms apart.`
  );
}
