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
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every layer that covers the table, with a string from the overlay's own body
 * — a `<Modal>` somewhere else in the same file says nothing about this one.
 */
const BLOCKING_OVERLAYS: [string, string][] = [
  ["components/ExchangeModal.tsx", "styles.overlay"],
  ["components/GameOverOverlay.tsx", "styles.innerCol"],
  ["components/ResultExchangeOverlay.tsx", "exStyles.jokerEmoji"],
  ["components/ResultExchangeOverlay.tsx", "result.exchangeTitle"],
  ["components/ExchangeAnnouncement.tsx", "styles.overlay"],
  // The portrait "rotate your device" cover, which is the whole screen.
  ["components/GameTable.tsx", "portraitOverlayStyles.overlay"],
];

/** The text of every `<Modal …>…</Modal>` in `source`, nesting-aware. */
export function modalBodies(source: string): string[] {
  const out: string[] = [];
  for (let at = source.indexOf("<Modal"); at !== -1; at = source.indexOf("<Modal", at + 1)) {
    if (/[A-Za-z0-9_]/.test(source[at + 6] ?? "")) continue;
    const close = source.indexOf("</Modal>", at);
    if (close !== -1) out.push(source.slice(at, close));
  }
  return out;
}

test("every blocking overlay is inside a real modal", () => {
  const offenders = BLOCKING_OVERLAYS.filter(([rel, marker]) => {
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
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
    const source = readFileSync(path.join(repoRoot, rel), "utf8");
    for (const body of modalBodies(source)) {
      if (!body.includes(marker)) continue;
      if (!/onRequestClose=/.test(body)) offenders.push(`${rel} (${marker}): no close handler`);
      // aria-modal with no name announces as an unnamed dialog.
      if (!/accessibilityLabel=/.test(body)) offenders.push(`${rel} (${marker}): unnamed`);
    }
  }
  assert.deepEqual(offenders, [], offenders.join(", "));
});

test("the scanner reads one modal at a time", () => {
  assert.deepEqual(modalBodies("<Modal a>x</Modal>\n<Modal b>y</Modal>"), ["<Modal a>x", "<Modal b>y"]);
  assert.deepEqual(modalBodies("<ModalContent>x</ModalContent>"), []);
});

// The rail's settings sheet is the one blocking layer that must *not* be a
// Modal: a full-screen modal takes the tap away from the rail knob that opened
// it, and the knob is the sheet's own close control (#195). It carries what a
// Modal would have brought instead, so it is covered here rather than in the
// list above — which stays the list of modals.
const NON_MODAL_OVERLAY = "components/table/settingsSheet.tsx";
const NON_MODAL_PROPERTIES: [string, RegExp][] = [
  ["traps focus", /useFocusTrap\(/],
  ["answers Escape", /useEscapeToClose\(/],
  ["answers the Android back gesture", /useBackToClose\(/],
  ["is announced as a modal dialog", /aria-modal/],
  ["names itself", /"aria-label":/],
];

test("the settings sheet covers the table on a non-modal layer's own terms", () => {
  const source = readFileSync(path.join(repoRoot, NON_MODAL_OVERLAY), "utf8");
  assert.deepEqual(
    modalBodies(source),
    [],
    `${NON_MODAL_OVERLAY} is a Modal now, so it belongs in BLOCKING_OVERLAYS`
  );
  const missing = NON_MODAL_PROPERTIES.filter(([, re]) => !re.test(source)).map(([what]) => what);
  assert.deepEqual(missing, [], `${NON_MODAL_OVERLAY} no longer ${missing.join(", nor ")}`);
});
