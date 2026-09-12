// tests/emulatorDisplayOverride.test.ts — the Maestro emulator is driven at half
// the resolution and half the density of the profile it boots, so swiftshader
// rasterizes a quarter of the pixels while every dp stays where it was. That
// second half is the whole safety of the first: the flows select on a laid-out
// screen, so a resolution cut without the matching density cut moves every
// element and fails the suite for a reason nobody would connect to this knob.
//
// The equivalence is arithmetic, so it is derived here from the profile the
// action boots rather than restated anywhere as a figure — a change to one
// number and not the other is exactly the edit that would leave it wrong (#942).
//
// Read as commands rather than as text: `actionScriptLines` drops comments, so
// nothing below can be satisfied by a command that is commented out.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { actionConfigLines, actionScriptLines } from "./helpers/androidAction.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = actionScriptLines(repoRoot);
const config = actionConfigLines(repoRoot);

/**
 * Each AVD profile's stock display, which lives in the Android SDK rather than in
 * this repo. Naming them here is what makes a profile change fail loudly instead
 * of silently invalidating the override below.
 */
const STOCK: Record<string, { width: number; height: number; density: number }> = {
  pixel_6: { width: 1080, height: 2400, density: 420 },
};

/** The first script command matching `pattern`, or undefined if none runs. */
function command(pattern: RegExp): RegExpExecArray | undefined {
  for (const line of script) {
    const m = pattern.exec(line);
    if (m) return m;
  }
  return undefined;
}

describe("the emulator display override", () => {
  const profile = config.map((l) => /^profile:\s*(\S+)$/.exec(l)?.[1]).find(Boolean);
  const size = command(/^adb shell wm size (\d+)x(\d+)$/);
  const density = command(/^adb shell wm density (\d+)$/);

  test("names a profile whose stock display this test knows", () => {
    assert.ok(profile, "the action no longer names an AVD profile");
    assert.ok(
      STOCK[profile],
      `the action boots '${profile}', whose stock display is not recorded here. ` +
        `Add it to STOCK, or the override below is being checked against nothing.`
    );
  });

  test("runs both a size and a density command", () => {
    // One without the other is the failure this file exists to prevent, and it
    // would otherwise show up as every flow failing on a moved element.
    assert.ok(size, "the script runs no `wm size` override");
    assert.ok(density, "the script runs no `wm density` override");
  });

  test("leaves the screen the same size in dp as the profile's own", () => {
    assert.ok(profile && size && density);
    const stock = STOCK[profile];
    const d = Number(density[1]);

    for (const [edge, px, stockPx] of [
      ["wide", Number(size[1]), stock.width],
      ["tall", Number(size[2]), stock.height],
    ] as const) {
      // Cross-multiplied rather than divided: the dp figures are not integers
      // and a float comparison here would be its own flake.
      assert.equal(
        px * stock.density,
        stockPx * d,
        `${px}px at ${d}dpi is ${((px / d) * 160).toFixed(1)}dp ${edge}, but ${profile} is ` +
          `${((stockPx / stock.density) * 160).toFixed(1)}dp. The flows would see a different screen.`
      );
    }
  });

  test("actually reduces the pixels swiftshader has to rasterize", () => {
    assert.ok(profile && size);
    const stock = STOCK[profile];
    const after = Number(size[1]) * Number(size[2]);
    const before = stock.width * stock.height;
    // The point of the override. Equal dp with equal pixels is a no-op that
    // would still pass every assertion above.
    assert.ok(
      after < before,
      `the override rasterizes ${after} pixels against the profile's ${before}; it buys nothing`
    );
  });

  test("reads both overrides back, against the values it set", () => {
    // `wm size` reports an override only when one took. Without these, a device
    // that refused the override looks exactly like the fix working, right up to
    // the next death — the shape #942 was filed about.
    //
    // Three things, because dropping any one of them leaves a read-back that
    // runs and reports nothing: it has to grep the value set two lines above
    // rather than any value, and it has to *fail the step* when that value is
    // absent. A `|| true` here would be a device check whose answer is discarded.
    assert.ok(size && density);
    const readsBack = (what: string, expected: string) => {
      const line = script.find((l) => l.startsWith(`adb shell wm ${what} |`));
      assert.ok(line, `nothing reads \`wm ${what}\` back`);
      assert.ok(
        line.includes(`Override ${what}: ${expected}`),
        `the \`wm ${what}\` read-back does not grep 'Override ${what}: ${expected}', the value the script sets`
      );
      assert.match(
        line,
        /\|\|.*exit 1/,
        `the \`wm ${what}\` read-back does not fail the step, so its answer is discarded`
      );
    };
    readsBack("size", `${size[1]}x${size[2]}`);
    readsBack("density", density[1]);
  });

  test("sits between the device-came-up marker and the app launch", () => {
    // Two bounds, and the override has to be inside both.
    //
    // Before the launch, because a density change is a configuration change:
    // applied later it would recreate the activity underneath a flow already
    // driving it. The launch is found by what it does rather than by its
    // spelling, so adding a second way to start the app does not quietly pass.
    //
    // After the marker, because everything above that line is the device coming
    // up, and `maestro.yml` reads a failure there as the emulator never having
    // arrived — so a device that merely refused the override would report
    // itself as #186 and be retried through another 900s boot.
    assert.ok(size);
    const applied = script.findIndex((l) => l.startsWith("adb shell wm size "));
    const marker = script.findIndex((l) => l.startsWith("touch") && l.includes("emulator-booted"));
    const launched = script.findIndex((l) => l.includes("android.intent.category.LAUNCHER"));
    assert.notEqual(marker, -1, "the script no longer marks the device as having come up");
    assert.notEqual(launched, -1, "nothing in the script launches the app any more");
    assert.ok(
      applied > marker,
      "the display override runs above the device-came-up marker, so refusing it reads as #186"
    );
    assert.ok(
      applied < launched,
      "the display override lands after the app is launched, which would recreate it"
    );
  });
});
