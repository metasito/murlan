// tests/stackingIsStated.test.ts — an opaque sibling that fills its parent must
// say whether it is above or below what it covers.
//
// Web and Android paint siblings in tree order, so writing the cover first and
// the content after reads correctly on both and needs no `zIndex`. The iOS
// renderer does not promise that order. #209 spent three sessions on it: the
// felt's pool painted over the seats, the pile, the hand and every button, and
// the fix was to state `zIndex` on both rather than to move either.
//
// The scan is narrow on purpose. A full-bleed view with no background covers no
// pixels, and one whose parent is the screen is a blocking overlay, which is
// `tests/blockingOverlays.test.ts`'s question. What is left is the small case:
// a glow, a veil or a wash filling one control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { blankComments, scannedFiles, styleSheetEntries } from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** All four edges pinned to its parent, which is what makes it a cover. */
function fillsItsParent(body: string): boolean {
  return (
    /position:\s*["']absolute["']/.test(body) &&
    /(^|[^\w])top:\s*0/.test(body) &&
    /(^|[^\w])bottom:\s*0/.test(body) &&
    /(^|[^\w])left:\s*0/.test(body) &&
    /(^|[^\w])right:\s*0/.test(body)
  );
}

/** It paints. `transparent` covers nothing, so it cannot take anyone's place. */
function isOpaque(body: string): boolean {
  return /backgroundColor:/.test(body) && !/backgroundColor:\s*["']transparent["']/.test(body);
}

const declaresZ = (text: string): boolean => /zIndex:/.test(text);

/**
 * Every style in the tree that fills its parent and paints, as
 * `file` + `object.name` + whether the block itself states its stacking.
 */
function covers(): { rel: string; name: string; inSheet: boolean; source: string }[] {
  const out: { rel: string; name: string; inSheet: boolean; source: string }[] = [];
  for (const rel of scannedFiles(repoRoot)) {
    const source = blankComments(readFileSync(path.join(repoRoot, rel), "utf8"));
    for (const [name, body] of styleSheetEntries(source)) {
      if (!fillsItsParent(body) || !isOpaque(body)) continue;
      out.push({ rel, name, inSheet: declaresZ(body), source });
    }
  }
  return out;
}

/**
 * The style may state its stacking at the call site instead — `settingsSheet`
 * sets both horizontal edges and its `zIndex` per render, because which side
 * the rail is on decides them. So a name is answered for if *every* line that
 * wears it carries a `zIndex`, and unanswered if any one does not.
 */
function wornWithoutZ(source: string, name: string): number {
  return source
    .split(/\r?\n/)
    .filter((line) => new RegExp(String.raw`\b${name.replace(".", "\\.")}\b`).test(line))
    .filter((line) => !declaresZ(line)).length;
}

test("every opaque full-bleed style says whether it is above or below", () => {
  const offenders = covers()
    .filter((c) => !c.inSheet && wornWithoutZ(c.source, c.name) > 0)
    .map((c) => `${c.rel}: ${c.name}`);
  assert.deepEqual(
    offenders,
    [],
    "these fill their parent and paint over it, with nothing saying which of the two is on " +
      "top. Web and Android read tree order; iOS does not promise to (#209). State `zIndex` " +
      "on this style and on what it covers:\n  " + offenders.join("\n  ")
  );
});

// The floor. This scan can only ever go red on a style someone adds later, so
// its own predicates are what have to be tested — a `fillsItsParent` that
// matched nothing would pass the test above forever.
test("the predicates still recognise a cover, and still ignore what covers nothing", () => {
  const full = 'position: "absolute", top: 0, left: 0, right: 0, bottom: 0,';
  assert.ok(fillsItsParent(full));
  assert.ok(!fillsItsParent('position: "absolute", top: 0, left: 0,'), "three edges is not a fill");
  assert.ok(!fillsItsParent('top: 0, left: 0, right: 0, bottom: 0,'), "static flow is not a cover");
  // `borderTopWidth: 0` and `paddingTop: 0` are not `top: 0`.
  assert.ok(!fillsItsParent('position: "absolute", borderTopWidth: 0, paddingBottom: 0'));

  assert.ok(isOpaque("backgroundColor: Colors.gold"));
  assert.ok(!isOpaque('backgroundColor: "transparent"'), "transparent covers no pixels");
  assert.ok(!isOpaque("borderColor: Colors.gold"), "a border is not a fill");
});

test("a call site may state the stacking the sheet leaves open", () => {
  const src = ["style={[s.veil, { zIndex: SHEET_Z }]}", "style={[s.other]}"].join("\n");
  assert.equal(wornWithoutZ(src, "s.veil"), 0, "the call site states it");
  assert.equal(wornWithoutZ(src, "s.other"), 1, "nothing states it");
});

// Without this the scan silently covers nothing: a helper that walked no files,
// or predicates that matched none of them, is clean under every assertion above.
test("the scan reaches the styles it exists for", () => {
  const found = covers().map((c) => `${c.rel}: ${c.name}`);
  for (const name of [
    "components/table/hand.tsx: handStyles.ungiveableVeil",
    "components/table/hand.tsx: handStyles.giveableGlow",
    "components/GameTable.tsx: styles.playBtnGlow",
  ]) {
    assert.ok(found.includes(name), `${name} is the case this scan exists for, and it missed it`);
  }
});
