// tests/pickSimulator.test.ts — which iOS simulator the device loop drives.
//
// The fixture is the runner's own `xcrun simctl list devices available -j`,
// captured in run 33454838368 and trimmed to the two fields the picker reads.
// Run 33440973925 logged `Using iPhone Air on
// com.apple.CoreSimulator.SimRuntime.iOS-26-5` against that same image, which
// is what the first test pins — so the expected answer is anchored to a run
// rather than to reasoning about one.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pickSimulator } from "../scripts/pick-simulator.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "pick-simulator.mjs");
/** The picker's answer, asserted present so each test can read it directly. */
const pick = (input: unknown) => {
  const picked = pickSimulator(input);
  assert.ok(picked, "the picker found no device");
  return picked;
};

const realListing = () =>
  JSON.parse(readFileSync(path.join(repoRoot, "tests", "fixtures", "simctl-devices.json"), "utf8"));

/** A listing built from `name -> [device names]`, in the shape simctl emits. */
const listing = (runtimes: Record<string, string[]>) => ({
  devices: Object.fromEntries(
    Object.entries(runtimes).map(([runtime, names]) => [
      `com.apple.CoreSimulator.SimRuntime.${runtime}`,
      names.map((name) => ({ name, udid: `udid-${name}` })),
    ]),
  ),
});

describe("the simulator the iOS loop drives", () => {
  test("picks what the runner actually drove", () => {
    const picked = pick(realListing());
    assert.equal(picked.device.name, "iPhone Air");
    assert.match(picked.runtime, /iOS-26-5$/);
  });

  test("takes the newest iOS runtime, by version rather than by key order", () => {
    // simctl's key order is not sorted, and 26-10 would sort before 26-2 as
    // text. The real capture has 26-2, 26-4 and 26-5 in that jumbled order.
    const picked = pick(
      listing({ "iOS-26-10": ["iPhone 17"], "iOS-26-2": ["iPhone 99"], "iOS-18-4": ["iPhone 50"] }),
    );
    assert.match(picked.runtime, /iOS-26-10$/);
  });

  test("ignores every runtime that is not iOS", () => {
    // watchOS, tvOS and xrOS are on the image and carry devices of their own -
    // nine of the twelve runtimes in the real capture.
    const picked = pick(listing({ "watchOS-26-5": ["iPhone impostor"], "iOS-18-0": ["iPhone 12"] }));
    assert.match(picked.runtime, /iOS-18-0$/);
    assert.equal(picked.device.name, "iPhone 12");
  });

  test("ignores iPads, which share every iOS runtime with the iPhones", () => {
    // Six of the eleven devices in each iOS runtime of the real capture are
    // iPads. Asserted as "none is a device to drive" rather than "the iPhone
    // wins the sort", because every iPad name sorts before every iPhone one
    // anyway - so the ordering half of this would pass with the filter gone.
    assert.equal(pickSimulator(listing({ "iOS-26-5": ["iPad Pro 13-inch (M5)", "iPad (A16)"] })), null);
    assert.equal(pick(listing({ "iOS-26-5": ["iPad (A16)", "iPhone 17"] })).device.name, "iPhone 17");
  });

  test("skips a runtime holding no iPhone rather than picking nothing", () => {
    // The newest runtime is not necessarily the newest one worth driving: an
    // image can ship a runtime with iPads alone. Reading `devices[newest]`
    // without this would take that one and find no iPhone in it.
    const picked = pick(listing({ "iOS-26-5": ["iPad (A16)"], "iOS-26-2": ["iPhone 17"] }));
    assert.match(picked.runtime, /iOS-26-2$/);
  });

  test("excludes the SE, which nothing has ever driven these flows on", () => {
    // Dead against today's image - it ships no SE - and alive the moment one
    // returns, which is the only state in which the exclusion means anything.
    assert.equal(pickSimulator(listing({ "iOS-26-5": ["iPhone SE (3rd generation)"] })), null);
  });

  test("orders names numerically, so 9 comes before 17", () => {
    // Plain string order puts "iPhone 9" last and would drive the oldest
    // device on the image.
    const picked = pick(listing({ "iOS-26-5": ["iPhone 17", "iPhone 9"] }));
    assert.equal(picked.device.name, "iPhone 17");
  });

  test("an image with no iPhone at all is nothing rather than a crash", () => {
    assert.equal(pickSimulator(listing({ "tvOS-26-5": ["Apple TV"] })), null);
    assert.equal(pickSimulator({}), null);
  });
});

describe("the workflow runs the script rather than a copy of it", () => {
  const workflowDir = path.join(repoRoot, ".github", "workflows");

  test("ios.yml pipes simctl into the script", () => {
    const ios = readFileSync(path.join(workflowDir, "ios.yml"), "utf8");
    assert.match(ios, /simctl list devices available -j \| node scripts\/pick-simulator\.mjs/);
  });

  test("no workflow embeds a program inside a shell quote", () => {
    // The hazard is the quoting, not this one program: a `'` anywhere inside
    // `node -e '...'` - a comment included - closes the string, the shell
    // re-parses the rest, and the interpreter is handed a truncated program
    // that fails somewhere else entirely.
    //
    // Read off disk rather than from a list, because a list cannot cover a
    // workflow added after it. `sh -c '...'` carries the same hazard and is
    // deliberately not matched: it is the shell's own idiom for a one-liner,
    // and `drive-android-flows` uses it for the two collectors it backgrounds.
    const embedded = /\b(node|python3?|ruby|osascript)\s+(-e|--eval)\s+'/;
    const files = readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));
    assert.ok(files.length > 1, "found no workflows to scan");
    for (const file of files) {
      const text = readFileSync(path.join(workflowDir, file), "utf8");
      assert.doesNotMatch(text, embedded, `${file} inlines a program in a shell quote`);
    }
  });

  test("the script is a file the workflow can reach from the checkout", () => {
    assert.ok(readFileSync(script, "utf8").includes("pickSimulator"));
  });
});

describe("the script the workflow runs", () => {
  const run = (stdin: string) => {
    try {
      const stdout = execFileSync("node", [script], { input: stdin, encoding: "utf8" });
      return { code: 0, stdout };
    } catch (e: any) {
      return { code: e.status as number, stdout: String(e.stdout ?? ""), stderr: String(e.stderr ?? "") };
    }
  };

  test("writes the udid and nothing else to stdout", () => {
    const result = run(JSON.stringify(realListing()));
    assert.equal(result.code, 0);
    const air = realListing().devices["com.apple.CoreSimulator.SimRuntime.iOS-26-5"].find(
      (d: { name: string }) => d.name === "iPhone Air",
    );
    // Bare, because the workflow takes it as `udid=$(... | node ...)` and a
    // trailing newline or a log line would land inside the variable.
    assert.equal(result.stdout, air.udid);
  });

  test("an empty pipe is named rather than reported as a broken program", () => {
    // A bare `SyntaxError: Unexpected end of input` from `JSON.parse` reads as
    // a broken script, and sends the next reader into this file rather than to
    // whatever upstream produced nothing.
    const result = run("");
    assert.equal(result.code, 1);
    assert.match(String(result.stderr), /simctl produced 0 bytes/);
  });

  test("valid JSON that is not a listing is named too", () => {
    // `JSON.parse` accepts `null`, a number and a string, so the catch above
    // does not fire and reading `.devices` off one of those would throw out of
    // the stdin handler - past the branch that exists to say what arrived.
    for (const input of ["null", "42", '"nope"']) {
      const result = run(input);
      assert.equal(result.code, 1, `${input} was not rejected`);
      assert.match(String(result.stderr), /::error::No iOS runtime/);
    }
  });

  test("no iPhone on the image fails the step with a reason", () => {
    const result = run(JSON.stringify(listing({ "tvOS-26-5": ["Apple TV"] })));
    assert.equal(result.code, 1);
    assert.match(String(result.stderr), /::error::No iOS runtime/);
  });
});
