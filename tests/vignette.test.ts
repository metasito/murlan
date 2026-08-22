// tests/vignette.test.ts — the felt's vignette has no hard edges in it.
//
// A linear gradient over a box reaches "transparent" only at the end of its
// own axis. A piece inset on both axes — a corner square — therefore still
// carries ink along the two edges that face the middle of the table, and draws
// them as straight lines across the felt. Four such pieces drew a visible grid
// on any screen large enough to spread them out; four full-edge bands fixed
// that, and the lantern's own radial vignette replaced them.
//
// A radial cannot reproduce the defect, so what is worth pinning now is that
// the vignette is still one radial over the whole felt, and still its own
// layer: folded into the pool it would travel with the lamp, and a vignette
// that moves is a moving frame rather than a dark rim.
//
// Structural, like tests/orientation.test.ts — the property is about how the
// styles are written, so it is checked by reading them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(repoRoot, "components/table/felt.tsx"), "utf8");

test("the vignette is a radial, not an assembly of straight-edged pieces", () => {
  const vignette = source.match(/<RadialGradient\s+id=\{VIGNETTE_ID\}[\s\S]*?<\/RadialGradient>/);
  assert.ok(vignette, "the vignette is no longer a RadialGradient over the felt");
  assert.match(
    vignette[0],
    /stopColor=\{Lantern\.vignetteClear\}/,
    "the vignette does not start transparent, so it darkens the middle of the felt"
  );
  assert.match(
    vignette[0],
    /offset=\{1\}\s+stopColor=\{Lantern\.vignette\}/,
    "the vignette does not reach its full darkness at the rim"
  );
  assert.equal(
    (source.match(/<LinearGradient/g) ?? []).length,
    0,
    "the felt has gone back to linear pieces, which stop mid-felt and draw their " +
      "inner edges as lines across the table"
  );
});

// SVG has no `rx`/`ry` on `radialGradient`. react-native-svg accepts them and
// passes them through, so an elliptical pool authored that way type-checks,
// renders on native, and on web silently falls back to `r="50%"` — a pool a
// third wider than written, washing the lit stop across the whole felt.
// Nothing else in the suite can see it: the shape is the browser's.
test("every radial states its shape as a transform, never as rx/ry", () => {
  const radials = source.match(/<RadialGradient[\s\S]*?>/g) ?? [];
  assert.ok(radials.length >= 4, `only ${radials.length} radials found in the felt`);
  for (const radial of radials) {
    const id = /id=\{(\w+)\}/.exec(radial)?.[1] ?? radial;
    assert.ok(!/\brx=/.test(radial) && !/\bry=/.test(radial), `${id} sizes itself with rx/ry`);
    assert.match(radial, /gradientTransform=/, `${id} has no shape at all`);
  }
});

// The floor: the scan above must fail on the shape it exists to find. Pinning
// the count alone would pass against a file that had gone back to rx/ry.
test("the scan finds an rx/ry radial when one is there", () => {
  const planted = '<RadialGradient id={FIELD_ID} cx="50%" rx="38%" ry="50%">';
  assert.ok(/\brx=/.test(planted) && /\bry=/.test(planted));
  assert.ok(!/gradientTransform=/.test(planted));
});

test("the vignette is drawn outside the pool, so the lamp can move under it", () => {
  // The pool sits inside the Animated.View that carries the lamp's position;
  // the vignette must not, or the dark rim swings with the light.
  const pool = source.match(/<Animated\.View[\s\S]*?<\/Animated\.View>/);
  assert.ok(pool, "the pool is no longer the thing that moves");
  assert.ok(
    !pool[0].includes("VIGNETTE_ID"),
    "the vignette is inside the layer the lamp animates, so it travels with the light"
  );
  assert.match(pool[0], /FIELD_ID/, "the field itself is not in the layer that moves");
});

test("the lamp moves by transform alone", () => {
  // Gradients only, transform and opacity only: a gradient rewritten per frame
  // is paint the browser cannot composite, and on web reanimated writes it
  // from the main JS thread.
  const animated = source.match(/useAnimatedStyle\(\(\) => \(\{[\s\S]*?\}\)\);/);
  assert.ok(animated, "the pool no longer animates through useAnimatedStyle");
  assert.match(animated[0], /transform:\s*\[/);
  assert.ok(
    !/(cx|cy|rx|ry|stopColor|backgroundColor):/.test(animated[0]),
    `the lamp animates something other than a transform: ${animated[0]}`
  );
});
