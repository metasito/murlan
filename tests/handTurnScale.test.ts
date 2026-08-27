// tests/handTurnScale.test.ts — the hand comes closer on the viewer's own turn.
//
// Two sizes, both real layout (`components/table/hand.tsx` picks between them
// from `isMyTurn`); the transform only carries the change and is 1 at rest.
// That makes what the hand *is* at each size pure geometry, which is what this
// file checks. What only a browser can see — that the near hand is still
// centred, still cropped by the bottom edge, and actually renders bigger — is
// tests/e2e/handParity.spec.ts.
//
// The share the row aims at grows with the card, so the fan opens instead of
// overlapping harder at a larger size. Three things have to survive that:
//
//   · the exposed strip stays a finger wide at BOTH sizes, on-turn included —
//     the size the player is holding while they choose a card;
//   · neither size reaches PASSA or GIOCA, which the row's own air separates
//     it from;
//   · a hand that fits without scrolling off turn still does on it — the
//     scroll fallback is for a full deal on a small phone, not for a turn.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  cardScale,
  CARD_W,
  FIELD_SCALE,
  HAND_NEAR_RATIO,
  HAND_SCALE,
  HAND_SCALE_ON_TURN,
} from "../components/cardFaceModel.ts";
import { computeTableFrame, HAND_ZONE_GAP } from "../components/gameTableModel.ts";
import { computeHandLayout, MIN_READABLE_STEP } from "../components/handLayout.ts";
import { PHONES, type Phone } from "./e2e/helpers/phones.ts";
import { dealCards } from "../lib/gameEngine.ts";

/** The biggest hand each seat count deals, from the engine rather than restated. */
const DEALS = ([2, 3, 4] as const).map((seats) => ({
  seats,
  n: Math.max(...dealCards(seats).hands.map((h) => h.length)),
}));

/**
 * How close to PASSA and GIOCA the row may come, as a share of the air between
 * them. The row is centred in that air, so a fan that spent all of it would be
 * touching both buttons.
 */
const GAP_HEADROOM = 0.5;

/** The row hand.tsx lays out on `phone`, holding `n` cards, on or off turn. */
function row(phone: Phone, n: number, onTurn: boolean) {
  const scale = cardScale(Math.min(phone.width, phone.height));
  const frame = computeTableFrame({
    width: phone.width,
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    scale,
  });
  const cardW = CARD_W(scale * (onTurn ? HAND_SCALE_ON_TURN : HAND_SCALE));
  const room = onTurn ? frame.handRoomW * HAND_NEAR_RATIO : frame.handRoomW;
  const { step, totalW, scrollable } = computeHandLayout(n, room, cardW, frame.handAvailW);
  return {
    step,
    scrollable,
    /** What the row actually spans: past `availW` the ScrollView is the edge. */
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
    assert.equal(HAND_NEAR_RATIO, HAND_SCALE_ON_TURN / HAND_SCALE);
  });

  // Big enough to read as the hand being picked up, small enough that three
  // turns a round of it is not the table breathing at the player.
  test("the two sizes are a step apart, not a jump", () => {
    const pct = ((HAND_NEAR_RATIO - 1) * 100).toFixed(1);
    assert.ok(HAND_NEAR_RATIO > 1.05, `a ${pct}% move will not read as anything`);
    assert.ok(HAND_NEAR_RATIO < 1.2, `a ${pct}% move is a lurch, not a lean`);
  });

  for (const phone of PHONES) {
    for (const { seats, n } of DEALS) {
      for (const onTurn of [false, true]) {
        const where = `${phone.name}, ${seats} seats, ${onTurn ? "on" : "off"} turn`;

        test(`${where}: the exposed strip is still a finger wide`, () => {
          const { step } = row(phone, n, onTurn);
          assert.ok(
            step >= MIN_READABLE_STEP,
            `step ${step.toFixed(1)} is under the ${MIN_READABLE_STEP}px floor`
          );
        });

        test(`${where}: the row keeps clear of the action buttons`, () => {
          const { width, availW, gap } = row(phone, n, onTurn);
          const ceiling = availW + gap * 2 * GAP_HEADROOM;
          assert.ok(
            width < ceiling,
            `the row spans ${width.toFixed(1)}px, past the ${ceiling.toFixed(1)}px it may reach`
          );
        });
      }

      // The scroll fallback exists for a full deal on a small phone. A hand
      // that fits at rest must not start scrolling for the turn coming round.
      test(`${phone.name}, ${seats} seats: coming closer does not start a scroll`, () => {
        const off = row(phone, n, false);
        const on = row(phone, n, true);
        if (!off.scrollable) {
          assert.equal(on.scrollable, false, "the near hand scrolls where the far one did not");
        }
      });

      // The point of the larger size: not just bigger cards, but the fan
      // opening with them. Where the row is not already compressed onto the
      // finger floor, the gap between two cards has to grow.
      test(`${phone.name}, ${seats} seats: the fan opens, it does not just overlap harder`, () => {
        const off = row(phone, n, false);
        const on = row(phone, n, true);
        if (off.step > MIN_READABLE_STEP) {
          assert.ok(
            on.step > off.step,
            `step went ${off.step.toFixed(1)} -> ${on.step.toFixed(1)} as the hand came closer`
          );
        }
      });
    }
  }
});
