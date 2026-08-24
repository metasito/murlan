// tests/vignette.test.ts — the felt's vignette has no hard edges in it.
//
// A linear gradient over a box reaches "transparent" only at the end of its
// own axis, so a piece inset on both axes still carries ink along the two
// edges facing the middle of the table and draws them as lines across the
// felt. One radial over the whole felt cannot do that — and it has to stay its
// own layer, because folded into the pool it would travel with the lamp, and a
// vignette that moves is a moving frame rather than a dark rim.
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
    /stop\(Lantern\.vignetteClear\)/,
    "the vignette does not start transparent, so it darkens the middle of the felt"
  );
  assert.match(
    vignette[0],
    /offset=\{1\}\s+\{\.\.\.stop\(Lantern\.vignette\)\}/,
    "the vignette does not reach its full darkness at the rim"
  );
  assert.equal(
    (source.match(/<LinearGradient/g) ?? []).length,
    0,
    "the felt has gone back to linear pieces, which stop mid-felt and draw their " +
      "inner edges as lines across the table"
  );
});

// Neither way of stating an ellipse *on* a radialGradient survives both
// platforms. `rx`/`ry` is what react-native-svg's native path reads and what
// SVG has no such attribute for, so every browser ignores it and draws a
// circle. `gradientTransform` is what a browser honours and what the native
// path pushes through a user-space matrix, where the unit-space translate that
// centres it means nothing — which is how the felt came to render as one black
// rectangle on iOS while every web check passed. The shape lives on the rect.
/** Every radial in a file that shapes itself, by id. Empty is the passing state. */
function selfShapedRadials(text: string): string[] {
  const radials = text.match(/<RadialGradient[\s\S]*?>/g) ?? [];
  return radials
    .filter((r) => /\s(rx|ry|gradientTransform)=/.test(r))
    .map((r) => /id=\{(\w+)\}/.exec(r)?.[1] ?? r);
}

/**
 * Every rect a *radial* is painted into, as `WxH` expressions. Keyed off the
 * ids actually declared as RadialGradient in the same source, so the weave's
 * pattern fills — which are tiled and have no shape of their own — are not
 * mistaken for one. A radial is a circle on the native path whatever the box
 * says, so any box that is not square is a shape the platforms disagree about.
 */
function radialRects(text: string): string[] {
  const ids = new Set(
    [...text.matchAll(/<RadialGradient\s+id=\{(\w+)\}/g)].map((m) => m[1])
  );
  return [
    ...text.matchAll(
      /<Rect\s+width=\{([^}]+)\}\s+height=\{([^}]+)\}\s+fill=\{`url\(#\$\{(\w+)\}\)`\}/g
    ),
  ]
    .filter((m) => ids.has(m[3]))
    .map((m) => `${m[1]}x${m[2]}`);
}

/** …and the ones that are not square, which is the failing state. */
const oblong = (rects: string[]) => rects.filter((r) => r.split("x")[0] !== r.split("x")[1]);

test("no radial is asked for an ellipse — the view it sits in is stretched", () => {
  const rects = radialRects(source);
  assert.ok(rects.length >= 4, `only ${rects.length} radial-filled rects found in the felt`);
  assert.deepEqual(
    oblong(rects),
    [],
    "a radial is painted into an oblong box. A browser draws the ellipse inscribed " +
      "in it; react-native-svg reads `r` as one scalar and draws a circle, so the " +
      "lamp lit a disc round the seat on move and left the rest of the felt dark."
  );
  // …and the ellipse is arrived at some other way, rather than lost. The
  // viewport is the only mechanism both platforms honour — a scale on the view
  // around the SVG never reaches the native paint. tests/native/feltEllipse
  // checks the props that reach the renderer; this checks it is still written
  // that way at all.
  assert.match(
    source,
    /preserveAspectRatio: PRESERVE_NONE/,
    "nothing stretches the squares into ellipses"
  );
  assert.equal(
    (source.match(/scaleX:/g) ?? []).length,
    0,
    "the ellipse is back on a view transform, which the native renderer ignores"
  );
});

// The floor. The scan reads the file, so a pattern that had drifted off the
// markup would report "no oblong rects" for a felt made entirely of them.
test("the scan can see an oblong radial box", () => {
  const decl = '<RadialGradient id={FIELD_ID}>';
  const planted = `${decl}<Rect width={poolW} height={poolH} fill={\`url(#\${FIELD_ID})\`} />`;
  assert.deepEqual(oblong(radialRects(planted)), ["poolWxpoolH"]);
  const square = `${decl}<Rect width={POOL_UNITS} height={POOL_UNITS} fill={\`url(#\${FIELD_ID})\`} />`;
  assert.deepEqual(oblong(radialRects(square)), []);
  // A pattern fill is not a radial, and must not be counted as one.
  assert.deepEqual(radialRects('<Rect width={w} height={h} fill={\`url(#\${WEAVE_LIGHT_ID})\`} />'), []);
  assert.deepEqual(radialRects("nothing here"), []);
});

test("no radial states its own shape — the rect it fills does", () => {
  const radials = source.match(/<RadialGradient[\s\S]*?>/g) ?? [];
  assert.ok(radials.length >= 4, `only ${radials.length} radials found in the felt`);
  assert.deepEqual(
    selfShapedRadials(source),
    [],
    "these radials size themselves, and no way of doing so renders the same on web and native"
  );
});

// The floor. The scan is run against a planted copy of each defect rather than
// re-tested by hand: a scan whose own pattern has drifted still passes a
// hand-written check of what the pattern used to be, which is how a guard
// comes to inspect nothing.
test("the scan finds a self-shaped radial of either kind", () => {
  for (const planted of [
    '<RadialGradient id={FIELD_ID} rx="38%" ry="50%">',
    '<RadialGradient id={FIELD_ID} gradientTransform="scale(1.5)">',
  ]) {
    assert.deepEqual(selfShapedRadials(planted), ["FIELD_ID"]);
  }
  // …and the felt is written in the form those fixtures model, so a scan that
  // only ever passes because the file stopped looking like this cannot.
  assert.match(source, /<RadialGradient id=\{FIELD_ID\}>/);
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

test("the lamp moves by position on native and by transform on web", () => {
  // Native reads the anchor's bounds and never an ancestor's transform
  // (felt.tsx's header); web composites the transform and keeps a 2560x1440
  // subtree off the layout path. Either way it is position or transform — a
  // gradient rewritten per frame is paint no platform can composite.
  const animated = source.match(/const poolStyle = useAnimatedStyle\([\s\S]*?\);\n/);
  assert.ok(animated, "the pool no longer animates through useAnimatedStyle");
  assert.match(animated[0], /Platform\.OS === "web"/, "web still swings the anchor's frame");
  assert.match(animated[0], /translateX: x\.value/);
  assert.match(animated[0], /left: x\.value/);
  assert.match(animated[0], /top: y\.value/);
  assert.ok(
    !/(cx|cy|rx|ry|stopColor|backgroundColor):/.test(animated[0]),
    `the lamp animates something the compositor cannot take: ${animated[0]}`
  );
});
