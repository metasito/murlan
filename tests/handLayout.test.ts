// Layout math for StraightHand's card row (components/table/hand.tsx),
// extracted to components/handLayout.ts specifically so it is importable
// here — Node's native TS loader can type-strip a plain .ts file but cannot
// parse the JSX in hand.tsx.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CARD_W } from "../components/cardFaceModel.ts";
import {
  MAX_STEP_RATIO,
  MIN_READABLE_STEP,
  cardAtX,
  computeHandLayout,
  hitWidth,
} from "../components/handLayout.ts";
import { HAND_ARC } from "../components/tableArc.ts";

// A representative resolved card width — the pure layout math takes it as a
// parameter now that CARD_W itself is scale-derived; these tests exercise the
// math at one fixed width, same as before scale existed.
const CW = CARD_W(1);
/** The widest this card ever steps — see MAX_STEP_RATIO. */
const MAX_STEP_AT_CW = CW * MAX_STEP_RATIO;

const WIDTHS = [320, 375, 428, 500, 600, 700, 768, 900, 1024];
// Deal sizes per docs/BRIEF.md §3.1: 4p up to 14, 3p up to 18, 2p up to 21.
const HAND_SIZES = Array.from({ length: 21 }, (_, i) => i + 1);

describe("computeHandLayout", () => {
  // WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA. Adjacent card centres
  // are exactly `step` apart, so a step under 24 fails both the 24x24 size
  // test and the undersized-target spacing exception.
  test("MIN_READABLE_STEP is the WCAG 2.2 AA floor", () => {
    assert.ok(MIN_READABLE_STEP >= 24, `step floor is ${MIN_READABLE_STEP}, SC 2.5.8 needs 24`);
    assert.ok(MIN_READABLE_STEP < CW);
  });

  // The step and the curve the cards are laid on have to agree about how wide
  // the hand is, so the cap is the arc's own ratio rather than a second number.
  test("MAX_STEP_RATIO is the hand arc's own step ratio", () => {
    assert.equal(MAX_STEP_RATIO, HAND_ARC.stepRatio);
    assert.ok(MAX_STEP_RATIO * CW > MIN_READABLE_STEP);
  });

  // The viewports a landscape phone actually produces, against the deal sizes
  // that reach them: 511 is a 667x375 web viewport, 600 a 844-wide native one
  // with notch insets, 688 a 844x390 web one. 14 is the 4-player deal, 21 the
  // 2-player one.
  for (const availW of [511, 600, 688]) {
    for (const n of [13, 14, 18, 21]) {
      test(`n=${n} availW=${availW} keeps every card its own 24px target`, () => {
        assert.ok(computeHandLayout(n, availW, CW).step >= 24);
      });
    }
  }

  test("n=0 and n=1 need no overlap math", () => {
    for (const availW of WIDTHS) {
      assert.deepEqual(computeHandLayout(0, availW, CW), { step: 0, totalW: CW, scrollable: false });
      assert.deepEqual(computeHandLayout(1, availW, CW), { step: 0, totalW: CW, scrollable: false });
    }
  });

  for (const availW of WIDTHS) {
    for (const n of HAND_SIZES) {
      test(`n=${n} availW=${availW}: never clipped, never below the readable step`, () => {
        const { step, totalW, scrollable } = computeHandLayout(n, availW, CW);

        // No negative offsets: every card's left edge (i * step) is >= 0.
        assert.ok(step >= 0, `step must not be negative (got ${step})`);
        const lastOffset = (n - 1) * step;
        assert.ok(lastOffset >= 0, `last card offset must not be negative (got ${lastOffset})`);

        // The corner must stay legible: step is always at least the derived
        // minimum once there is more than one card to overlap.
        if (n > 1) {
          assert.ok(
            step >= MIN_READABLE_STEP,
            `step ${step} below MIN_READABLE_STEP ${MIN_READABLE_STEP} at n=${n} availW=${availW}`
          );
        }

        // totalW is internally consistent with step.
        assert.equal(totalW, step * (n - 1) + CW);

        // A hand fans out only so far, however much room it is given: past
        // this the cards stop overlapping and read as a row, not a hand.
        assert.ok(
          step <= MAX_STEP_AT_CW + 1e-9,
          `step ${step} exceeds the arc's own ${MAX_STEP_AT_CW} at n=${n} availW=${availW}`
        );

        if (scrollable) {
          // Only the fallback for a hand that genuinely cannot fit at the
          // finger floor is allowed to exceed availW — and when it does,
          // the row must scroll (the caller wraps it in a ScrollView), never
          // clip: nothing here silently drops below MIN_READABLE_STEP to
          // force a fit.
          assert.ok(totalW > availW, "scrollable must only trigger when the row truly cannot fit");
          assert.equal(step, MIN_READABLE_STEP, "scrollable rows hold the step at the finger floor");
        } else {
          // The common case: the whole hand fits, unclipped, inside availW.
          // Tolerate floating-point noise from the division in computeHandLayout
          // (e.g. 768.0000000000001) — a fraction of a pixel is not a clip.
          assert.ok(totalW <= availW + 1e-6, `totalW ${totalW} exceeds availW ${availW} without scrolling`);
        }
      });
    }
  }

  test("step degrades smoothly across the scrollable boundary (no jump)", () => {
    // At the exact width where a hand stops fitting, the step computed just
    // before and just after crossing into "scrollable" must be continuous —
    // the layout should not visibly jump as the hand grows by one card or
    // the screen shrinks by one pixel.
    const n = 20;
    let prevStep: number | null = null;
    for (let availW = 320; availW <= 1024; availW += 1) {
      const { step } = computeHandLayout(n, availW, CW);
      if (prevStep !== null) {
        assert.ok(Math.abs(step - prevStep) <= 1, `step jumped from ${prevStep} to ${step} at availW=${availW}`);
      }
      prevStep = step;
    }
  });

  test("more cards never increases the step for a fixed width", () => {
    // n=1 is special-cased to step=0 (no overlap math needed for a single
    // card), so monotonicity is only a meaningful property from n=2 up.
    const availW = 700;
    let prevStep = computeHandLayout(2, availW, CW).step;
    for (const n of HAND_SIZES.slice(1)) {
      const { step } = computeHandLayout(n, availW, CW);
      assert.ok(step <= prevStep + 1e-9, `step increased from ${prevStep} to ${step} going from fewer to more cards`);
      prevStep = step;
    }
  });

  test("a row past any real deal on a small device scrolls instead of clipping", () => {
    const { step, totalW, scrollable } = computeHandLayout(21, 320, CW);
    assert.equal(scrollable, true);
    assert.ok(step >= MIN_READABLE_STEP);
    assert.ok(totalW > 320);
  });

  test("13-card hand (the pre-existing baseline) still fits without scrolling on a real device width", () => {
    const { totalW, scrollable } = computeHandLayout(13, 700, CW);
    assert.equal(scrollable, false);
    assert.ok(totalW <= 700);
  });

  // A hand overlaps far past half a card, so a card's geometric centre is
  // under its neighbour — which is where a click or tap resolves, and is what
  // silently froze two offline e2e games once hand cards started scaling with
  // the table. The fix is the tap strip (`hitWidth`, components/CardView.tsx),
  // not a wider step: what this file has to guarantee is that the strip a card
  // exposes is a target in the first place.
  test("the strip a card exposes is never smaller than a finger", () => {
    for (const cardW of [CARD_W(0.82), CARD_W(1), CARD_W(1.85)]) {
      for (const availW of [320, 511, 900, 1280]) {
        for (const n of [13, 14, 18, 21]) {
          const { step } = computeHandLayout(n, availW, cardW);
          assert.ok(
            step >= MIN_READABLE_STEP,
            `exposed strip ${step} under ${MIN_READABLE_STEP} at n=${n} cardW=${cardW} availW=${availW}`
          );
        }
      }
    }
  });

  // The hand is the same width whether it holds five cards or eighteen —
  // it compresses inside its share rather than reaching further for each card
  // added. Only the finger floor may push it past that share.
  test("a full hand takes no more room than the share it is given", () => {
    const room = 500;
    for (let n = 2; n <= 21; n++) {
      const { step, totalW } = computeHandLayout(n, room, CW);
      if (step > MIN_READABLE_STEP) {
        assert.ok(totalW <= room + 1e-9, `n=${n} spans ${totalW} of a ${room} share`);
      }
    }
  });
});

describe("which card a tap belongs to", () => {
  const N = 14;
  const { step } = computeHandLayout(N, 600, CW);

  test("the strips tile the row: no overlap, no gap", () => {
    let x = 0;
    for (let i = 0; i < N; i++) {
      assert.equal(cardAtX(x, N, step, CW), i, `the left edge of card ${i} belongs to it`);
      const w = hitWidth(i, N, step, CW);
      assert.equal(
        cardAtX(x + w - 1e-6, N, step, CW),
        i,
        `the right edge of card ${i}'s strip belongs to it`
      );
      x += w;
    }
    // The last card owns a whole card rather than a step, so the strips end
    // exactly where the row does.
    assert.equal(x, step * (N - 1) + CW);
  });

  test("only the last card is as wide as it is drawn", () => {
    for (let i = 0; i < N - 1; i++) assert.equal(hitWidth(i, N, step, CW), step);
    assert.equal(hitWidth(N - 1, N, step, CW), CW);
  });

  test("a tap off either end belongs to no card", () => {
    assert.equal(cardAtX(-1, N, step, CW), null);
    assert.equal(cardAtX(step * (N - 1) + CW, N, step, CW), null);
  });

  test("a hand of one is the whole card", () => {
    const one = computeHandLayout(1, 600, CW);
    assert.equal(hitWidth(0, 1, one.step, CW), CW);
    assert.equal(cardAtX(0, 1, one.step, CW), 0);
    assert.equal(cardAtX(CW - 1e-6, 1, one.step, CW), 0);
    assert.equal(cardAtX(CW, 1, one.step, CW), null);
  });
});
