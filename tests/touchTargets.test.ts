// tests/touchTargets.test.ts — nothing in the repo measured a touch target.
//
// tests/e2e/tapTargets.spec.ts is named for them but checks occlusion only:
// whether a control's centre point belongs to something inert. A control can
// pass that while being 32pt tall.
//
// The size sweep lives in the e2e spec, where a rect can actually be measured.
// This is the half that runs in CI: every pressable node in the app, and the
// box its declared styles give it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Spacing, TOUCH_TARGET_MIN } from "../lib/tokens.ts";
import { physicalTouchTarget } from "../components/cardFaceModel.ts";
import { ACTION_BTN_FLOOR, actionBtnSize } from "../components/gameTableModel.ts";
import {
  blankComments,
  declaredBox,
  hitSlopGrowth,
  pressableNodes,
  scannedFiles,
  styleSheetEntries,
} from "./helpers/sourceScan.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Pressables whose box is a number computed at render, so there is no style to read. Each
 * names where the number comes from; the arithmetic itself is asserted further down, which
 * is the half a source scan cannot do.
 */
const SIZED_AT_RUNTIME: [string, number, string][] = [
  ["components/GameTable.tsx", 2, "PASSA and GIOCA take `actionBtnSize(scale)`, floored at ACTION_BTN_FLOOR"],
  ["components/table/chrome.tsx", 1, "the rail's knobs take `physicalTouchTarget(scale)`, floored at TOUCH_TARGET_MIN"],
  ["components/MenuButton.tsx", 1, "the box is `styles[size]`, one of three steps the scan reads as declared styles in their own right"],
  ["components/GameOverOverlay.tsx", 1, "the rematch button's box is the gradient it wraps, which declares the floor"],
  ["components/table/settingsSheet.tsx", 1, "the exit button's box is the gradient it wraps, sized `EXIT_PAD_V * scale`"],
];

/**
 * Pressables that are not control-sized boxes: a whole card, a surface, a dismiss scrim. The
 * count per file is the point — a file named here would otherwise absorb the next real
 * control added to it silently, which is the curated list's blind spot one level up.
 */
const NOT_A_TARGET: [string, number, string][] = [
  ["components/CardView.tsx", 1, "a playing card, sized CARD_W x CARD_H — the hand's geometry, not a control's"],
  ["components/ExchangeModal.tsx", 1, "a playing card offered for exchange, same geometry"],
  ["components/ExchangeAnnouncement.tsx", 1, "the announcement card itself: tap anywhere on it to dismiss"],
  ["components/NotificationBanner.tsx", 1, "the banner body — the whole banner is the target"],
  ["components/table/chrome.tsx", 1, "the start-reason toast: a full-width surface, tap anywhere to dismiss"],
  ["components/table/settingsSheet.tsx", 1, "the veil, which covers the table beside the rail"],
  ["app/(online)/quickmatch.tsx", 1, "a mode card, laid out at card size rather than control size"],
];

/**
 * Controls measured under the floor. Listed rather than fixed here, each against the issue
 * that owns it: raising any of these moves a laid-out screen by more than a hairline, which
 * is a design change and not a guard's to make. Adding to this list is how the debt stays
 * visible — a new undersized control cannot land without naming itself here. Empty is the
 * goal, not the invariant.
 */
const UNDER_THE_FLOOR: [string, number, string][] = [
  ["app/(online)/friends.tsx", 1, "the send button is a 36pt circle; #493"],
  ["app/(online)/index.tsx", 1, "the error banner's close is a 16pt icon with 12pt of slop, so 40pt; #493"],
  ["app/(online)/room.tsx", 1, "an invite row is 36pt in landscape, which is the orientation the game plays in; #493"],
  ["components/ReplayControls.tsx", 1, "a move row is one text line inside 4pt of padding; #493"],
  ["app/index.tsx", 2, "the logout button is caption text inside 2pt of padding; #493"],
];

type Candidate = { file: string; line: number; effective: number | null };

/**
 * Every pressable node in the app, with the box its declared styles give it.
 *
 * A style sheet and the node wearing it need not share a file, so an accessor declared
 * anywhere is offered to every file that names its object — the hole that made
 * `rotateOverlay` invisible to #404's first draft, one guard over.
 *
 * `null` means no style it wears declares a size at all. That is not a pass: a box that
 * comes from padding, from flex or from a runtime prop is not decidable from source, which
 * is exactly why the caller refuses it rather than judging it.
 */
export function pressableBoxes(files: string[], read: (rel: string) => string): Candidate[] {
  const sources = new Map(files.map((f) => [f, blankComments(read(f))]));
  const sheets = new Map([...sources].map(([f, s]) => [f, styleSheetEntries(s)]));
  const declaredIn = new Map<string, { file: string; body: string }>();
  for (const [file, entries] of sheets) {
    for (const [accessor, body] of entries) declaredIn.set(accessor, { file, body });
  }

  const out: Candidate[] = [];
  for (const [file, source] of sources) {
    const local = sheets.get(file)!;
    for (const node of pressableNodes(source)) {
      const bodies = node.accessors
        .map((a) => {
          const here = local.get(a);
          if (here !== undefined) return here;
          const elsewhere = declaredIn.get(a);
          const named = new RegExp(String.raw`\b${a.split(".")[0]}\b`).test(source);
          return elsewhere && named ? elsewhere.body : undefined;
        })
        .filter((b): b is string => b !== undefined);

      // A layer that covers its whole parent is self-evidently larger than a thumb.
      if (
        node.accessors.includes("StyleSheet.absoluteFill") ||
        bodies.some((b) => /absoluteFillObject/.test(b))
      ) {
        continue;
      }
      const sizes = bodies
        .map((b) => declaredBox(b, TOUCH_TARGET_MIN))
        .filter((n): n is number => n !== null);
      out.push({
        file,
        line: node.line,
        effective: sizes.length ? Math.max(...sizes) + hitSlopGrowth(node.tag, Spacing) : null,
      });
    }
  }
  return out;
}

const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

test("the touch minimum is the iOS HIG floor", () => {
  assert.equal(TOUCH_TARGET_MIN, 44);
});

// The scan does not decide whether an undeclared box is big enough — it cannot, from source.
// It only refuses a control nobody has ruled on, so forgetting one is a red build rather than
// a silent hole. #393 promoted a control whose style already declared the floor as a literal,
// absent from every list here; nothing would have noticed had it been 32.
test("every control's touch size has been ruled on", () => {
  const candidates = pressableBoxes(scannedFiles(repoRoot), read);
  const byFile = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (c.effective !== null && c.effective >= TOUCH_TARGET_MIN) continue;
    byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  }

  const claimed = (file: string) =>
    [SIZED_AT_RUNTIME, NOT_A_TARGET, UNDER_THE_FLOOR]
      .flat()
      .filter(([f]) => f === file)
      .reduce((n, [, c]) => n + c, 0);

  const unruled: string[] = [];
  for (const [file, found] of byFile) {
    if (claimed(file) === found.length) continue;
    const shown = found.map(
      (c) => `      line ${c.line}: ${c.effective === null ? "no declared box" : `${c.effective}pt`}`
    );
    unruled.push([`${file}: ${found.length} unmeasured, ${claimed(file)} classified`, ...shown].join("\n"));
  }

  assert.deepEqual(
    unruled,
    [],
    "classify each of these into SIZED_AT_RUNTIME, NOT_A_TARGET or UNDER_THE_FLOOR — a control " +
      `nobody has ruled on is a control nobody has measured:\n  ${unruled.join("\n  ")}`
  );
});

// Without this the suite above passes on a scan that finds nothing, which is what a broken
// reader looks like: no candidates, no failures, green.
test("the scan finds the app's controls, and reads a real box", () => {
  const candidates = pressableBoxes(scannedFiles(repoRoot), read);
  assert.ok(candidates.length > 80, `only ${candidates.length} pressables found`);
  assert.ok(
    candidates.filter((c) => c.effective !== null).length > 50,
    "no candidate has a box the reader could measure"
  );
  // MenuButton is the in-repo reference for what this project considers a correct control.
  const md = styleSheetEntries(read("components/MenuButton.tsx")).get("sizeStyles.md");
  assert.ok(md, "MenuButton no longer declares a md size");
  assert.equal(declaredBox(md, TOUCH_TARGET_MIN), 52);
});

test("a control nobody has ruled on fails, naming itself", () => {
  const seeded = new Map(scannedFiles(repoRoot).map((f) => [f, read(f)]));
  seeded.set(
    "components/Seeded.tsx",
    `const styles = StyleSheet.create({ tiny: { height: 20 } });\n` +
      `export const S = () => <Pressable style={styles.tiny} onPress={go} />;\n`
  );
  const found = pressableBoxes([...seeded.keys()], (f) => seeded.get(f)!).filter(
    (c) => c.file === "components/Seeded.tsx"
  );
  assert.deepEqual(found, [{ file: "components/Seeded.tsx", line: 2, effective: 20 }]);
});

// A file already in a list is the case a plain per-file exemption gets wrong: it clears the
// file, and the next control added to it inherits the clearance.
test("a second control in a classified file is not absorbed by its entry", () => {
  const file = "components/table/settingsSheet.tsx";
  const seeded = new Map(scannedFiles(repoRoot).map((f) => [f, read(f)]));
  seeded.set(
    file,
    seeded.get(file)! + `\nexport const Extra = () => <Pressable style={sheetStyles.exitPressed} onPress={go} />;\n`
  );
  const before = pressableBoxes(scannedFiles(repoRoot), read).filter((c) => c.file === file).length;
  const after = pressableBoxes([...seeded.keys()], (f) => seeded.get(f)!).filter(
    (c) => c.file === file
  ).length;
  assert.equal(after, before + 1, "the scan counts nodes, so an extra one cannot hide behind an entry");
});

test("the rail's knobs are sized by physicalTouchTarget, at the HIG floor", () => {
  const source = read("components/GameTable.tsx");
  assert.match(source, /const knobSize = physicalTouchTarget\(scale\)/);
  assert.match(source, /size=\{knobSize\}/);
  // A touch target's floor is physical size, never `TOUCH_TARGET_MIN * s`: on
  // an iPhone SE the table's scale is 0.82, which would put a scaled knob at
  // 36pt.
  assert.equal(physicalTouchTarget(0.82), TOUCH_TARGET_MIN);
  assert.equal(physicalTouchTarget(1), TOUCH_TARGET_MIN);
  assert.ok(physicalTouchTarget(1.13) > TOUCH_TARGET_MIN);
});

// PASSA and GIOCA are the two most-pressed controls in the app, and the only
// ones whose box is a square that scales: `56 * s`, floored at 48pt physical.
// The floor is the part that matters — on an iPhone SE the table's scale is
// 0.82, which would put a scaled key at 46pt.
test("the action buttons are square, scale up, and never fall below a thumb", () => {
  const source = read("components/GameTable.tsx");
  assert.match(source, /const actionBtn = actionBtnSize\(scale\)/);
  // Both buttons take the same box, and take it as a square.
  assert.equal((source.match(/size=\{actionBtn\}/g) ?? []).length, 2);
  assert.match(source, /width: size, height: size/);

  assert.equal(actionBtnSize(0.82), ACTION_BTN_FLOOR);
  assert.equal(actionBtnSize(1), 56);
  assert.ok(actionBtnSize(2) > actionBtnSize(1), "the key does not grow with the table");
});
