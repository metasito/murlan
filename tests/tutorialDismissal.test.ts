// tests/tutorialDismissal.test.ts — no control on the tutorial screen takes touch
// on Android (#627): not the Skip button, not the card body's own "Inizia". A flow
// that dismisses the tutorial by tapping therefore hangs there and fails against a
// screen the app rendered correctly, which is how the Android loop stayed red from
// 2026-08-21 with nobody able to see why. `back` is the one input that screen
// accepts.
//
// This is the class rather than the two instances: the next flow written will copy
// whichever one its author read, and both of them have to be wrong for this to
// catch it. Delete this file when #627 closes and the tap works again.
//
// Read as text rather than parsed: js-yaml is only a hoisted transitive dependency
// here, and the claim is about which command a block uses, which is the level the
// file is edited at.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flowDir = path.join(repoRoot, ".maestro");

const flows = readdirSync(flowDir).filter((f) => f.endsWith(".yaml"));

describe("dismissing the tutorial", () => {
  test("there are flows to check", () => {
    assert.ok(flows.length > 0, ".maestro holds no flows; this test is checking nothing");
  });

  for (const file of flows) {
    const src = readFileSync(path.join(flowDir, file), "utf8");
    const code = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");

    test(`${file} does not tap to dismiss it`, () => {
      assert.ok(
        !/tapOn:\s*"Salta il tutorial"/.test(code),
        `${file} taps "Salta il tutorial". That tap does nothing on Android — #627. Use \`- back\`.`,
      );
    });

    test(`${file} guards the dismissal on copy the screen renders`, () => {
      // A `when:` keyed on the button's own label is the same bug one level up:
      // it gates on a control that cannot be used, so the block is either skipped
      // or entered to no purpose. "GUIDA RAPIDA" is the screen's own heading.
      assert.ok(
        !/visible:\s*"Salta il tutorial"/.test(code),
        `${file} gates on "Salta il tutorial". Gate on "GUIDA RAPIDA" — the screen, not the dead control.`,
      );
    });
  }
});
