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
 * Pressables whose box is a number computed at render, so there is no style to read. Each names
 * where the number comes from. The two that scale with the table have their arithmetic asserted
 * at the bottom of this file, which is the half a source scan cannot do; the other two are read
 * off a style the scan does see, one indirection away.
 */
const SIZED_AT_RUNTIME: [string, number, string][] = [
  ["components/table/actions.tsx", 2, "PASSA and GIOCA take `actionBtnSize(scale)`, floored at ACTION_BTN_FLOOR"],
  ["components/table/chrome.tsx", 1, "the rail's knobs take `physicalTouchTarget(scale)`, floored at TOUCH_TARGET_MIN"],
  ["components/MenuButton.tsx", 1, "the box is `styles[size]`, one of three steps the scan reads as declared styles in their own right"],
  ["components/table/settingsSheet.tsx", 1, "the exit button's box is the gradient it wraps, floored at `physicalTouchTarget(scale)`"],
  ["app/(online)/index.tsx", 1, "the error banner's close is a 16pt icon reaching the floor through `hitSlop`"],
  ["app/(online)/room.tsx", 1, "an invite row takes `{ height: ROW_H }` inline, and ROW_H is the token"],
];

/**
 * Pressables that are not control-sized boxes: a whole card, a surface, a dismiss scrim. The
 * count per file is the point — a file named here would otherwise absorb the next real
 * control added to it silently, which is the curated list's blind spot one level up.
 */
const NOT_A_TARGET: [string, number, string][] = [
  ["components/CardView.tsx", 1, "a playing card, sized CARD_W x CARD_H — the hand's geometry, not a control's"],
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
];

type Candidate = { file: string; line: number; width: number | null; height: number | null };

/** Whether `source` imports `object` from somewhere else, rather than declaring it. */
const imports = (source: string, object: string) =>
  new RegExp(String.raw`import\s[^;]*\b${object}\b[^;]*from`).test(source);

/**
 * Every pressable node in the app, with the box its declared styles give it, per dimension.
 *
 * A style sheet and the node wearing it need not share a file — `rotateOverlay.tsx` wears
 * `portraitOverlayStyles.overlay`, which `chrome.tsx` declares — so an accessor this file does
 * not declare is looked up elsewhere. Only when this file actually *imports* that object:
 * 78 accessor names are declared in more than one file, `styles` above all, and matching on the
 * bare name lets a pressable borrow an unrelated file's box and pass on it.
 *
 * A `null` dimension is one no style it wears declares. That is not a pass: a box that comes
 * from padding, from flex or from a runtime prop is not decidable from source, which is exactly
 * why the caller refuses it rather than judging it.
 */
export function pressableBoxes(files: string[], read: (rel: string) => string): Candidate[] {
  const sources = new Map(files.map((f) => [f, blankComments(read(f))]));
  const sheets = new Map([...sources].map(([f, s]) => [f, styleSheetEntries(s)]));
  const declaredIn = new Map<string, string>();
  for (const [, entries] of sheets) {
    for (const [accessor, body] of entries) declaredIn.set(accessor, body);
  }

  const out: Candidate[] = [];
  for (const [file, source] of sources) {
    const local = sheets.get(file)!;
    const declaresObject = new Set([...local.keys()].map((a) => a.split(".")[0]));
    for (const node of pressableNodes(source)) {
      const bodies = node.accessors
        .map((a) => {
          const here = local.get(a);
          if (here !== undefined) return here;
          const object = a.split(".")[0];
          if (declaresObject.has(object) || !imports(source, object)) return undefined;
          return declaredIn.get(a);
        })
        .filter((b): b is string => b !== undefined);

      // A layer that covers its whole parent is self-evidently larger than a thumb.
      if (
        node.accessors.includes("StyleSheet.absoluteFill") ||
        bodies.some((b) => /absoluteFillObject/.test(b))
      ) {
        continue;
      }
      const slop = hitSlopGrowth(node.tag, Spacing);
      const grown = (n: number | null) => (n === null ? null : n + slop);
      const boxes = bodies.map((b) => declaredBox(b, TOUCH_TARGET_MIN));
      const widest = (side: "width" | "height") => {
        const found = boxes.map((b) => b[side]).filter((n): n is number => n !== null);
        return found.length ? Math.max(...found) : null;
      };
      out.push({
        file,
        line: node.line,
        width: grown(widest("width")),
        height: grown(widest("height")),
      });
    }
  }
  return out;
}

/** A dimension a style declares must reach the floor; one none of them declares is a question. */
const measuresUp = (c: Candidate) =>
  (c.width !== null || c.height !== null) &&
  (c.width ?? TOUCH_TARGET_MIN) >= TOUCH_TARGET_MIN &&
  (c.height ?? TOUCH_TARGET_MIN) >= TOUCH_TARGET_MIN;

const read = (rel: string) => readFileSync(path.join(repoRoot, rel), "utf8");

test("the touch minimum is the iOS HIG floor", () => {
  assert.equal(TOUCH_TARGET_MIN, 44);
});

// The scan does not decide whether an undeclared box is big enough — it cannot, from source.
// It only refuses a control nobody has ruled on, so forgetting one is a red build rather than
// a silent hole. #393 promoted a control whose style already declared the floor as a literal,
// absent from every list here; nothing would have noticed had it been 32.
test("every control's touch size has been ruled on", () => {
  const byFile = new Map<string, Candidate[]>();
  for (const c of pressableBoxes(scannedFiles(repoRoot), read)) {
    if (measuresUp(c)) continue;
    byFile.set(c.file, [...(byFile.get(c.file) ?? []), c]);
  }

  const lists = [SIZED_AT_RUNTIME, NOT_A_TARGET, UNDER_THE_FLOOR].flat();
  const claimed = (file: string) =>
    lists.filter(([f]) => f === file).reduce((n, [, c]) => n + c, 0);

  // Every file either list names, so a claim that no longer matches anything is a failure too:
  // a stale entry is a claim going spare, and the next control added to that file inherits it.
  const files = new Set([...byFile.keys(), ...lists.map(([f]) => f)]);
  const wrong: string[] = [];
  for (const file of files) {
    const found = byFile.get(file) ?? [];
    if (claimed(file) === found.length) continue;
    const shown = found.map(
      (c) => `      line ${c.line}: ${c.width ?? "?"} x ${c.height ?? "?"}`
    );
    wrong.push([`${file}: ${found.length} unmeasured, ${claimed(file)} classified`, ...shown].join("\n"));
  }

  assert.deepEqual(
    wrong,
    [],
    "each of these needs one entry in SIZED_AT_RUNTIME, NOT_A_TARGET or UNDER_THE_FLOOR, and no " +
      "more: a control nobody has ruled on is a control nobody has measured, and a claim with " +
      "nothing left to cover is one the next control will inherit"
  );
});

// Without this the suite above passes on a scan that finds nothing, which is what a broken
// reader looks like: no candidates, no failures, green.
//
// A floor against the reader breaking, never a census: it sits below the real
// count on purpose, so adding a control does not redden it. It has moved down
// once — #671 replaced hand-rolled controls with shared components, which
// genuinely removes Pressables — and a move down is the direction that weakens
// this, so it is stated rather than quietly re-fitted. 70 of the 80 the scan
// reads today; anything that halves the count is the broken reader this exists
// to catch.
const PRESSABLE_FLOOR = 70;

test("the scan finds the app's controls, and reads a real box", () => {
  const candidates = pressableBoxes(scannedFiles(repoRoot), read);
  assert.ok(
    candidates.length > PRESSABLE_FLOOR,
    `only ${candidates.length} pressables found, against a floor of ${PRESSABLE_FLOOR}`
  );
  assert.ok(
    candidates.filter(measuresUp).length > 50,
    "no candidate has a box the reader could measure"
  );
  // MenuButton is the in-repo reference for what this project considers a correct control.
  const md = styleSheetEntries(read("components/MenuButton.tsx")).get("sizeStyles.md");
  assert.ok(md, "MenuButton no longer declares a md size");
  assert.deepEqual(declaredBox(md, TOUCH_TARGET_MIN), { width: null, height: 52 });
});

test("a box has to clear the floor in both dimensions, and only its own", () => {
  const box = (body: string) => declaredBox(body, TOUCH_TARGET_MIN);
  const at = (width: number | null, height: number | null) => ({ file: "x", line: 1, width, height });

  // A 200pt-wide control 20pt tall is a 20pt-tall control.
  assert.deepEqual(box("width: 200, height: 20"), { width: 200, height: 20 });
  assert.equal(measuresUp(at(200, 20)), false);
  assert.equal(measuresUp(at(44, 44)), true);
  // One dimension declared and one from padding: the declared half is all there is to check.
  assert.equal(measuresUp(at(null, 44)), true);
  assert.equal(measuresUp(at(null, 20)), false);
  assert.equal(measuresUp(at(null, null)), false, "an undeclared box is a question, not a pass");

  // An offset is not a box.
  assert.deepEqual(box("height: 20, shadowOffset: { width: 44, height: 44 }"), {
    width: null,
    height: 20,
  });
  assert.deepEqual(box("minHeight: TOUCH_TARGET_MIN"), { width: null, height: 44 });
});

test("a pressable cannot borrow a same-named style from a file it does not import", () => {
  const seeded = new Map([
    ["components/Big.tsx", `const styles = StyleSheet.create({ btn: { height: 60, width: 60 } });\n`],
    [
      "components/Small.tsx",
      `const styles = StyleSheet.create({ other: { height: 60 } });\n` +
        `export const S = () => <Pressable style={styles.btn} onPress={go} />;\n`,
    ],
  ]);
  const found = pressableBoxes([...seeded.keys()], (f) => seeded.get(f)!);
  assert.deepEqual(found, [{ file: "components/Small.tsx", line: 2, width: null, height: null }]);
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
  assert.deepEqual(found, [{ file: "components/Seeded.tsx", line: 2, width: null, height: 20 }]);
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

// The three whose box is real but unreadable from a style sheet. Each is in SIZED_AT_RUNTIME,
// and a classification only says someone looked — these say what they looked at.
test("the settings sheet's exit floors rather than scales", () => {
  const source = read("components/table/settingsSheet.tsx");
  assert.match(source, /minHeight: physicalTouchTarget\(scale\)/);
  const num = (name: string) => {
    const m = new RegExp(String.raw`const ${name} = ([\d.]+);`).exec(source);
    assert.ok(m, `${name} is gone, so the arithmetic below proves nothing`);
    return Number(m[1]);
  };
  // Padding around a scaled label, which is what it had, shrinks straight through the floor.
  const unfloored = (s: number) => num("EXIT_PAD_V") * 2 * s + num("EXIT_FS") * s;
  assert.ok(unfloored(1) < TOUCH_TARGET_MIN, "the floor is doing nothing at scale 1");
  assert.ok(unfloored(0.82) < unfloored(1), "the box shrinks with the table");
  assert.equal(physicalTouchTarget(0.82), TOUCH_TARGET_MIN);
});

test("the error banner's close reaches the floor on slop, having no room for a box", () => {
  const source = read("app/(online)/index.tsx");
  const tag = /<Pressable\s+onPress=\{clearError\}\s+hitSlop=\{Spacing\.(\w+)\}/.exec(source);
  assert.ok(tag, "the close button no longer takes its reach from hitSlop");
  const icon = /name="close"\s+size=\{(\d+)\}/.exec(source);
  assert.ok(icon, "the close button no longer wraps a sized icon");
  const inset = Spacing[tag[1] as keyof typeof Spacing];
  assert.ok(
    Number(icon[1]) + inset * 2 >= TOUCH_TARGET_MIN,
    `${icon[1]}pt icon plus ${inset}pt each side is ${Number(icon[1]) + inset * 2}pt`
  );
});

test("an invite row is a touch target in both orientations", () => {
  const source = read("app/(online)/room.tsx");
  assert.match(source, /const ROW_H = TOUCH_TARGET_MIN;/);
  // The list does not scroll, so landscape buys the taller row by showing one fewer.
  assert.match(source, /const maxVisible = isLandscape \? 2 : 3;/);
  assert.match(source, /scrollEnabled=\{false\}/);
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
  // The number is the table's; the square is the buttons' own. Read from the
  // two files that hold them, so neither half can move without saying so.
  const table = read("components/GameTable.tsx");
  assert.match(table, /const actionBtn = actionBtnSize\(scale\)/);
  // Both buttons take the same box.
  assert.equal((table.match(/size=\{actionBtn\}/g) ?? []).length, 2);
  const buttons = read("components/table/actions.tsx");
  assert.equal((buttons.match(/width: size, height: size/g) ?? []).length, 2);

  assert.equal(actionBtnSize(0.82), ACTION_BTN_FLOOR);
  assert.equal(actionBtnSize(1), 56);
  assert.ok(actionBtnSize(2) > actionBtnSize(1), "the key does not grow with the table");
});
