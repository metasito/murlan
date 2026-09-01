// Chooses the iPhone simulator `ios.yml` drives, from `xcrun simctl list
// devices available -j` on stdin, and writes its UDID to stdout.
//
// A file rather than a `node -e '...'` in the workflow. Inside the shell's
// single quotes an apostrophe anywhere in these thirty lines - a comment
// included - closes the string, the rest is re-parsed by the shell, and node
// reads nothing: run 33451719934 died on `SyntaxError: Unexpected end of
// input`, which is `JSON.parse("")` and points nowhere near quoting (#708).
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

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
  const devices = listing.devices ?? {};
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

// Skipped when imported by the test, which calls `pickSimulator` directly.
// Compared as resolved paths rather than by comparing the URL to argv: on
// Windows argv carries backslashes and a drive letter of either case, and a
// string comparison against a `file://` URL is false every time.
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (raw += chunk));
  process.stdin.on("end", () => {
    let listing;
    try {
      listing = JSON.parse(raw);
    } catch {
      // Named, because the bare parse error says "Unexpected end of input" and
      // reads as a broken program rather than an empty pipe.
      console.error(`::error::simctl produced ${raw.length} bytes, which is not JSON.`);
      process.exit(1);
    }
    const picked = pickSimulator(listing);
    if (!picked) {
      console.error("::error::No iOS runtime with a full-screen iPhone on this runner.");
      process.exit(1);
    }
    console.error(`Using ${picked.device.name} on ${picked.runtime}`);
    process.stdout.write(picked.device.udid);
  });
}
