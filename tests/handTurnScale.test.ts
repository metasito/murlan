// tests/handTurnScale.test.ts — the hand comes closer on the viewer's own turn.
//
// The row is laid out once, at the off-turn size, and a transform carries it
// to the on-turn one (components/table/hand.tsx `useHandNear`). That order is
// the whole point: nearer means bigger and means the same fraction more air
// between the cards, but the overlap step a finger has to find is solved
// against the *smaller* of the two — so the strip a buried card exposes never
// depends on whose turn it is, and coming closer is never what makes the hand
// fit.
//
// Both halves are pure geometry, so they are checked here rather than in a
// browser. What only a browser can see — that the near hand is still centred
// and still cropped by the bottom edge — is tests/e2e/handParity.spec.ts.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cardScale,
  CARD_W,
  FIELD_SCALE,
  HAND_SCALE,
  HAND_SCALE_ON_TURN,
} from "../components/cardFaceModel.ts";
import { computeTableFrame, HAND_ZONE_GAP } from "../components/gameTableModel.ts";
import { computeHandLayout, MIN_READABLE_STEP } from "../components/handLayout.ts";
import { dealCards } from "../lib/gameEngine.ts";

/** The handsets tests/e2e/handParity.spec.ts runs on, smallest first. */
const PHONES = [
  { name: "iPhone SE", width: 568, height: 320 },
  { name: "iPhone 12", width: 844, height: 390 },
  { name: "iPhone 16 Pro", width: 874, height: 402 },
  { name: "iPhone 17 Pro Max", width: 956, height: 440 },
];

/** The biggest hand each seat count deals, from the engine rather than restated. */
const DEALS = ([2, 3, 4] as const).map((seats) => ({
  seats,
  n: Math.max(...dealCards(seats).hands.map((h) => h.length)),
}));

/** What the transform has to do to take the laid-out row to its on-turn size. */
const NEAR = HAND_SCALE_ON_TURN / HAND_SCALE;

/** The row hand.tsx lays out on `phone` holding `n` cards, and the room it has. */
function row(phone: (typeof PHONES)[number], n: number) {
  const scale = cardScale(Math.min(phone.width, phone.height));
  const frame = computeTableFrame({
    width: phone.width,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    scale,
  });
  const cardW = CARD_W(scale * HAND_SCALE);
  const { step, totalW } = computeHandLayout(n, frame.handRoomW, cardW, frame.handAvailW);
  return {
    step,
    width: Math.min(totalW, frame.handAvailW),
    availW: frame.handAvailW,
    gap: HAND_ZONE_GAP * scale,
  };
}

describe("the hand's two sizes", () => {
  test("a hand card is bigger than a field card, and bigger still on your own turn", () => {
    assert.ok(HAND_SCALE > FIELD_SCALE, `hand ${HAND_SCALE} is not above field ${FIELD_SCALE}`);
    assert.ok(
      HAND_SCALE_ON_TURN > HAND_SCALE,
      `on turn ${HAND_SCALE_ON_TURN} is not above off turn ${HAND_SCALE}`
    );
  });

  // Big enough to read as the hand being picked up, small enough that three
  // turns a round of it is not the table breathing at the player.
  test("the two sizes are a step apart, not a jump", () => {
    assert.ok(NEAR > 1.05, `a ${((NEAR - 1) * 100).toFixed(1)}% move will not read as anything`);
    assert.ok(NEAR < 1.2, `a ${((NEAR - 1) * 100).toFixed(1)}% move is a lurch, not a lean`);
  });

  for (const phone of PHONES) {
    for (const { seats, n } of DEALS) {
      // The floor holds at the size the row is laid out at, which is the
      // off-turn one — a step measured on the turn the player is coming into
      // would shrink back under the thumb the moment the turn passed.
      test(`${phone.name}, ${seats} seats: the exposed strip holds off turn`, () => {
        const { step } = row(phone, n);
        assert.ok(
          step >= MIN_READABLE_STEP,
          `step ${step.toFixed(1)} is under the ${MIN_READABLE_STEP}px floor off turn`
        );
      });

      // The near hand may spill into the air either side of the row, which is
      // there for it, but never as far as the two buttons that air separates
      // it from.
      test(`${phone.name}, ${seats} seats: the near hand stays off the action buttons`, () => {
        const { width, availW, gap } = row(phone, n);
        assert.ok(
          width * NEAR <= availW + gap * 2,
          `the hand comes to ${(width * NEAR).toFixed(1)}px in a ` +
            `${(availW + gap * 2).toFixed(1)}px zone — it reaches PASSA and GIOCA`
        );
        assert.ok(width * NEAR <= phone.width, "the hand runs off the side of the screen");
      });
    }
  }
});
