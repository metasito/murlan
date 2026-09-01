// Chooses the iPhone simulator `ios.yml` drives, from `xcrun simctl list
// devices available -j` on stdin, and writes its UDID to stdout.
import { pathToFileURL } from "node:url";
import path from "node:path";

/**
 * `macos-latest` ships a fixed set of pre-created simulators rather than a
 * fresh AVD per run, so the device to drive is found rather than declared.
 *
 * The SE is excluded: the flows no longer tap the hand by percentage of the
 * screen (#661 made them name the card), so its 16:9 shape is no longer
 * disqualifying - it is simply a device nothing has ever driven these flows on.
 */
const usable = (device) => /^iPhone/.test(device.name) && !/\bSE\b/.test(device.name);

/** `[major, minor]` of a runtime identifier, or `[]` where it names no iOS. */
const version = (runtime) => (runtime.match(/iOS-(\d+)-(\d+)/) || []).slice(1).map(Number);

/**
 * The newest iOS runtime holding a device worth driving, and within it the
 * last iPhone by name.
 *
 * Both are chosen rather than taken as simctl happens to order them, so a
 * runner image that reorders its device list cannot silently change which
 * device a run was driven on. `numeric: true` is what puts "iPhone 16 Pro"
 * after "iPhone 9" instead of before it.
 */
export function pickSimulator(listing) {
  // Optional all the way down: `JSON.parse` is happy with `null`, a number or
  // a string, and reading `.devices` off one of those throws out of the stdin
  // handler below - past the `catch` that exists to name a bad input.
  const devices = listing?.devices ?? {};
  const runtimes = Object.keys(devices)
    .filter((runtime) => /iOS/i.test(runtime) && devices[runtime].some(usable))
    .sort((a, b) => {
      const [aMajor, aMinor] = version(a);
      const [bMajor, bMinor] = version(b);
      return aMajor - bMajor || aMinor - bMinor;
    });
  const runtime = runtimes[runtimes.length - 1];
  if (!runtime) return null;
  const iphones = devices[runtime]
    .filter(usable)
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  return { runtime, device: iphones[iphones.length - 1] };
}

// The same shape `scripts/e2e-shard.mjs`, `next-ticket.mjs`, `native-scope.mjs`
// and `prune-worktrees.mjs` use. Each keeps its own copy because every one of
// them runs on import, so importing the helper would run its script.
export function isInvokedDirectly(argv1, moduleUrl) {
  return Boolean(argv1) && pathToFileURL(path.resolve(argv1)).href === moduleUrl;
}

if (isInvokedDirectly(process.argv[1], import.meta.url)) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    // `exitCode` rather than `exit()`: on a runner stderr is a pipe, writes to
    // a pipe are asynchronous, and exiting discards whatever has not flushed -
    // which is the `::error::` line itself, leaving a bare exit 1 with no
    // reason in the log.
    let listing;
    try {
      listing = JSON.parse(raw);
    } catch {
      // Named, because the bare parse error says "Unexpected end of input" and
      // reads as a broken program rather than an empty pipe.
      console.error(`::error::simctl produced ${raw.length} bytes, which is not JSON.`);
      process.exitCode = 1;
      return;
    }
    const picked = pickSimulator(listing);
    if (!picked) {
      console.error("::error::No iOS runtime with a full-screen iPhone on this runner.");
      process.exitCode = 1;
      return;
    }
    console.error(`Using ${picked.device.name} on ${picked.runtime}`);
    process.stdout.write(picked.device.udid);
  });
}
