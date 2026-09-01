// tests/gameTableTapSettle.test.ts — Maestro's default wait after a tap is "wait for
// the view hierarchy to stop changing", and the game table's Reanimated glow and pulse
// never stop, so that wait runs to its internal timeout on every tap that lands there.
// `waitToSettleTimeoutMs` caps it. The flows have carried the cap on the taps *inside*
// the table since it was first diagnosed; what hung the Android run was the tap that
// *opens* it, which is the last tap of the menu and so sat outside a rule written by
// section (#762).
//
// The boundary is taken from the flow rather than named here: a flow that enters the
// table rotates the device for it, and says so. That means a flow reordered around
// that line moves this check with it instead of leaving it pointing at a tap that is
// no longer the one crossing over.
//
// Read as text rather than parsed: no YAML parser is a dependency of this project, and
// the claim is about which command comes before which, which is the level the file is
// edited at.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FLOW_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".maestro");

/** The line each `tapOn` starts on, and every line of the block it owns. */
function tapsIn(lines: string[]): { line: number; block: string[] }[] {
  const taps: { line: number; block: string[] }[] = [];
  for (const [i, line] of lines.entries()) {
    const at = line.indexOf("tapOn:");
    if (at === -1 || line.trimStart().replace(/^-\s*/, "").indexOf("tapOn:") !== 0) continue;
    const block = [line];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (next.trim() === "") continue;
      if (next.search(/\S/) <= at) break;
      block.push(next);
    }
    taps.push({ line: i + 1, block });
  }
  return taps;
}

/**
 * Flows that enter the game table, which is the only screen locked to landscape —
 * so a flow turning the device that way is on its way there, and one turning it to
 * portrait (`smoke.yaml`, for the menus below the fold) is not.
 */
function flowsReachingTheTable(): { name: string; lines: string[]; rotation: number }[] {
  const found = [];
  for (const name of readdirSync(FLOW_DIR).filter((f) => /\.ya?ml$/.test(f))) {
    const lines = readFileSync(path.join(FLOW_DIR, name), "utf8").split("\n");
    const rotation = lines.findIndex((l) => /^\s*-?\s*setOrientation:\s*LANDSCAPE/.test(l));
    if (rotation !== -1) found.push({ name, lines, rotation });
  }
  return found;
}

describe("taps that land on the game table", () => {
  test("at least one flow enters the table, or this check is watching nothing", () => {
    // The whole file passes vacuously if the rotation it keys on is ever renamed or
    // dropped, and a green suite would then be reporting a rule nothing applies.
    assert.notEqual(
      flowsReachingTheTable().length,
      0,
      `no flow under .maestro/ rotates the device, so nothing here located the game ` +
        `table. If the flows now enter it another way, key this check on that instead.`
    );
  });

  for (const { name, lines, rotation } of flowsReachingTheTable()) {
    test(`${name} caps the settle wait from the tap that opens the table onward`, () => {
      const taps = tapsIn(lines);
      const opening = taps.filter((t) => t.line <= rotation + 1).pop();
      assert.ok(opening, `${name} rotates for the table without a tap ever opening it`);

      const uncapped = taps
        .filter((t) => t.line >= opening.line)
        .filter((t) => !t.block.some((l) => l.includes("waitToSettleTimeoutMs")))
        .map((t) => `${name}:${t.line}`);

      assert.deepEqual(
        uncapped,
        [],
        `these taps land on the game table and let Maestro wait for a screen whose ` +
          `animations never stop, which is a hang rather than a failure — the run ends ` +
          `mid-command with the element found and aimed at. Pin waitToSettleTimeoutMs on ` +
          `each, as the taps below them already do.`
      );
    });
  }
});
