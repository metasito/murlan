// tests/tutorialDismissal.test.ts — no control on the tutorial screen takes touch
// on Android (#627): not the Skip button, not the card body's own "Inizia". A flow
// that taps to dismiss the tutorial therefore dies there against a screen the app
// rendered correctly, which is how the Android loop stayed red from 2026-08-21
// with nobody able to see why. `back` is the one input that screen accepts.
//
// The tap is still right on iOS (#353), where it works and where Maestro's `back`
// is an edge-swipe gesture rather than a key press. So the requirement is not
// "never tap" but "split by platform" — and a flow that hands one branch to both
// platforms breaks whichever one it was not written for.
//
// This is the class rather than today's two instances: the next flow written will
// copy whichever one its author read. Collapse this to the tap when #627 closes.
//
// Read as text rather than parsed: js-yaml is only a hoisted transitive dependency
// here, and the claim is about which command sits under which guard, which is the
// level the file is edited at.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flowDir = path.join(repoRoot, ".maestro");

/** A flow's source with comment lines dropped, so prose cannot satisfy a check. */
function code(file: string): string {
  return readFileSync(path.join(flowDir, file), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");
}

const flows = readdirSync(flowDir)
  .filter((f) => f.endsWith(".yaml"))
  .filter((f) => /GUIDA RAPIDA/.test(code(f)));

describe("dismissing the tutorial", () => {
  test("there are flows that dismiss it", () => {
    assert.ok(flows.length > 0, "no flow mentions the tutorial; this test is checking nothing");
  });

  for (const file of flows) {
    const src = code(file);

    test(`${file} presses back for Android`, () => {
      assert.match(
        src,
        /platform:\s*Android[\s\S]{0,120}?-\s*back\b/,
        `${file} must dismiss the tutorial with \`- back\` under \`platform: Android\` — the tap does nothing there (#627).`,
      );
    });

    test(`${file} keeps the tap for iOS only`, () => {
      const taps = [...src.matchAll(/tapOn:\s*"Salta il tutorial"/g)];
      for (const tap of taps) {
        // The guard is the nearest `platform:` above the tap. Anything else means
        // the tap is being handed to Android too.
        const before = src.slice(0, tap.index);
        const guard = [...before.matchAll(/platform:\s*(\w+)/g)].pop()?.[1];
        assert.equal(
          guard,
          "iOS",
          `${file} taps "Salta il tutorial" under \`platform: ${guard ?? "none"}\`. That tap does nothing on Android (#627); guard it with \`platform: iOS\`.`,
        );
      }
    });

    test(`${file} gates the block on the screen, not the dead control`, () => {
      // Gating on the button's own label is the same bug one level up: it keys
      // the whole block on a control that cannot be used.
      assert.ok(
        !/visible:\s*"Salta il tutorial"/.test(src),
        `${file} gates on "Salta il tutorial". Gate on "GUIDA RAPIDA" — the screen, not the control.`,
      );
    });
  }
});
