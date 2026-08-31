// tests/tutorialDismissal.test.ts — no control on the tutorial screen takes touch
// on Android (#627): not the Skip button, not the card body's own "Inizia". A flow
// that taps to dismiss the tutorial therefore dies there against a screen the app
// rendered correctly, which is how the Android loop stayed red from 2026-08-21
// with nobody able to see why. `back` is the one input that screen accepts.
//
// The tap is still right on iOS (#353), where it works and where Maestro's `back`
// is an edge-swipe gesture rather than a key press. So the requirement is not
// "never tap" but "split by platform", and a flow that hands one branch to both
// platforms breaks whichever one it was not written for.
//
// Every check below is scoped to the dismissal block. Scanning the whole file
// cannot work: both flows open with an unrelated `platform: iOS` block for iOS's
// deep-link prompt, and a file-wide "nearest platform above the tap" search reads
// that one — so removing the split entirely still looked iOS-guarded and passed.
//
// This is the class rather than today's two instances: the next flow written will
// copy whichever one its author read. Delete it when #627 closes and the tap works.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const flowDir = path.join(repoRoot, ".maestro");

/**
 * Source with comments stripped from the first unquoted `#`, so neither a whole
 * comment line nor a trailing one can satisfy a check with prose.
 */
function code(src: string): string {
  return src
    .split("\n")
    .map((line) => {
      let quote: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === "#") {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

/**
 * The one top-level command that dismisses the tutorial, as its own text.
 *
 * Selected by "the block that names the Skip button", never by the first mention
 * of tutorial copy anywhere: the launch wait above it reads
 * `visible: "IL GIOCO DI CARTE|GUIDA RAPIDA"`, and searching for that lands on
 * the wrong block entirely. Returns null when a flow never meets the tutorial.
 */
function dismissalBlock(src: string): string | null {
  const lines = code(src).split("\n");

  // Top-level commands begin with `- ` at column 0; everything until the next one
  // belongs to it. Bounding on that rather than on indentation matters because
  // stripping comments leaves blank lines, which would otherwise run two adjacent
  // blocks together.
  const starts = lines.flatMap((l, i) => (/^-\s/.test(l) ? [i] : []));
  const blocks = starts.map((from, n) => lines.slice(from, starts[n + 1] ?? lines.length).join("\n"));

  const found = blocks.filter((b) => /"Salta il tutorial"/.test(b));
  assert.ok(found.length <= 1, "more than one top-level block dismisses the tutorial");
  return found[0] ?? null;
}

const flows = readdirSync(flowDir)
  .filter((f) => f.endsWith(".yaml"))
  .map((file) => ({ file, block: dismissalBlock(readFileSync(path.join(flowDir, file), "utf8")) }))
  .filter((f): f is { file: string; block: string } => f.block !== null);

describe("dismissing the tutorial", () => {
  test("there are flows that dismiss it", () => {
    assert.ok(flows.length > 0, "no flow dismisses the tutorial; this test is checking nothing");
  });

  for (const { file, block } of flows) {
    test(`${file} presses back for Android`, () => {
      assert.match(
        block,
        /platform:\s*Android\b[\s\S]*?^\s+-\s*back\s*$/m,
        `${file} must dismiss the tutorial with \`- back\` under \`platform: Android\`; the tap does nothing there (#627).\n${block}`,
      );
    });

    test(`${file} guards every skip tap with iOS`, () => {
      // Both spellings: `- tapOn: "…"` and the object form `- tapOn:\n text: "…"`,
      // which these files already use elsewhere for iOS's "Apri" prompt.
      const taps = [...block.matchAll(/tapOn:(?:\s*"Salta il tutorial"|[\s\S]{0,80}?text:\s*"Salta il tutorial")/g)];
      assert.ok(taps.length > 0, `${file} no longer taps Skip at all; iOS needs that tap (#353).\n${block}`);
      for (const tap of taps) {
        const guard = [...block.slice(0, tap.index).matchAll(/platform:\s*(\w+)/g)].pop()?.[1];
        assert.equal(
          guard,
          "iOS",
          `${file} taps "Salta il tutorial" under \`platform: ${guard ?? "no platform guard"}\`. That tap does nothing on Android (#627).\n${block}`,
        );
      }
    });

    test(`${file} gates on the button, which every beat renders`, () => {
      // "GUIDA RAPIDA" titles an `info` beat's card only: a `play` beat titles the
      // card after itself and `complete` has its own. Gating or exiting on it skips
      // the block on most of the tutorial, and "it went" is then satisfied by the
      // tutorial advancing a beat rather than being dismissed.
      assert.ok(
        !/GUIDA RAPIDA/.test(block),
        `${file} gates or exits the dismissal on "GUIDA RAPIDA", which only an info beat renders. Use "Salta il tutorial" — the header carries it on every beat.\n${block}`,
      );
    });
  }
});
