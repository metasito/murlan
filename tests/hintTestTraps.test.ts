// tests/hintTestTraps.test.ts — the PreToolUse hint fires on the files whose traps are
// documented, stays silent everywhere else, and never blocks.
//
// The hint exists because loops.md is read at the start of a session and needed hours later,
// when a test is actually being written. A hint that fires on the wrong file is noise, and a
// hint that fails loudly would block an edit, so both are pinned here.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "hint-test-traps.mjs");

function run(payload: string): string {
  return execFileSync(process.execPath, [script], { input: payload, encoding: "utf8" });
}

const forPath = (file_path: string) => JSON.stringify({ tool_input: { file_path } });

describe("the test-trap hint fires where a trap is documented", () => {
  for (const [file, expected] of [
    ["tests/native/bannerMakesRoom.test.tsx", /unmount/],
    ["C:\\repo\\tests\\native\\a.test.tsx", /unmount/],
    ["tests/native/x.test.ts", /unmount/],
    ["tests/e2e/bannerDisplaces.spec.ts", /flexbox/],
    ["locales/en.ts", /sq\.ts/],
  ] as const) {
    test(`hints on ${file}`, () => {
      const out = run(forPath(file));
      assert.match(out, expected);
      assert.match(out, /additionalContext/);
    });
  }
});

// The floor. A hint on every file is noise that trains the reader to skip it, which costs more
// than the hint saves.
describe("the test-trap hint stays silent elsewhere", () => {
  for (const file of [
    "components/MenuLayout.tsx",
    "server/socketSafety.ts",
    "tests/guardBash.test.ts",
    "locales/it.ts",
    "docs/agents/loops.md",
  ]) {
    test(`silent on ${file}`, () => {
      assert.equal(run(forPath(file)), "");
    });
  }
});

describe("the test-trap hint never disturbs a tool call", () => {
  for (const payload of ["", "not json", "{}", '{"tool_input":{}}']) {
    test(`exits 0 and says nothing on: ${payload || "(empty)"}`, () => {
      assert.equal(run(payload), "");
    });
  }
});
