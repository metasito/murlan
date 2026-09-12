// tests/emulatorDisplayOverride.test.ts — the Maestro emulator is driven at half
// the resolution and half the density of the profile it boots, so swiftshader
// rasterizes a quarter of the pixels while every dp stays where it was. That
// second half is the whole safety of the first: the flows select on a laid-out
// screen, so a resolution cut without the matching density cut moves every
// element and fails the suite for a reason nobody would connect to this knob.
//
// The equivalence is arithmetic, so it is derived here rather than asserted in a
// comment beside the two numbers — a comment cannot fail, and a change to one
// number and not the other is exactly the edit that would leave it wrong (#942).
//
// Read as text rather than parsed: no YAML parser is a dependency of this
// project, and the file is edited at the level of these lines.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACTION = ".github/actions/drive-android-flows/action.yml";

const src = readFileSync(path.join(repoRoot, ACTION), "utf8");

/**
 * Each AVD profile's stock display, which lives in the Android SDK rather than in
 * this repo. Naming them here is what makes a profile change fail loudly instead
 * of silently invalidating the override below.
 */
const STOCK: Record<string, { width: number; height: number; density: number }> = {
  pixel_6: { width: 1080, height: 2400, density: 420 },
};

describe("the emulator display override", () => {
  const profile = /^\s*profile:\s*(\S+)\s*$/m.exec(src)?.[1];
  const size = /adb shell wm size (\d+)x(\d+)/.exec(src);
  const density = /adb shell wm density (\d+)/.exec(src);

  test("names a profile whose stock display this test knows", () => {
    assert.ok(profile, "the action no longer names an AVD profile");
    assert.ok(
      STOCK[profile],
      `the action boots '${profile}', whose stock display is not recorded here. ` +
        `Add it to STOCK, or the override below is being checked against nothing.`
    );
  });

  test("sets both a size and a density", () => {
    // One without the other is the failure this file exists to prevent, and it
    // would otherwise show up as every flow failing on a moved element.
    assert.ok(size, "no `wm size` override in the action's script");
    assert.ok(density, "no `wm density` override in the action's script");
  });

  test("leaves the screen the same size in dp as the profile's own", () => {
    assert.ok(profile && size && density);
    const stock = STOCK[profile];
    const [w, h] = [Number(size[1]), Number(size[2])];
    const d = Number(density[1]);

    // Cross-multiplied rather than divided: the dp figures are not integers and
    // a float comparison here would be its own flake.
    assert.equal(
      w * stock.density,
      stock.width * d,
      `${w}px at ${d}dpi is ${((w / d) * 160).toFixed(1)}dp wide, but ${profile} is ` +
        `${((stock.width / stock.density) * 160).toFixed(1)}dp. The flows would see a different screen.`
    );
    assert.equal(
      h * stock.density,
      stock.height * d,
      `${h}px at ${d}dpi is ${((h / d) * 160).toFixed(1)}dp tall, but ${profile} is ` +
        `${((stock.height / stock.density) * 160).toFixed(1)}dp. The flows would see a different screen.`
    );
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

  test("is verified in the script rather than assumed", () => {
    // `wm size` reports an override only when one took. Without these, a device
    // that refused the override looks exactly like the fix working, right up to
    // the next death — the shape #942 was filed about.
    // Matched against the one line each, not the whole file: a failure here
    // should name the missing check, not print the action back at the reader.
    const verifies = (what: string, override: string) =>
      src
        .split("\n")
        .some((l) => l.includes(`adb shell wm ${what} |`) && l.includes(`Override ${override}:`));
    assert.ok(verifies("size", "size"), "`wm size` is set but never read back");
    assert.ok(verifies("density", "density"), "`wm density` is set but never read back");
  });

  test("is applied before the app is launched", () => {
    // A density change is a configuration change: applied later, it would
    // recreate the activity underneath a flow already driving it.
    const applied = src.indexOf("adb shell wm size ");
    const launched = src.indexOf("adb shell monkey");
    assert.ok(applied !== -1 && launched !== -1);
    assert.ok(applied < launched, "the display override lands after the app is launched");
  });
});
