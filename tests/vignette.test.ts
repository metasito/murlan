// tests/vignette.test.ts — the felt's vignette has no hard edges in it.
//
// A LinearGradient over a box reaches "transparent" only at the end of its own
// axis. A piece inset on both axes — a corner square — therefore still carries
// ink along the two edges that face the middle of the table, and draws them as
// straight lines across the felt. Four such pieces drew a visible grid on any
// screen large enough to spread them out.
//
// A piece that spans a full edge cannot do that: the edges where it still
// carries ink are the screen's own. Structural, like tests/orientation.test.ts
// — the property is about how the styles are written, so it is checked by
// reading them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(path.join(repoRoot, "components/GameShared.tsx"), "utf8");

/** The `vignetteStyles` block, entry by entry. */
function vignettePieces(): { name: string; body: string }[] {
  const block = source.match(/const vignetteStyles = StyleSheet\.create\(\{([\s\S]*?)\n\}\);/);
  assert.ok(block, "vignetteStyles is no longer where this test looks for it");
  return [...block[1].matchAll(/^\s{2}(\w+):\s*\{([^}]*)\}/gm)].map((m) => ({
    name: m[1],
    body: m[2],
  }));
}

test("every vignette piece spans a full edge of the felt", () => {
  const pieces = vignettePieces();
  assert.ok(pieces.length >= 4, `expected the four edge bands, found ${pieces.length}`);

  for (const { name, body } of pieces) {
    const spansWidth = /\bleft:\s*0\b/.test(body) && /\bright:\s*0\b/.test(body);
    const spansHeight = /\btop:\s*0\b/.test(body) && /\bbottom:\s*0\b/.test(body);
    assert.ok(
      spansWidth || spansHeight,
      `vignetteStyles.${name} is inset on both axes, so its gradient stops mid-felt ` +
        `and draws its inner edges as lines across the table. A vignette piece must ` +
        `span the full width or the full height.`
    );
  }
});
