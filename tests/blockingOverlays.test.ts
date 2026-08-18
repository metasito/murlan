// tests/blockingOverlays.test.ts — an absolutely positioned view covers pixels
// and nothing else. It does not leave anything out of the tab order or out of
// the accessibility tree, so a keyboard or screen-reader player reaching the
// exchange phase used to Tab through a dozen inert cards behind the scrim
// before finding the card picker.
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

/** Every layer that covers the table and must be dismissed before play resumes. */
const BLOCKING_OVERLAYS = [
  "components/ExchangeModal.tsx",
  "components/GameOverOverlay.tsx",
  "components/ResultExchangeOverlay.tsx",
  "components/ExchangeAnnouncement.tsx",
  // The portrait "rotate your device" cover, which is the whole screen.
  "components/GameTable.tsx",
];

test("every blocking overlay is a real modal", () => {
  const offenders = BLOCKING_OVERLAYS.filter(
    (rel) => !/<Modal\b/.test(readFileSync(path.join(repoRoot, rel), "utf8"))
  );
  assert.deepEqual(
    offenders,
    [],
    `these cover the table without trapping focus: ${offenders.join(", ")}`
  );
});

// A <Modal> with no onRequestClose swallows Escape and the Android back
// gesture silently. Each of these answers it — inertly where the overlay is a
// gate the player has to pass through, which the source comments say.
test("every blocking overlay answers a close request", () => {
  const offenders = BLOCKING_OVERLAYS.filter(
    (rel) => !/onRequestClose=/.test(readFileSync(path.join(repoRoot, rel), "utf8"))
  );
  assert.deepEqual(offenders, [], `no close handler: ${offenders.join(", ")}`);
});
