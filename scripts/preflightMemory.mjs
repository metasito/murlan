/**
 * Refuses to start a suite that the machine does not have the memory to run.
 *
 * Starvation and a regression are indistinguishable by their symptoms — an exhausted box gives
 * failing suites and specs failing at 0ms with ERR_CONNECTION_REFUSED, and a reader goes looking
 * for a defect that is not there. So the run names exhaustion itself rather than letting it
 * arrive disguised. `docs/agents/loops.md` carries the recognition table.
 *
 * The `globalSetup` of both jest and Playwright, and — run as a script — the `pretest` of the node
 * suite, which is every entry point that can exhaust the box. Jest reads this from the root config
 * rather than per-project: `runGlobalHook` adds `globalConfig.globalSetup` to the per-project ones,
 * so `projects` does not shadow it. `node --test` has no such hook at all, which is why the third
 * one is an npm lifecycle script rather than a fourth call site.
 */
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
 * How long to let the box settle between readings. A suite tearing down releases its workers in
 * one burst — the other session's hold about 2.6 GB — and a reading landing inside that burst
 * refused a run that the identical command completed a second later.
 */
const SETTLE_MS = 1000;

/**
 * How long to keep waiting for the box before ruling against it.
 *
 * Two sessions share this machine and the second has no way to know when the first will finish, so
 * a refusal makes it ask a human or guess. Waiting on the thing that actually gates the run is the
 * direct answer — but a wait with no bound is a hang, and a suite that looks hung is worse than one
 * that says why it will not start. A minute is longer than a jest teardown and shorter than a
 * reader's patience.
 */
const WAIT_CEILING_MS = 60_000;

export default async function preflightMemory({
  sample = os.freemem,
  totalBytes = os.totalmem(),
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  env = process.env,
  // Waiting is the default because the sessions this exists for are agents, and a flag you have to
  // remember is a flag nobody passes.
  ceilingMs = WAIT_CEILING_MS,
  announce = (msg) => console.error(msg),
} = {}) {
  // CI runners are sized for one job and start near their floor by design; the collision this
  // guards against is two local sessions sharing one developer machine. Injectable because the
  // suite that covers this function runs *on* CI, where reading process.env directly makes every
  // case below return before it samples anything and pass for the wrong reason.
  if (env.CI) return;

  const readings = [sample()];
  if (memoryVerdict({ freeBytes: readings[0], totalBytes }).ok) return;

  // Once, and only when there is actually a wait: a silent pause is indistinguishable from a hang,
  // which is the thing this is trying not to look like. A single settle is not worth announcing.
  if (ceilingMs > SETTLE_MS) {
    announce(
      `Waiting up to ${Math.round(ceilingMs / 1000)}s for memory: ` +
        `${gb(readings[0])} GB free, ${gb(memoryFloor(totalBytes))} GB needed.`
    );
  }

  for (let waited = 0; waited < ceilingMs; waited += SETTLE_MS) {
    await wait(SETTLE_MS);
    readings.push(sample());
    // The latest reading, never the best one seen: taking the best would rule on a stale number in
    // the one case that matters, a box that got worse while we waited.
    if (memoryVerdict({ freeBytes: readings[readings.length - 1], totalBytes }).ok) return;
  }

  // The ceiling is reached, so this is the same refusal it has always been. Deliberately not a
  // "waited too long" of its own: the reason the run cannot start is still the memory, and a second
  // error would be a second thing to recognise.
  const verdict = memoryVerdict({ freeBytes: readings[readings.length - 1], totalBytes });
  if (verdict.ok) return;
  // A refusal that leaves nothing behind cannot be told from a transient dip afterwards, and the
  // readings are what a reader would otherwise reconstruct from a second clock. The best one seen
  // as well as the ends: it is what says whether the box was climbing towards the floor or never
  // moved, which is the difference between waiting longer and going and finding what holds it.
  throw new Error(
    `${verdict.message}\n\n` +
      `Read ${gb(readings[0])} GB, best ${gb(Math.max(...readings))} GB, last ` +
      `${gb(readings[readings.length - 1])} GB, over ${readings.length} readings ` +
      `${SETTLE_MS} ms apart.`
  );
}

// Run directly, this is `pretest`. The message is the whole point of the refusal, so it is printed
// rather than thrown: an unhandled rejection would bury it under a stack trace of this file.
//
// `.catch` and not `await`: the suites import this module through a transform that compiles to CJS,
// where a top-level await is a build error rather than a slower path.
// It says what it decided even when it decides nothing, the way `preflight.mjs` does. A guard that
// is silent when it passes cannot be told from a guard that never ran — which is the failure this
// one is most exposed to, since it is reached through an npm lifecycle name rather than a call.
//
// `exitCode` and not `exit()`: a piped stdout is written asynchronously, and exiting on the spot
// can take the message with it.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // For a reader at a prompt who wants the verdict rather than the wait. One settle and rule,
  // which is a single poll — the settle is not part of the waiting, it is what keeps a reading
  // taken inside another suite's teardown burst from being the one that decides.
  preflightMemory(process.argv.includes("--no-wait") ? { ceilingMs: SETTLE_MS } : {})
    .then(() => {
      console.log(
        process.env.CI
          ? "preflight: skipped under CI."
          : `preflight: ${gb(os.freemem())} GB free of ${gb(os.totalmem())} GB.`
      );
    })
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}
