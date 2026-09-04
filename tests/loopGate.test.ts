// tests/loopGate.test.ts
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { readFields, check } from "../scripts/loop-gate.mjs";

const FILLED = `# LOOP STATE

status: RUNNING
ticket: 824
branch: agent/824-music-delay

## Evidence
dod:
  - [ ] the delay is measured on device
  - [ ] a regression test pins it
recon: components/audio.ts, lib/sound.ts
verdict: VERDICT: LAND
gate:
`;

describe("the loop's evidence gate", () => {
  test("a filled state passes", () => {
    assert.deepEqual(check(readFields(FILLED)).blank, []);
  });

  test("a phase that never ran leaves its field blank, and is named", () => {
    const { blank } = check(readFields(FILLED.replace("recon: components/audio.ts, lib/sound.ts", "recon:")));
    assert.equal(blank.length, 1);
    assert.match(blank[0], /^recon: phase B never ran/);
  });

  // The failure this whole file exists for: the template ships every field carrying a `# hint`
  // comment, and reading that as content would call a run that did nothing complete.
  test("a template hint is not evidence", () => {
    const fields = readFields(`status: RUNNING\nticket: 1\nbranch: b\ndod:\nrecon:   # B: files to touch\nverdict:\n`);
    assert.equal(fields.recon, "");
    assert.deepEqual(
      check(fields).blank.map((b) => b.split(":")[0]),
      ["dod", "recon", "verdict"],
    );
  });

  test("a HOLD blocks the push even though phase D ran", () => {
    const { blank, held } = check(readFields(FILLED.replace("VERDICT: LAND", "VERDICT: HOLD — the guard exempts its own case")));
    assert.deepEqual(blank, []);
    assert.equal(held, true);
  });

  // The shipped template must be the shape the gate reads, or the gate is checking a file
  // nothing writes. It ships IDLE, so only its field names are asserted here.
  test("the committed STATE.md carries every field the gate requires", () => {
    const fields = readFields(readFileSync(".claude/loop/STATE.md", "utf8"));
    for (const key of ["status", "ticket", "branch", "dod", "recon", "verdict"]) {
      assert.ok(key in fields, `.claude/loop/STATE.md has no \`${key}\` field`);
    }
  });
});
