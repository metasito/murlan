// tests/blockingOverlays.test.ts — an absolutely positioned view covers pixels
// and nothing else: it takes nothing out of the tab order or out of the
// accessibility tree, so every control it hides stays reachable behind it.
//
// React Native's <Modal> is what buys the focus trap, Escape and aria-modal —
// react-native-web ships all three (exports/Modal/ModalFocusTrap.js,
// ModalContent.js). Every blocking layer in the game must use one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  blankComments,
  coversNothing,
  fullBleedAccessors,
  fullBleedNodes,
  scannedFiles,
} from "./helpers/sourceScan.ts";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every layer that covers the table, with a string from the overlay's own body
 * — an `<AppModal>` somewhere else in the same file says nothing about this one.
 */
const BLOCKING_OVERLAYS: [string, string][] = [
  ["components/GameOverOverlay.tsx", "<ResultBoard"],
  ["components/ConfirmDialog.tsx", "StyleSheet.absoluteFill"],
  ["components/SettingsModal.tsx", "StyleSheet.absoluteFill"],
  ["components/ErrorFallback.tsx", "styles.modalOverlay"],
  ["components/SessionReplacedNotice.tsx", "styles.overlay"],
  ["app/(online)/index.tsx", "StyleSheet.absoluteFill"],
  // The portrait cover, which is the whole screen.
  ["components/table/rotateOverlay.tsx", "portraitOverlayStyles.overlay"],
];

/**
 * Full-bleed nodes that cover something other than the table, one entry per file with how
 * many of them it holds. The count is the point: a file named here would otherwise absorb
 * the next blocking layer added to it silently, which is the curated list's blind spot one
 * level up.
 */
const NOT_A_BLOCKER: [string, number, string][] = [
  ["components/table/felt.tsx", 1, "the table's own paint at zIndex 0 — the surface the game is drawn on, not a layer over it"],
  ["components/table/chrome.tsx", 1, "the rail is a fixed-width strip down one edge: full-height, never full-screen, and the table is laid out beside it"],
  ["app/index.tsx", 1, "the face of one animated card, absolute within that card's own view"],
  ["app/(online)/game.tsx", 1, 'the overlay layer itself is pointerEvents="box-none" — it takes no touch and holds no content, only the overlays that do'],
];

/**
 * Blocking layers that must not be Modals, each with the properties it carries instead of
 * the ones a Modal would have brought. A property here is a call site, not a promise — but
 * it can only say the layer is wired, never that the wiring is right. What the veil
 * actually withdraws is `tests/native/tableCoveredVeil.test.tsx`'s job.
 */
const NON_MODAL_OVERLAYS: [string, number, string, string, [string, RegExp][]][] = [
  [
    "components/table/settingsSheet.tsx",
    1,
    'testID="settings-veil"',
    "a full-screen modal takes the tap away from the rail knob that opened it, and the knob is the sheet's own close control (#195)",
    [
      ["traps focus", /useFocusTrap\(/],
      ["answers Escape", /useEscapeToClose\(/],
      ["answers the Android back gesture", /useBackToClose\(/],
      ["is announced as a dialog", /a11yDialog\(/],
    ],
  ],
];

/**
 * Layers that do cover a screen and do not trap focus. Listed rather than fixed here, each
 * against the issue that owns it: a reader behind one of these can still reach the controls
 * underneath. Adding to this list is how the debt stays visible — a new untrapped layer
 * cannot land without naming itself here. Empty is the goal, not the invariant.
 */
const UNTRAPPED: [string, number, string][] = [];

/** Every full-bleed node that could cover something, by file. */
export function candidatesByFile(files: string[], read: (rel: string) => string): Map<string, string[]> {
  const sources = new Map(files.map((f) => [f, blankComments(read(f))]));
  // A style sheet and the node wearing it need not share a file, so an accessor declared
  // anywhere is offered to every file that names its object.
  const declaredIn = new Map<string, string>();
  for (const [file, source] of sources) {
    for (const accessor of fullBleedAccessors(source)) declaredIn.set(accessor, file);
  }
  const found = new Map<string, string[]>();
  for (const [file, source] of sources) {
    const imported = [...declaredIn]
      .filter(
        ([accessor, from]) =>
          from !== file && new RegExp(String.raw`\b${accessor.split(".")[0]}\b`).test(source)
      )
      .map(([accessor]) => accessor);
    const covering = fullBleedNodes(source, imported).filter((tag) => !coversNothing(tag));
    if (covering.length) found.set(file, covering);
  }
  return found;
}

/** The text of every `<AppModal …>…</AppModal>` in `source`, nesting-aware. */
export function modalBodies(source: string): string[] {
  const out: string[] = [];
  const TAG = "<AppModal";
  for (let at = source.indexOf(TAG); at !== -1; at = source.indexOf(TAG, at + 1)) {
    if (/[A-Za-z0-9_]/.test(source[at + TAG.length] ?? "")) continue;
    const close = source.indexOf("</AppModal>", at);
    if (close !== -1) out.push(source.slice(at, close));
  }
  return out;
}

// The scan does not decide what a layer covers — it cannot, from source. It only refuses a
// candidate nobody has classified, so forgetting one is a red build rather than a silent
// hole. #337 added `components/table/chrome.tsx` to the curated list by hand; nothing would
// have noticed if the person adding the layer had not remembered.
test("every full-bleed layer has been classified by a human", () => {
  const candidates = candidatesByFile(scannedFiles(repoRoot), (rel) =>
    readFileSync(path.join(repoRoot, rel), "utf8")
  );
  const count = (list: [string, number, ...unknown[]][], file: string) =>
    list.filter(([f]) => f === file).reduce((n, [, c]) => n + c, 0);

  const unclassified: string[] = [];
  for (const [file, tags] of candidates) {
    const claimed =
      BLOCKING_OVERLAYS.filter(([f]) => f === file).length +
      count(NOT_A_BLOCKER, file) +
      count(NON_MODAL_OVERLAYS, file) +
      count(UNTRAPPED, file);
    if (claimed === tags.length) continue;
    const shown = tags.map((t) => `      ${t.replace(/\s+/g, " ").slice(0, 110)}`);
    unclassified.push(
      [`${file}: ${tags.length} full-bleed node(s), ${claimed} classified`, ...shown].join("\n")
    );
  }

  assert.deepEqual(
    unclassified,
    [],
    "classify each of these into BLOCKING_OVERLAYS, NOT_A_BLOCKER, NON_MODAL_OVERLAYS or UNTRAPPED " +
      `— a layer nobody has ruled on is a layer nobody has checked:\n  ${unclassified.join("\n  ")}`
  );
});

test("the classification lists name files that still exist and still qualify", () => {
  const candidates = candidatesByFile(scannedFiles(repoRoot), (rel) =>
    readFileSync(path.join(repoRoot, rel), "utf8")
  );
  const stale = [...NOT_A_BLOCKER, ...NON_MODAL_OVERLAYS, ...UNTRAPPED]
    .map(([file]) => file)
    .filter((file) => !candidates.has(file));
  assert.deepEqual(stale, [], `no longer full-bleed, so drop the entry: ${stale.join(", ")}`);
});

test("every blocking overlay is inside a real modal", () => {
  const offenders = BLOCKING_OVERLAYS.filter(([rel, marker]) => {
    const source = blankComments(readFileSync(path.join(repoRoot, rel), "utf8"));
    return !modalBodies(source).some((body) => body.includes(marker));
  }).map(([rel, marker]) => `${rel} (${marker})`);

  assert.deepEqual(
    offenders,
    [],
    `these cover the table without trapping focus: ${offenders.join(", ")}`
  );
});

// A <Modal> with no onRequestClose swallows Escape and the Android back
// gesture. Each of these answers it — inertly where the overlay is a gate the
// player has to pass through, which the source says at the call site.
test("every blocking overlay answers a close request and names itself", () => {
  const offenders: string[] = [];
  for (const [rel, marker] of BLOCKING_OVERLAYS) {
    const source = blankComments(readFileSync(path.join(repoRoot, rel), "utf8"));
    for (const body of modalBodies(source)) {
      if (!body.includes(marker)) continue;
      if (!/onRequestClose=/.test(body)) offenders.push(`${rel} (${marker}): no close handler`);
      // aria-modal with no name announces as an unnamed dialog. `a11yGroup`
      // carries the label as its argument, so the prop is not written out.
      if (!/accessibilityLabel=|a11yGroup\(/.test(body)) {
        offenders.push(`${rel} (${marker}): unnamed`);
      }
    }
  }
  assert.deepEqual(offenders, [], offenders.join(", "));
});

test("the scanner reads one modal at a time", () => {
  assert.deepEqual(modalBodies("<AppModal a>x</AppModal>\n<AppModal b>y</AppModal>"), [
    "<AppModal a>x",
    "<AppModal b>y",
  ]);
  assert.deepEqual(modalBodies("<AppModalContent>x</AppModalContent>"), []);
});

for (const [rel, , marker, why, properties] of NON_MODAL_OVERLAYS) {
  test(`${rel} covers a screen on a non-modal layer's own terms`, () => {
    const source = blankComments(readFileSync(path.join(repoRoot, rel), "utf8"));
    // This list asserts an absence, so a marker that no longer matches anything
    // would satisfy it silently — the opposite failure mode to BLOCKING_OVERLAYS.
    assert.ok(source.includes(marker), `${rel}: nothing in the source matches ${marker}`);
    assert.ok(
      !modalBodies(source).some((body) => body.includes(marker)),
      `${rel} (${marker}) is inside a Modal now, so it belongs in BLOCKING_OVERLAYS`
    );
    const missing = properties.filter(([, re]) => !re.test(source)).map(([what]) => what);
    assert.deepEqual(missing, [], `${rel} no longer ${missing.join(", nor ")} — ${why}`);
  });
}
