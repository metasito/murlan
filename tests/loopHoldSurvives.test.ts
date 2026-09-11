// tests/loopHoldSurvives.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A real process, because only one with nothing else to do can fail: under the test runner something
 * always keeps the event loop alive, so an unref'd wait resolves and the assertion passes anyway.
 */
const DIR = path.join(".loop-logs", "hold-probe");

describe("a hold survives in a process with nothing else to do", () => {
  test("the line after the wait actually runs", () => {
    mkdirSync(DIR, { recursive: true });
    const probe = path.join(DIR, "probe.mjs");
    const loop = pathToFileURL(path.resolve("scripts/queue-loop.mjs")).href;

    writeFileSync(
      probe,
      [
        `import { holdFor } from ${JSON.stringify(loop)};`,
        `async function main() {`,
        `  await holdFor(300, () => false, 50);`,
        `  console.log("RESUMED");`,
        `  return 0;`,
        `}`,
        `main().then((c) => process.exit(c));`,
      ].join("\n"),
      "utf8"
    );

    const out = execFileSync(process.execPath, [probe], { encoding: "utf8" });
    assert.match(out, /RESUMED/, "the process exited during the hold — the wait was unref'd");
    rmSync(DIR, { recursive: true, force: true });
  });
});
